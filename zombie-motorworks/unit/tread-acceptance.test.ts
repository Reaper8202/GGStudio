/**
 * Behavioural guards for tread (skid-steer) rigs, driven through the real
 * physics rather than asserted on constants.
 *
 * Before this pass a two-belt tank spun at 7.35 rad/s — twice the global yaw
 * limit — while a four-belt tank managed 0.42 rad/s and 0.3 m/s, a 17.5x
 * spread that made tread builds feel broken. Belts also ran to ~990 rad/s of
 * spin (≈280 m/s of track speed), which pinned tyre force at the friction
 * ceiling and, once bounded, briefly let a tracked rig out-run a car.
 *
 * The bands below are wide enough to retune within and tight enough to catch
 * those regressions coming back. The four-wheel car case is the guard on the
 * separate steering work: treads must not be fixed by changing wheels.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { getPartDef } from '../src/core/parts.ts';
import { deriveConnections } from '../src/core/structural.ts';
import type { PlacedPart, VehicleBlueprint } from '../src/core/types.ts';
import { assembleVehicle } from '../src/runtime/assembler.ts';
import { brakeInputWithAutoHold, RuntimeVehicle } from '../src/runtime/vehicle.ts';

beforeAll(() => RAPIER.init());

const at = (
  id: string,
  defId: string,
  x: number,
  z: number,
  y = 1,
): PlacedPart => ({
  id,
  defId,
  pos: { x, y, z },
  orient: 0,
  config: {},
});

// Engine and tank sit on the deck (y = 2) rather than alongside the wheels.
// The bands asserted below were measured on exactly this hull; moving mass
// around changes the centre of gravity and with it every number here.
const HULL: PlacedPart[] = [
  at('core', 'chassis-core', 0, 0),
  at('f1', 'frame-box', 0, 1),
  at('f2', 'frame-box', 0, -1),
  at('f3', 'frame-box', 1, 0),
  at('f4', 'frame-box', -1, 0),
  at('eng', 'engine-small', 0, 0, 2),
  at('fuel', 'fuel-tank', 0, 1, 2),
];

const RIGS = {
  twoTread: [
    ...HULL,
    at('tL', 'tread-tank', -2, 0),
    at('tR', 'tread-tank', 2, 0),
  ],
  fourTread: [
    ...HULL,
    at('tL1', 'tread-tank', -2, 3),
    at('tR1', 'tread-tank', 2, 3),
    at('tL2', 'tread-tank', -2, -3),
    at('tR2', 'tread-tank', 2, -3),
  ],
  car: [
    ...HULL,
    at('wFL', 'wheel-standard', -2, 2),
    at('wFR', 'wheel-standard', 2, 2),
    at('wRL', 'wheel-standard', -2, -2),
    at('wRR', 'wheel-standard', 2, -2),
  ],
} as const;

interface Result {
  peakYawRate: number;
  speed: number;
  topSpeed: number;
  maxSurfaceSpeed: number;
}

/**
 * Settle the rig on flat ground, then hold the given controls. The order
 * preStep -> world.step -> postStepStability is what the game loop does; skip
 * the last call and the stability clamps never run, which makes every number
 * here meaningless.
 */
function drive(
  parts: readonly PlacedPart[],
  controls: { throttle: number; steer: number },
  steps = 300,
): Result {
  const bp: VehicleBlueprint = {
    schemaVersion: 4,
    id: 'rig',
    name: 'rig',
    parts: [...parts],
  };
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );
  const vehicle = new RuntimeVehicle(
    world,
    bp,
    getPartDef,
    deriveConnections(bp, getPartDef),
    { translation: { x: 0, y: 1.4, z: 0 } },
  );
  const dt = 1 / 60;
  const surfaceOf = (): 'asphalt' => 'asphalt';
  for (let i = 0; i < 90; i++) {
    vehicle.preStep(
      dt,
      { throttle: 0, brake: 1, steer: 0, reverse: 0, fire: false, aimYawWorld: 0 },
      surfaceOf,
    );
    world.step();
    vehicle.postStepStability(dt);
  }
  let peakYawRate = 0;
  let topSpeed = 0;
  let maxSurfaceSpeed = 0;
  for (let i = 0; i < steps; i++) {
    vehicle.preStep(
      dt,
      { ...controls, brake: 0, reverse: 0, fire: false, aimYawWorld: 0 },
      surfaceOf,
    );
    world.step();
    vehicle.postStepStability(dt);
    peakYawRate = Math.max(peakYawRate, Math.abs(vehicle.body.angvel().y));
    const v = vehicle.body.linvel();
    topSpeed = Math.max(topSpeed, Math.hypot(v.x, v.z));
    for (const w of vehicle.assembled.wheels) {
      maxSurfaceSpeed = Math.max(maxSurfaceSpeed, Math.abs(w.omega) * w.radius);
    }
  }
  const v = vehicle.body.linvel();
  return {
    peakYawRate,
    speed: Math.hypot(v.x, v.z),
    topSpeed,
    maxSurfaceSpeed,
  };
}

describe('tread rigs steer', () => {
  it('turns every belt count at a comparable rate, under the yaw limit', () => {
    const two = drive(RIGS.twoTread, { throttle: 1, steer: 1 });
    const four = drive(RIGS.fourTread, { throttle: 1, steer: 1 });
    for (const r of [two, four]) {
      expect(r.peakYawRate).toBeGreaterThan(1);
      expect(r.peakYawRate).toBeLessThan(3.5); // YAW_RATE_SOFT_LIMIT
    }
    // Belt count must not decide how well a tank turns. Was 17.5x.
    const spread =
      Math.max(two.peakYawRate, four.peakYawRate) /
      Math.min(two.peakYawRate, four.peakYawRate);
    expect(spread).toBeLessThan(2);
  });

  it('pivots in place at full lock with the throttle shut', () => {
    for (const parts of [RIGS.twoTread, RIGS.fourTread]) {
      const r = drive(parts, { throttle: 0, steer: 1 });
      expect(r.peakYawRate).toBeGreaterThan(0.8);
      expect(r.speed).toBeLessThan(1.5); // in place, not driving off
    }
  });

  it('never lets a belt run away into unphysical track speed', () => {
    for (const parts of [RIGS.twoTread, RIGS.fourTread, RIGS.car]) {
      const r = drive(parts, { throttle: 1, steer: 1 });
      expect(r.maxSurfaceSpeed).toBeLessThan(60); // was ~280 m/s
    }
  });

  it('keeps treads slow flat-out compared with wheels', () => {
    const tank = drive(RIGS.twoTread, { throttle: 1, steer: 0 }, 900);
    const car = drive(RIGS.car, { throttle: 1, steer: 0 }, 900);
    expect(tank.topSpeed).toBeLessThan(car.topSpeed * 0.75);
    // Still has to be worth driving.
    expect(tank.topSpeed).toBeGreaterThan(8);
  });

  it('leaves the four-wheel car untouched', () => {
    const car = drive(RIGS.car, { throttle: 1, steer: 1 });
    // Baseline before and after the tread work: 2.36 rad/s, 19.3 m/s.
    expect(car.peakYawRate).toBeGreaterThan(2);
    expect(car.peakYawRate).toBeLessThan(2.8);
    expect(car.speed).toBeGreaterThan(15);
  });
});

describe('tread wiring', () => {
  it('samples a three-cell belt along its length, a wheel at one point', () => {
    expect(getPartDef('wheel-standard').cells).toHaveLength(1);
    expect(getPartDef('tread-tank').cells).toHaveLength(3);
    const bp: VehicleBlueprint = {
      schemaVersion: 4,
      id: 'mix',
      name: 'mix',
      parts: [...HULL, at('w', 'wheel-standard', -2, 0), at('t', 'tread-tank', 2, 0)],
    };
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const assembled = assembleVehicle(
      world,
      bp,
      getPartDef,
      deriveConnections(bp, getPartDef),
      { translation: { x: 0, y: 1.4, z: 0 } },
    );
    const wheel = assembled.wheels.find((w) => w.partId === 'w');
    const tread = assembled.wheels.find((w) => w.partId === 't');
    // A one-cell wheel must stay exactly one sample, or every wheeled rig's
    // handling shifts underneath the steering work.
    expect(wheel?.contactOffsetsLocal).toHaveLength(1);
    expect(tread?.contactOffsetsLocal.length).toBeGreaterThan(1);
  });

  it('releases auto-hold for a commanded pivot but still holds a coast', () => {
    const hold = (steer: number, hasSkidSteer: boolean): number =>
      brakeInputWithAutoHold(
        { throttle: 0, reverse: 0, brake: 0, steer },
        0,
        hasSkidSteer,
      );
    expect(hold(1, true)).toBe(0); // pivot commanded: let the belts turn
    expect(hold(0, true)).toBe(1); // no input: park it
    expect(hold(1, false)).toBe(1); // wheels cannot skid-steer: still park it
  });
});
