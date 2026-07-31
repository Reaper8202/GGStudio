import { describe, expect, it } from 'vitest';
import {
  canAfford,
  isStarterUnlocked,
  nextUpgrade,
  partInvestment,
  placeCost,
  sellRefund,
  unlockCost,
  unlockInvestment,
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
    expect(partInvestment(placed('turret', 3))).toBe(120 + 40 + 86);
    expect(sellRefund(placed('turret', 3))).toBe(123);
    expect(partInvestment(placed('turret'))).toBe(120);
  });

  it('prices a maxed turret as the upgrade chain and nothing more', () => {
    // The EMP Coil and Piercing Rounds used to be side modules bought separately,
    // and their price was added on top of the chain. They are now rungs *on* the
    // chain, so a fully upgraded turret costs exactly base plus its five unlocks
    // — there is no module surcharge left to account for.
    const maxed = placed('turret', MAX_PART_LEVEL);

    expect(partInvestment(maxed)).toBe(120 + 40 + 86 + 184 + 295 + 472);
    expect(partInvestment(maxed)).toBe(1197);
    expect(sellRefund(maxed)).toBe(598);
  });

  it('refunds only the unlock spend when a part goes back to inventory', () => {
    // Returning a part hands back a base block, so the base price stays spent
    // and everything above it comes back in full.
    expect(unlockInvestment(placed('turret', 3))).toBe(40 + 86);
    expect(unlockInvestment(placed('turret'))).toBe(0);
    expect(unlockInvestment(placed('turret', 3))).toBe(
      partInvestment(placed('turret', 3)) - placeCost('turret'),
    );
  });

  it('returns the next upgrade price and stops at the maximum level', () => {
    expect(nextUpgrade(placed('turret'))).toEqual({
      targetLevel: 2,
      price: 40,
    });
    expect(nextUpgrade(placed('turret', MAX_PART_LEVEL))).toBeNull();
  });

  it('handles a catalog part with no upgrade metadata as its base cost only', () => {
    const fuelTank = getPartDef('fuel-tank');
    const originalUpgrade = fuelTank.upgrade;
    try {
      fuelTank.upgrade = undefined;
      expect(partInvestment(placed('fuel-tank', 3))).toBe(16);
      expect(nextUpgrade(placed('fuel-tank'))).toBeNull();
    } finally {
      fuelTank.upgrade = originalUpgrade;
    }
  });

  it('exposes catalog purchase and unlock costs plus starter membership', () => {
    expect(placeCost('engine-small')).toBe(48);
    expect(unlockCost('frame-reinforced')).toBe(10);
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
