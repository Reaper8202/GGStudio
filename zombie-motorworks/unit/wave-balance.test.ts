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
        walker: 13,
        thrower: 0,
        worker: 0,
        'phone-addict': 0,
        boss: 0,
      },
      healthMultiplier: healthMultiplierForWave(1),
      speedMultiplier: speedMultiplierForWave(1),
      attackDamageMultiplier: attackDamageMultiplierForWave(1),
      effectiveTotalHp: 520,
      totalPossibleReward: 89,
    });
  });

  it('reports the exact wave 2 balance', () => {
    expect(waveBalanceReport(2)).toEqual({
      wave: 2,
      composition: {
        walker: 16,
        thrower: 0,
        worker: 0,
        'phone-addict': 0,
        boss: 0,
      },
      healthMultiplier: healthMultiplierForWave(2),
      speedMultiplier: speedMultiplierForWave(2),
      attackDamageMultiplier: attackDamageMultiplierForWave(2),
      effectiveTotalHp: 678,
      totalPossibleReward: 108,
    });
  });

  it('reports the exact wave 3 balance', () => {
    expect(waveBalanceReport(3)).toEqual({
      wave: 3,
      composition: {
        walker: 19,
        thrower: 1,
        worker: 0,
        'phone-addict': 0,
        boss: 0,
      },
      healthMultiplier: healthMultiplierForWave(3),
      speedMultiplier: speedMultiplierForWave(3),
      attackDamageMultiplier: attackDamageMultiplierForWave(3),
      effectiveTotalHp: 923,
      totalPossibleReward: 135,
    });
  });

  it('reports the exact wave 4 balance', () => {
    expect(waveBalanceReport(4)).toEqual({
      wave: 4,
      composition: {
        walker: 22,
        thrower: 1,
        worker: 0,
        'phone-addict': 0,
        boss: 0,
      },
      healthMultiplier: healthMultiplierForWave(4),
      speedMultiplier: speedMultiplierForWave(4),
      attackDamageMultiplier: attackDamageMultiplierForWave(4),
      effectiveTotalHp: 1114,
      totalPossibleReward: 154,
    });
  });

  it('reports the exact wave 7 balance', () => {
    expect(waveBalanceReport(7)).toEqual({
      wave: 7,
      composition: {
        walker: 31,
        thrower: 3,
        worker: 1,
        'phone-addict': 0,
        boss: 0,
      },
      healthMultiplier: healthMultiplierForWave(7),
      speedMultiplier: speedMultiplierForWave(7),
      attackDamageMultiplier: attackDamageMultiplierForWave(7),
      effectiveTotalHp: 2018,
      totalPossibleReward: 239,
    });
  });

  it('reports the exact wave 11 balance', () => {
    expect(waveBalanceReport(11)).toEqual({
      wave: 11,
      composition: {
        walker: 43,
        thrower: 5,
        worker: 2,
        'phone-addict': 1,
        boss: 0,
      },
      healthMultiplier: healthMultiplierForWave(11),
      speedMultiplier: speedMultiplierForWave(11),
      attackDamageMultiplier: attackDamageMultiplierForWave(11),
      effectiveTotalHp: 3507,
      totalPossibleReward: 353,
    });
  });

  // Every fifth wave replaces the horde with one boss, so the report is a
  // single boss HP figure plus the boss bounty and the ordinary clear bonus.
  it.each([
    { wave: 5, effectiveTotalHp: 1116, totalPossibleReward: 240 },
    { wave: 10, effectiveTotalHp: 1386, totalPossibleReward: 290 },
    { wave: 15, effectiveTotalHp: 1656, totalPossibleReward: 340 },
  ])('reports the exact boss wave $wave balance', (expected) => {
    expect(waveBalanceReport(expected.wave)).toEqual({
      wave: expected.wave,
      composition: {
        walker: 0,
        thrower: 0,
        worker: 0,
        'phone-addict': 0,
        boss: 1,
      },
      healthMultiplier: healthMultiplierForWave(expected.wave),
      speedMultiplier: speedMultiplierForWave(expected.wave),
      attackDamageMultiplier: attackDamageMultiplierForWave(expected.wave),
      effectiveTotalHp: expected.effectiveTotalHp,
      totalPossibleReward: expected.totalPossibleReward,
    });
  });

  it('offers 486 total reward across waves 1 through 4', () => {
    const earlyWaveReward = [1, 2, 3, 4].reduce(
      (total, wave) => total + waveBalanceReport(wave).totalPossibleReward,
      0,
    );

    expect(earlyWaveReward).toBe(486);
  });
});
