import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/core/parts.ts';
import { effectivePartDef } from '../src/core/upgrades.ts';
import {
  BASE_ZOMBIE_STATS,
  plowCrushDamage,
} from '../src/survival/zombies/zombieConfig.ts';
import type { PlowDefinition } from '../src/core/types.ts';

const BLADE = PART_CATALOG['dozer-blade'];
const PLOW: PlowDefinition = BLADE.melee!.plow!;

describe('bulldozer blade crush', () => {
  it('crushes nothing below the blade minimum speed or with an empty blade', () => {
    expect(plowCrushDamage(PLOW, PLOW.minCrushSpeedMps - 0.01, 6)).toBe(0);
    expect(plowCrushDamage(PLOW, 20, 0)).toBe(0);
  });

  it('pays the base crush at exactly the minimum speed with one body', () => {
    expect(plowCrushDamage(PLOW, PLOW.minCrushSpeedMps, 1)).toBeCloseTo(
      PLOW.crushDamage,
    );
  });

  it('scales with closing speed and with the size of the pile', () => {
    const slow = plowCrushDamage(PLOW, PLOW.minCrushSpeedMps + 5, 1);
    expect(slow).toBeCloseTo(PLOW.crushDamage + PLOW.crushDamagePerSpeed * 5);

    const packed = plowCrushDamage(PLOW, PLOW.minCrushSpeedMps + 5, 8);
    expect(packed).toBeCloseTo(slow * (1 + PLOW.pileBonus * 7));
    expect(packed).toBeGreaterThan(slow);
  });

  it('kills a base walker outright at the minimum speed', () => {
    expect(plowCrushDamage(PLOW, PLOW.minCrushSpeedMps, 1)).toBeGreaterThan(
      BASE_ZOMBIE_STATS.health,
    );
  });

  it('carries the load rather than shredding it: contact damage stays feeble', () => {
    // The blade earns its slot on the slam, not on touching things. If this
    // ever climbs to drum territory the part has quietly become a grinder.
    expect(BLADE.melee!.damage).toBeLessThan(
      PART_CATALOG['barrel-drum'].melee!.damage / 5,
    );
  });

  it('upgrades the slam, not the reach or the capacity', () => {
    const upgraded = effectivePartDef(BLADE, BLADE.upgrade!.maxLevel);
    const upgradedPlow = upgraded.melee!.plow!;
    expect(upgradedPlow.crushDamage).toBeGreaterThan(PLOW.crushDamage);
    expect(upgradedPlow.reachM).toBe(PLOW.reachM);
    expect(upgradedPlow.halfWidthM).toBe(PLOW.halfWidthM);
    expect(upgradedPlow.capacity).toBe(PLOW.capacity);
    // The catalog definition must not be mutated by resolving an effective one.
    expect(PLOW.crushDamage).toBe(
      PART_CATALOG['dozer-blade'].melee!.plow!.crushDamage,
    );
  });
});
