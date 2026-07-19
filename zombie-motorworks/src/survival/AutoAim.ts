import RAPIER from '@dimforge/rapier3d-compat';
import type { RuntimeVehicle } from '../runtime/vehicle.ts';
import type { RuntimeWeapon, WeaponAimInput } from '../runtime/weapons.ts';
import {
  GROUP_DEBRIS,
  GROUP_TERRAIN,
  GROUP_ZOMBIE,
} from '../runtime/assembler.ts';
import type { ZombieSystem } from './zombies/ZombieSystem.ts';

export type AutoAimEntry = WeaponAimInput;

/** Larger than any squared weapon range, so it only reorders, never excludes. */
const RANGED_PRIORITY_PENALTY = 1e9;

interface AutoWeapon {
  readonly weapon: RuntimeWeapon;
  readonly entry: AutoAimEntry;
}

/**
 * Builds per-weapon inputs for automatic weapons without allocating in the
 * fixed-step hot path. Manual weapons are deliberately absent from the map.
 */
export class AutoAim {
  private readonly weaponAim = new Map<string, AutoAimEntry>();
  private readonly autoWeapons: AutoWeapon[] = [];
  private readonly candidateTargets: (ReturnType<ZombieSystem['getAliveTargets']>[number] | null)[] =
    [null, null, null, null];
  private readonly candidateDistances = new Float64Array(4);
  private readonly losRay = new RAPIER.Ray(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
  );

  constructor(
    private readonly vehicle: RuntimeVehicle,
    private readonly zombies: ZombieSystem,
    private readonly world: Pick<RAPIER.World, 'castRay'>,
  ) {
    const rotation = vehicle.body.rotation();
    for (const weapon of vehicle.weaponStates()) {
      if (weapon.def.aimMode !== 'auto') continue;
      const local = weapon.forwardLocal;
      const tx = 2 * (rotation.y * local.z - rotation.z * local.y);
      const ty = 2 * (rotation.z * local.x - rotation.x * local.z);
      const tz = 2 * (rotation.x * local.y - rotation.y * local.x);
      const forwardX =
        local.x + rotation.w * tx + rotation.y * tz - rotation.z * ty;
      const forwardZ =
        local.z + rotation.w * tz + rotation.x * ty - rotation.y * tx;
      this.autoWeapons.push({
        weapon,
        entry: {
          aimYawWorld: Math.atan2(forwardX, forwardZ) + weapon.yaw,
          fire: false,
          aimPoint: { x: 0, y: 0, z: 0 },
        },
      });
    }
  }

  /** Reuses both the returned map and every value stored in it. */
  step(): ReadonlyMap<string, AutoAimEntry> {
    this.weaponAim.clear();

    const vehiclePosition = this.vehicle.body.translation();
    const vehicleRotation = this.vehicle.body.rotation();
    const targets = this.zombies.getAliveTargets();

    for (const autoWeapon of this.autoWeapons) {
      const { weapon, entry } = autoWeapon;
      const part = this.vehicle.assembled.parts.get(weapon.partId);
      if (
        part === undefined ||
        !part.alive ||
        part.detached ||
        part.health <= 0
      ) {
        continue;
      }

      // Rotate the local mount by the vehicle quaternion without creating a
      // temporary vector.
      const local = weapon.mountLocal;
      const tx =
        2 * (vehicleRotation.y * local.z - vehicleRotation.z * local.y);
      const ty =
        2 * (vehicleRotation.z * local.x - vehicleRotation.x * local.z);
      const tz =
        2 * (vehicleRotation.x * local.y - vehicleRotation.y * local.x);
      const mountX =
        vehiclePosition.x +
        local.x +
        vehicleRotation.w * tx +
        vehicleRotation.y * tz -
        vehicleRotation.z * ty;
      const mountY =
        vehiclePosition.y +
        local.y +
        vehicleRotation.w * ty +
        vehicleRotation.z * tx -
        vehicleRotation.x * tz;
      const mountZ =
        vehiclePosition.z +
        local.z +
        vehicleRotation.w * tz +
        vehicleRotation.x * ty -
        vehicleRotation.y * tx;

      const candidateCount = this.collectNearestCandidates(
        targets,
        mountX,
        mountY,
        mountZ,
        weapon.def.rangeM,
        weapon.def.minRangeM ?? 0,
        weapon.def.targetPriority === 'ranged',
      );
      let acquired = false;

      for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
        const zombie = this.candidateTargets[candidateIndex];
        if (!zombie) continue;
        const target = zombie.body.translation();
        const dx = target.x - mountX;
        const dy = target.y - mountY;
        const dz = target.z - mountZ;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        const distance = Math.sqrt(distanceSq);
        if (distance <= 1e-6) continue;
        this.losRay.origin.x = mountX + (dx / distance) * 0.4;
        this.losRay.origin.y = mountY + (dy / distance) * 0.4;
        this.losRay.origin.z = mountZ + (dz / distance) * 0.4;
        this.losRay.dir.x = dx / distance;
        this.losRay.dir.y = dy / distance;
        this.losRay.dir.z = dz / distance;
        const hit = this.world.castRay(
          this.losRay,
          Math.max(0, distance - 0.4),
          true,
          undefined,
          (0xffff << 16) | (GROUP_TERRAIN | GROUP_DEBRIS | GROUP_ZOMBIE),
        );
        if (!hit || hit.collider.handle !== zombie.collider.handle) continue;
        entry.aimYawWorld = Math.atan2(dx, dz);
        entry.aimPoint!.x = target.x;
        entry.aimPoint!.y = target.y;
        entry.aimPoint!.z = target.z;
        acquired = true;
        break;
      }

      entry.fire = acquired;
      this.weaponAim.set(weapon.partId, entry);
    }

    return this.weaponAim;
  }

  /** Insert the closest bounded set without allocating or sorting each step. */
  private collectNearestCandidates(
    targets: ReturnType<ZombieSystem['getAliveTargets']>,
    mountX: number,
    mountY: number,
    mountZ: number,
    rangeM: number,
    minRangeM: number,
    preferRanged: boolean,
  ): number {
    let count = 0;
    const rangeSq = rangeM * rangeM;
    const minRangeSq = minRangeM * minRangeM;
    for (const zombie of targets) {
      // Rapier is authoritative here. The render position can trail physics
      // and is not precise enough for a 0.32 m-radius hitscan target.
      const target = zombie.body.translation();
      const dx = target.x - mountX;
      const dy = target.y - mountY;
      const dz = target.z - mountZ;
      let distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq > rangeSq || distanceSq < minRangeSq) continue;
      // Priority weapons sort walkers behind every in-range thrower while
      // keeping their true distance ordering within each group.
      if (preferRanged && zombie.kind !== 'thrower')
        distanceSq += RANGED_PRIORITY_PENALTY;
      let index = count;
      while (index > 0 && distanceSq < this.candidateDistances[index - 1]) {
        if (index < this.candidateTargets.length) {
          this.candidateTargets[index] = this.candidateTargets[index - 1];
          this.candidateDistances[index] = this.candidateDistances[index - 1];
        }
        index--;
      }
      if (index >= this.candidateTargets.length) continue;
      this.candidateTargets[index] = zombie;
      this.candidateDistances[index] = distanceSq;
      if (count < this.candidateTargets.length) count++;
    }
    return count;
  }
}
