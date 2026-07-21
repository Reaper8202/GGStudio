import { describe, expect, it } from 'vitest';
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
        id: 'seat',
        defId: 'driver-seat',
        pos: { x: 0, y: 1, z: 0 },
        orient: 0,
        config: {},
      },
    ],
  };
}

function sampleRun(): SavedRun {
  return {
    schemaVersion: 1,
    wave: 7,
    kills: 42,
    moneyEarned: 135,
    blueprint: sampleBlueprint(),
    partHp: { core: 80, frame: 12.5 },
    savedAt: 1_752_000_000_000,
  };
}

describe('saved run codec', () => {
  it('round-trips supported saved-run fields', () => {
    const run = sampleRun();

    expect(decodeSavedRun(encodeSavedRun(run))).toEqual(run);
  });

  it.each([
    ['absent input', null],
    ['unparseable JSON', '{not json'],
    ['missing fields', '{}'],
    [
      'wrong schema version',
      JSON.stringify({ ...sampleRun(), schemaVersion: 2 }),
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

  it('clamps negative kills and run money to zero', () => {
    const json = JSON.stringify({
      ...sampleRun(),
      kills: -3,
      moneyEarned: -25,
    });

    expect(decodeSavedRun(json)).toMatchObject({
      kills: 0,
      moneyEarned: 0,
    });
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
