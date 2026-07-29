import { describe, expect, it } from 'vitest';
import {
  activeVehicleWarnings,
  FUEL_CAUTION_FRACTION,
  HULL_CAUTION_PCT,
  HULL_CRITICAL_PCT,
  TIRE_CAUTION_FRACTION,
  TIRE_CRITICAL_FRACTION,
  type VehicleWarningInput,
} from '../src/survival/vehicleWarnings.ts';

/** A healthy four-wheeled rig with a full tank, one engine, and two weapons. */
function healthy(
  overrides: Partial<VehicleWarningInput> = {},
): VehicleWarningInput {
  return {
    integrityPct: 100,
    wheels: Array.from({ length: 4 }, () => ({
      healthFraction: 1,
      broken: false,
    })),
    fuel: 60,
    fuelCapacity: 60,
    liveEngineCount: 1,
    weaponCount: 2,
    liveWeaponCount: 2,
    ...overrides,
  };
}

function ids(input: VehicleWarningInput): string[] {
  return activeVehicleWarnings(input).map((warning) => warning.id);
}

describe('activeVehicleWarnings', () => {
  it('stays silent on an undamaged vehicle', () => {
    expect(activeVehicleWarnings(healthy())).toEqual([]);
  });

  it('escalates a tire from caution to critical to blown', () => {
    const wheel = (healthFraction: number, broken = false) =>
      healthy({
        wheels: [{ healthFraction, broken }, { healthFraction: 1, broken: false }],
      });

    expect(ids(wheel(TIRE_CAUTION_FRACTION))).toEqual(['tire-caution']);
    expect(ids(wheel(TIRE_CRITICAL_FRACTION))).toEqual(['tire-critical']);
    expect(ids(wheel(0, true))).toEqual(['tire-blown']);
  });

  it('reports only the worst tire state, never one warning per wheel', () => {
    const warnings = activeVehicleWarnings(
      healthy({
        wheels: [
          { healthFraction: 0, broken: true },
          { healthFraction: 0.1, broken: false },
          { healthFraction: 0.3, broken: false },
          { healthFraction: 1, broken: false },
        ],
      }),
    );
    expect(warnings.map((w) => w.id)).toEqual(['tire-blown']);
    expect(warnings[0].title).toContain('1 Tire Blown');
  });

  it('counts multiple blown tires in the title', () => {
    const [warning] = activeVehicleWarnings(
      healthy({
        wheels: [
          { healthFraction: 0, broken: true },
          { healthFraction: 0, broken: true },
        ],
      }),
    );
    expect(warning.title).toContain('2 Tires Blown');
  });

  it('marks tire, hull, fuel, engine, and weapon failures as critical', () => {
    const warnings = activeVehicleWarnings(
      healthy({
        integrityPct: 10,
        wheels: [{ healthFraction: 0, broken: true }],
        fuel: 0,
        liveEngineCount: 0,
        liveWeaponCount: 0,
      }),
    );
    expect(warnings.map((w) => w.id)).toEqual([
      'tire-blown',
      'hull-critical',
      'fuel-empty',
      'engine-down',
      'weapons-offline',
    ]);
    for (const warning of warnings) expect(warning.severity).toBe('critical');
  });

  it('ranks every critical alert above every caution', () => {
    const warnings = activeVehicleWarnings(
      healthy({
        integrityPct: HULL_CAUTION_PCT,
        wheels: [{ healthFraction: 0, broken: true }],
      }),
    );
    expect(warnings.map((w) => w.severity)).toEqual(['critical', 'caution']);
  });

  it('uses the hull thresholds inclusively', () => {
    expect(ids(healthy({ integrityPct: HULL_CRITICAL_PCT }))).toContain(
      'hull-critical',
    );
    expect(ids(healthy({ integrityPct: HULL_CRITICAL_PCT + 1 }))).toContain(
      'hull-caution',
    );
    expect(ids(healthy({ integrityPct: HULL_CAUTION_PCT + 1 }))).toEqual([]);
  });

  it('warns on low fuel and shows the remaining percentage', () => {
    const [warning] = activeVehicleWarnings(
      healthy({ fuel: 60 * FUEL_CAUTION_FRACTION }),
    );
    expect(warning.id).toBe('fuel-low');
    expect(warning.detail).toBe('25% remaining');
  });

  it('says nothing about fuel on a build that carries no tank', () => {
    expect(ids(healthy({ fuel: 0, fuelCapacity: 0 }))).toEqual([]);
  });

  it('does not report weapons offline for an unarmed build', () => {
    expect(ids(healthy({ weaponCount: 0, liveWeaponCount: 0 }))).toEqual([]);
  });

  it('gives every warning a distinct id and a non-empty detail line', () => {
    const warnings = activeVehicleWarnings(
      healthy({
        integrityPct: 10,
        wheels: [{ healthFraction: 0, broken: true }],
        fuel: 1,
        liveEngineCount: 0,
        liveWeaponCount: 0,
      }),
    );
    expect(new Set(warnings.map((w) => w.id)).size).toBe(warnings.length);
    for (const warning of warnings) {
      expect(warning.detail.length).toBeGreaterThan(0);
      expect(warning.title.length).toBeGreaterThan(0);
    }
  });
});
