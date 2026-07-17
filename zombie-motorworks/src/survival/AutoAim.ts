import type { RuntimeVehicle } from '../runtime/vehicle.ts';
import type { RuntimeWeapon, WeaponAimInput } from '../runtime/weapons.ts';
import type { ZombieSystem } from './zombies/ZombieSystem.ts';

export type AutoAimEntry = WeaponAimInput;

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

  constructor(
    private readonly vehicle: RuntimeVehicle,
    private readonly zombies: ZombieSystem,
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

      let nearestDistanceSq = weapon.def.rangeM * weapon.def.rangeM;
      let acquired = false;
      let targetX = 0;
      let targetZ = 0;

      for (const zombie of targets) {
        // Rapier is authoritative here. The render position can trail physics
        // and is not precise enough for a 0.32 m-radius hitscan target.
        const target = zombie.body.translation();
        const dx = target.x - mountX;
        const dy = target.y - mountY;
        const dz = target.z - mountZ;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq > nearestDistanceSq) continue;
        nearestDistanceSq = distanceSq;
        targetX = target.x;
        targetZ = target.z;
        acquired = true;
      }

      if (acquired) {
        entry.aimYawWorld = Math.atan2(targetX - mountX, targetZ - mountZ);
      }
      entry.fire = acquired;
      this.weaponAim.set(weapon.partId, entry);
    }

    return this.weaponAim;
  }
}
