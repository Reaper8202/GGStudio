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
        gunslinger: 0,
        necromancer: 0,
        thrower: 0,
        worker: 0,
        'phone-addict': 0,
        kamikaze: 0,
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
        gunslinger: 0,
        necromancer: 0,
        thrower: 0,
        worker: 0,
        'phone-addict': 0,
        kamikaze: 0,
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
        gunslinger: 1,
        necromancer: 0,
        thrower: 1,
        worker: 0,
        'phone-addict': 0,
        kamikaze: 0,
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
      },
      healthMultiplier: healthMultiplierForWave(7),
      speedMultiplier: speedMultiplierForWave(7),
      attackDamageMultiplier: attackDamageMultiplierForWave(7),
      effectiveTotalHp: 3210,
      totalPossibleReward: 357,
    });
  });

  it('reports the exact wave 10 balance', () => {
    expect(waveBalanceReport(10)).toEqual({
      wave: 10,
      composition: {
        walker: 40,
        gunslinger: 10,
        necromancer: 1,
        thrower: 4,
        worker: 2,
        'phone-addict': 1,
        kamikaze: 5,
      },
      healthMultiplier: healthMultiplierForWave(10),
      speedMultiplier: speedMultiplierForWave(10),
      attackDamageMultiplier: attackDamageMultiplierForWave(10),
      effectiveTotalHp: 4614,
      totalPossibleReward: 467,
    });
  });

  it('reports the exact wave 15 balance', () => {
    expect(waveBalanceReport(15)).toEqual({
      wave: 15,
      composition: {
        walker: 55,
        gunslinger: 10,
        necromancer: 2,
        thrower: 7,
        worker: 3,
        'phone-addict': 2,
        kamikaze: 7,
      },
      healthMultiplier: healthMultiplierForWave(15),
      speedMultiplier: speedMultiplierForWave(15),
      attackDamageMultiplier: attackDamageMultiplierForWave(15),
      effectiveTotalHp: 7537,
      totalPossibleReward: 638,
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
