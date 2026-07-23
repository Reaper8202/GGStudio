/**
 * Weapons have unlimited ammo — firing is limited only by each weapon's
 * fire-rate cooldown. Fuel is the resource the player manages instead, topped
 * up by refuel crates via RuntimeVehicle.refuel.
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
  return { schemaVersion: 4, id: 'weapon-test', name: 'Weapon test', parts };
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('unlimited weapons', () => {
  it('labels a weapon with its player-facing part name', () => {
    expect(createWeapon(part('blaster', 'turret')).label).toBe('Zombie Blaster');
  });

  it('carries module levels only for the turret mounting part', () => {
    const blaster = createWeapon({
      ...part('blaster', 'turret'),
      config: { empLevel: 3, piercingLevel: 2 },
    });
    const cannon = createWeapon({
      ...part('cannon', 'cannon-heavy'),
      config: { empLevel: 3, piercingLevel: 3 },
    });

    expect(blaster.empLevel).toBe(3);
    expect(blaster.piercingLevel).toBe(2);
    expect(cannon.empLevel).toBe(0);
    expect(cannon.piercingLevel).toBe(0);
  });

  it('never runs out of ammo — it fires as fast as its cooldown allows', () => {
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
    const attached = new Set([blaster.partId]);

    // Far more trigger pulls than any old magazine held; every one discharges.
    const pulls = 500;
    for (let i = 0; i < pulls; i++) {
      blaster.cooldown = 0;
      stepWeapons(
        world,
        assembled,
        [blaster],
        attached,
        { aimYawWorld: 0, fire: true },
        1 / 60,
      );
    }

    expect(blaster.shotsFired).toBe(pulls);

    world.removeRigidBody(assembled.body);
    world.free();
  });

  it('fires a manual-fire cannon only when acquisition and the player trigger agree', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const cannonPart = part('cannon', 'cannon-heavy');
    const assembled = assembleVehicle(
      world,
      blueprint([cannonPart]),
      getPartDef,
      [],
      { translation: { x: 0, y: 1, z: 0 } },
    );
    const cannon = createWeapon(cannonPart);
    const attached = new Set([cannon.partId]);
    // Auto-aim reports an acquired target via the per-weapon entry's fire flag.
    const acquired = new Map([[cannon.partId, { aimYawWorld: 0, fire: true }]]);

    // Target acquired, but the player is not holding fire: the cannon holds.
    const held = stepWeapons(
      world,
      assembled,
      [cannon],
      attached,
      { aimYawWorld: 0, fire: false, weaponAim: acquired },
      0.1,
    );
    expect(held.shots).toHaveLength(0);
    expect(cannon.shotsFired).toBe(0);

    cannon.cooldown = 0;
    // Player holds fire with a target acquired: it discharges.
    const fired = stepWeapons(
      world,
      assembled,
      [cannon],
      attached,
      { aimYawWorld: 0, fire: true, weaponAim: acquired },
      0.1,
    );
    expect(fired.shots.length).toBeGreaterThan(0);
    expect(cannon.shotsFired).toBe(1);

    world.removeRigidBody(assembled.body);
    world.free();
  });
});

describe('refuel crates', () => {
  it('tops up onboard fuel by a fixed chunk and clamps at capacity', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const vehicle = new RuntimeVehicle(
      world,
      blueprint([
        part('engine', 'engine-small', -1),
        part('tank', 'fuel-tank', 1),
      ]),
      getPartDef,
      [],
      { translation: { x: 0, y: 1, z: 0 } },
    );
    const telemetry = vehicle.telemetry();
    const capacity = telemetry.fuelCapacity;
    expect(capacity).toBeGreaterThan(0);
    // Vehicles start with a full tank.
    expect(telemetry.fuel).toBeCloseTo(capacity);

    // A full tank drives straight over a crate: nothing to add.
    expect(vehicle.refuel(0.5)).toBe(0);

    // Burn some fuel, then a crate restores half of total capacity.
    vehicle.debugSetFuel(0);
    const added = vehicle.refuel(0.5);
    expect(added).toBeCloseTo(capacity * 0.5);

    // A second crate tops up and clamps at capacity; a third finds nothing.
    vehicle.refuel(0.5);
    expect(vehicle.telemetry().fuel).toBeCloseTo(capacity);
    expect(vehicle.refuel(0.5)).toBe(0);

    vehicle.dispose();
    world.free();
  });
});
