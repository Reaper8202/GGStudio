import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPartDef } from '../src/core/parts.ts';
import type { PlacedPart, VehicleBlueprint } from '../src/core/types.ts';
import {
  assembleVehicle,
  GROUP_TERRAIN,
  GROUP_VEHICLE,
  GROUP_ZOMBIE,
} from '../src/runtime/assembler.ts';
import { createWeapon, stepWeapons } from '../src/runtime/weapons.ts';

const ZOMBIE_GROUPS =
  (GROUP_ZOMBIE << 16) | (GROUP_TERRAIN | GROUP_VEHICLE | GROUP_ZOMBIE);

function part(id: string, defId: string): PlacedPart {
  return { id, defId, pos: { x: 0, y: 0, z: 0 }, orient: 0, config: { level: 1 } };
}

function blueprint(parts: PlacedPart[]): VehicleBlueprint {
  return { schemaVersion: 4, id: 'cone', name: 'cone', parts };
}

function zombieAt(world: RAPIER.World, x: number, z: number): number {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0, z),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(0.5, 0.3).setCollisionGroups(ZOMBIE_GROUPS),
    body,
  );
  return collider.handle;
}

beforeAll(async () => {
  await RAPIER.init();
});

/**
 * A cone weapon's rays are what the cone looks like; the volume behind them is
 * what it burns. Ray spacing grows with distance, so anything resolved from
 * the rays alone misses targets standing plainly inside the fire.
 */
describe('flame cone volume', () => {
  it('burns every zombie in the cone, near and far, between the rays', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const flame = part('flame', 'flamethrower');
    const assembled = assembleVehicle(world, blueprint([flame]), getPartDef, [], {
      translation: { x: 0, y: 0, z: 0 },
    });
    const weapon = createWeapon(flame);

    // Far end of the 7m/50° cone, deliberately off every ray line; one just
    // outside the cone; one behind the nozzle.
    const inFar = zombieAt(world, 1.0, 6.0);
    const inNear = zombieAt(world, 0.2, 1.5);
    const outside = zombieAt(world, 6.0, 2.0);
    const behind = zombieAt(world, 0, -3);

    world.step();
    const shots = stepWeapons(
      world,
      assembled,
      [weapon],
      new Set([weapon.partId]),
      { aimYawWorld: 0, fire: false },
      0.1,
    ).shots;

    const burned = shots
      .filter((shot) => shot.damageOnly)
      .map((shot) => shot.hitZombieHandle);
    expect(burned).toContain(inFar);
    expect(burned).toContain(inNear);
    expect(burned).not.toContain(outside);
    expect(burned).not.toContain(behind);
    expect(shots.filter((shot) => !shot.damageOnly)).toHaveLength(6);

    world.free();
  });
});
