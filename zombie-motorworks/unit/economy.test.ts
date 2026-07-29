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
    expect(partInvestment(placed('turret', 3))).toBe(150 + 90 + 144);
    expect(sellRefund(placed('turret', 3))).toBe(192);
    expect(partInvestment(placed('turret'))).toBe(150);
  });

  it('includes the whole turret upgrade chain in the sell refund', () => {
    // EMP and piercing are no longer bought separately: they come with turret
    // upgrade levels, so the chain a maxed turret has paid for is the thing the
    // refund has to account for. Level 6 tops both ladders (EMP 3, piercing 3).
    //
    // Pinned rather than recomputed from the helpers: sellRefund is defined as
    // floor(partInvestment * 0.5), so asserting that relationship would only
    // restate the implementation and could never fail.
    const turret = placed('turret', 6);

    expect(partInvestment(turret)).toBe(1573);
    expect(sellRefund(turret)).toBe(786);
  });

  it('refunds only the unlock spend when a part goes back to inventory', () => {
    // Returning a part hands back a base block, so the base price stays spent
    // and everything above it comes back in full.
    expect(unlockInvestment(placed('turret', 3))).toBe(90 + 144);
    expect(unlockInvestment(placed('turret'))).toBe(0);
    expect(unlockInvestment(placed('turret', 3))).toBe(
      partInvestment(placed('turret', 3)) - placeCost('turret'),
    );
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
