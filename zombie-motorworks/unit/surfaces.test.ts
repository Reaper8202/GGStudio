import { describe, expect, it } from 'vitest';
import {
  NEUTRAL_ENVIRONMENT,
  combineEnvironments,
  hazardIntensity,
  type BiomeHazardSpec,
  type EnvironmentModifiers,
} from '../src/core/biomes.ts';
import {
  SURFACES,
  type SurfaceKind,
} from '../src/core/surfaces.ts';

const SURFACE_KINDS = [
  'asphalt',
  'dirt',
  'mud',
  'rubble',
  'gravel',
  'snow',
  'ice',
  'sand',
  'hardpan',
] as const satisfies readonly SurfaceKind[];

const HAZARD_SPECS = [
  {
    kind: 'blizzard',
    startWave: 1,
    fullWave: 8,
    maxFogDensity: 0.08,
    maxGripLoss: 0.35,
    maxDragMul: 1.2,
  },
  {
    kind: 'sandstorm',
    startWave: 5,
    fullWave: 15,
    maxFogDensity: 0.1,
    maxGripLoss: 0.25,
    maxDragMul: 1.4,
  },
  {
    kind: 'none',
    startWave: 3,
    fullWave: 6,
    maxFogDensity: 0,
    maxGripLoss: 0,
    maxDragMul: 1,
  },
] as const satisfies readonly BiomeHazardSpec[];

describe('surface parameters', () => {
  it('defines valid parameters for every surface kind', () => {
    expect(Object.keys(SURFACES).sort()).toEqual([...SURFACE_KINDS].sort());

    for (const surface of Object.values(SURFACES)) {
      expect(Number.isFinite(surface.muLong)).toBe(true);
      expect(surface.muLong).toBeGreaterThan(0);
      expect(Number.isFinite(surface.muLat)).toBe(true);
      expect(surface.muLat).toBeGreaterThan(0);
      expect(Number.isFinite(surface.rollingResistance)).toBe(true);
      expect(surface.rollingResistance).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(surface.sinkage)).toBe(true);
      expect(surface.sinkage).toBeGreaterThanOrEqual(0);
    }
  });

  it('preserves the original four surface values exactly', () => {
    expect(SURFACES.asphalt).toMatchObject({
      muLong: 1,
      muLat: 1,
      rollingResistance: 0.015,
    });
    expect(SURFACES.dirt).toMatchObject({
      muLong: 0.72,
      muLat: 0.68,
      rollingResistance: 0.035,
    });
    expect(SURFACES.mud).toMatchObject({
      muLong: 0.4,
      muLat: 0.35,
      rollingResistance: 0.09,
    });
    expect(SURFACES.rubble).toMatchObject({
      muLong: 0.6,
      muLat: 0.55,
      rollingResistance: 0.06,
    });
  });

  it('keeps the intended terrain ordering', () => {
    expect(SURFACES.snow.muLat).toBeLessThan(SURFACES.dirt.muLat);
    expect(SURFACES.ice.muLong).toBeLessThan(SURFACES.snow.muLong);
    expect(SURFACES.sand.rollingResistance).toBeGreaterThan(
      SURFACES.dirt.rollingResistance,
    );
    expect(SURFACES.sand.sinkage).toBeGreaterThan(SURFACES.snow.sinkage);
    expect(SURFACES.snow.sinkage).toBeGreaterThan(SURFACES.dirt.sinkage);
    expect(SURFACES.asphalt.sinkage).toBe(0);
  });
});

describe('environment modifiers', () => {
  it('makes every neutral multiplier exactly one', () => {
    expect(Object.values(NEUTRAL_ENVIRONMENT)).toHaveLength(8);
    for (const multiplier of Object.values(NEUTRAL_ENVIRONMENT)) {
      expect(multiplier).toBe(1);
    }
  });

  it('combines environments component-wise and preserves neutral identity', () => {
    const a: EnvironmentModifiers = {
      gripLongMul: 0.8,
      gripLatMul: 0.7,
      rollingResistanceMul: 1.2,
      dragMul: 1.3,
      engineOutputMul: 0.9,
      fuelBurnMul: 1.1,
      stabilityAssistMul: 0.5,
      topSpeedMul: 0.95,
    };
    const b: EnvironmentModifiers = {
      gripLongMul: 0.5,
      gripLatMul: 0.25,
      rollingResistanceMul: 2,
      dragMul: 1.5,
      engineOutputMul: 0.75,
      fuelBurnMul: 1.25,
      stabilityAssistMul: 0.4,
      topSpeedMul: 0.8,
    };

    expect(combineEnvironments(a, b)).toEqual({
      gripLongMul: 0.4,
      gripLatMul: 0.175,
      rollingResistanceMul: 2.4,
      dragMul: 1.9500000000000002,
      engineOutputMul: 0.675,
      fuelBurnMul: 1.375,
      stabilityAssistMul: 0.2,
      topSpeedMul: 0.76,
    });
    expect(combineEnvironments(a, NEUTRAL_ENVIRONMENT)).toEqual(a);
    expect(combineEnvironments(NEUTRAL_ENVIRONMENT, a)).toEqual(a);
  });
});

describe('hazard intensity', () => {
  it('is exactly zero at wave one for hazards that start at wave one or later', () => {
    for (const spec of HAZARD_SPECS) {
      expect(hazardIntensity(spec, 1)).toBe(0);
    }
  });

  it('stays at zero for every wave when a biome has no hazard', () => {
    for (const spec of HAZARD_SPECS.filter((s) => s.kind === 'none')) {
      for (let wave = 1; wave <= 30; wave++) {
        expect(hazardIntensity(spec, wave)).toBe(0);
      }
    }
  });

  it('uses exact endpoints and rises monotonically through wave 30', () => {
    // Only ramping hazards have endpoints; a 'none' hazard never leaves zero.
    for (const spec of HAZARD_SPECS.filter((s) => s.kind !== 'none')) {
      expect(hazardIntensity(spec, spec.startWave - 1)).toBe(0);
      expect(hazardIntensity(spec, spec.startWave)).toBe(0);
      expect(hazardIntensity(spec, spec.fullWave)).toBe(1);
      expect(hazardIntensity(spec, spec.fullWave + 1)).toBe(1);

      let previous = hazardIntensity(spec, 1);
      for (let wave = 2; wave <= 30; wave++) {
        const current = hazardIntensity(spec, wave);
        expect(current).toBeGreaterThanOrEqual(previous);
        previous = current;
      }
    }
  });

  it('handles a full wave at or before the start wave without NaN', () => {
    for (const fullWave of [5, 3]) {
      const spec: BiomeHazardSpec = {
        kind: 'blizzard',
        startWave: 5,
        fullWave,
        maxFogDensity: 0.1,
        maxGripLoss: 0.4,
        maxDragMul: 1.5,
      };
      expect(hazardIntensity(spec, 4)).toBe(0);
      expect(hazardIntensity(spec, 5)).toBe(1);
      for (let wave = 1; wave <= 30; wave++) {
        expect(Number.isNaN(hazardIntensity(spec, wave))).toBe(false);
      }
    }
  });
});
