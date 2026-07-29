import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hazardIntensity,
  type BiomeDefinition,
  type BiomeId,
  type PropEntry,
} from '../src/core/biomes.ts';
import {
  BIOMES,
  DEFAULT_BIOME_ID,
  getBiome,
} from '../src/survival/arena/recipes/index.ts';

const BIOME_IDS = [
  'graveyard',
  'snowfield',
  'desert',
] as const satisfies readonly BiomeId[];
const PUBLIC_DIR = resolve(process.cwd(), 'public');

function expectAscendingPositiveRange(
  range: readonly [number, number] | undefined,
): void {
  if (range === undefined) return;
  expect(range[0]).toBeGreaterThan(0);
  expect(range[1]).toBeGreaterThan(0);
  expect(range[0]).toBeLessThanOrEqual(range[1]);
}

function expectValidProp(prop: PropEntry): void {
  expect(prop.asset.trim()).not.toBe('');
  expect(prop.weight).toBeGreaterThan(0);
  expectAscendingPositiveRange(prop.scale);
  expectAscendingPositiveRange(prop.scaleY);
}

function referencedAssets(biome: BiomeDefinition): string[] {
  return [
    biome.layout.groundAsset,
    ...biome.layout.scatters.flatMap((scatter) =>
      scatter.table.map((prop) => prop.asset),
    ),
    ...(biome.layout.perimeterProp === undefined
      ? []
      : [biome.layout.perimeterProp.asset]),
    ...(biome.layout.fixtures ?? [])
      .map((fixture) => fixture.asset)
      .filter((asset) => !asset.startsWith('@arena/')),
  ];
}

describe('biome recipes', () => {
  it('defines one matching recipe for every biome id', () => {
    expect(Object.keys(BIOMES).sort()).toEqual([...BIOME_IDS].sort());
    for (const id of BIOME_IDS) expect(BIOMES[id].id).toBe(id);
  });

  it('falls back to the graveyard for an unrecognised id', () => {
    expect(getBiome('bogus' as BiomeId)).toBe(BIOMES[DEFAULT_BIOME_ID]);
  });

  it('keeps layout ranges and weighted prop tables valid', () => {
    for (const biome of Object.values(BIOMES)) {
      const { layout } = biome;
      expect(layout.halfSize).toBeGreaterThan(0);
      expect(layout.spawnPointCount).toBeGreaterThan(0);
      expect(layout.terrainRoughness).toBeGreaterThanOrEqual(0);
      expect(layout.terrainRoughness).toBeLessThanOrEqual(1);

      for (const scatter of layout.scatters) {
        expect(scatter.count[0]).toBeGreaterThanOrEqual(0);
        expect(scatter.count[1]).toBeGreaterThanOrEqual(0);
        expect(scatter.count[0]).toBeLessThanOrEqual(scatter.count[1]);
        expect(scatter.table.length).toBeGreaterThan(0);
        for (const prop of scatter.table) expectValidProp(prop);
      }

      for (const patch of layout.patches) {
        expect(patch.count[0]).toBeGreaterThanOrEqual(0);
        expect(patch.count[1]).toBeGreaterThanOrEqual(0);
        expect(patch.count[0]).toBeLessThanOrEqual(patch.count[1]);
        expect(patch.radius[0]).toBeGreaterThanOrEqual(0);
        expect(patch.radius[1]).toBeGreaterThanOrEqual(0);
        expect(patch.radius[0]).toBeLessThanOrEqual(patch.radius[1]);
      }

      if (layout.perimeterProp !== undefined) {
        expectValidProp(layout.perimeterProp);
      }
    }
  });

  it('references asset files that exist under public', () => {
    for (const biome of Object.values(BIOMES)) {
      const assetRoot = biome.layout.assetRoot.replace(/^\/+/, '');
      for (const asset of new Set(referencedAssets(biome))) {
        const basePath = join(PUBLIC_DIR, assetRoot, asset);
        if (asset.endsWith('.fbx')) {
          expect(existsSync(basePath), basePath).toBe(true);
          continue;
        }
        expect(existsSync(`${basePath}.obj`), `${basePath}.obj`).toBe(true);
        expect(existsSync(`${basePath}.mtl`), `${basePath}.mtl`).toBe(true);
      }
    }
  });

  it('keeps wave one hazard-free in every biome', () => {
    for (const biome of Object.values(BIOMES)) {
      expect(biome.hazard.startWave).toBeGreaterThanOrEqual(1);
      expect(hazardIntensity(biome.hazard, 1)).toBe(0);
    }
  });

  it('preserves each new biome identity modifier', () => {
    expect(BIOMES.snowfield.drive.stabilityAssistMul).toBeLessThan(1);
    expect(BIOMES.desert.drive.fuelBurnMul).toBeGreaterThan(1);
  });
});
