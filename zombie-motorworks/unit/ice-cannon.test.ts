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
    expect(def.weapon?.slowFactor).toBeGreaterThan(0);
    expect(def.weapon?.slowFactor).toBeLessThan(1);
    expect(def.weapon?.slowDurationSeconds).toBeGreaterThan(0);
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
