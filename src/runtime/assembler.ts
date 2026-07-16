/**
 * Runtime vehicle assembler: turns a validated blueprint into one Rapier
 * compound rigid body (per-part cuboid colliders with explicit masses, so
 * Rapier derives total mass / CoM / inertia), plus wheel runtime state and
 * live structural connections. See docs/vehicle_editor/PHYSICS_MODEL.md.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type {
  PartDefinition,
  PlacedPart,
  StructuralConnection,
  SuspensionParams,
  Vec3,
  VehicleBlueprint,
  WheelDefinition,
} from '../core/types.ts';
import { CELL_SIZE, SUSPENSION_PRESET_MULTIPLIERS } from '../core/types.ts';
import {
  FACE_VECTORS,
  rotateFace,
  rotateVec,
  worldCells,
} from '../core/grid.ts';
import { cellCentreM, placedCellMasses } from '../core/mass.ts';

export type GetDef = (defId: string) => PartDefinition;

// Collision groups: (memberships << 16) | filter
export const GROUP_TERRAIN = 0x0001;
export const GROUP_VEHICLE = 0x0002;
export const GROUP_WHEEL = 0x0004;
export const GROUP_DEBRIS = 0x0008;
export const GROUP_ZOMBIE = 0x0010;

export const VEHICLE_GROUPS =
  (GROUP_VEHICLE << 16) | (GROUP_TERRAIN | GROUP_DEBRIS | GROUP_ZOMBIE);
export const ATTACHED_WHEEL_GROUPS = GROUP_WHEEL << 16; // filter 0: mass only
export const DEBRIS_GROUPS =
  (GROUP_DEBRIS << 16) |
  (GROUP_TERRAIN | GROUP_DEBRIS | GROUP_ZOMBIE | GROUP_VEHICLE);
export const WHEEL_RAY_GROUPS = (0xffff << 16) | GROUP_TERRAIN;

export interface RuntimePart {
  placed: PlacedPart;
  def: PartDefinition;
  health: number;
  alive: boolean;
  /** Collider handles (on whichever body currently owns the part). */
  colliderHandles: number[];
  /** Local (vehicle-frame) centres of this part's colliders, metres. */
  colliderCentresM: Vec3[];
  detached: boolean;
}

export interface RuntimeWheel {
  partId: string;
  wheelDef: WheelDefinition;
  suspension: SuspensionParams; // preset-scaled
  driven: boolean;
  steering: boolean;
  steerInverted: boolean;
  braking: boolean;
  anchorLocal: Vec3; // vehicle-local metres (cell centre)
  axleLocal: Vec3; // unit, rotated by placement
  suspDirLocal: Vec3; // unit, rotated by placement
  radius: number;
  inertia: number; // kg·m²
  // mutable state
  omega: number; // rad/s
  steerAngle: number; // rad, current
  compression: number; // m, previous step
  grounded: boolean;
  contactPointW: Vec3 | null;
  loadN: number;
  broken: boolean;
}

export interface AssembledVehicle {
  body: RAPIER.RigidBody;
  parts: Map<string, RuntimePart>;
  wheels: RuntimeWheel[];
  connections: StructuralConnection[];
  /** partId -> connection indices, for damage lookups. */
  connectionsByPart: Map<string, number[]>;
  rootPartId: string;
}

function suspensionScaled(
  base: SuspensionParams,
  preset: keyof typeof SUSPENSION_PRESET_MULTIPLIERS,
): SuspensionParams {
  const m = SUSPENSION_PRESET_MULTIPLIERS[preset];
  return {
    restLength: base.restLength,
    travel: base.travel * m.travel,
    stiffness: base.stiffness * m.stiffness,
    damping: base.damping * m.damping,
    maxLoad: base.maxLoad * m.maxLoad,
  };
}

/** Lowest solid point (vehicle-local metres, Y) so spawns can clear the ground. */
export function lowestPointM(bp: VehicleBlueprint, getDef: GetDef): number {
  let minY = Infinity;
  for (const p of bp.parts) {
    const def = getDef(p.defId);
    for (const c of worldCells(def.cells, p.pos, p.orient)) {
      minY = Math.min(minY, c.y * CELL_SIZE);
    }
    if (def.wheel) {
      const centre = cellCentreM(p.pos);
      const susp = rotateVec(p.orient, def.wheel.suspensionDir);
      minY = Math.min(
        minY,
        centre.y +
          susp.y * (def.wheel.suspension.restLength + def.wheel.radius),
      );
    }
  }
  return minY === Infinity ? 0 : minY;
}

export function assembleVehicle(
  world: RAPIER.World,
  bp: VehicleBlueprint,
  getDef: GetDef,
  connections: StructuralConnection[],
  spawn: { translation: Vec3; yawRad?: number },
): AssembledVehicle {
  const yaw = spawn.yawRad ?? 0;
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(
      spawn.translation.x,
      spawn.translation.y,
      spawn.translation.z,
    )
    .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
    .setCanSleep(false);
  const body = world.createRigidBody(bodyDesc);

  const parts = new Map<string, RuntimePart>();
  const wheels: RuntimeWheel[] = [];
  let rootPartId = '';
  const half = CELL_SIZE / 2;

  for (const placed of bp.parts) {
    const def = getDef(placed.defId);
    if (def.isRoot) rootPartId = placed.id;
    const entry: RuntimePart = {
      placed,
      def,
      health: def.health,
      alive: true,
      colliderHandles: [],
      colliderCentresM: [],
      detached: false,
    };

    if (def.wheel) {
      // Wheels: collider carries mass but collides with nothing while attached
      // (suspension raycast does the ground work; box collider would fight it).
      const centre = cellCentreM(placed.pos);
      const w = def.wheel;
      const desc = RAPIER.ColliderDesc.cuboid(half, half, half)
        .setTranslation(centre.x, centre.y, centre.z)
        .setMass(def.massKg)
        .setCollisionGroups(ATTACHED_WHEEL_GROUPS);
      const col = world.createCollider(desc, body);
      entry.colliderHandles.push(col.handle);
      entry.colliderCentresM.push(centre);

      const preset = placed.config.suspensionPreset ?? 'standard';
      // Normalize axle handedness: a mirrored wheel is physically the same
      // wheel (the differential spins each side opposite so both roll the
      // vehicle forward). If the wheel's rolling direction opposes vehicle
      // forward (+Z), flip the axle. Genuinely wrong mounts (axle along Z or
      // vertical) have |forward.z| ≈ 0 and are left broken on purpose.
      let axleLocal = rotateVec(placed.orient, w.axleAxis);
      const suspLocal = rotateVec(placed.orient, w.suspensionDir);
      const upL = { x: -suspLocal.x, y: -suspLocal.y, z: -suspLocal.z };
      const rollFwdZ = axleLocal.x * upL.y - axleLocal.y * upL.x; // (axle × up).z
      if (rollFwdZ < -0.5) {
        axleLocal = { x: -axleLocal.x, y: -axleLocal.y, z: -axleLocal.z };
      }
      wheels.push({
        partId: placed.id,
        wheelDef: w,
        suspension: suspensionScaled(w.suspension, preset),
        driven: placed.config.driven ?? false,
        steering: placed.config.steering ?? false,
        steerInverted: placed.config.steerInverted ?? false,
        braking: placed.config.braking ?? true,
        anchorLocal: centre,
        axleLocal,
        suspDirLocal: suspLocal,
        radius: w.radius,
        inertia: 0.6 * def.massKg * w.radius * w.radius,
        omega: 0,
        steerAngle: 0,
        compression: 0,
        grounded: false,
        contactPointW: null,
        loadN: 0,
        broken: false,
      });
    } else if (def.cells.length === 0) {
      // Face-mounted armour/shell: thin slab on the covered face.
      const socket = def.sockets[0];
      const face = rotateFace(placed.orient, socket?.face ?? 'pz');
      const fv = FACE_VECTORS[face];
      const centre = cellCentreM(placed.pos);
      const t = 0.06; // slab thickness, m
      const off = half - t / 2;
      const hx = fv.x !== 0 ? t / 2 : half;
      const hy = fv.y !== 0 ? t / 2 : half;
      const hz = fv.z !== 0 ? t / 2 : half;
      const cx = centre.x + fv.x * off;
      const cy = centre.y + fv.y * off;
      const cz = centre.z + fv.z * off;
      const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(cx, cy, cz)
        .setMass(def.massKg)
        .setFriction(0.5)
        .setCollisionGroups(VEHICLE_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(100_000);
      const col = world.createCollider(desc, body);
      entry.colliderHandles.push(col.handle);
      entry.colliderCentresM.push({ x: cx, y: cy, z: cz });
    } else {
      for (const cm of placedCellMasses(def, placed)) {
        const desc = RAPIER.ColliderDesc.cuboid(half, half, half)
          .setTranslation(cm.centreM.x, cm.centreM.y, cm.centreM.z)
          .setMass(cm.massKg)
          .setFriction(0.5)
          .setCollisionGroups(VEHICLE_GROUPS)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(100_000);
        const col = world.createCollider(desc, body);
        entry.colliderHandles.push(col.handle);
        entry.colliderCentresM.push(cm.centreM);
      }
    }
    parts.set(placed.id, entry);
  }

  const live = connections.map((c) => ({ ...c }));
  const connectionsByPart = new Map<string, number[]>();
  live.forEach((c, i) => {
    for (const id of [c.aId, c.bId]) {
      const arr = connectionsByPart.get(id) ?? [];
      arr.push(i);
      connectionsByPart.set(id, arr);
    }
  });

  return {
    body,
    parts,
    wheels,
    connections: live,
    connectionsByPart,
    rootPartId,
  };
}
