/**
 * Pure drivetrain math: torque-curve sampling, simple automatic gearbox,
 * per-wheel torque distribution. No Rapier imports (unit-testable).
 */

import type { EngineDefinition } from '../core/types.ts';

export const GEAR_RATIOS = [3.6, 2.2, 1.45, 1.0, 0.78] as const;
export const FINAL_DRIVE = 3.9;
export const DRIVELINE_EFFICIENCY = 0.85;
export const SHIFT_UP_RPM_FRACTION = 0.82;
export const SHIFT_DOWN_RPM_FRACTION = 0.35;

/** Linear interpolation on an ascending [rpm, torque] curve, clamped at ends. */
export function torqueAtRpm(curve: readonly [number, number][], rpm: number): number {
  if (curve.length === 0) return 0;
  if (rpm <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (rpm >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    const [r1, t1] = curve[i];
    const [r0, t0] = curve[i - 1];
    if (rpm <= r1) {
      const f = (rpm - r0) / (r1 - r0);
      return t0 + f * (t1 - t0);
    }
  }
  return last[1];
}

export interface GearboxState {
  gear: number; // index into GEAR_RATIOS
  shiftCooldown: number; // s
}

export function totalRatio(gear: number): number {
  return GEAR_RATIOS[gear] * FINAL_DRIVE;
}

/** Engine rpm implied by mean driven-wheel angular speed (rad/s). */
export function rpmFromWheelSpeed(meanWheelRadPerS: number, gear: number, engine: EngineDefinition): number {
  const rpm = Math.abs(meanWheelRadPerS) * totalRatio(gear) * (60 / (2 * Math.PI));
  return Math.min(Math.max(rpm, engine.idleRpm), engine.maxRpm);
}

/** Simple automatic shifting with a cooldown to prevent hunting. */
export function updateGearbox(state: GearboxState, rpm: number, engine: EngineDefinition, dt: number): GearboxState {
  let { gear, shiftCooldown } = state;
  shiftCooldown = Math.max(0, shiftCooldown - dt);
  if (shiftCooldown === 0) {
    if (rpm > engine.maxRpm * SHIFT_UP_RPM_FRACTION && gear < GEAR_RATIOS.length - 1) {
      gear += 1;
      shiftCooldown = 0.6;
    } else if (rpm < engine.maxRpm * SHIFT_DOWN_RPM_FRACTION && gear > 0) {
      gear -= 1;
      shiftCooldown = 0.6;
    }
  }
  return { gear, shiftCooldown };
}

export interface EngineOutput {
  wheelTorqueTotal: number; // N·m at the wheels (before per-wheel clamp)
  rpm: number;
  fuelUsed: number; // litres
}

/** Torque delivered by one engine this step. Multiple engines sum their outputs. */
export function engineStep(
  engine: EngineDefinition,
  gearbox: GearboxState,
  throttle: number, // 0..1
  meanDrivenWheelRadPerS: number,
  dt: number,
): EngineOutput {
  const rpm = rpmFromWheelSpeed(meanDrivenWheelRadPerS, gearbox.gear, engine);
  const engineTorque = torqueAtRpm(engine.torqueCurve, rpm) * throttle;
  const wheelTorqueTotal = engineTorque * totalRatio(gearbox.gear) * DRIVELINE_EFFICIENCY;
  return {
    wheelTorqueTotal,
    rpm,
    fuelUsed: engine.fuelPerSecondAtFull * throttle * dt,
  };
}

/** Equal split across driven wheels (open diff), clamped per wheel. */
export function distributeTorque(total: number, drivenWheelLimits: readonly number[]): number[] {
  const n = drivenWheelLimits.length;
  if (n === 0) return [];
  const per = total / n;
  return drivenWheelLimits.map((lim) => Math.sign(per) * Math.min(Math.abs(per), lim));
}
