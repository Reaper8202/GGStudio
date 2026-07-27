import { describe, expect, it } from 'vitest';
import {
  ABILITY_KIND_META,
  ABILITY_SLOT_KEYS,
  BENCHED_ABILITY_SLOT,
  effectiveHellfire,
  effectiveOverdrive,
  effectivePulse,
  MAX_ABILITY_SLOTS,
  resolveAbilityLoadout,
  type AbilityCandidate,
} from '../src/core/abilities.ts';
import { getPartDef, PART_CATALOG } from '../src/core/parts.ts';
import { STARTER_UNLOCKS } from '../src/core/profile.ts';
import type { AbilityDefinition } from '../src/core/types.ts';

function candidate(
  partId: string,
  defId: string,
  overrides: Partial<AbilityCandidate> = {},
): AbilityCandidate {
  const def = getPartDef(defId);
  if (def.ability === undefined) throw new Error(`${defId} has no ability`);
  return {
    partId,
    partName: def.name,
    ability: def.ability,
    level: 1,
    preferred: false,
    ...overrides,
  };
}

describe('ability bar slots', () => {
  it('binds three slots to Q, E, and R', () => {
    expect(MAX_ABILITY_SLOTS).toBe(3);
    expect([...ABILITY_SLOT_KEYS]).toEqual(['q', 'e', 'r']);
  });

  it('gives every ability kind a label, a glyph, and a blurb', () => {
    for (const kind of [
      'shield',
      'freeze',
      'pulse',
      'overdrive',
      'hellfire',
    ] as const) {
      const meta = ABILITY_KIND_META[kind];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.glyph.length).toBeGreaterThan(0);
      expect(meta.blurb.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveAbilityLoadout', () => {
  it('gives a rig with no ability parts no abilities at all', () => {
    expect(resolveAbilityLoadout([])).toEqual([]);
  });

  it('equips every ability part when the rig carries three or fewer', () => {
    const loadout = resolveAbilityLoadout([
      candidate('a', 'shield-generator'),
      candidate('b', 'ice-cannon'),
    ]);
    expect(loadout.map((slot) => slot.partId)).toEqual(['a', 'b']);
    expect(loadout.map((slot) => slot.key)).toEqual(['q', 'e']);
    expect(loadout.map((slot) => slot.slot)).toEqual([0, 1]);
  });

  it('never fills more than the three slots', () => {
    const loadout = resolveAbilityLoadout([
      candidate('a', 'shield-generator'),
      candidate('b', 'ice-cannon'),
      candidate('c', 'pulse-emitter'),
      candidate('d', 'nitro-injector'),
    ]);
    expect(loadout).toHaveLength(MAX_ABILITY_SLOTS);
    expect(loadout.map((slot) => slot.partId)).toEqual(['a', 'b', 'c']);
  });

  it('lets the garage pick which abilities make the cut', () => {
    // Four parts, one bar: the flagged ones take the slots, in order.
    const loadout = resolveAbilityLoadout([
      candidate('a', 'shield-generator'),
      candidate('b', 'ice-cannon'),
      candidate('c', 'pulse-emitter', { preferred: true }),
      candidate('d', 'nitro-injector', { preferred: true }),
    ]);
    expect(loadout.map((slot) => slot.partId)).toEqual(['c', 'd', 'a']);
    expect(loadout.map((slot) => slot.key)).toEqual(['q', 'e', 'r']);
  });

  it('carries the part and its level through to the slot', () => {
    const [slot] = resolveAbilityLoadout([
      candidate('a', 'ice-cannon', { level: 4 }),
    ]);
    expect(slot.partName).toBe('Ice Cannon');
    expect(slot.level).toBe(4);
    expect(slot.ability.kind).toBe('freeze');
  });

  it('puts an ability in the exact box the garage panel assigned it', () => {
    const loadout = resolveAbilityLoadout([
      candidate('a', 'shield-generator', { slot: 2 }),
      candidate('b', 'ice-cannon', { slot: 0 }),
    ]);
    expect(loadout.map((slot) => [slot.partId, slot.key])).toEqual([
      ['b', 'q'],
      ['a', 'r'],
    ]);
  });

  it('leaves a box empty rather than packing the ones after it', () => {
    // Slot E deliberately cleared: R must stay on R, not slide down to E.
    const loadout = resolveAbilityLoadout([
      candidate('a', 'shield-generator', { slot: 0 }),
      candidate('b', 'ice-cannon', { slot: BENCHED_ABILITY_SLOT }),
      candidate('c', 'pulse-emitter', { slot: 2 }),
    ]);
    expect(loadout.map((slot) => slot.slot)).toEqual([0, 2]);
    expect(loadout.map((slot) => slot.partId)).toEqual(['a', 'c']);
  });

  it('keeps a benched ability out of the bar even with boxes to spare', () => {
    const loadout = resolveAbilityLoadout([
      candidate('a', 'shield-generator', { slot: BENCHED_ABILITY_SLOT }),
      candidate('b', 'ice-cannon'),
    ]);
    expect(loadout.map((slot) => slot.partId)).toEqual(['b']);
  });

  it('drops a newly fitted ability into whatever box is still free', () => {
    const loadout = resolveAbilityLoadout([
      candidate('a', 'shield-generator', { slot: 1 }),
      candidate('b', 'ice-cannon'),
    ]);
    expect(
      loadout.find((slot) => slot.partId === 'b')?.slot,
    ).toBe(0);
  });

  it('ignores an out-of-range or duplicated box claim', () => {
    const loadout = resolveAbilityLoadout([
      candidate('a', 'shield-generator', { slot: 0 }),
      // Same box as 'a': first claim wins, the loser falls back to a free box.
      candidate('b', 'ice-cannon', { slot: 0 }),
      candidate('c', 'pulse-emitter', { slot: 9 }),
    ]);
    expect(loadout.map((slot) => [slot.partId, slot.slot])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });
});

describe('pulse emitter catalog entry', () => {
  const def = getPartDef('pulse-emitter');
  const ability = def.ability as AbilityDefinition;

  it('is a buyable, unlockable ability part with no normal fire', () => {
    expect(PART_CATALOG['pulse-emitter']).toBeDefined();
    expect(def.unlockCost).toBeGreaterThan(0);
    expect(STARTER_UNLOCKS).not.toContain('pulse-emitter');
    expect(def.weapon).toBeUndefined();
    expect(ability.kind).toBe('pulse');
  });

  it('hits harder and reaches further with every upgrade level', () => {
    const level1 = effectivePulse(ability, 1);
    const level5 = effectivePulse(ability, 5);
    expect(level1.damage).toBe(ability.baseDamage);
    expect(level1.radiusM).toBe(ability.rangeM);
    expect(level5.damage).toBeGreaterThan(level1.damage);
    expect(level5.radiusM).toBeGreaterThan(level1.radiusM);
    // Cooldown is the one thing upgrades never touch.
    expect(level5.cooldownSeconds).toBe(ability.cooldownSeconds);
  });

  it('defaults to level 1 and never scales below it', () => {
    expect(effectivePulse(ability)).toEqual(effectivePulse(ability, 1));
    expect(effectivePulse(ability, 0)).toEqual(effectivePulse(ability, 1));
  });
});

describe('flamethrower hellfire catalog entry', () => {
  const def = getPartDef('flamethrower');
  const ability = def.ability as AbilityDefinition;

  it('rides along with the nozzle rather than being its own part', () => {
    expect(ability.kind).toBe('hellfire');
    // Unlike the pure ability parts, the flamethrower keeps its normal fire —
    // Hellfire is an overcharge of that weapon, not a replacement for it.
    expect(def.weapon).toBeDefined();
  });

  it('overcharges reach, cone, and damage all at once', () => {
    const hellfire = effectiveHellfire(ability, 1);
    expect(hellfire.durationSeconds).toBe(6);
    expect(hellfire.damageMultiplier).toBeCloseTo(2.4);
    expect(hellfire.rangeMultiplier).toBeGreaterThan(1);
    expect(hellfire.coneMultiplier).toBeGreaterThan(1);
  });

  it('burns hotter and longer with every upgrade level', () => {
    const level1 = effectiveHellfire(ability, 1);
    const level5 = effectiveHellfire(ability, 5);
    expect(level5.durationSeconds).toBeGreaterThan(level1.durationSeconds);
    expect(level5.damageMultiplier).toBeGreaterThan(level1.damageMultiplier);
    // Reach, cone, and cooldown are the parts upgrades never touch.
    expect(level5.rangeMultiplier).toBe(level1.rangeMultiplier);
    expect(level5.coneMultiplier).toBe(level1.coneMultiplier);
    expect(level5.cooldownSeconds).toBe(ability.cooldownSeconds);
  });

  it('defaults to level 1 and never scales below it', () => {
    expect(effectiveHellfire(ability)).toEqual(effectiveHellfire(ability, 1));
    expect(effectiveHellfire(ability, 0)).toEqual(
      effectiveHellfire(ability, 1),
    );
  });
});

describe('nitro injector catalog entry', () => {
  const def = getPartDef('nitro-injector');
  const ability = def.ability as AbilityDefinition;

  it('is a buyable, unlockable ability part with no normal fire', () => {
    expect(PART_CATALOG['nitro-injector']).toBeDefined();
    expect(def.unlockCost).toBeGreaterThan(0);
    expect(STARTER_UNLOCKS).not.toContain('nitro-injector');
    expect(def.weapon).toBeUndefined();
    expect(ability.kind).toBe('overdrive');
  });

  it('is a real shove, not a nudge, at every level', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      const overdrive = effectiveOverdrive(ability, level);
      // At least triple torque: enough to haul a heavy rig out of a crowd.
      expect(overdrive.torqueMultiplier).toBeGreaterThanOrEqual(3);
      // And the ceiling lifts with it, so the surge is felt at speed too.
      expect(overdrive.topSpeedMultiplier).toBeGreaterThan(1.25);
    }
  });

  it('runs longer and pulls harder with every upgrade level', () => {
    const level1 = effectiveOverdrive(ability, 1);
    const level5 = effectiveOverdrive(ability, 5);
    expect(level1.durationSeconds).toBe(ability.baseDurationSeconds);
    expect(level1.torqueMultiplier).toBe(ability.baseTorqueMultiplier);
    expect(level1.topSpeedMultiplier).toBe(ability.baseTopSpeedMultiplier);
    expect(level5.durationSeconds).toBeGreaterThan(level1.durationSeconds);
    expect(level5.torqueMultiplier).toBeGreaterThan(level1.torqueMultiplier);
    expect(level5.topSpeedMultiplier).toBeGreaterThan(
      level1.topSpeedMultiplier,
    );
    expect(level5.cooldownSeconds).toBe(ability.cooldownSeconds);
  });

  it('defaults to level 1 and never scales below it', () => {
    expect(effectiveOverdrive(ability)).toEqual(effectiveOverdrive(ability, 1));
    expect(effectiveOverdrive(ability, 0)).toEqual(
      effectiveOverdrive(ability, 1),
    );
  });
});
