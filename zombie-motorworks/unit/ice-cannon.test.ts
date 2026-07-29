import { describe, expect, it } from 'vitest';
import { effectiveFreeze } from '../src/core/abilities.ts';
import { getPartDef, PART_CATALOG } from '../src/core/parts.ts';
import { STARTER_UNLOCKS } from '../src/core/profile.ts';

describe('ice cannon catalog entry', () => {
  it('is a buyable, unlockable weapon with slowing fire and a freeze ability', () => {
    const def = getPartDef('ice-cannon');
    expect(def.category).toBe('weapon');
    // Must be purchased before use, so it is not free and not a starter unlock.
    expect(def.unlockCost).toBeGreaterThan(0);
    expect(STARTER_UNLOCKS).not.toContain('ice-cannon');
    // Normal fire: an auto-aim cryo weapon whose shards slow zombies on hit.
    expect(def.weapon?.aimMode).toBe('auto');
    // A control weapon: it must stay well under the basic turret's damage per
    // second, so the slow is the reason to fit it.
    const turret = getPartDef('turret').weapon!;
    const dps = def.weapon!.damage * def.weapon!.fireRate;
    expect(dps).toBeLessThan(turret.damage * turret.fireRate * 0.6);
    expect(def.weapon?.slowFactor).toBeGreaterThan(0);
    // Cryo fire has to bite: a hit zombie crawls at roughly a third speed, and
    // the slow outlasts the gap between shots so sustained fire keeps it there.
    expect(def.weapon?.slowFactor).toBeLessThanOrEqual(0.35);
    expect(def.weapon?.slowDurationSeconds).toBeGreaterThanOrEqual(3);
    // Q ability: the full flash-freeze, separate from normal fire.
    expect(def.ability?.kind).toBe('freeze');
    expect(def.ability?.cooldownSeconds).toBe(22);
    expect(def.ability?.baseTargets).toBe(3);
    expect(def.ability?.baseDurationSeconds).toBe(4);
  });

  it('appears in the catalog', () => {
    expect(PART_CATALOG['ice-cannon']).toBeDefined();
  });
});

describe('effectiveFreeze scaling', () => {
  const ability = getPartDef('ice-cannon').ability!;

  it('returns the base stats at level 1', () => {
    const freeze = effectiveFreeze(ability, 1);
    expect(freeze.targets).toBe(3);
    expect(freeze.durationSeconds).toBe(4);
    expect(freeze.cooldownSeconds).toBe(22);
    expect(freeze.rangeM).toBe(ability.rangeM);
  });

  it('adds one target and one second of freeze per level', () => {
    const level5 = effectiveFreeze(ability, 5);
    expect(level5.targets).toBe(7);
    expect(level5.durationSeconds).toBe(8);
    // Cooldown and range stay fixed as the weapon upgrades.
    expect(level5.cooldownSeconds).toBe(22);
    expect(level5.rangeM).toBe(ability.rangeM);
  });

  it('defaults to level 1 and never scales below it', () => {
    expect(effectiveFreeze(ability)).toEqual(effectiveFreeze(ability, 1));
    expect(effectiveFreeze(ability, 0)).toEqual(effectiveFreeze(ability, 1));
  });
});
