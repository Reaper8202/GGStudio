import { describe, expect, it } from 'vitest';
import { formatRelativeDate } from '../src/app/TitleScreen.ts';
import {
  leaderboardRows,
  type LeaderboardEntry,
} from '../src/core/leaderboard.ts';

function entry(
  score: number,
  wave: number,
  kills: number,
  at: number,
): LeaderboardEntry {
  return { score, wave, kills, at };
}

describe('leaderboard display rows', () => {
  it('ranks entries before marking the requested display rank', () => {
    const rows = leaderboardRows(
      [entry(500, 2, 20, 300), entry(900, 1, 8, 200), entry(500, 3, 4, 100)],
      2,
    );

    expect(
      rows.map(({ rank, score, wave, kills, isCurrentRun }) => ({
        rank,
        score,
        wave,
        kills,
        isCurrentRun,
      })),
    ).toEqual([
      { rank: 1, score: 900, wave: 1, kills: 8, isCurrentRun: false },
      { rank: 2, score: 500, wave: 3, kills: 4, isCurrentRun: true },
      { rank: 3, score: 500, wave: 2, kills: 20, isCurrentRun: false },
    ]);
  });

  it('does not mark a current run when the highlight is null', () => {
    const rows = leaderboardRows(
      [entry(300, 2, 10, 100), entry(100, 1, 4, 200)],
      null,
    );

    expect(rows.map((row) => row.isCurrentRun)).toEqual([false, false]);
  });
});

describe('relative leaderboard dates', () => {
  const now = Date.UTC(2026, 6, 27, 12);

  it('uses seconds until the first full minute', () => {
    expect(formatRelativeDate(now - 1_000, now)).toBe('1 second ago');
    expect(formatRelativeDate(now - 59_000, now)).toBe('59 seconds ago');
    expect(formatRelativeDate(now - 60_000, now)).toBe('1 minute ago');
  });

  it('moves from minutes to hours at a full hour', () => {
    expect(formatRelativeDate(now - 59 * 60_000, now)).toBe('59 minutes ago');
    expect(formatRelativeDate(now - 60 * 60_000, now)).toBe('1 hour ago');
    expect(formatRelativeDate(now - 23 * 60 * 60_000, now)).toBe(
      '23 hours ago',
    );
  });

  it('moves from hours to days and from days to weeks', () => {
    expect(formatRelativeDate(now - 24 * 60 * 60_000, now)).toBe('1 day ago');
    expect(formatRelativeDate(now - 6 * 24 * 60 * 60_000, now)).toBe(
      '6 days ago',
    );
    expect(formatRelativeDate(now - 7 * 24 * 60 * 60_000, now)).toBe(
      '1 week ago',
    );
    expect(formatRelativeDate(now - 14 * 24 * 60 * 60_000, now)).toBe(
      '2 weeks ago',
    );
  });

  it('treats future timestamps as just completed', () => {
    expect(formatRelativeDate(now + 30_000, now)).toBe('just now');
  });
});
