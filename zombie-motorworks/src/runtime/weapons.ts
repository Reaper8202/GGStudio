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
import { footprintCentreM } from '../core/mass.ts';
import { getPartDef } from '../core/parts.ts';
import { KID_LABELS } from '../core/tutorial.ts';
import {
  piercingDamageFraction,
  turretEmpLevel,
  turretPiercingLevel,
} from '../core/turretModules.ts';
import {
  add,
  clamp,
  dot,
  len,
  norm,
  rotateAroundAxis,
  rotateByQuat,
  scale,
  sub,
  v3,
} from './vec.ts';

/**
 * Temporary buff riding on one weapon (the Hellfire ability). While it runs the
 * weapon's damage, reach, and spray cone are scaled, and a periodic weapon
 * stops waiting out its burst interval — the nozzle simply stays open.
 */
export interface WeaponOvercharge {
  secondsRemaining: number;
  damageMultiplier: number;
  rangeMultiplier: number;
  coneMultiplier: number;
}

export interface RuntimeWeapon {
  partId: string;
  /** Catalog part id, retained so each fired shot can keep its visual identity. */
  weaponDefId: string;
  def: WeaponDefinition;
  /** Display name of the mounting part, for the ammo HUD. */
  label: string;
  mountLocal: Vec3;
  forwardLocal: Vec3;
  yaw: number; // turret yaw relative to mounted forward, rad
  /**
   * Turret elevation onto its aim point, rad (positive = muzzle up). Tracked
   * every step, not just on the shot, so the mesh can follow the aim between
   * rounds.
   */
  pitch: number;
  cooldown: number; // s
  /** Elapsed time in the current burst cycle for periodic burst weapons, s. */
  cycleTime: number;
  shotsFired: number;
  /** EMP strength, derived from the turret's upgrade level; 0 for other guns. */
  empLevel: number;
  /** Piercing strength, derived the same way; 0 for every other gun. */
  piercingLevel: number;
  /** Active Hellfire overcharge, or null while the weapon runs stock. */
  overcharge: WeaponOvercharge | null;
}

export interface TracerShot {
  from: Vec3;
  to: Vec3;
  /**
   * Part id of the weapon that fired, so presentation can be per-weapon
   * instead of guessed from damage numbers.
   */
  weaponDefId: string;
  hitZombieHandle: number | null;
  /**
   * True when the ray terminated against terrain or debris rather than a
   * zombie or the end of its range. Presentation uses it to tell a ricochet
   * off a headstone from a round that simply ran out of reach mid-air.
   */
  hitSurface: boolean;
  damage: number;
  /** Delivery type of the firing weapon; aoe rays render as flame. */
  damageType: DamageType;
  /** EMP level of the firing weapon, for shield-leak resolution. */
  empLevel: number;
  /** Piercing module level, retained for the weapon's tracer treatment. */
  piercingLevel: number;
  /** Second target struck by a piercing round, if any. */
  pierceZombieHandle: number | null;
  /** Damage for the secondary target; 0 when there is no pierce. */
  pierceDamage: number;
  /** End point of the fainter secondary tracer segment. */
  pierceTo: Vec3 | null;
  /** Cryo slow to apply to struck zombies (fraction of speed); 0 = none. */
  slowFactor: number;
  /** Seconds the cryo slow lasts; 0 = none. */
  slowDurationSeconds: number;
  /** Blast radius around `to`; 0 = no explosion. */
  splashRadiusM: number;
  /** Blast damage at the centre, falling off to 0 at the rim; 0 = none. */
  splashDamage: number;
  /**
   * Fired by a weapon running a Hellfire overcharge. Presentation only — the
   * multipliers are already baked into `damage` and the ray's reach.
   */
  overcharged: boolean;
  /**
   * A burn resolved from a cone weapon's flame volume rather than from a ray it
   * drew. It carries damage only: the visual rays already drew the fire, so
   * presentation skips these or the cone renders once per zombie caught in it.
   */
  damageOnly: boolean;
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
  const isTurret = placed.defId === 'turret';
  return {
    partId: placed.id,
    weaponDefId: partDef.id,
    def,
    label: KID_LABELS[partDef.id]?.name ?? partDef.name,
    // Shots leave from the middle of the footprint, which is where the gun is
    // modelled: a multi-cell mount would otherwise fire out of its corner cell.
    mountLocal: footprintCentreM(partDef, placed),
    forwardLocal: rotateVec(placed.orient, { x: 0, y: 0, z: 1 }),
    yaw: 0,
    pitch: 0,
    cooldown: 0,
    cycleTime: 0,
    shotsFired: 0,
    // Both come off the part's upgrade level: the EMP Coil and Piercing Rounds
    // are unlocks on the turret's chain, not separately bought modules.
    empLevel: isTurret ? turretEmpLevel(placed) : 0,
    piercingLevel: isTurret ? turretPiercingLevel(placed) : 0,
    overcharge: null,
  };
}

/**
 * Start (or refresh) a Hellfire overcharge on one weapon. Re-activation takes
 * the longer time and the stronger multipliers rather than stacking, so
 * spamming it can never run away with the nozzle.
 */
export function overchargeWeapon(
  wpn: RuntimeWeapon,
  seconds: number,
  multipliers: {
    damageMultiplier: number;
    rangeMultiplier: number;
    coneMultiplier: number;
  },
): void {
  if (seconds <= 0) return;
  const current = wpn.overcharge;
  wpn.overcharge = {
    secondsRemaining: Math.max(current?.secondsRemaining ?? 0, seconds),
    damageMultiplier: Math.max(
      current?.damageMultiplier ?? 1,
      multipliers.damageMultiplier,
    ),
    rangeMultiplier: Math.max(
      current?.rangeMultiplier ?? 1,
      multipliers.rangeMultiplier,
    ),
    coneMultiplier: Math.max(
      current?.coneMultiplier ?? 1,
      multipliers.coneMultiplier,
    ),
  };
}

const TURRET_YAW_RATE = 3.2; // rad/s
/**
 * A turret following the player's cursor slews far faster than one hunting on
 * its own. An auto turret's slow sweep is part of its cost — it takes time to
 * come onto a new target. Player aim is already limited by how fast the cursor
 * moves, so a slow slew only reads as unresponsive input.
 */
const MANUAL_TURRET_YAW_RATE = 14; // rad/s
// Move beyond the first surface while keeping the complete projectile path
// bounded by the weapon's original range.
const PIERCE_RAY_EPSILON_M = 1e-4;
const WEAPON_RAY_GROUPS =
  (0xffff << 16) | (GROUP_TERRAIN | GROUP_ZOMBIE | GROUP_DEBRIS);
/**
 * A cone weapon's rays are presentation: flame washes over a crowd rather than
 * stopping dead in the first zombie, so the jets ignore bodies and run until
 * they meet scenery. Damage comes from the volume query below instead.
 */
const FLAME_RAY_GROUPS = (0xffff << 16) | (GROUP_TERRAIN | GROUP_DEBRIS);
const ZOMBIE_QUERY_GROUPS = (0xffff << 16) | GROUP_ZOMBIE;
/**
 * Half a body's width of slack on the cone edge, so a zombie the flame is
 * visibly licking burns instead of being missed by a hair.
 */
const FLAME_EDGE_ALLOWANCE_M = 0.5;
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
/** Reused so a cone weapon does not allocate a query shape every shot. */
const flameVolume = new RAPIER.Ball(1);

export interface WeaponStepResult {
  shots: TracerShot[];
}

export interface WeaponAimInput {
  aimYawWorld: number;
  fire: boolean;
  /** World-space target centre. Turrets pitch onto it; fixed mounts ignore it. */
  aimPoint?: Vec3;
}

export interface WeaponStepInput extends WeaponAimInput {
  weaponAim?: ReadonlyMap<string, WeaponAimInput>;
  /**
   * Player override: every weapon drops the target `weaponAim` acquired for it
   * and converges on this input's own aim point and trigger instead. Set while
   * the player is aiming at the world with the cursor.
   */
  manualOverride?: boolean;
}

export function stepWeapons(
  world: RAPIER.World,
  vehicle: AssembledVehicle,
  weapons: RuntimeWeapon[],
  attachedAliveIds: Set<string>,
  input: WeaponStepInput,
  dt: number,
): WeaponStepResult {
  const body = vehicle.body;
  const rot = body.rotation();
  const pos = body.translation();
  const shots: TracerShot[] = [];

  for (const wpn of weapons) {
    wpn.cooldown = Math.max(0, wpn.cooldown - dt);
    const overcharge = tickOvercharge(wpn, dt);
    if (!attachedAliveIds.has(wpn.partId)) continue;
    // Weapons have unlimited ammo — firing is limited only by the per-weapon
    // fire-rate cooldown below. Fuel is the resource the player manages now.
    //
    // The player's cursor outranks auto-acquisition: while the override is on,
    // every weapon takes the shared aim input rather than the target AutoAim
    // picked for it, so a click concentrates the whole rig on one point.
    const manualOverride = input.manualOverride === true;
    const weaponInput = manualOverride
      ? input
      : (input.weaponAim?.get(wpn.partId) ?? input);

    const up = norm(rotateByQuat(rot, v3(0, 1, 0)));
    const mountedFwdW = norm(rotateByQuat(rot, wpn.forwardLocal));
    const mountW = add(
      v3(pos.x, pos.y, pos.z),
      rotateByQuat(rot, wpn.mountLocal),
    );

    if (wpn.def.mountType === 'turret') {
      // Desired world yaw -> yaw relative to mounted forward, arc-clamped.
      const fwdYawW = Math.atan2(mountedFwdW.x, mountedFwdW.z);
      // Under the override the yaw is resolved from this mount rather than
      // from the hull centre, so guns spread across a wide rig cross on the
      // cursor instead of firing parallel past it. (AutoAim already works per
      // mount, so its yaw needs no such correction.)
      const overridePoint = manualOverride ? weaponInput.aimPoint : undefined;
      const aimYawWorld =
        overridePoint === undefined
          ? weaponInput.aimYawWorld
          : Math.atan2(overridePoint.x - mountW.x, overridePoint.z - mountW.z);
      let desired =
        wpn.def.arcDeg >= 360
          ? normalizeAngle(aimYawWorld - fwdYawW)
          : clamp(
              normalizeAngle(aimYawWorld - fwdYawW),
              -halfArc(wpn.def),
              halfArc(wpn.def),
            );
      if (wpn.def.arcDeg >= 360) {
        // shortest-path tracking, unbounded arc
        desired = normalizeAngle(desired);
      }
      const yawRate =
        manualOverride || wpn.def.aimMode === 'manual'
          ? MANUAL_TURRET_YAW_RATE
          : TURRET_YAW_RATE;
      const dYaw = clamp(
        normalizeAngle(desired - wpn.yaw),
        -yawRate * dt,
        yawRate * dt,
      );
      wpn.yaw += dYaw;
      // Elevation tracks continuously as well, so a turret is already looking
      // at its target when the cooldown clears rather than snapping on the
      // frame it fires.
      wpn.pitch = weaponInput.aimPoint
        ? pitchAngleToward(up, mountW, weaponInput.aimPoint)
        : 0;
    } else {
      wpn.yaw = 0;
      wpn.pitch = 0;
    }

    let wantsFire: boolean;
    if (wpn.def.fireMode === 'periodic') {
      const { burstSeconds, burstIntervalSeconds } = wpn.def;
      if (overcharge !== null) {
        // Hellfire holds the trigger open: no gap between bursts for as long as
        // the overcharge runs, and a fresh burst starts the moment it ends.
        wantsFire = true;
        wpn.cycleTime = 0;
      } else if (
        burstSeconds !== undefined &&
        burstIntervalSeconds !== undefined
      ) {
        // Spray while inside the burst window, then wait out the cycle.
        wantsFire = wpn.cycleTime < burstSeconds;
        wpn.cycleTime = (wpn.cycleTime + dt) % burstIntervalSeconds;
      } else {
        wantsFire = true;
      }
    } else if (wpn.def.manualFire) {
      // Auto-aim, manual trigger: the mount tracks its target and reports
      // acquisition in weaponInput.fire, but it only discharges while the
      // player is also holding their own fire button.
      wantsFire = weaponInput.fire && input.fire;
    } else {
      wantsFire = weaponInput.fire;
    }
    if (!wantsFire || wpn.cooldown > 0) continue;

    const yawDir =
      wpn.yaw !== 0
        ? norm(rotateAroundAxis(mountedFwdW, up, wpn.yaw))
        : mountedFwdW;
    // Any turret with a target point pitches onto it: normally the one AutoAim
    // acquired, or the player's cursor point while the override runs. Fixed
    // mounts (the flamethrower nozzle) keep firing along the hull and ignore it.
    const fireDir =
      wpn.pitch !== 0 ? pitchedDirection(yawDir, up, wpn.pitch) : yawDir;

    // A Hellfire overcharge scales what the shot is worth without touching the
    // catalog definition, so the weapon reverts the moment the buff lapses.
    const damage = wpn.def.damage * (overcharge?.damageMultiplier ?? 1);
    const rangeM = wpn.def.rangeM * (overcharge?.rangeMultiplier ?? 1);

    // Cone weapons fan raysPerShot rays across coneDeg around the fire
    // direction; conventional weapons are the single-ray special case.
    const isCone = wpn.def.coneDeg !== undefined;
    const rays = isCone ? Math.max(1, wpn.def.raysPerShot ?? 1) : 1;
    const coneDeg = (wpn.def.coneDeg ?? 0) * (overcharge?.coneMultiplier ?? 1);
    const halfCone = (coneDeg / 2) * (Math.PI / 180);
    for (let i = 0; i < rays; i++) {
      const offset =
        rays === 1 ? 0 : -halfCone + (2 * halfCone * i) / (rays - 1);
      const rayDir =
        offset === 0 ? fireDir : norm(rotateAroundAxis(fireDir, up, offset));
      const muzzle = add(mountW, scale(rayDir, 0.4));

      const ray = new RAPIER.Ray(muzzle, rayDir);
      const hit = world.castRay(
        ray,
        rangeM,
        true,
        undefined,
        isCone ? FLAME_RAY_GROUPS : WEAPON_RAY_GROUPS,
        undefined,
        body,
      );
      const end = hit
        ? add(muzzle, scale(rayDir, hit.timeOfImpact))
        : add(muzzle, scale(rayDir, rangeM));
      let zombieHandle: number | null = null;
      if (hit) {
        const groups = hit.collider.collisionGroups() >>> 16;
        if ((groups & GROUP_ZOMBIE) !== 0) zombieHandle = hit.collider.handle;
      }
      let pierceZombieHandle: number | null = null;
      let pierceDamage = 0;
      let pierceTo: Vec3 | null = null;
      const pierceFraction =
        rays === 1 && !isCone ? piercingDamageFraction(wpn.piercingLevel) : 0;
      if (hit && zombieHandle !== null && pierceFraction > 0) {
        const remainingRange = rangeM - hit.timeOfImpact - PIERCE_RAY_EPSILON_M;
        if (remainingRange > 0) {
          const pierceFrom = add(
            muzzle,
            scale(rayDir, hit.timeOfImpact + PIERCE_RAY_EPSILON_M),
          );
          const pierceRay = new RAPIER.Ray(pierceFrom, rayDir);
          const pierceHit = world.castRay(
            pierceRay,
            remainingRange,
            true,
            undefined,
            WEAPON_RAY_GROUPS,
            hit.collider,
            body,
          );
          pierceTo = pierceHit
            ? add(pierceFrom, scale(rayDir, pierceHit.timeOfImpact))
            : add(pierceFrom, scale(rayDir, remainingRange));
          if (pierceHit) {
            const groups = pierceHit.collider.collisionGroups() >>> 16;
            if ((groups & GROUP_ZOMBIE) !== 0) {
              pierceZombieHandle = pierceHit.collider.handle;
              pierceDamage = damage * pierceFraction;
            }
          }
        }
      }
      shots.push({
        from: muzzle,
        to: end,
        weaponDefId: wpn.weaponDefId,
        hitZombieHandle: zombieHandle,
        hitSurface: hit !== null && zombieHandle === null,
        damage,
        damageType: wpn.def.damageType,
        empLevel: wpn.empLevel,
        piercingLevel: wpn.piercingLevel,
        pierceZombieHandle,
        pierceDamage,
        pierceTo,
        slowFactor: wpn.def.slowFactor ?? 0,
        slowDurationSeconds: wpn.def.slowDurationSeconds ?? 0,
        splashRadiusM: wpn.def.splashRadiusM ?? 0,
        splashDamage: wpn.def.splashDamage ?? 0,
        overcharged: overcharge !== null,
        damageOnly: false,
      });
    }

    // Flame burns the volume it fills, not the handful of lines drawn through
    // it. Ray spacing grows with distance — at the far end of a Hellfire cone
    // the gaps between six rays are wider than a zombie, which is why targets
    // plainly inside the fire used to take nothing until they closed in. Every
    // zombie in the cone burns instead, so the back of a crowd cooks with the
    // front. No line of sight is traced: fire washes around a headstone.
    if (isCone) {
      for (const target of zombiesInCone(
        world,
        body,
        mountW,
        fireDir,
        up,
        rangeM,
        halfCone,
      )) {
        shots.push({
          from: mountW,
          to: target.point,
          weaponDefId: wpn.weaponDefId,
          hitZombieHandle: target.handle,
          hitSurface: false,
          damage,
          damageType: wpn.def.damageType,
          empLevel: wpn.empLevel,
          piercingLevel: wpn.piercingLevel,
          pierceZombieHandle: null,
          pierceDamage: 0,
          pierceTo: null,
          slowFactor: wpn.def.slowFactor ?? 0,
          slowDurationSeconds: wpn.def.slowDurationSeconds ?? 0,
          splashRadiusM: 0,
          splashDamage: 0,
          overcharged: overcharge !== null,
          damageOnly: true,
        });
      }
    }

    // Recoil at the mount, opposite fire direction (once per trigger pull).
    body.applyImpulseAtPoint(
      scale(fireDir, -wpn.def.recoilImpulse),
      mountW,
      true,
    );

    wpn.cooldown = 1 / wpn.def.fireRate;
    wpn.shotsFired++;
  }
  return { shots };
}

/**
 * Every zombie standing in a weapon's flame cone: inside `rangeM` of the muzzle
 * and within `halfCone` of the fire direction, measured in the plane the cone
 * fans across (rays sweep around `up`, so the spray is a sheet, not a circular
 * cone — height never excludes a target). The edge carries a body-width
 * allowance, since a zombie the flame visibly licks should burn.
 */
function zombiesInCone(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  muzzle: Vec3,
  fireDir: Vec3,
  up: Vec3,
  rangeM: number,
  halfCone: number,
): { handle: number; point: Vec3 }[] {
  const found: { handle: number; point: Vec3 }[] = [];
  const aim = flatten(fireDir, up);
  if (len(aim) < 1e-6) return found;
  const aimDir = norm(aim);
  flameVolume.radius = rangeM;
  world.intersectionsWithShape(
    muzzle,
    IDENTITY_ROTATION,
    flameVolume,
    (collider) => {
      const at = collider.translation();
      const point = v3(at.x, at.y, at.z);
      const offset = sub(point, muzzle);
      const distance = len(offset);
      if (distance > rangeM) return true;
      const flat = flatten(offset, up);
      // Anything effectively on top of the muzzle is inside the cone whatever
      // its bearing works out to.
      const angle =
        len(flat) < 1e-6
          ? 0
          : Math.acos(clamp(dot(norm(flat), aimDir), -1, 1));
      const allowance = Math.atan2(
        FLAME_EDGE_ALLOWANCE_M,
        Math.max(distance, FLAME_EDGE_ALLOWANCE_M),
      );
      if (angle <= halfCone + allowance)
        found.push({ handle: collider.handle, point });
      return true;
    },
    undefined,
    ZOMBIE_QUERY_GROUPS,
    undefined,
    body,
  );
  return found;
}

/** Component of `v` in the plane perpendicular to the unit vector `up`. */
function flatten(v: Vec3, up: Vec3): Vec3 {
  return sub(v, scale(up, dot(v, up)));
}

/**
 * Burn a step off a weapon's overcharge and return it while it is still live.
 * Ticks even for a detached or dead weapon, so a nozzle torn off mid-Hellfire
 * doesn't come back overcharged when it is repaired.
 */
function tickOvercharge(
  wpn: RuntimeWeapon,
  dt: number,
): WeaponOvercharge | null {
  const overcharge = wpn.overcharge;
  if (overcharge === null) return null;
  overcharge.secondsRemaining -= dt;
  if (overcharge.secondsRemaining <= 0) {
    wpn.overcharge = null;
    return null;
  }
  return overcharge;
}

const MAX_AUTO_PITCH = (35 * Math.PI) / 180;

/**
 * Elevation from a mount onto a target, positive with the muzzle up. The pitch
 * limit prevents elevated turrets from firing back through their own vehicle
 * deck.
 */
function pitchAngleToward(up: Vec3, mount: Vec3, target: Vec3): number {
  const targetOffset = {
    x: target.x - mount.x,
    y: target.y - mount.y,
    z: target.z - mount.z,
  };
  const vertical =
    targetOffset.x * up.x + targetOffset.y * up.y + targetOffset.z * up.z;
  const targetHorizontal = Math.hypot(
    targetOffset.x - up.x * vertical,
    targetOffset.y - up.y * vertical,
    targetOffset.z - up.z * vertical,
  );
  return clamp(
    Math.atan2(vertical, targetHorizontal),
    -MAX_AUTO_PITCH,
    MAX_AUTO_PITCH,
  );
}

/** Preserve the yaw slew result while elevating the shot by `pitch`. */
function pitchedDirection(yawDir: Vec3, up: Vec3, pitch: number): Vec3 {
  const horizontal = {
    x: yawDir.x - up.x * (yawDir.x * up.x + yawDir.y * up.y + yawDir.z * up.z),
    y: yawDir.y - up.y * (yawDir.x * up.x + yawDir.y * up.y + yawDir.z * up.z),
    z: yawDir.z - up.z * (yawDir.x * up.x + yawDir.y * up.y + yawDir.z * up.z),
  };
  const horizontalLength = Math.hypot(horizontal.x, horizontal.y, horizontal.z);
  if (horizontalLength < 1e-6) return yawDir;
  const horizontalDir = scale(horizontal, 1 / horizontalLength);
  return norm(
    add(scale(horizontalDir, Math.cos(pitch)), scale(up, Math.sin(pitch))),
  );
}

function halfArc(def: WeaponDefinition): number {
  return ((def.arcDeg / 2) * Math.PI) / 180;
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
