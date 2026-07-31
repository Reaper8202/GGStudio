import { afterEach, describe, expect, it } from 'vitest';
import {
  clearFeelLog,
  feelEntries,
  formatFeelReport,
  recordFeel,
} from '../src/survival/devtuning/feelLog.ts';
import type { FeelEntry } from '../src/survival/devtuning/feelLog.ts';

function entry(overrides: Partial<FeelEntry> = {}): FeelEntry {
  return {
    wave: 8,
    rating: 'hard',
    seconds: 92,
    integrityPct: 14,
    kills: 41,
    ...overrides,
  };
}

afterEach(() => {
  clearFeelLog();
});

describe('collecting ratings', () => {
  it('keeps what was rated', () => {
    recordFeel(entry());
    expect(feelEntries()).toHaveLength(1);
    expect(feelEntries()[0]).toMatchObject({ wave: 8, rating: 'hard' });
  });

  it('replaces an earlier verdict on the same wave', () => {
    // A wave gets replayed repeatedly while a tuning is dialled in; only the
    // current verdict is worth reporting.
    recordFeel(entry({ rating: 'hard' }));
    recordFeel(entry({ rating: 'right' }));
    expect(feelEntries()).toHaveLength(1);
    expect(feelEntries()[0].rating).toBe('right');
  });

  it('keeps different waves apart, in wave order', () => {
    recordFeel(entry({ wave: 12 }));
    recordFeel(entry({ wave: 3 }));
    recordFeel(entry({ wave: 7 }));
    expect(feelEntries().map((e) => e.wave)).toEqual([3, 7, 12]);
  });
});

describe('the report', () => {
  it('says so when nothing was rated', () => {
    expect(formatFeelReport([])).toContain('nothing rated');
  });

  it('counts each verdict in the header', () => {
    const report = formatFeelReport([
      entry({ wave: 1, rating: 'easy' }),
      entry({ wave: 2, rating: 'easy' }),
      entry({ wave: 3, rating: 'hard' }),
    ]);
    expect(report).toContain('3 waves rated');
    expect(report).toContain('2 too easy');
    expect(report).toContain('0 about right');
    expect(report).toContain('1 too hard');
  });

  it('puts the numbers that produced the verdict next to it', () => {
    const report = formatFeelReport([entry()]);
    expect(report).toContain('too hard');
    expect(report).toContain('92s');
    expect(report).toContain('14%');
    expect(report).toContain('41');
  });

  it('carries a note through', () => {
    const report = formatFeelReport([
      entry({ note: 'throwers out of reach behind the wall' }),
    ]);
    expect(report).toContain('throwers out of reach behind the wall');
  });

  it('lines the columns up so the shape of a run is readable', () => {
    const lines = formatFeelReport([
      entry({ wave: 3, seconds: 40, integrityPct: 90, kills: 20 }),
      entry({ wave: 14, seconds: 130, integrityPct: 7, kills: 108 }),
    ]).split('\n');
    // Header, column titles, then one line per wave, all the same width up to
    // the free-text note.
    expect(lines).toHaveLength(4);
    expect(lines[2].indexOf('s')).toBe(lines[3].indexOf('s'));
  });

  it('uses the singular for a single wave', () => {
    expect(formatFeelReport([entry()])).toContain('1 wave rated');
  });

  it('leaves no trailing whitespace on a row without a note', () => {
    const rows = formatFeelReport([entry({ note: undefined })]).split('\n');
    expect(rows[2]).toBe(rows[2].trimEnd());
  });
});
