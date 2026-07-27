import { describe, expect, it } from 'vitest';
import {
  BADGES,
  BADGE_TIER_BONUS_PCT,
  badgeAwards,
  badgeBonus,
  badgeBonusTotal,
  evaluateWaveBadges,
  getBadge,
  type BadgeDefinition,
  type WaveResultStats,
} from '../src/core/badges.ts';

function stats(overrides: Partial<WaveResultStats> = {}): WaveResultStats {
  return {
    wave: 1,
    killsThisWave: 1,
    elapsedSeconds: 60,
    moneyEarned: 100,
    integrityPct: 50,
    startIntegrityPct: 100,
    partsLost: 1,
    damagedParts: 1,
    bestSecondsForWave: null,
    cleanWaveStreak: 0,
    ...overrides,
  };
}

function earnedIds(value: WaveResultStats): string[] {
  return evaluateWaveBadges(value).map((badge) => badge.id);
}

describe('wave badge rules', () => {
  it.each([
    ['fastest-clear', { elapsedSeconds: 40, bestSecondsForWave: 41 }],
    [
      'untouched',
      {
        integrityPct: 100,
        startIntegrityPct: 100,
        partsLost: 0,
        damagedParts: 0,
      },
    ],
    ['speed-demon', { elapsedSeconds: 45 }],
    ['big-payday', { moneyEarned: 500 }],
    ['all-parts-intact', { partsLost: 0 }],
    ['overkill', { killsThisWave: 30 }],
    ['close-call', { integrityPct: 15 }],
    ['deep-run', { wave: 10 }],
    ['on-a-roll', { cleanWaveStreak: 3 }],
    ['iron-streak', { cleanWaveStreak: 7 }],
  ] satisfies readonly [string, Partial<WaveResultStats>][])(
    'awards %s at its threshold',
    (id, overrides) => {
      expect(earnedIds(stats(overrides))).toContain(id);
    },
  );

  it('awards nothing for a slow, damaged first clear with low rewards', () => {
    expect(earnedIds(stats())).toEqual([]);
  });

  it('does not treat a first clear as a fastest clear', () => {
    expect(
      earnedIds(
        stats({
          elapsedSeconds: 30,
          bestSecondsForWave: null,
        }),
      ),
    ).not.toContain('fastest-clear');
  });

  it('does not award untouched when a part was damaged', () => {
    expect(
      earnedIds(
        stats({
          integrityPct: 100,
          startIntegrityPct: 100,
          partsLost: 0,
          damagedParts: 1,
        }),
      ),
    ).not.toContain('untouched');
  });

  it('allows overlapping intact and clean-streak badges', () => {
    const ids = earnedIds(
      stats({
        integrityPct: 100,
        startIntegrityPct: 100,
        partsLost: 0,
        damagedParts: 0,
        cleanWaveStreak: 7,
      }),
    );

    expect(ids).toEqual([
      'untouched',
      'iron-streak',
      'on-a-roll',
      'all-parts-intact',
    ]);
  });

  it('returns every earned badge in the stable BADGES order', () => {
    const allBadges = earnedIds(
      stats({
        wave: 10,
        killsThisWave: 30,
        elapsedSeconds: 30,
        moneyEarned: 500,
        integrityPct: 10,
        startIntegrityPct: 10,
        partsLost: 0,
        damagedParts: 0,
        bestSecondsForWave: 31,
        cleanWaveStreak: 7,
      }),
    );

    expect(allBadges).toEqual(BADGES.map((badge) => badge.id));
  });

  it('awards nothing for non-finite numeric inputs', () => {
    const nonFinite = Number.NaN;
    const value = stats({
      wave: nonFinite,
      killsThisWave: nonFinite,
      elapsedSeconds: nonFinite,
      moneyEarned: nonFinite,
      integrityPct: nonFinite,
      startIntegrityPct: nonFinite,
      partsLost: nonFinite,
      damagedParts: nonFinite,
      bestSecondsForWave: Number.POSITIVE_INFINITY,
      cleanWaveStreak: Number.NEGATIVE_INFINITY,
    });

    expect(() => evaluateWaveBadges(value)).not.toThrow();
    expect(earnedIds(value)).toEqual([]);
  });
});

describe('badge definitions', () => {
  it('defines the ten requested badges once', () => {
    const ids = BADGES.map((badge) => badge.id);

    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    expect(ids).toEqual([
      'untouched',
      'iron-streak',
      'fastest-clear',
      'close-call',
      'deep-run',
      'on-a-roll',
      'speed-demon',
      'big-payday',
      'all-parts-intact',
      'overkill',
    ]);
  });

  it('looks up known badge ids and returns undefined for unknown ids', () => {
    expect(getBadge('fastest-clear')).toEqual(
      expect.objectContaining({ name: 'FASTEST CLEAR', icon: '⚡' }),
    );
    expect(getBadge('unknown')).toBeUndefined();
  });
});

describe('badge payouts', () => {
  function badge(id: string): BadgeDefinition {
    const found = getBadge(id);
    if (found === undefined) throw new Error(`missing badge ${id}`);
    return found;
  }

  it('pays each tier its share of the wave payout', () => {
    expect(badgeBonus(badge('overkill'), 400)).toBe(40);
    expect(badgeBonus(badge('deep-run'), 400)).toBe(100);
    expect(badgeBonus(badge('untouched'), 400)).toBe(132);
  });

  it('rises with the payout it is cut from', () => {
    expect(BADGE_TIER_BONUS_PCT.common).toBeLessThan(BADGE_TIER_BONUS_PCT.rare);
    expect(BADGE_TIER_BONUS_PCT.rare).toBeLessThan(BADGE_TIER_BONUS_PCT.epic);
    expect(badgeBonus(badge('untouched'), 1000)).toBeGreaterThan(
      badgeBonus(badge('untouched'), 400),
    );
  });

  it('pays whole dollars, and nothing on a payout it cannot cut', () => {
    for (const payout of [Number.NaN, Number.POSITIVE_INFINITY, 0, -500, 2]) {
      for (const definition of BADGES) {
        const bonus = badgeBonus(definition, payout);
        expect(Number.isSafeInteger(bonus)).toBe(true);
        expect(bonus).toBeGreaterThanOrEqual(0);
      }
    }
    expect(badgeBonus(badge('overkill'), 0)).toBe(0);
    expect(badgeBonus(badge('overkill'), Number.NaN)).toBe(0);
  });

  it('totals the awards it pairs with the earned badges', () => {
    const earned = [badge('overkill'), badge('deep-run')];
    const awards = badgeAwards(earned, 300);

    expect(awards.map((award) => award.badge.id)).toEqual([
      'overkill',
      'deep-run',
    ]);
    expect(badgeBonusTotal(awards)).toBe(awards[0].bonus + awards[1].bonus);
    expect(badgeBonusTotal([])).toBe(0);
  });
});
