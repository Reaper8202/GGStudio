/**
 * Headless check that the Nitro Injector's overdrive is worth pressing: the
 * same rig, the same throttle, with and without the surge.
 */

import { readFileSync } from 'node:fs';

import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { effectiveOverdrive } from '../src/core/abilities.ts';
import { getPartDef } from '../src/core/parts.ts';
import { deserializeBlueprint } from '../src/core/serialize.ts';
import { deriveConnections } from '../src/core/structural.ts';
import { GROUP_TERRAIN, lowestPointM } from '../src/runtime/assembler.ts';
import type { VehicleControls } from '../src/runtime/vehicle.ts';
import { RuntimeVehicle } from '../src/runtime/vehicle.ts';
import { rotateByQuat } from '../src/runtime/vec.ts';

const DT = 1 / 60;
const TERRAIN_GROUPS = (GROUP_TERRAIN << 16) | 0xffff;

const idleControls: VehicleControls = {
  throttle: 0,
  brake: 0,
  steer: 0,
  fire: false,
  aimYawWorld: 0,
};

beforeAll(async () => {
  await RAPIER.init();
});

function makeWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(400, 1, 400)
      .setTranslation(0, -1, 0)
      .setFriction(0.9)
      .setCollisionGroups(TERRAIN_GROUPS),
  );
  return world;
}

function spawnVehicle(world: RAPIER.World): RuntimeVehicle {
  const bp = deserializeBlueprint(
    readFileSync(
      new URL('../tests/fixtures/balanced.json', import.meta.url),
      'utf8',
    ),
  );
  const connections = deriveConnections(bp, getPartDef);
  return new RuntimeVehicle(world, bp, getPartDef, connections, {
    translation: { x: 0, y: -lowestPointM(bp, getPartDef) + 0.32, z: 0 },
  });
}

function drive(
  world: RAPIER.World,
  vehicle: RuntimeVehicle,
  controls: Partial<VehicleControls>,
  seconds: number,
): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    vehicle.preStep(DT, { ...idleControls, ...controls }, () => 'asphalt');
    world.step();
    vehicle.postStepStability(DT);
    vehicle.finishStep();
  }
}

/** Top speed in m/s after `seconds` of full throttle from a standstill. */
function launch(overdrive: { seconds: number; torque: number; speed: number } | null): number {
  const world = makeWorld();
  const vehicle = spawnVehicle(world);
  drive(world, vehicle, {}, 1); // settle on the suspension
  drive(world, vehicle, { throttle: 1 }, 6); // reach the natural cruise
  if (overdrive !== null) {
    vehicle.grantOverdrive(
      overdrive.seconds,
      overdrive.torque,
      overdrive.speed,
    );
  }
  drive(world, vehicle, { throttle: 1 }, 3);
  const speed = vehicle.forwardSpeed();
  world.free();
  return speed;
}

describe('nitro injector overdrive', () => {
  const ability = getPartDef('nitro-injector').ability!;

  it('is a big, obvious shove rather than a nudge', () => {
    const stats = effectiveOverdrive(ability, 1);
    const plain = launch(null);
    const boosted = launch({
      seconds: stats.durationSeconds,
      torque: stats.torqueMultiplier,
      speed: stats.topSpeedMultiplier,
    });
    // A third again as fast on the same rig, same throttle, same three seconds.
    expect(boosted).toBeGreaterThan(plain * 1.3);
  });

  it('does not flip the rig when the surge lands from a standstill', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    drive(world, vehicle, {}, 1);
    const stats = effectiveOverdrive(ability, 5);
    // Worst case: max-level surge dumped in before the rig is even rolling.
    vehicle.grantOverdrive(
      stats.durationSeconds,
      stats.torqueMultiplier,
      stats.topSpeedMultiplier,
    );
    let minUpY = 1;
    for (let i = 0; i < Math.round(stats.durationSeconds / DT); i++) {
      vehicle.preStep(DT, { ...idleControls, throttle: 1 }, () => 'asphalt');
      world.step();
      vehicle.postStepStability(DT);
      vehicle.finishStep();
      const up = rotateByQuat(vehicle.body.rotation(), { x: 0, y: 1, z: 0 });
      minUpY = Math.min(minUpY, up.y);
    }
    expect(minUpY).toBeGreaterThan(0.95);
    world.free();
  });

  it('hands the speed back when the surge runs out', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    drive(world, vehicle, {}, 1);
    drive(world, vehicle, { throttle: 1 }, 6);
    const stats = effectiveOverdrive(ability, 1);
    vehicle.grantOverdrive(
      stats.durationSeconds,
      stats.torqueMultiplier,
      stats.topSpeedMultiplier,
    );
    expect(vehicle.isOverdriving).toBe(true);
    drive(world, vehicle, { throttle: 1 }, stats.durationSeconds + 0.5);
    expect(vehicle.isOverdriving).toBe(false);
    world.free();
  });

  it('never stacks past the strongest surge in flight', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    drive(world, vehicle, {}, 1);
    drive(world, vehicle, { throttle: 1 }, 4);
    vehicle.grantOverdrive(4, 3.2, 1.35);
    const single = vehicle.forwardSpeed();
    for (let i = 0; i < 5; i++) vehicle.grantOverdrive(4, 3.2, 1.35);
    drive(world, vehicle, { throttle: 1 }, 2);
    const spammed = vehicle.forwardSpeed();
    // Re-arming mid-surge must not compound into a rocket.
    expect(spammed).toBeLessThan(single * 3);
    world.free();
  });
});
