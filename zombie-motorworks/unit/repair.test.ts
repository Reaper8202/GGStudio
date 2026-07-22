import { describe, expect, it } from 'vitest';
import {
  partRepairCost,
  repairPlan,
  scaledHpOnUpgrade,
} from '../src/core/economy.ts';

describe('repair economy', () => {
  it('charges half the catalog cost in proportion to missing HP', () => {
    expect(partRepairCost(180, 90, 180)).toBe(45);
    expect(partRepairCost(180, 144, 180)).toBe(18);
    expect(partRepairCost(0, 50, 100)).toBe(0);
    expect(partRepairCost(180, 180, 180)).toBe(0);
  });

  it('clamps the missing fraction and rejects non-positive max HP', () => {
    expect(partRepairCost(180, -20, 180)).toBe(90);
    expect(partRepairCost(180, 0, 0)).toBe(0);
    expect(partRepairCost(-10, 50, 100)).toBe(0);
  });

  it('builds paid line items while including free parts in integrity', () => {
    const plan = repairPlan([
      { id: 'half', baseCost: 180, currentHp: 90, maxHp: 180 },
      { id: 'fifth', baseCost: 180, currentHp: 144, maxHp: 180 },
      { id: 'free', baseCost: 0, currentHp: 50, maxHp: 100 },
      { id: 'full', baseCost: 80, currentHp: 100, maxHp: 100 },
    ]);

    expect(plan.items).toEqual([
      { id: 'half', cost: 45, missingHp: 90 },
      { id: 'fifth', cost: 18, missingHp: 36 },
    ]);
    expect(plan.totalCost).toBe(63);
    expect(plan.integrityPct).toBe((100 * 384) / 560);
  });

  it('reports zero integrity when there is no maximum HP', () => {
    expect(repairPlan([])).toEqual({
      items: [],
      totalCost: 0,
      integrityPct: 0,
    });
  });

  it('preserves HP percentage across an upgrade without a free heal', () => {
    expect(scaledHpOnUpgrade(70, 140, 151)).toBe((70 / 140) * 151);
    expect(scaledHpOnUpgrade(200, 140, 151)).toBe(151);
    expect(scaledHpOnUpgrade(-20, 140, 151)).toBe(0);
    expect(scaledHpOnUpgrade(70, 0, 151)).toBe(151);
  });
});
