import { describe, expect, it } from 'vitest';
import { effectiveShield } from '../src/core/abilities.ts';
import { getPartDef, PART_CATALOG } from '../src/core/parts.ts';
import { STARTER_UNLOCKS } from '../src/core/profile.ts';

describe('shield generator catalog entry', () => {
  it('is a buyable, unlockable, purely defensive shield ability', () => {
    const def = getPartDef('shield-generator');
    expect(def.category).toBe('weapon');
    // Bought before use: not free, not a starter unlock.
    expect(def.unlockCost).toBeGreaterThan(0);
    expect(STARTER_UNLOCKS).not.toContain('shield-generator');
    // Purely defensive: no normal fire, only the Q bubble.
    expect(def.weapon).toBeUndefined();
    expect(def.ability?.kind).toBe('shield');
    expect(def.ability?.cooldownSeconds).toBe(25);
    expect(def.ability?.baseDurationSeconds).toBeGreaterThan(0);
  });

  it('appears in the catalog', () => {
    expect(PART_CATALOG['shield-generator']).toBeDefined();
  });
});

describe('effectiveShield scaling', () => {
  const ability = getPartDef('shield-generator').ability!;

  it('returns the base duration and fixed 25s cooldown at level 1', () => {
    const shield = effectiveShield(ability, 1);
    expect(shield.durationSeconds).toBe(ability.baseDurationSeconds);
    expect(shield.cooldownSeconds).toBe(25);
  });

  it('adds one second of invulnerability per level, cooldown fixed', () => {
    const level5 = effectiveShield(ability, 5);
    expect(level5.durationSeconds).toBe(ability.baseDurationSeconds + 4);
    expect(level5.cooldownSeconds).toBe(25);
  });

  it('defaults to level 1 and never scales below it', () => {
    expect(effectiveShield(ability)).toEqual(effectiveShield(ability, 1));
    expect(effectiveShield(ability, 0)).toEqual(effectiveShield(ability, 1));
  });
});
