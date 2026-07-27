import { describe, expect, it, vi } from 'vitest';
import {
  createClearedWaveCheckpoint,
  createInitialRunCheckpoint,
  savedRunFromCheckpoint,
} from '../src/app/App.ts';
import { createEmptyBlueprint } from '../src/core/blueprint.ts';
import {
  BIOME_IDS,
  biomeHandlingSummary,
  isBiomeId,
  NEUTRAL_ENVIRONMENT,
  type BiomeId,
} from '../src/core/biomes.ts';
import {
  decodeProfile,
  defaultProfile,
  encodeProfile,
} from '../src/core/profile.ts';
import { decodeSavedRun, encodeSavedRun } from '../src/core/runSave.ts';
import {
  BIOMES,
  DEFAULT_BIOME_ID,
} from '../src/survival/arena/recipes/index.ts';

describe('biome selection', () => {
  it('carries each biome and its seed unchanged across several waves', () => {
    for (const biomeId of Object.keys(BIOMES) as BiomeId[]) {
      let checkpoint = createInitialRunCheckpoint(
        createEmptyBlueprint(`biome-${biomeId}`),
        biomeId,
      );
      const seed = checkpoint.seed;

      for (let nextWave = 2; nextWave <= 6; nextWave += 1) {
        checkpoint = createClearedWaveCheckpoint({
          blueprint: checkpoint.blueprint,
          nextWave,
          survivingPartIds: checkpoint.blueprint.parts.map((part) => part.id),
          partHp: checkpoint.partHp,
          kills: nextWave * 3,
          biomeId: checkpoint.biomeId,
          seed: checkpoint.seed,
          score: nextWave * 100,
          bankedEarnings: nextWave * 10,
          elapsedSeconds: nextWave * 30,
        });

        expect(checkpoint.biomeId).toBe(biomeId);
        expect(checkpoint.seed).toBe(seed);
      }
    }
  });

  it('generates exactly one seed when a new checkpoint is created', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const checkpoint = createInitialRunCheckpoint(
        createEmptyBlueprint('single-seed'),
        'snowfield',
      );

      expect(random).toHaveBeenCalledOnce();
      expect(checkpoint.seed).toBe(2_147_483_648);
    } finally {
      random.mockRestore();
    }
  });

  it('preserves biome and seed through save encoding and decoding', () => {
    const checkpoint = createInitialRunCheckpoint(
      createEmptyBlueprint('save-biome'),
      'desert',
    );
    const saved = savedRunFromCheckpoint(checkpoint, 1_800_000_000_000);

    expect(decodeSavedRun(encodeSavedRun(saved))).toMatchObject({
      biomeId: checkpoint.biomeId,
      seed: checkpoint.seed,
    });
  });

  it('migrates a schema-3 payload to the default biome and a finite seed', () => {
    const checkpoint = createInitialRunCheckpoint(
      createEmptyBlueprint('legacy-biome'),
      'desert',
    );
    const payload: Record<string, unknown> = {
      ...savedRunFromCheckpoint(checkpoint, 1_800_000_000_000),
      schemaVersion: 3,
    };
    delete payload.biomeId;
    delete payload.seed;

    const decoded = decodeSavedRun(JSON.stringify(payload));

    expect(decoded?.biomeId).toBe(DEFAULT_BIOME_ID);
    expect(Number.isFinite(decoded?.seed)).toBe(true);
  });

  it('normalizes an unknown biome instead of throwing', () => {
    const checkpoint = createInitialRunCheckpoint(
      createEmptyBlueprint('bogus-biome'),
      'snowfield',
    );
    const saved = savedRunFromCheckpoint(checkpoint, 1_800_000_000_000);

    expect(() =>
      decodeSavedRun(JSON.stringify({ ...saved, biomeId: 'bogus' })),
    ).not.toThrow();
    expect(
      decodeSavedRun(JSON.stringify({ ...saved, biomeId: 'bogus' }))?.biomeId,
    ).toBe(DEFAULT_BIOME_ID);
  });

  it.each([
    ['NaN', Number.NaN],
    ['missing', undefined],
    ['string', '1234'],
  ])('normalizes a %s seed to a finite number', (_case, seed) => {
    const checkpoint = createInitialRunCheckpoint(
      createEmptyBlueprint(`invalid-seed-${_case}`),
      'graveyard',
    );
    const saved = savedRunFromCheckpoint(checkpoint, 1_800_000_000_000);

    const decoded = decodeSavedRun(JSON.stringify({ ...saved, seed }));

    expect(Number.isFinite(decoded?.seed)).toBe(true);
  });
});

describe('title-screen map preference', () => {
  it('keeps the picked map across a profile save and load', () => {
    const profile = {
      ...defaultProfile(),
      preferredBiomeId: 'desert' as const,
    };

    expect(decodeProfile(encodeProfile(profile)).preferredBiomeId).toBe(
      'desert',
    );
  });

  it('drops a corrupt map instead of carrying it into a run', () => {
    const stored = JSON.stringify({
      ...JSON.parse(encodeProfile(defaultProfile())),
      preferredBiomeId: 'atlantis',
    });

    expect(decodeProfile(stored).preferredBiomeId).toBeUndefined();
  });

  it('leaves a profile that never picked a map without one', () => {
    expect(
      decodeProfile(encodeProfile(defaultProfile())).preferredBiomeId,
    ).toBeUndefined();
  });

  it('offers exactly the biomes the recipes define', () => {
    expect([...BIOME_IDS].sort()).toEqual(Object.keys(BIOMES).sort());
    expect(BIOME_IDS.every(isBiomeId)).toBe(true);
    expect(isBiomeId('atlantis')).toBe(false);
  });
});

describe('map card handling copy', () => {
  it('calls an unmodified biome standard rather than listing nothing', () => {
    expect(biomeHandlingSummary({ drive: NEUTRAL_ENVIRONMENT })).toBe(
      'Standard handling',
    );
  });

  it('names every multiplier a biome changes, and no others', () => {
    const summary = biomeHandlingSummary(BIOMES.snowfield);

    expect(summary).toContain('55% less stability assist');
    expect(summary).toContain('5% lower top speed');
    expect(summary).not.toContain('fuel burn');
  });

  it('describes each shipped biome without leaving a card blank', () => {
    for (const id of BIOME_IDS) {
      expect(biomeHandlingSummary(BIOMES[id]).length).toBeGreaterThan(0);
    }
  });
});
