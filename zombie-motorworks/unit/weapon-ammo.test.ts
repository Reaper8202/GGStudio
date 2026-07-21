/**
 * Per-weapon magazines. Ammo used to be one pool summed across every weapon
 * part, which meant a Zombie Blaster could be starved dry by a Heavy Cannon
 * sharing the rig and the HUD could not say what any one gun had left.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPartDef } from '../src/core/parts.ts';
import type { PlacedPart, VehicleBlueprint } from '../src/core/types.ts';
import { assembleVehicle } from '../src/runtime/assembler.ts';
import { RuntimeVehicle } from '../src/runtime/vehicle.ts';
import { createWeapon, stepWeapons } from '../src/runtime/weapons.ts';

function part(id: string, defId: string, x = 0): PlacedPart {
  return { id, defId, pos: { x, y: 0, z: 0 }, orient: 0, config: {} };
}

function blueprint(parts: PlacedPart[]): VehicleBlueprint {
  return { schemaVersion: 4, id: 'ammo-test', name: 'Ammo test', parts };
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('per-weapon magazines', () => {
  it('loads each weapon to its own part ammoCapacity', () => {
    const blaster = createWeapon(part('blaster', 'turret'));
    const cannon = createWeapon(part('cannon', 'cannon-heavy'));

    expect(blaster.ammoCapacity).toBe(getPartDef('turret').ammoCapacity);
    expect(blaster.ammo).toBe(blaster.ammoCapacity);
    expect(cannon.ammoCapacity).toBe(getPartDef('cannon-heavy').ammoCapacity);
    expect(cannon.ammo).toBe(cannon.ammoCapacity);
    // Distinct magazines, not a shared total.
    expect(blaster.ammoCapacity).not.toBe(cannon.ammoCapacity);
  });

  it('labels a weapon with its player-facing part name', () => {
    expect(createWeapon(part('blaster', 'turret')).label).toBe('Zombie Blaster');
  });

  it('spends only the firing weapon’s own rounds', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const blasterPart = part('blaster', 'turret', -1);
    const cannonPart = part('cannon', 'cannon-heavy', 1);
    const assembled = assembleVehicle(
      world,
      blueprint([blasterPart, cannonPart]),
      getPartDef,
      [],
      { translation: { x: 0, y: 1, z: 0 } },
    );
    const blaster = createWeapon(blasterPart);
    const cannon = createWeapon(cannonPart);
    const blasterStart = blaster.ammo;
    const cannonStart = cannon.ammo;

    // Only the blaster is told to fire; the cannon is held.
    stepWeapons(
      world,
      assembled,
      [blaster, cannon],
      new Set([blaster.partId, cannon.partId]),
      {
        aimYawWorld: 0,
        fire: true,
        weaponAim: new Map([[cannon.partId, { aimYawWorld: 0, fire: false }]]),
      },
      1_000,
      0.1,
    );

    expect(blaster.ammo).toBe(blasterStart - blaster.def.ammoPerShot);
    expect(cannon.ammo).toBe(cannonStart);

    world.removeRigidBody(assembled.body);
    world.free();
  });

  it('never auto-refills a spent magazine — ammo comes only from pickups', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const blasterPart = part('blaster', 'turret');
    const assembled = assembleVehicle(
      world,
      blueprint([blasterPart]),
      getPartDef,
      [],
      { translation: { x: 0, y: 1, z: 0 } },
    );
    const blaster = createWeapon(blasterPart);
    blaster.ammo = 0;

    // A whole second of holding an attached, empty gun must add nothing.
    const result = stepWeapons(
      world,
      assembled,
      [blaster],
      new Set([blaster.partId]),
      { aimYawWorld: 0, fire: true },
      1_000,
      1,
    );

    expect(result.shots).toHaveLength(0);
    expect(blaster.shotsFired).toBe(0);
    expect(blaster.ammo).toBe(0);

    world.removeRigidBody(assembled.body);
    world.free();
  });

  it('refills every mounted weapon by a fixed chunk when a pickup is collected', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const vehicle = new RuntimeVehicle(
      world,
      blueprint([part('blaster', 'turret')]),
      getPartDef,
      [],
      { translation: { x: 0, y: 1, z: 0 } },
    );
    const [weapon] = vehicle.weaponStates();
    weapon.ammo = 0;

    // One box adds half a magazine and reports how many rounds it restored.
    const added = vehicle.refillWeapons(0.5);
    expect(added).toBeCloseTo(weapon.ammoCapacity * 0.5);
    expect(weapon.ammo).toBeCloseTo(weapon.ammoCapacity * 0.5);

    // A second box tops up and clamps at capacity; a third finds nothing to add.
    vehicle.refillWeapons(0.5);
    expect(weapon.ammo).toBe(weapon.ammoCapacity);
    expect(vehicle.refillWeapons(0.5)).toBe(0);

    vehicle.dispose();
    world.free();
  });

  it('does not recharge a detached or destroyed weapon', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const blasterPart = part('blaster', 'turret');
    const assembled = assembleVehicle(
      world,
      blueprint([blasterPart]),
      getPartDef,
      [],
      { translation: { x: 0, y: 1, z: 0 } },
    );
    const blaster = createWeapon(blasterPart);
    blaster.ammo = 0;

    stepWeapons(
      world,
      assembled,
      [blaster],
      new Set(),
      { aimYawWorld: 0, fire: false },
      1_000,
      1,
    );

    expect(blaster.ammo).toBe(0);

    world.removeRigidBody(assembled.body);
    world.free();
  });
});
