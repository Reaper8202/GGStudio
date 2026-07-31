import { describe, expect, it } from 'vitest';
import {
  kindShare,
  payPerThreat,
  spawnBoundSeconds,
  spawnOverflow,
  threatScaledPayout,
  waveKillReward,
  wavePopulation,
  waveThreat,
} from '../src/core/waveModel.ts';
import type { KindProfiles } from '../src/core/waveModel.ts';

const PROFILES: KindProfiles = {
  walker: { healthMultiplier: 1, reward: 3 },
  thrower: { healthMultiplier: 1.6, reward: 8 },
  worker: { healthMultiplier: 1.3, reward: 12 },
};

describe('wave population', () => {
  it('sums every kind', () => {
    expect(wavePopulation({ walker: 13, thrower: 2, worker: 1 })).toBe(16);
  });

  it('ignores absent kinds and junk counts', () => {
    expect(
      wavePopulation({ walker: 5, thrower: 0, worker: -3, ghost: NaN }),
    ).toBe(5);
  });
});

describe('wave threat', () => {
  it('weighs each kind by its own toughness and the wave multiplier', () => {
    // 10 walkers at 40hp plus 2 throwers at 40 * 1.6, all doubled by the wave.
    expect(waveThreat({ walker: 10, thrower: 2 }, PROFILES, 40, 2)).toBe(
      10 * 40 * 2 + 2 * 40 * 1.6 * 2,
    );
  });

  it('separates count from difficulty', () => {
    // Half as many throwers is not half the wave: they are tougher each.
    const many = waveThreat({ walker: 20 }, PROFILES, 40, 1);
    const few = waveThreat({ thrower: 10 }, PROFILES, 40, 1);
    expect(many).toBe(800);
    expect(few).toBe(640);
  });

  it('skips kinds it has no profile for rather than counting them as free', () => {
    expect(waveThreat({ walker: 1, mystery: 99 }, PROFILES, 40, 1)).toBe(40);
  });

  it('returns zero for non-finite inputs', () => {
    expect(waveThreat({ walker: 5 }, PROFILES, NaN, 1)).toBe(0);
    expect(waveThreat({ walker: 5 }, PROFILES, 40, Infinity)).toBe(0);
  });
});

describe('wave kill reward', () => {
  it('pays per kind, not per head', () => {
    expect(
      waveKillReward({ walker: 10, thrower: 2, worker: 1 }, PROFILES),
    ).toBe(10 * 3 + 2 * 8 + 12);
  });
});

describe('pay per threat', () => {
  it('is the ratio of payout to work', () => {
    expect(payPerThreat(89, 520)).toBeCloseTo(0.1712, 4);
  });

  it('falls when threat outgrows payout', () => {
    const early = payPerThreat(89, 520);
    const late = payPerThreat(612, 8089);
    expect(late).toBeLessThan(early / 2);
  });

  it('guards division by zero', () => {
    expect(payPerThreat(100, 0)).toBe(0);
    expect(payPerThreat(100, -5)).toBe(0);
  });
});

describe('spawn overflow', () => {
  it('is zero while the wave fits on screen', () => {
    expect(spawnOverflow(42, 42)).toBe(0);
    expect(spawnOverflow(20, 42)).toBe(0);
  });

  it('counts only the surplus that has to queue', () => {
    expect(spawnOverflow(87, 48)).toBe(39);
  });
});

describe('spawn-bound wave length', () => {
  it('is zero when the whole wave fits in one horde', () => {
    expect(spawnBoundSeconds(8, 11, 1.45)).toBe(0);
  });

  it('charges one interval per horde after the first', () => {
    // 30 zombies in hordes of 11 is three hordes: two waits.
    expect(spawnBoundSeconds(30, 11, 1.45)).toBeCloseTo(2.9, 5);
  });

  it('grows with population, which is how overflow becomes duration', () => {
    const short = spawnBoundSeconds(47, 11, 1.25);
    const long = spawnBoundSeconds(87, 11, 1.05);
    expect(long).toBeGreaterThan(short);
  });

  it('returns zero rather than dividing by a zero horde', () => {
    expect(spawnBoundSeconds(30, 0, 1.45)).toBe(0);
    expect(spawnBoundSeconds(30, 11, 0)).toBe(0);
  });
});

describe('kind share', () => {
  it('reports the fraction made up of the named kinds', () => {
    expect(
      kindShare({ walker: 70, thrower: 9, worker: 5 }, ['walker']),
    ).toBeCloseTo(70 / 84, 5);
  });

  it('shows a flat specialist share across two waves that differ only in size', () => {
    const early = kindShare({ walker: 40, thrower: 4, worker: 2 }, [
      'thrower',
      'worker',
    ]);
    const late = kindShare({ walker: 80, thrower: 8, worker: 4 }, [
      'thrower',
      'worker',
    ]);
    expect(late).toBeCloseTo(early, 5);
  });

  it('is zero for an empty wave', () => {
    expect(kindShare({}, ['walker'])).toBe(0);
  });
});

describe('threat-scaled payout', () => {
  it('holds pay per threat at the given rate', () => {
    const rate = 0.171;
    const early = threatScaledPayout(520, rate);
    const late = threatScaledPayout(8089, rate);
    expect(payPerThreat(early, 520)).toBeCloseTo(rate, 3);
    expect(payPerThreat(late, 8089)).toBeCloseTo(rate, 3);
  });

  it('pays whole dollars', () => {
    expect(Number.isInteger(threatScaledPayout(523, 0.1713))).toBe(true);
  });

  it('refuses nonsense rather than paying a negative wage', () => {
    expect(threatScaledPayout(0, 0.171)).toBe(0);
    expect(threatScaledPayout(520, -1)).toBe(0);
    expect(threatScaledPayout(NaN, 0.171)).toBe(0);
  });
});
