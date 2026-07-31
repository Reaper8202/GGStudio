import { describe, expect, it } from 'vitest';
import { buildStarterBlueprint } from '../src/app/App.ts';
import { getPartDef } from '../src/core/parts.ts';
import { deriveAutomaticWheelLayout, resolveDrivenPartIds } from '../src/core/wheelLayout.ts';
import type { RuntimeWheel } from '../src/runtime/assembler.ts';
import { computeAckermann, steerTargets, steeringActuatorRate, steeringSpeedMultiplier } from '../src/runtime/wheels.ts';

function wheel(partId: string, x: number, z: number, steering = true): RuntimeWheel {
  return {
    partId,
    anchorLocal: { x, y: 0, z },
    steering,
    broken: false,
    steerInverted: false,
    steerAngle: 0,
    wheelDef: getPartDef('wheel-standard').wheel!,
  } as RuntimeWheel;
}

describe('steering geometry and actuator', () => {
  it('drives and steers the starter front wheel at the same time', () => {
    const blueprint = buildStarterBlueprint();
    const driven = resolveDrivenPartIds(blueprint, getPartDef);
    const { steeringPartIds } = deriveAutomaticWheelLayout(blueprint, getPartDef);
    const front = blueprint.parts.find((part) => part.defId === 'wheel-standard' && part.pos.z === 2)!;
    // The whole point of the fix: these two sets used to be disjoint.
    expect(driven.has(front.id)).toBe(true);
    expect(steeringPartIds.has(front.id)).toBe(true);
    // Steering must stay underived so a swapped-in wheel re-derives correctly.
    expect(front.config.steering).toBeUndefined();
  });

  it('drives every wheel of a four-wheel rig while the front pair steers', () => {
    const blueprint = buildStarterBlueprint();
    const wheels = blueprint.parts.filter((part) => getPartDef(part.defId).wheel);
    const driven = resolveDrivenPartIds(blueprint, getPartDef);
    const { steeringPartIds } = deriveAutomaticWheelLayout(blueprint, getPartDef);
    expect(driven.size).toBe(wheels.length);
    expect(steeringPartIds.size).toBeGreaterThan(0);
    // Every steering wheel is also a driven wheel.
    for (const id of steeringPartIds) expect(driven.has(id)).toBe(true);
  });

  it('gives the inner steering wheel a larger Ackermann angle', () => {
    const wheels = [wheel('fl', 0, 2), wheel('fr', 1, 2), wheel('rl', 0, -2, false), wheel('rr', 1, -2, false)];
    const targets = steerTargets(wheels, computeAckermann(wheels), 0.5);
    expect(Math.abs(targets.get('fl')!)).toBeGreaterThan(Math.abs(targets.get('fr')!));
    expect(Math.abs(targets.get('fl')!)).toBeLessThanOrEqual(wheels[0]!.wheelDef.maxSteerAngleDeg * Math.PI / 180);
  });

  it('returns all steering targets to zero for zero input', () => {
    const wheels = [wheel('l', 0, 2), wheel('r', 1, 2)];
    expect([...steerTargets(wheels, computeAckermann(wheels), 0).values()]).toEqual([0, 0]);
  });

  it('fades speed-sensitive steering from one to a bounded floor', () => {
    expect(steeringSpeedMultiplier(0)).toBe(1);
    expect(steeringSpeedMultiplier(13)).toBeLessThan(1);
    expect(steeringSpeedMultiplier(42)).toBeGreaterThanOrEqual(0.38);
    expect(steeringSpeedMultiplier(1000)).toBe(0.38);
  });

  it('returns to centre faster than it turns in', () => {
    expect(steeringActuatorRate(0.2, 0.8)).toBeGreaterThan(steeringActuatorRate(0.8, 0));
    expect(steeringActuatorRate(-0.2, 0.2)).toBeGreaterThan(steeringActuatorRate(0.8, 0.2));
  });

  it('treats a turn begun from dead centre as turn-in, not a sign flip', () => {
    // Math.sign(0) is 0, so a naive sign comparison mistakes the most common
    // turn-in of all — leaving straight — for a cross-centre correction.
    expect(steeringActuatorRate(0.8, 0)).toBe(steeringActuatorRate(0.8, 0.2));
  });

  it('still steers a single-axle rig, where every wheel steers', () => {
    // No non-steering axle means no Ackermann pivot line. The hubs must still
    // take the commanded angle instead of collapsing to zero.
    const wheels = [wheel('l', 0, 0), wheel('r', 1, 0)];
    const targets = steerTargets(wheels, computeAckermann(wheels), 1);
    const max = (wheels[0]!.wheelDef.maxSteerAngleDeg * Math.PI) / 180;
    expect(Math.abs(targets.get('l')!)).toBeCloseTo(max, 6);
    expect(Math.abs(targets.get('r')!)).toBeCloseTo(max, 6);
  });

  it('steers a rig whose steering wheels sit behind the fixed axle', () => {
    const wheels = [wheel('fl', 0, 2, false), wheel('fr', 1, 2, false), wheel('rl', 0, -2), wheel('rr', 1, -2)];
    const targets = steerTargets(wheels, computeAckermann(wheels), 0.5);
    expect(Math.abs(targets.get('rl')!)).toBeGreaterThan(0);
    expect(Math.abs(targets.get('rr')!)).toBeGreaterThan(0);
  });
});
