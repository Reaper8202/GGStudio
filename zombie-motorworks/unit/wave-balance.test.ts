import { describe, expect, it } from 'vitest';
import {
  attackDamageMultiplierForWave,
  healthMultiplierForWave,
  speedMultiplierForWave,
} from '../src/survival/WaveManager.ts';
import { waveBalanceReport } from '../src/survival/waveBalance.ts';

describe('wave balance report', () => {
  it('reports the exact wave 1 balance', () => {
    expect(waveBalanceReport(1)).toEqual({
      wave: 1,
      composition: {
        walker: 18,
        gunslinger: 0,
        necromancer: 0,
        thrower: 0,
        worker: 0,
        'phone-addict': 0,
        kamikaze: 0,
        behemoth: 0,
        zamboni: 0,
        boss: 0,
      },
      healthMultiplier: healthMultiplierForWave(1),
      speedMultiplier: speedMultiplierForWave(1),
      attackDamageMultiplier: attackDamageMultiplierForWave(1),
      effectiveTotalHp: 720,
      totalPossibleReward: 104,
    });
  });

  it('reports the exact wave 2 balance', () => {
    expect(waveBalanceReport(2)).toEqual({
      wave: 2,
      composition: {
        walker: 26,
        gunslinger: 0,
        necromancer: 0,
        thrower: 0,
        worker: 0,
        'phone-addict': 0,
        kamikaze: 0,
        behemoth: 0,
        zamboni: 0,
        boss: 0,
      },
      healthMultiplier: healthMultiplierForWave(2),
      speedMultiplier: speedMultiplierForWave(2),
      attackDamageMultiplier: attackDamageMultiplierForWave(2),
      effectiveTotalHp: 1102,
      totalPossibleReward: 138,
    });
  });

  it('reports the exact wave 3 balance', () => {
    expect(waveBalanceReport(3)).toEqual({
      wave: 3,
      composition: {
        walker: 19,
        gunslinger: 1,
        necromancer: 0,
        thrower: 1,
        worker: 0,
        'phone-addict': 0,
        kamikaze: 0,
        behemoth: 0,
        zamboni: 0,
        boss: 0,
      },
      healthMultiplier: healthMultiplierForWave(3),
      speedMultiplier: speedMultiplierForWave(3),
      attackDamageMultiplier: attackDamageMultiplierForWave(3),
      effectiveTotalHp: 1004,
      totalPossibleReward: 144,
    });
  });

  it('reports the exact wave 4 balance', () => {
    expect(waveBalanceReport(4)).toEqual({
      wave: 4,
      composition: {
        walker: 22,
        gunslinger: 3,
        necromancer: 0,
        thrower: 1,
        worker: 0,
        'phone-addict': 0,
        kamikaze: 2,
        behemoth: 0,
        zamboni: 0,
        boss: 0,
      },
      healthMultiplier: healthMultiplierForWave(4),
      speedMultiplier: speedMultiplierForWave(4),
      attackDamageMultiplier: attackDamageMultiplierForWave(4),
      effectiveTotalHp: 1416,
      totalPossibleReward: 195,
    });
  });

  it('reports the exact wave 7 balance', () => {
    expect(waveBalanceReport(7)).toEqual({
      wave: 7,
      composition: {
        walker: 31,
        gunslinger: 9,
        necromancer: 1,
        thrower: 3,
        worker: 1,
        'phone-addict': 0,
        kamikaze: 3,
        behemoth: 0,
        zamboni: 0,
        boss: 0,
      },
      healthMultiplier: healthMultiplierForWave(7),
      speedMultiplier: speedMultiplierForWave(7),
      attackDamageMultiplier: attackDamageMultiplierForWave(7),
      effectiveTotalHp: 3210,
      totalPossibleReward: 357,
    });
  });

  it('reports the exact wave 11 balance', () => {
    expect(waveBalanceReport(11)).toEqual({
      wave: 11,
      composition: {
        walker: 43,
        gunslinger: 10,
        necromancer: 2,
        thrower: 5,
        worker: 2,
        'phone-addict': 1,
        kamikaze: 5,
        behemoth: 1,
        zamboni: 1,
        boss: 0,
      },
      healthMultiplier: healthMultiplierForWave(11),
      speedMultiplier: speedMultiplierForWave(11),
      attackDamageMultiplier: attackDamageMultiplierForWave(11),
      effectiveTotalHp: 6061,
      totalPossibleReward: 556,
    });
  });

  // Every fifth wave replaces the horde with one boss, so the report is a
  // single boss HP figure plus the boss bounty and the ordinary clear bonus.
  it.each([
    // Waves 5 and 15 are The Sledge (900 base HP); wave 10 is The Alchemist,
    // which carries 2,000 because it replaces the far larger wave-9 horde.
    { wave: 5, effectiveTotalHp: 1116, totalPossibleReward: 240 },
    { wave: 10, effectiveTotalHp: 3542, totalPossibleReward: 420 },
    { wave: 15, effectiveTotalHp: 1656, totalPossibleReward: 340 },
  ])('reports the exact boss wave $wave balance', (expected) => {
    expect(waveBalanceReport(expected.wave)).toEqual({
      wave: expected.wave,
      composition: {
        walker: 0,
        gunslinger: 0,
        necromancer: 0,
        thrower: 0,
        worker: 0,
        'phone-addict': 0,
        kamikaze: 0,
        behemoth: 0,
        zamboni: 0,
        boss: 1,
      },
      healthMultiplier: healthMultiplierForWave(expected.wave),
      speedMultiplier: speedMultiplierForWave(expected.wave),
      attackDamageMultiplier: attackDamageMultiplierForWave(expected.wave),
      effectiveTotalHp: expected.effectiveTotalHp,
      totalPossibleReward: expected.totalPossibleReward,
    });
  });

  it('offers 536 total reward across waves 1 through 4', () => {
    const earlyWaveReward = [1, 2, 3, 4].reduce(
      (total, wave) => total + waveBalanceReport(wave).totalPossibleReward,
      0,
    );

    expect(earlyWaveReward).toBe(536);
  });
});
