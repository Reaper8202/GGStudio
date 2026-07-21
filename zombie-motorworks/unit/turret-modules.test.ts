import { describe, expect, it } from 'vitest';
import {
  empShieldLeak,
  isEmpUnlocked,
  isPiercingUnlocked,
  MINE_SWEEPER_MINIMAP_LEVEL,
  mineSweeperRadius,
  piercingDamageFraction,
  turretModuleLevel,
  turretModulePrice,
} from '../src/core/turretModules.ts';

describe('turret modules', () => {
  it('uses the exact EMP shield leak for every module level', () => {
    expect([0, 1, 2, 3].map(empShieldLeak)).toEqual([0.1, 0.35, 0.5, 0.65]);
  });

  it('uses the exact secondary-target damage fraction for every piercing level', () => {
    expect([0, 1, 2, 3].map(piercingDamageFraction)).toEqual([
      0, 0.3, 0.45, 0.6,
    ]);
  });

  it('returns the exact target-level prices and stops past the maximum', () => {
    expect([1, 2, 3].map((level) => turretModulePrice('emp', level))).toEqual([
      100, 175, 300,
    ]);
    expect(
      [1, 2, 3].map((level) => turretModulePrice('piercing', level)),
    ).toEqual([125, 225, 375]);
    expect(turretModulePrice('emp', 4)).toBeNull();
    expect(turretModulePrice('piercing', 99)).toBeNull();
  });

  it('clamps invalid stored module levels', () => {
    expect(turretModuleLevel({ empLevel: Number.NaN }, 'emp')).toBe(0);
    expect(turretModuleLevel({ piercingLevel: -1 }, 'piercing')).toBe(0);
    expect(turretModuleLevel({ empLevel: 99 }, 'emp')).toBe(3);
  });

  it('unlocks EMP through wave or Phone Addict progress while piercing is ungated', () => {
    expect(isEmpUnlocked({})).toBe(false);
    expect(isEmpUnlocked({ highestWaveCleared: 10 })).toBe(true);
    expect(isEmpUnlocked({ highestWaveCleared: 9 })).toBe(false);
    expect(isEmpUnlocked({ phoneAddictsKilled: 1 })).toBe(true);
    expect(isPiercingUnlocked()).toBe(true);
  });

  it('clamps Mine Sweeper levels to the configured reveal radii', () => {
    expect([0, 1, 2, 3].map(mineSweeperRadius)).toEqual([0, 14, 22, 30]);
    expect(mineSweeperRadius(Number.NaN)).toBe(0);
    expect(mineSweeperRadius(-1)).toBe(0);
    expect(mineSweeperRadius(99)).toBe(30);
    expect(MINE_SWEEPER_MINIMAP_LEVEL).toBe(2);
  });
});
