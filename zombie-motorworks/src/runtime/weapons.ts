/**
 * Weapon runtime: fixed guns fire along their mounted forward axis; turrets
 * yaw toward the player's aim within (360°) arc. Hitscan projectiles with a
 * tracer segment returned for rendering; recoil impulse applied at the mount.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type { AssembledVehicle, GetDef } from './assembler.ts';
import {
  GROUP_DEBRIS,
  GROUP_TERRAIN,
  GROUP_ZOMBIE,
  resolvePlacedDef,
} from './assembler.ts';
import type {
  DamageType,
  PlacedPart,
  Vec3,
  WeaponDefinition,
} from '../core/types.ts';
import { rotateVec } from '../core/grid.ts';
import { cellCentreM } from '../core/mass.ts';
import { getPartDef } from '../core/parts.ts';
import { KID_LABELS } from '../core/tutorial.ts';
import {
  add,
  clamp,
  norm,
  rotateAroundAxis,
  rotateByQuat,
  scale,
  v3,
} from './vec.ts';

export interface RuntimeWeapon {
  partId: string;
  def: WeaponDefinition;
  /** Display name of the mounting part, for the ammo HUD. */
  label: string;
  mountLocal: Vec3;
  forwardLocal: Vec3;
  yaw: number; // turret yaw relative to mounted forward, rad
  cooldown: number; // s
  /** Elapsed time in the current burst cycle for periodic burst weapons, s. */
  cycleTime: number;
  shotsFired: number;
  /** Rounds left in this weapon's own magazine. */
  ammo: number;
  /** Magazine size, from the mounting part's ammoCapacity. */
  ammoCapacity: number;
}

export interface TracerShot {
  from: Vec3;
  to: Vec3;
  hitZombieHandle: number | null;
  damage: number;
  /** Delivery type of the firing weapon; aoe rays render as flame. */
  damageType: DamageType;
}

export function createWeapon(
  placed: PlacedPart,
  getDef: GetDef = getPartDef,
): RuntimeWeapon {
  const partDef = resolvePlacedDef(placed, getDef);
  const def = partDef.weapon;
  if (def === undefined) {
    throw new Error(`Part definition ${placed.defId} is not a weapon`);
  }
  const ammoCapacity = partDef.ammoCapacity ?? 0;
  return {
    partId: placed.id,
    def,
    label: KID_LABELS[partDef.id]?.name ?? partDef.name,
    mountLocal: cellCentreM(placed.pos),
    forwardLocal: rotateVec(placed.orient, { x: 0, y: 0, z: 1 }),
    yaw: 0,
    cooldown: 0,
    cycleTime: 0,
    shotsFired: 0,
    ammo: ammoCapacity,
    ammoCapacity,
  };
}

const TURRET_YAW_RATE = 3.2; // rad/s
const WEAPON_RAY_GROUPS =
  (0xffff << 16) | (GROUP_TERRAIN | GROUP_ZOMBIE | GROUP_DEBRIS);

export interface WeaponStepResult {
  shots: TracerShot[];
  ammoUsed: number;
  powerUsed: number;
}

export interface WeaponAimInput {
  aimYawWorld: number;
  fire: boolean;
  /** World-space target centre for automatic weapons. Manual aim remains yaw-only. */
  aimPoint?: Vec3;
}

export interface WeaponStepInput extends WeaponAimInput {
  weaponAim?: ReadonlyMap<string, WeaponAimInput>;
}

export function stepWeapons(
  world: RAPIER.World,
  vehicle: AssembledVehicle,
  weapons: RuntimeWeapon[],
  attachedAliveIds: Set<string>,
  input: WeaponStepInput,
  powerAvailable: number,
  dt: number,
): WeaponStepResult {
  const body = vehicle.body;
  const rot = body.rotation();
  const pos = body.translation();
  const shots: TracerShot[] = [];
  let ammoUsed = 0;
  let powerUsed = 0;

  for (const wpn of weapons) {
    wpn.cooldown = Math.max(0, wpn.cooldown - dt);
    if (!attachedAliveIds.has(wpn.partId)) continue;
    const weaponInput = input.weaponAim?.get(wpn.partId) ?? input;

    const up = norm(rotateByQuat(rot, v3(0, 1, 0)));
    const mountedFwdW = norm(rotateByQuat(rot, wpn.forwardLocal));

    if (wpn.def.mountType === 'turret') {
      // Desired world yaw -> yaw relative to mounted forward, arc-clamped.
      const fwdYawW = Math.atan2(mountedFwdW.x, mountedFwdW.z);
      let desired =
        wpn.def.arcDeg >= 360
          ? normalizeAngle(weaponInput.aimYawWorld - fwdYawW)
          : clamp(
              normalizeAngle(weaponInput.aimYawWorld - fwdYawW),
              -halfArc(wpn.def),
              halfArc(wpn.def),
            );
      if (wpn.def.arcDeg >= 360) {
        // shortest-path tracking, unbounded arc
        desired = normalizeAngle(desired);
      }
      const dYaw = clamp(
        normalizeAngle(desired - wpn.yaw),
        -TURRET_YAW_RATE * dt,
        TURRET_YAW_RATE * dt,
      );
      wpn.yaw += dYaw;
    } else {
      wpn.yaw = 0;
    }

    let wantsFire: boolean;
    if (wpn.def.fireMode === 'periodic') {
      const { burstSeconds, burstIntervalSeconds } = wpn.def;
      if (burstSeconds !== undefined && burstIntervalSeconds !== undefined) {
        // Spray while inside the burst window, then wait out the cycle.
        wantsFire = wpn.cycleTime < burstSeconds;
        wpn.cycleTime = (wpn.cycleTime + dt) % burstIntervalSeconds;
      } else {
        wantsFire = true;
      }
    } else {
      wantsFire = weaponInput.fire;
    }
    if (!wantsFire || wpn.cooldown > 0) continue;
    // Each weapon draws from its own magazine; battery power stays shared.
    if (wpn.ammo < wpn.def.ammoPerShot) continue;
    if (powerAvailable - powerUsed < wpn.def.powerPerShot) continue;

    const yawDir =
      wpn.yaw !== 0
        ? norm(rotateAroundAxis(mountedFwdW, up, wpn.yaw))
        : mountedFwdW;
    const mountW = add(
      v3(pos.x, pos.y, pos.z),
      rotateByQuat(rot, wpn.mountLocal),
    );
    const fireDir = wpn.def.aimMode === 'auto' && weaponInput.aimPoint
      ? pitchedDirection(yawDir, up, mountW, weaponInput.aimPoint)
      : yawDir;

    // Cone weapons fan raysPerShot rays across coneDeg around the fire
    // direction; conventional weapons are the single-ray special case.
    const rays = wpn.def.coneDeg !== undefined
      ? Math.max(1, wpn.def.raysPerShot ?? 1)
      : 1;
    const halfCone = ((wpn.def.coneDeg ?? 0) / 2) * (Math.PI / 180);
    for (let i = 0; i < rays; i++) {
      const offset =
        rays === 1 ? 0 : -halfCone + (2 * halfCone * i) / (rays - 1);
      const rayDir =
        offset === 0 ? fireDir : norm(rotateAroundAxis(fireDir, up, offset));
      const muzzle = add(mountW, scale(rayDir, 0.4));

      const ray = new RAPIER.Ray(muzzle, rayDir);
      const hit = world.castRay(
        ray,
        wpn.def.rangeM,
        true,
        undefined,
        WEAPON_RAY_GROUPS,
        undefined,
        body,
      );
      const end = hit
        ? add(muzzle, scale(rayDir, hit.timeOfImpact))
        : add(muzzle, scale(rayDir, wpn.def.rangeM));
      let zombieHandle: number | null = null;
      if (hit) {
        const groups = hit.collider.collisionGroups() >>> 16;
        if ((groups & GROUP_ZOMBIE) !== 0) zombieHandle = hit.collider.handle;
      }
      shots.push({
        from: muzzle,
        to: end,
        hitZombieHandle: zombieHandle,
        damage: wpn.def.damage,
        damageType: wpn.def.damageType,
      });
    }

    // Recoil at the mount, opposite fire direction (once per trigger pull).
    body.applyImpulseAtPoint(
      scale(fireDir, -wpn.def.recoilImpulse),
      mountW,
      true,
    );

    wpn.ammo -= wpn.def.ammoPerShot;
    ammoUsed += wpn.def.ammoPerShot;
    powerUsed += wpn.def.powerPerShot;
    wpn.cooldown = 1 / wpn.def.fireRate;
    wpn.shotsFired++;
  }
  return { shots, ammoUsed, powerUsed };
}

const MAX_AUTO_PITCH = (35 * Math.PI) / 180;

/**
 * Preserve the yaw slew result while aiming vertically at an automatic
 * weapon's target. The pitch limit prevents elevated turrets from firing
 * back through their own vehicle deck.
 */
function pitchedDirection(
  yawDir: Vec3,
  up: Vec3,
  mount: Vec3,
  target: Vec3,
): Vec3 {
  const targetOffset = {
    x: target.x - mount.x,
    y: target.y - mount.y,
    z: target.z - mount.z,
  };
  const vertical =
    targetOffset.x * up.x + targetOffset.y * up.y + targetOffset.z * up.z;
  const horizontal = {
    x: yawDir.x - up.x * (yawDir.x * up.x + yawDir.y * up.y + yawDir.z * up.z),
    y: yawDir.y - up.y * (yawDir.x * up.x + yawDir.y * up.y + yawDir.z * up.z),
    z: yawDir.z - up.z * (yawDir.x * up.x + yawDir.y * up.y + yawDir.z * up.z),
  };
  const horizontalLength = Math.hypot(horizontal.x, horizontal.y, horizontal.z);
  if (horizontalLength < 1e-6) return yawDir;
  const horizontalDir = scale(horizontal, 1 / horizontalLength);
  const targetHorizontal = Math.hypot(
    targetOffset.x - up.x * vertical,
    targetOffset.y - up.y * vertical,
    targetOffset.z - up.z * vertical,
  );
  const pitch = clamp(
    Math.atan2(vertical, targetHorizontal),
    -MAX_AUTO_PITCH,
    MAX_AUTO_PITCH,
  );
  return norm(add(scale(horizontalDir, Math.cos(pitch)), scale(up, Math.sin(pitch))));
}

function halfArc(def: WeaponDefinition): number {
  return ((def.arcDeg / 2) * Math.PI) / 180;
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
