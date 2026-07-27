import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BADGE_STORAGE_KEY,
  BadgeStore,
  WAVE_TIMES_STORAGE_KEY,
  badgeProgress,
  type BadgeStorage,
} from '../src/app/badgeStore.ts';
import { playSfx, isSfxMuted } from '../src/app/sfx.ts';
import { BADGES } from '../src/core/badges.ts';

class MemoryStorage implements BadgeStorage {
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

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('badge store', () => {
  it('loads an empty collection when nothing has been persisted', () => {
    const store = new BadgeStore();

    expect(store.load()).toEqual({});
  });

  it('records new badges and preserves the first-earned time on a re-earn', () => {
    const store = new BadgeStore();
    const first = BADGES[0].id;
    const second = BADGES[1].id;

    const initial = store.record([first, second], 1_000);
    const repeated = store.record([first], 2_000);

    expect(initial.newlyEarned).toEqual([first, second]);
    expect(repeated.newlyEarned).toEqual([]);
    expect(repeated.collection[first]).toEqual({
      id: first,
      firstEarnedAt: 1_000,
      count: 2,
    });
  });

  it('records a duplicate id only once per call', () => {
    const store = new BadgeStore();
    const id = BADGES[0].id;

    const result = store.record([id, id], 1_000);

    expect(result.newlyEarned).toEqual([id]);
    expect(result.collection[id]?.count).toBe(1);
  });

  it('loads malformed persisted JSON as an empty collection', () => {
    storage.values.set(BADGE_STORAGE_KEY, '{not json');
    const store = new BadgeStore();

    expect(() => store.load()).not.toThrow();
    expect(store.load()).toEqual({});
  });

  it.each([
    ['an array', '[]'],
    ['a bare string', '"badges"'],
  ])('loads %s as an empty collection', (_label, json) => {
    storage.values.set(BADGE_STORAGE_KEY, json);
    const store = new BadgeStore();

    expect(() => store.load()).not.toThrow();
    expect(store.load()).toEqual({});
  });

  it('drops garbage entries while salvaging valid records', () => {
    const id = BADGES[0].id;
    storage.values.set(
      BADGE_STORAGE_KEY,
      JSON.stringify({
        valid: { id, firstEarnedAt: 1_000, count: 2 },
        nullRecord: null,
        badId: { id: 42, firstEarnedAt: 1_000, count: 1 },
        badTime: { id, firstEarnedAt: Number.NaN, count: 1 },
        badCount: { id, firstEarnedAt: 1_000, count: 0 },
      }),
    );
    const store = new BadgeStore();

    expect(() => store.load()).not.toThrow();
    expect(store.load()).toEqual({
      [id]: { id, firstEarnedAt: 1_000, count: 2 },
    });
  });

  it('drops unknown badge ids on load', () => {
    storage.values.set(
      BADGE_STORAGE_KEY,
      JSON.stringify({
        retired: {
          id: 'retired-badge',
          firstEarnedAt: 1_000,
          count: 1,
        },
      }),
    );
    const store = new BadgeStore();

    expect(store.load()).toEqual({});
  });

  it('keeps the in-memory collection when persistence throws', () => {
    const throwingStorage: BadgeStorage = {
      getItem() {
        return null;
      },
      setItem() {
        throw new Error('quota exceeded');
      },
      removeItem() {},
    };
    const store = new BadgeStore(throwingStorage);
    const id = BADGES[0].id;

    expect(() => store.record([id], 1_000)).not.toThrow();
    expect(store.load()[id]?.count).toBe(1);
  });

  it('keeps only the best valid time for each wave', () => {
    const store = new BadgeStore();

    expect(store.bestTimeForWave(1)).toBeNull();
    store.recordWaveTime(1, 24);
    store.recordWaveTime(1, 30);
    store.recordWaveTime(1, 18);
    store.recordWaveTime(0, 10);
    store.recordWaveTime(Number.NaN, 10);
    store.recordWaveTime(2, 0);
    store.recordWaveTime(2, Number.POSITIVE_INFINITY);

    expect(store.bestTimeForWave(1)).toBe(18);
    expect(store.bestTimeForWave(2)).toBeNull();
    expect(
      JSON.parse(storage.values.get(WAVE_TIMES_STORAGE_KEY) ?? '{}'),
    ).toEqual({ 1: 18 });
  });

  it('reports earned badge progress against the catalog size', () => {
    const store = new BadgeStore();
    const id = BADGES[0].id;

    expect(badgeProgress(store.record([id], 1_000).collection)).toEqual({
      earned: 1,
      total: BADGES.length,
    });
  });
});

describe('sfx', () => {
  it('is safe without a DOM or AudioContext', () => {
    expect(() => playSfx('coinTick')).not.toThrow();
    expect(() => isSfxMuted()).not.toThrow();
  });
});
