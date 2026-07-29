import { describe, expect, it } from 'vitest';
import {
  LEADERBOARD_STORAGE_KEY,
  LeaderboardStore,
  type LeaderboardStorage,
} from '../src/app/leaderboardStore.ts';
import {
  encodeLeaderboard,
  type LeaderboardEntry,
} from '../src/core/leaderboard.ts';

class MemoryStorage implements LeaderboardStorage {
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

function entry(
  score: number,
  overrides: Partial<LeaderboardEntry> = {},
): LeaderboardEntry {
  return {
    score,
    wave: 1,
    kills: 0,
    at: 1_750_000_000_000,
    ...overrides,
  };
}

describe('leaderboard store', () => {
  it('loads an empty board when nothing has been persisted', () => {
    const store = new LeaderboardStore(new MemoryStorage());

    expect(store.load()).toEqual([]);
  });

  it('records the first run at rank one as a personal best', () => {
    const storage = new MemoryStorage();
    const store = new LeaderboardStore(storage);
    const finishedRun = entry(1_250);

    const result = store.record(finishedRun);

    expect(result).toEqual({
      entries: [finishedRun],
      rank: 1,
      isPersonalBest: true,
    });
    expect(storage.values.get(LEADERBOARD_STORAGE_KEY)).toBe(
      encodeLeaderboard([finishedRun]),
    );
  });

  it('returns no rank when a worse eleventh entry misses the board', () => {
    const store = new LeaderboardStore(new MemoryStorage());
    for (let score = 1_000; score >= 100; score -= 100) {
      store.record(entry(score, { at: score }));
    }
    const eleventh = entry(1, { at: 1 });

    const result = store.record(eleventh);

    expect(result.rank).toBeNull();
    expect(result.isPersonalBest).toBe(false);
    expect(result.entries).toHaveLength(10);
    expect(result.entries).not.toContain(eleventh);
  });

  it('ranks an exact tie without treating it as a personal best', () => {
    const store = new LeaderboardStore(new MemoryStorage());
    const first = entry(500);
    const tied = entry(500);
    store.record(first);

    const result = store.record(tied);

    expect(result.rank).toBe(2);
    expect(result.isPersonalBest).toBe(false);
    expect(result.entries[0]).toBe(first);
    expect(result.entries[1]).toBe(tied);
  });

  it('keeps the correct cached board when persistence throws', () => {
    const storage: LeaderboardStorage = {
      getItem() {
        return null;
      },
      setItem() {
        throw new Error('write denied');
      },
      removeItem() {
        throw new Error('remove denied');
      },
    };
    const store = new LeaderboardStore(storage);
    const finishedRun = entry(750);

    expect(() => store.record(finishedRun)).not.toThrow();
    expect(store.load()).toEqual([finishedRun]);
  });

  it('clears persisted entries and the in-memory cache', () => {
    const storage = new MemoryStorage();
    const persisted = entry(900);
    storage.values.set(LEADERBOARD_STORAGE_KEY, encodeLeaderboard([persisted]));
    const store = new LeaderboardStore(storage);
    expect(store.load()).toEqual([persisted]);

    store.clear();

    expect(store.load()).toEqual([]);
    expect(storage.values.has(LEADERBOARD_STORAGE_KEY)).toBe(false);
  });

  it('loads malformed persisted JSON as an empty board', () => {
    const storage = new MemoryStorage();
    storage.values.set(LEADERBOARD_STORAGE_KEY, '{not json');
    const store = new LeaderboardStore(storage);

    expect(() => store.load()).not.toThrow();
    expect(store.load()).toEqual([]);
  });
});
