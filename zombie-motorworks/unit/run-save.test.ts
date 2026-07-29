import { describe, expect, it, vi } from 'vitest';
import {
  RUN_SAVE_STORAGE_KEY,
  RunSaveStore,
  type RunSaveStorage,
} from '../src/app/runSaveStore.ts';
import {
  decodeSavedRun,
  encodeSavedRun,
  type SavedRun,
} from '../src/core/runSave.ts';
import { BLUEPRINT_SCHEMA_VERSION } from '../src/core/types.ts';
import type { VehicleBlueprint } from '../src/core/types.ts';

class MemoryStorage implements RunSaveStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function sampleBlueprint(): VehicleBlueprint {
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    id: 'saved-rig',
    name: 'Saved Rig',
    parts: [
      {
        id: 'core',
        defId: 'chassis-core',
        pos: { x: 0, y: 0, z: 0 },
        orient: 0,
        config: {},
      },
      {
        id: 'frame',
        defId: 'frame-box',
        pos: { x: 1, y: 0, z: 0 },
        orient: 0,
        config: {},
      },
      {
        id: 'roof',
        defId: 'frame-box',
        pos: { x: 0, y: 1, z: 0 },
        orient: 0,
        config: {},
      },
    ],
  };
}

function sampleRun(): SavedRun {
  return {
    schemaVersion: 5,
    phase: 'wave',
    activeWave: 7,
    score: 12_450,
    wave: 7,
    kills: 42,
    biomeId: 'snowfield',
    seed: 2_718_281,
    bankedEarnings: 135,
    elapsedSeconds: 372,
    blueprint: sampleBlueprint(),
    partHp: { core: 80, frame: 12.5 },
    savedAt: 1_752_000_000_000,
  };
}

describe('saved run codec', () => {
  it('round-trips schema-5 checkpoint fields', () => {
    const run = sampleRun();

    expect(decodeSavedRun(encodeSavedRun(run))).toEqual(run);
  });

  it.each([
    ['absent input', null],
    ['unparseable JSON', '{not json'],
    ['missing fields', '{}'],
    [
      'wrong schema version',
      JSON.stringify({ ...sampleRun(), schemaVersion: 6 }),
    ],
    ['wave zero', JSON.stringify({ ...sampleRun(), wave: 0 })],
    ['fractional wave', JSON.stringify({ ...sampleRun(), wave: 2.5 })],
    ['invalid blueprint', JSON.stringify({ ...sampleRun(), blueprint: {} })],
  ])('returns null for %s', (_case, json) => {
    expect(decodeSavedRun(json)).toBeNull();
  });

  it('drops HP for unknown parts and invalid values', () => {
    const json = JSON.stringify({
      ...sampleRun(),
      partHp: {
        core: 50,
        frame: Number.NaN,
        seat: -1,
        missing: 25,
      },
    });

    expect(decodeSavedRun(json)?.partHp).toEqual({ core: 50 });
  });

  it('migrates schema-1 moneyEarned into schema 4 with score zero', () => {
    const current = sampleRun();
    const legacy = {
      ...current,
      schemaVersion: 1,
      moneyEarned: current.bankedEarnings,
    };
    delete (legacy as Partial<typeof legacy>).bankedEarnings;
    delete (legacy as Partial<typeof legacy>).biomeId;
    delete (legacy as Partial<typeof legacy>).seed;

    const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      expect(decodeSavedRun(JSON.stringify(legacy))).toEqual({
        ...current,
        score: 0,
        biomeId: 'graveyard',
        seed: 1_073_741_824,
        phase: 'wave',
        activeWave: current.wave,
      });
    } finally {
      random.mockRestore();
    }
  });

  it('migrates schema 2 into schema 4 with score zero', () => {
    const current = sampleRun();
    const legacy = {
      ...current,
      schemaVersion: 2,
    };
    delete (legacy as Partial<typeof legacy>).score;
    delete (legacy as Partial<typeof legacy>).biomeId;
    delete (legacy as Partial<typeof legacy>).seed;

    const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      expect(decodeSavedRun(JSON.stringify(legacy))).toEqual({
        ...current,
        score: 0,
        biomeId: 'graveyard',
        seed: 1_073_741_824,
        phase: 'wave',
        activeWave: current.wave,
      });
    } finally {
      random.mockRestore();
    }
  });

  it('preserves a valid schema-3 score', () => {
    expect(decodeSavedRun(JSON.stringify(sampleRun()))?.score).toBe(12_450);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    'normalizes an invalid score of %s to zero',
    (score) => {
      expect(
        decodeSavedRun(JSON.stringify({ ...sampleRun(), score }))?.score,
      ).toBe(0);
    },
  );

  it('always returns the current schema version', () => {
    expect(decodeSavedRun(JSON.stringify(sampleRun()))?.schemaVersion).toBe(5);
  });

  it('clamps negative kills and banked earnings to zero', () => {
    const json = JSON.stringify({
      ...sampleRun(),
      kills: -3,
      bankedEarnings: -25,
    });

    expect(decodeSavedRun(json)).toMatchObject({
      kills: 0,
      bankedEarnings: 0,
    });
  });
});

describe('resume location', () => {
  // `wave` is the wave the player resumes into; `activeWave` is the wave the
  // run HUD was showing. They differ in the Garage, where the checkpoint has
  // already advanced to the wave being prepared for.
  function buildPhaseRun(): SavedRun {
    return { ...sampleRun(), phase: 'build', wave: 8, activeWave: 7 };
  }

  it('keeps a Garage save distinguishable from an arena save', () => {
    const decoded = decodeSavedRun(encodeSavedRun(buildPhaseRun()));

    expect(decoded?.phase).toBe('build');
    expect(decoded?.wave).toBe(8);
    expect(decoded?.activeWave).toBe(7);
  });

  it('resumes a schema-4 save into the arena on its own wave', () => {
    const legacy = { ...sampleRun(), schemaVersion: 4, wave: 6 };
    delete (legacy as Partial<typeof legacy>).phase;
    delete (legacy as Partial<typeof legacy>).activeWave;

    const decoded = decodeSavedRun(JSON.stringify(legacy));

    expect(decoded?.phase).toBe('wave');
    expect(decoded?.activeWave).toBe(6);
  });

  it.each([
    ['an unknown phase', 'garage'],
    ['a missing phase', undefined],
    ['a non-string phase', 3],
  ])('falls back to the arena for %s', (_case, phase) => {
    const json = JSON.stringify({ ...buildPhaseRun(), phase });

    expect(decodeSavedRun(json)?.phase).toBe('wave');
  });

  it.each([0, -3, 2.5, '4', Number.NaN, null])(
    'falls back to the resume wave for an invalid activeWave of %s',
    (activeWave) => {
      const json = JSON.stringify({ ...buildPhaseRun(), activeWave });

      // buildPhaseRun resumes into wave 8, so a rejected activeWave shows up
      // as 8 rather than the 7 it was written with.
      expect(decodeSavedRun(json)?.activeWave).toBe(8);
    },
  );

  it('rejects a schema-5 save whose blueprint is unusable', () => {
    const json = JSON.stringify({ ...buildPhaseRun(), blueprint: {} });

    expect(decodeSavedRun(json)).toBeNull();
  });
});

describe('run save store', () => {
  it('saves and loads through the codec, then clears the save', () => {
    const storage = new MemoryStorage();
    const store = new RunSaveStore(storage);
    const run = sampleRun();

    store.save(run);

    expect(store.load()).toEqual(run);
    expect(store.has()).toBe(true);

    store.clear();

    expect(store.load()).toBeNull();
    expect(store.has()).toBe(false);
    expect(storage.values.has(RUN_SAVE_STORAGE_KEY)).toBe(false);
  });

  it('returns null without throwing for corrupt storage', () => {
    const storage = new MemoryStorage();
    storage.values.set(RUN_SAVE_STORAGE_KEY, '{not json');
    const store = new RunSaveStore(storage);

    expect(() => store.load()).not.toThrow();
    expect(store.load()).toBeNull();
    expect(store.has()).toBe(false);
  });
});
