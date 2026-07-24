import { describe, expect, it } from 'vitest';
import { isAllTreadRig } from '../src/runtime/vehicle.ts';
import type { WheelDefinition } from '../src/core/types.ts';

/**
 * Excavator-mode gating: a rig should pivot on the spot (counter-rotating
 * belts) only when it steers purely by treads. Any hub-steering-capable wheel
 * means the player still has car-like steering, so the milder skid applies.
 */

const TREAD_DEF = {
  skidSteer: true,
  maxSteerAngleDeg: 0,
} as unknown as WheelDefinition;

const STEER_WHEEL_DEF = {
  skidSteer: false,
  maxSteerAngleDeg: 40,
} as unknown as WheelDefinition;

function wheel(wheelDef: WheelDefinition): { wheelDef: WheelDefinition } {
  return { wheelDef };
}

describe('isAllTreadRig', () => {
  it('is true for an all-tread rig (four treads, no steering wheels)', () => {
    const wheels = [TREAD_DEF, TREAD_DEF, TREAD_DEF, TREAD_DEF].map(wheel);
    expect(isAllTreadRig(wheels)).toBe(true);
  });

  it('is false when a hub-steering wheel is present alongside treads', () => {
    const wheels = [TREAD_DEF, TREAD_DEF, STEER_WHEEL_DEF, STEER_WHEEL_DEF].map(
      wheel,
    );
    expect(isAllTreadRig(wheels)).toBe(false);
  });

  it('is false for a wheels-only rig (no treads to pivot on)', () => {
    const wheels = [STEER_WHEEL_DEF, STEER_WHEEL_DEF].map(wheel);
    expect(isAllTreadRig(wheels)).toBe(false);
  });

  it('is false even when only one steer-capable wheel sits among treads', () => {
    // A single steer-capable hub is enough to keep car-like steering, so the
    // rig does not switch to the counter-rotating excavator pivot.
    const wheels = [TREAD_DEF, TREAD_DEF, TREAD_DEF, STEER_WHEEL_DEF].map(wheel);
    expect(isAllTreadRig(wheels)).toBe(false);
  });

  it('is false for an empty wheel list', () => {
    expect(isAllTreadRig([])).toBe(false);
  });
});
