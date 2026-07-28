import { describe, expect, it } from 'vitest';
import {
  canAfford,
  isStarterUnlocked,
  nextUpgrade,
  partInvestment,
  placeCost,
  sellRefund,
  unlockCost,
} from '../src/core/economy.ts';
import { getPartDef } from '../src/core/parts.ts';
import { MAX_PART_LEVEL } from '../src/core/partUpgrades.ts';
import type { PlacedPart } from '../src/core/types.ts';

function placed(defId: string, level?: number): PlacedPart {
  return {
    id: `test-${defId}`,
    defId,
    pos: { x: 0, y: 0, z: 0 },
    orient: 0,
    config: level === undefined ? {} : { level },
  };
}

describe('economy helpers', () => {
  it('calculates investment, a floored half refund, and default level cost', () => {
    expect(partInvestment(placed('turret', 3))).toBe(150 + 90 + 144);
    expect(sellRefund(placed('turret', 3))).toBe(192);
    expect(partInvestment(placed('turret'))).toBe(150);
  });

  it('includes both turret module investments in the sell refund', () => {
    const turret = placed('turret', 3);
    turret.config.empLevel = 2;
    turret.config.piercingLevel = 1;

    expect(partInvestment(turret)).toBe(150 + 90 + 144 + 100 + 175 + 125);
    expect(sellRefund(turret)).toBe(392);
  });

  it('returns the next upgrade price and stops at the maximum level', () => {
    expect(nextUpgrade(placed('turret'))).toEqual({
      targetLevel: 2,
      price: 90,
    });
    expect(nextUpgrade(placed('turret', MAX_PART_LEVEL))).toBeNull();
  });

  it('handles a catalog part with no upgrade metadata as its base cost only', () => {
    const fuelTank = getPartDef('fuel-tank');
    const originalUpgrade = fuelTank.upgrade;
    try {
      fuelTank.upgrade = undefined;
      expect(partInvestment(placed('fuel-tank', 3))).toBe(20);
      expect(nextUpgrade(placed('fuel-tank'))).toBeNull();
    } finally {
      fuelTank.upgrade = originalUpgrade;
    }
  });

  it('exposes catalog purchase and unlock costs plus starter membership', () => {
    expect(placeCost('engine-small')).toBe(60);
    expect(unlockCost('frame-reinforced')).toBe(150);
    expect(unlockCost('turret')).toBe(0);
    expect(isStarterUnlocked('turret')).toBe(true);
    expect(isStarterUnlocked('cannon-heavy')).toBe(false);
  });

  it('only treats safe integer balances as affordable', () => {
    expect(canAfford(200, 200)).toBe(true);
    expect(canAfford(199, 200)).toBe(false);
    expect(canAfford(10.5, 10)).toBe(false);
    expect(canAfford(10, -1)).toBe(false);
  });
});
