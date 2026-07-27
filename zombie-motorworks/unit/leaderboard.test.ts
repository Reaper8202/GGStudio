import { describe, expect, it } from 'vitest';
import {
  LEADERBOARD_MAX_ENTRIES,
  decodeLeaderboard,
  encodeLeaderboard,
  insertEntry,
  isPersonalBest,
  personalBest,
  type LeaderboardEntry,
} from '../src/core/leaderboard.ts';

function entry(
  score: number,
  wave = 1,
  kills = 0,
  at = 1_000,
): LeaderboardEntry {
  return { score, wave, kills, at };
}

describe('leaderboard ranking', () => {
  it('ranks by score, wave, kills, then earlier completion time', () => {
    const newer = entry(100, 5, 10, 200);
    const entries = [
      newer,
      entry(100, 5, 11, 300),
      entry(100, 6, 1, 400),
      entry(110, 1, 1, 500),
      entry(100, 5, 10, 100),
    ];

    expect(insertEntry(entries, entry(90))).toEqual([
      entry(110, 1, 1, 500),
      entry(100, 6, 1, 400),
      entry(100, 5, 11, 300),
      entry(100, 5, 10, 100),
      newer,
      entry(90),
    ]);
    expect(entries[0]).toBe(newer);
  });

  it('drops an eleventh worse entry', () => {
    const entries = Array.from(
      { length: LEADERBOARD_MAX_ENTRIES },
      (_, index) => entry(100 - index),
    );

    expect(insertEntry(entries, entry(1))).toEqual(entries);
  });

  it('lets an eleventh better entry evict the worst', () => {
    const entries = Array.from(
      { length: LEADERBOARD_MAX_ENTRIES },
      (_, index) => entry(100 - index),
    );

    expect(insertEntry(entries, entry(101))).toEqual([
      entry(101),
      ...entries.slice(0, -1),
    ]);
  });

  it('returns the highest-ranked personal best without mutating input', () => {
    const entries = [entry(100, 2), entry(100, 3), entry(90, 10)];

    expect(personalBest(entries)).toEqual(entry(100, 3));
    expect(entries).toEqual([entry(100, 2), entry(100, 3), entry(90, 10)]);
    expect(personalBest([])).toBeNull();
  });

  it('requires a positive score that strictly beats the board', () => {
    expect(isPersonalBest([], 1)).toBe(true);
    expect(isPersonalBest([], 0)).toBe(false);
    expect(isPersonalBest([entry(100)], 100)).toBe(false);
    expect(isPersonalBest([entry(100), entry(90)], 101)).toBe(true);
  });
});

describe('leaderboard codec', () => {
  it('returns an empty board for absent, corrupt, or non-array input', () => {
    expect(decodeLeaderboard(null)).toEqual([]);
    expect(decodeLeaderboard(undefined)).toEqual([]);
    expect(decodeLeaderboard('{not json')).toEqual([]);
    expect(decodeLeaderboard('{"score": 100}')).toEqual([]);
  });

  it('drops malformed entries, including negative and fractional scores', () => {
    const valid = entry(120, 4, 20, 500);
    const json = JSON.stringify([
      valid,
      { ...valid, score: -1 },
      { ...valid, score: 1.5 },
      { ...valid, wave: -1 },
      { ...valid, kills: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, at: '500' },
      null,
    ]);

    expect(decodeLeaderboard(json)).toEqual([valid]);
  });

  it('re-sorts decoded entries and truncates them to the maximum', () => {
    const entries = Array.from(
      { length: LEADERBOARD_MAX_ENTRIES + 1 },
      (_, index) => entry(index + 1),
    );

    expect(decodeLeaderboard(JSON.stringify(entries))).toEqual(
      [...entries].reverse().slice(0, LEADERBOARD_MAX_ENTRIES),
    );
  });

  it('round-trips supported fields without serializing extras', () => {
    const entries = [
      { ...entry(250, 8, 40, 100), ignored: true },
      entry(100, 3, 12, 200),
    ];
    const encoded = encodeLeaderboard(entries);

    expect(JSON.parse(encoded)[0]).not.toHaveProperty('ignored');
    expect(decodeLeaderboard(encoded)).toEqual([
      entry(250, 8, 40, 100),
      entry(100, 3, 12, 200),
    ]);
  });
});
