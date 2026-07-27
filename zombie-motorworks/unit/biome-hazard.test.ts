import { describe, expect, it } from 'vitest';
import {
  combineEnvironments,
  hazardEnvironment,
  hazardIntensity,
  type BiomeDefinition,
  type EnvironmentModifiers,
} from '../src/core/biomes.ts';
import { BIOMES } from '../src/survival/arena/recipes/index.ts';

function foldedEnvironment(
  biome: BiomeDefinition,
  wave: number,
): EnvironmentModifiers {
  const intensity = hazardIntensity(biome.hazard, wave);
  return combineEnvironments(
    biome.drive,
    hazardEnvironment(biome.hazard, intensity),
  );
}

describe('per-wave biome hazards', () => {
  it('leaves every biome at its base drive environment on wave one', () => {
    for (const biome of Object.values(BIOMES)) {
      expect(foldedEnvironment(biome, 1)).toEqual(biome.drive);
    }
  });

  it('reduces snowfield grip and increases desert drag by wave 12', () => {
    const snowAtWave1 = foldedEnvironment(BIOMES.snowfield, 1);
    const snowAtWave12 = foldedEnvironment(BIOMES.snowfield, 12);
    const desertAtWave1 = foldedEnvironment(BIOMES.desert, 1);
    const desertAtWave12 = foldedEnvironment(BIOMES.desert, 12);

    expect(snowAtWave12.gripLongMul).toBeLessThan(
      snowAtWave1.gripLongMul,
    );
    expect(snowAtWave12.gripLatMul).toBeLessThan(snowAtWave1.gripLatMul);
    expect(desertAtWave12.dragMul).toBeGreaterThan(desertAtWave1.dragMul);
  });

  it('keeps grip and drag monotonic through wave 30', () => {
    for (const biome of Object.values(BIOMES)) {
      let previous = foldedEnvironment(biome, 1);
      for (let wave = 2; wave <= 30; wave++) {
        const current = foldedEnvironment(biome, wave);
        expect(current.gripLongMul).toBeLessThanOrEqual(
          previous.gripLongMul,
        );
        expect(current.gripLatMul).toBeLessThanOrEqual(previous.gripLatMul);
        expect(current.dragMul).toBeGreaterThanOrEqual(previous.dragMul);
        previous = current;
      }
    }
  });

  it('leaves the graveyard unchanged through wave 30', () => {
    expect(foldedEnvironment(BIOMES.graveyard, 30)).toEqual(
      foldedEnvironment(BIOMES.graveyard, 1),
    );
  });

  it('keeps every folded modifier finite and positive through wave 60', () => {
    for (const biome of Object.values(BIOMES)) {
      for (let wave = 1; wave <= 60; wave++) {
        for (const value of Object.values(foldedEnvironment(biome, wave))) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThan(0);
        }
      }
    }
  });
});
