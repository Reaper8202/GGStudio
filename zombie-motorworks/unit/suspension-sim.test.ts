/**
 * Headless stability simulation for the per-wheel raycast suspension.
 * Drives the balanced fixture through the scenarios the suspension is tuned
 * for: settling at rest, hard launch without pitch-flip, cornering without
 * rollover, and rough terrain without losing the chassis.
 */

import { readFileSync } from 'node:fs';

import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPartDef } from '../src/core/parts.ts';
import { deserializeBlueprint } from '../src/core/serialize.ts';
import { deriveConnections } from '../src/core/structural.ts';
import { GROUP_TERRAIN, lowestPointM } from '../src/runtime/assembler.ts';
import type { VehicleControls } from '../src/runtime/vehicle.ts';
import {
  RuntimeVehicle,
  brakeInputWithAutoHold,
} from '../src/runtime/vehicle.ts';
import { rotateByQuat } from '../src/runtime/vec.ts';

const DT = 1 / 60;
const TERRAIN_GROUPS = (GROUP_TERRAIN << 16) | 0xffff;

beforeAll(async () => {
  await RAPIER.init();
});

function makeWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(200, 1, 200)
      .setTranslation(0, -1, 0)
      .setFriction(0.9)
      .setCollisionGroups(TERRAIN_GROUPS),
  );
  return world;
}

/** Bumps and a shallow ramp across the driving line, up to 0.15 m tall. */
function addRoughTerrain(world: RAPIER.World): void {
  for (let i = 0; i < 12; i++) {
    const height = 0.05 + (i % 3) * 0.05;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(3, height, 0.35)
        .setTranslation(((i % 2) - 0.5) * 1.2, height - 0.02, 8 + i * 3)
        .setFriction(0.9)
        .setCollisionGroups(TERRAIN_GROUPS),
    );
  }
}

function spawnVehicle(world: RAPIER.World): RuntimeVehicle {
  const bp = deserializeBlueprint(
    readFileSync(new URL('../tests/fixtures/balanced.json', import.meta.url), 'utf8'),
  );
  const connections = deriveConnections(bp, getPartDef);
  return new RuntimeVehicle(world, bp, getPartDef, connections, {
    translation: { x: 0, y: -lowestPointM(bp, getPartDef) + 0.32, z: 0 },
  });
}

const idleControls: VehicleControls = {
  throttle: 0,
  brake: 0,
  steer: 0,
  fire: false,
  aimYawWorld: 0,
};

/** Steps the sim, returning the minimum chassis-up world-Y seen (1 = level). */
function run(
  world: RAPIER.World,
  vehicle: RuntimeVehicle,
  controls: Partial<VehicleControls>,
  seconds: number,
): number {
  let minUpY = 1;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    vehicle.preStep(DT, { ...idleControls, ...controls }, () => 'asphalt');
    world.step();
    vehicle.postStepStability(DT);
    vehicle.finishStep();
    const up = rotateByQuat(vehicle.body.rotation(), { x: 0, y: 1, z: 0 });
    minUpY = Math.min(minUpY, up.y);
  }
  return minUpY;
}

function horizontalDistance(
  from: { x: number; z: number },
  to: { x: number; z: number },
): number {
  return Math.hypot(to.x - from.x, to.z - from.z);
}

describe('suspension stability simulation', () => {
  it('settles level and grounded at rest', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    const minUpY = run(world, vehicle, {}, 3);

    expect(minUpY).toBeGreaterThan(0.98);
    const telemetry = vehicle.telemetry();
    expect(telemetry.groundedWheels).toBe(telemetry.totalWheels);
    expect(Math.abs(vehicle.body.linvel().y)).toBeLessThan(0.1);
    world.free();
  });

  it('does not pitch or flip under full-throttle launch', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    run(world, vehicle, {}, 1); // settle
    const minUpY = run(world, vehicle, { throttle: 1 }, 6);

    expect(minUpY).toBeGreaterThan(0.95);
    expect(vehicle.forwardSpeed()).toBeGreaterThan(8);
    world.free();
  });

  it('stays braced through a full-lock corner at speed', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    run(world, vehicle, {}, 1);
    run(world, vehicle, { throttle: 1 }, 4); // build speed
    const headingBefore = rotateByQuat(vehicle.body.rotation(), { x: 0, y: 0, z: 1 });
    const minUpY = run(world, vehicle, { throttle: 0.7, steer: 1 }, 3);
    const headingAfter = rotateByQuat(vehicle.body.rotation(), { x: 0, y: 0, z: 1 });

    expect(minUpY).toBeGreaterThan(0.85);
    // The car actually turned (heading rotated by a meaningful angle).
    const dot = headingBefore.x * headingAfter.x + headingBefore.z * headingAfter.z;
    expect(dot).toBeLessThan(0.9);
    world.free();
  });

  it('crosses rough terrain upright and keeps moving', () => {
    const world = makeWorld();
    addRoughTerrain(world);
    const vehicle = spawnVehicle(world);
    run(world, vehicle, {}, 1);
    const minUpY = run(world, vehicle, { throttle: 1 }, 8);

    expect(minUpY).toBeGreaterThan(0.7);
    expect(vehicle.body.translation().z).toBeGreaterThan(20);
    expect(vehicle.isDestroyed()).toBe(false);
    world.free();
  });
});

describe('vehicle idle settling simulation', () => {
  it('holds only at low speed without drive input', () => {
    expect(brakeInputWithAutoHold(idleControls, 1.49)).toBe(1);
    expect(brakeInputWithAutoHold(idleControls, 1.5)).toBe(0);
    expect(
      brakeInputWithAutoHold({ ...idleControls, throttle: 1 }, 0),
    ).toBe(0);
    expect(
      brakeInputWithAutoHold({ ...idleControls, reverse: 1 }, 0),
    ).toBe(0);
  });

  it('stays in place on flat ground with zero input', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    const start = vehicle.body.translation();

    run(world, vehicle, {}, 5);
    expect(horizontalDistance(start, vehicle.body.translation())).toBeLessThan(0.03);
    world.free();
  });

  it('stops a low-speed roll and does not resume creeping', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    run(world, vehicle, {}, 1);
    const verticalSpeed = vehicle.body.linvel().y;
    vehicle.body.setLinvel({ x: 0, y: verticalSpeed, z: 1 }, true);

    run(world, vehicle, {}, 2);

    expect(Math.abs(vehicle.forwardSpeed())).toBeLessThan(0.02);
    const stoppedAt = vehicle.body.translation();
    run(world, vehicle, {}, 2);
    expect(Math.abs(vehicle.forwardSpeed())).toBeLessThan(0.02);
    expect(horizontalDistance(stoppedAt, vehicle.body.translation())).toBeLessThan(0.02);
    world.free();
  });
});
