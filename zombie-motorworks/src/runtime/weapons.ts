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
  piercingDamageFraction,
  turretModuleLevel,
} from '../core/turretModules.ts';
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
  /** Turret EMP module level (0 for every non-turret weapon). */
  empLevel: number;
  /** Turret piercing module level (0 for every non-turret weapon). */
  piercingLevel: number;
}

export interface TracerShot {
  from: Vec3;
  to: Vec3;
  hitZombieHandle: number | null;
  damage: number;
  /** Delivery type of the firing weapon; aoe rays render as flame. */
  damageType: DamageType;
  /** EMP level of the firing weapon, for shield-leak resolution. */
  empLevel: number;
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
    def,
    label: KID_LABELS[partDef.id]?.name ?? partDef.name,
    mountLocal: cellCentreM(placed.pos),
    forwardLocal: rotateVec(placed.orient, { x: 0, y: 0, z: 1 }),
    yaw: 0,
    cooldown: 0,
    cycleTime: 0,
    shotsFired: 0,
    empLevel: isTurret ? turretModuleLevel(placed.config, 'emp') : 0,
    piercingLevel: isTurret
      ? turretModuleLevel(placed.config, 'piercing')
      : 0,
  };
}

const TURRET_YAW_RATE = 3.2; // rad/s
// Move beyond the first surface while keeping the complete projectile path
// bounded by the weapon's original range.
const PIERCE_RAY_EPSILON_M = 1e-4;
const WEAPON_RAY_GROUPS =
  (0xffff << 16) | (GROUP_TERRAIN | GROUP_ZOMBIE | GROUP_DEBRIS);

export interface WeaponStepResult {
  shots: TracerShot[];
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
  dt: number,
): WeaponStepResult {
  const body = vehicle.body;
  const rot = body.rotation();
  const pos = body.translation();
  const shots: TracerShot[] = [];

  for (const wpn of weapons) {
    wpn.cooldown = Math.max(0, wpn.cooldown - dt);
    if (!attachedAliveIds.has(wpn.partId)) continue;
    // Weapons have unlimited ammo — firing is limited only by the per-weapon
    // fire-rate cooldown below. Fuel is the resource the player manages now.
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
      let pierceZombieHandle: number | null = null;
      let pierceDamage = 0;
      let pierceTo: Vec3 | null = null;
      const pierceFraction =
        rays === 1 ? piercingDamageFraction(wpn.piercingLevel) : 0;
      if (hit && zombieHandle !== null && pierceFraction > 0) {
        const remainingRange =
          wpn.def.rangeM - hit.timeOfImpact - PIERCE_RAY_EPSILON_M;
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
              pierceDamage = wpn.def.damage * pierceFraction;
            }
          }
        }
      }
      shots.push({
        from: muzzle,
        to: end,
        hitZombieHandle: zombieHandle,
        damage: wpn.def.damage,
        damageType: wpn.def.damageType,
        empLevel: wpn.empLevel,
        pierceZombieHandle,
        pierceDamage,
        pierceTo,
        slowFactor: wpn.def.slowFactor ?? 0,
        slowDurationSeconds: wpn.def.slowDurationSeconds ?? 0,
      });
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
