/**
 * Contracts for the car-item system (`src/items/**`): the persistent,
 * customizable parts a player attaches to their car (engines, wheels,
 * turrets, ...). Distinct from the run-scoped upgrades in
 * `src/config/upgradeDefs.ts`, which reset every run.
 *
 * An item is a plain data object (`ItemDefinition`): declarative per-level
 * stat scaling plus optional level-gated ability unlocks. See
 * `docs/ITEMS.md` for the guide to adding new items.
 */

// ---------------------------------------------------------------------------
// Slots and stat keys
// ---------------------------------------------------------------------------

/** Where on the car an item conceptually attaches. */
export type ItemSlot = "engine" | "wheels" | "weapon" | "armor" | "utility";

/**
 * Every stat an item can modify. Add a key here when a new item needs to
 * touch something no existing key covers, then aggregate it wherever the
 * consuming system lives.
 */
export type ItemStatKey =
  | "enginePower" // scales acceleration
  | "topSpeed" // scales maximum forward speed
  | "grip" // scales lateral grip / steering feel
  | "weaponDamage"
  | "weaponFireRate"
  | "weaponRange"
  | "maxHealth" // flat HP is the common use; multipliers also work
  | "damageResistance"; // flat 0..1 fraction of damage ignored

export const ITEM_STAT_KEYS: readonly ItemStatKey[] = [
  "enginePower",
  "topSpeed",
  "grip",
  "weaponDamage",
  "weaponFireRate",
  "weaponRange",
  "maxHealth",
  "damageResistance",
];

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

/**
 * Every ability an item can unlock. Extend this union when a new item
 * introduces a new ability; the gameplay system that implements the ability
 * checks `CarLoadout.hasAbility(...)`.
 */
export type AbilityId = "boost";

/** An ability granted once the owning item reaches `level`. */
export interface AbilityUnlock {
  /** Item level (1..maxLevel) at which the ability becomes active. */
  level: number;
  ability: AbilityId;
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Stat scaling
// ---------------------------------------------------------------------------

/**
 * How one stat grows with the owning item's level. Level 1 contributes the
 * `base*` values (default 0 — the starter items at level 1 leave the car at
 * its base tuning); each level past 1 adds the `*PerLevel` values, clamped
 * by the optional caps.
 *
 * `percent` fields are fractional bonuses that stack additively across
 * items into a final multiplier (two items giving +0.10 each = 1.20x).
 * `flat` fields are absolute amounts that sum (e.g. +25 max HP).
 */
export interface StatScaling {
  stat: ItemStatKey;
  /** Fractional bonus at level 1 (0.1 = +10%). Default 0. */
  basePercent?: number;
  /** Additional fractional bonus per level beyond 1. Default 0. */
  percentPerLevel?: number;
  /** Upper bound on the total fractional bonus from this scaling. */
  maxPercent?: number;
  /** Flat amount at level 1. Default 0. */
  baseFlat?: number;
  /** Additional flat amount per level beyond 1. Default 0. */
  flatPerLevel?: number;
  /** Upper bound on the total flat amount from this scaling. */
  maxFlat?: number;
}

/** One item's contribution to a single stat at a specific level. */
export interface StatContribution {
  flat: number;
  percent: number;
}

/** Aggregated loadout totals for one stat: `final = (base + flat) * multiplier`. */
export interface StatTotal {
  flat: number;
  multiplier: number;
}

/** Aggregated totals for every stat key (identity when nothing modifies it). */
export type LoadoutStats = Record<ItemStatKey, StatTotal>;

// ---------------------------------------------------------------------------
// Item definition
// ---------------------------------------------------------------------------

export interface ItemDefinition {
  /** Unique kebab-case id, e.g. "basic-engine". */
  id: string;
  name: string;
  description: string;
  slot: ItemSlot;
  /** Highest purchasable level (level 1 = the item as first equipped). */
  maxLevel: number;
  /** Price of the level 1 -> 2 upgrade; see `upgradePrice`. */
  basePrice: number;
  /** price(level) = round(basePrice * priceGrowth^(level - 1)). */
  priceGrowth: number;
  /** Declarative per-level stat growth. */
  stats: StatScaling[];
  /** Abilities gated behind item levels, e.g. boost at engine level 7. */
  unlocks?: AbilityUnlock[];
}

/** An item as currently equipped on the car. */
export interface EquippedItem {
  definition: ItemDefinition;
  level: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Contribution of one `StatScaling` at an item level (level >= 1). */
export function statContributionAtLevel(
  scaling: StatScaling,
  level: number
): StatContribution {
  const steps = Math.max(0, level - 1);
  const percent =
    (scaling.basePercent ?? 0) + (scaling.percentPerLevel ?? 0) * steps;
  const flat = (scaling.baseFlat ?? 0) + (scaling.flatPerLevel ?? 0) * steps;
  return {
    percent: Math.min(percent, scaling.maxPercent ?? Infinity),
    flat: Math.min(flat, scaling.maxFlat ?? Infinity),
  };
}

/**
 * Money cost to go from `currentLevel` to `currentLevel + 1`, or `null`
 * when the item is already at `maxLevel`.
 */
export function upgradePrice(
  definition: ItemDefinition,
  currentLevel: number
): number | null {
  if (currentLevel >= definition.maxLevel) return null;
  return Math.round(
    definition.basePrice * definition.priceGrowth ** (currentLevel - 1)
  );
}

/** Fresh identity totals (flat 0, multiplier 1) for every stat key. */
export function createEmptyLoadoutStats(): LoadoutStats {
  const stats = {} as LoadoutStats;
  for (const key of ITEM_STAT_KEYS) {
    stats[key] = { flat: 0, multiplier: 1 };
  }
  return stats;
}
