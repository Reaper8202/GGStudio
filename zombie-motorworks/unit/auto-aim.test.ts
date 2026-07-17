import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/core/parts.ts';
import type { RuntimeVehicle } from '../src/runtime/vehicle.ts';
import type { RuntimeWeapon } from '../src/runtime/weapons.ts';
import { AutoAim } from '../src/survival/AutoAim.ts';
import type { ZombieSystem } from '../src/survival/zombies/ZombieSystem.ts';

describe('AutoAim', () => {
  it('targets the nearest body translation and reuses override storage', () => {
    const autoPart = { alive: true, detached: false, health: 100 };
    const manualPart = { alive: true, detached: false, health: 100 };
    const autoWeapon: RuntimeWeapon = {
      partId: 'auto',
      def: { ...PART_CATALOG.turret.weapon!, rangeM: 5 },
      mountLocal: { x: 1, y: 0, z: 0 },
      forwardLocal: { x: 0, y: 0, z: 1 },
      yaw: 0,
      cooldown: 0,
      shotsFired: 0,
    };
    const manualWeapon: RuntimeWeapon = {
      partId: 'manual',
      def: PART_CATALOG['cannon-heavy'].weapon!,
      mountLocal: { x: 0, y: 0, z: 0 },
      forwardLocal: { x: 0, y: 0, z: 1 },
      yaw: 0,
      cooldown: 0,
      shotsFired: 0,
    };
    const vehicle = {
      body: {
        translation: () => ({ x: 10, y: 0, z: 20 }),
        rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      },
      assembled: {
        parts: new Map([
          ['auto', autoPart],
          ['manual', manualPart],
        ]),
      },
      weaponStates: () => [autoWeapon, manualWeapon],
    } as unknown as RuntimeVehicle;

    const bodyPosition = { x: 13, y: 1, z: 24 };
    const target = {
      // A deliberately stale visual position catches accidental render-space aim.
      position: { x: -100, y: 0, z: -100 },
      body: { translation: () => bodyPosition },
    };
    const zombies = {
      getAliveTargets: () => [target],
    } as unknown as ZombieSystem;

    const autoAim = new AutoAim(vehicle, zombies);
    const firstMap = autoAim.step();
    const firstEntry = firstMap.get('auto');
    expect(firstEntry).toBeDefined();
    expect(firstEntry?.fire).toBe(true);
    expect(firstEntry?.aimYawWorld).toBeCloseTo(Math.atan2(2, 4));
    expect(firstMap.has('manual')).toBe(false);

    bodyPosition.x = 100;
    const secondMap = autoAim.step();
    expect(secondMap).toBe(firstMap);
    expect(secondMap.get('auto')).toBe(firstEntry);
    expect(secondMap.get('auto')?.fire).toBe(false);
    expect(secondMap.get('auto')?.aimYawWorld).toBe(firstEntry?.aimYawWorld);

    autoPart.detached = true;
    expect(autoAim.step().has('auto')).toBe(false);
  });
});
