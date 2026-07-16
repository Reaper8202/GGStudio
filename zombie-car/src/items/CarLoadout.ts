/**
 * The set of items currently equipped on the car, each at some level.
 * Owns equip/unequip/upgrade rules and aggregates the loadout into
 * `LoadoutStats` totals and unlocked abilities for gameplay systems to read.
 *
 * Deliberately knows nothing about money (the economy decides whether an
 * upgrade is affordable before calling `upgrade`) or about UI.
 */
import type { ItemRegistry } from "./ItemRegistry";
import {
  createEmptyLoadoutStats,
  statContributionAtLevel,
  upgradePrice,
} from "./types";
import type {
  AbilityId,
  AbilityUnlock,
  EquippedItem,
  LoadoutStats,
} from "./types";

export class CarLoadout {
  /** itemId -> current level (>= 1). Absent means not equipped. */
  private readonly levels = new Map<string, number>();

  constructor(private readonly registry: ItemRegistry) {}

  /** Equip a registered item at `level` (default 1). Throws if already equipped. */
  equip(itemId: string, level = 1): void {
    const definition = this.registry.get(itemId);
    if (this.levels.has(itemId)) {
      throw new Error(`CarLoadout: "${itemId}" is already equipped`);
    }
    if (!Number.isInteger(level) || level < 1 || level > definition.maxLevel) {
      throw new Error(
        `CarLoadout: "${itemId}" level ${level} is outside 1..${definition.maxLevel}`
      );
    }
    this.levels.set(itemId, level);
  }

  unequip(itemId: string): void {
    this.levels.delete(itemId);
  }

  isEquipped(itemId: string): boolean {
    return this.levels.has(itemId);
  }

  /** Current level of an equipped item; 0 when not equipped. */
  getLevel(itemId: string): number {
    return this.levels.get(itemId) ?? 0;
  }

  /** Raise an equipped item one level and return the new level. */
  upgrade(itemId: string): number {
    const definition = this.registry.get(itemId);
    const level = this.levels.get(itemId);
    if (level === undefined) {
      throw new Error(`CarLoadout: cannot upgrade unequipped item "${itemId}"`);
    }
    if (level >= definition.maxLevel) {
      throw new Error(`CarLoadout: "${itemId}" is already at max level`);
    }
    const newLevel = level + 1;
    this.levels.set(itemId, newLevel);
    return newLevel;
  }

  /** Cost of the next level for an equipped item; `null` at max level. */
  nextUpgradePrice(itemId: string): number | null {
    return upgradePrice(this.registry.get(itemId), this.getLevel(itemId));
  }

  /** Every equipped item with its current level. */
  equipped(): readonly EquippedItem[] {
    return [...this.levels.entries()].map(([itemId, level]) => ({
      definition: this.registry.get(itemId),
      level,
    }));
  }

  /**
   * Aggregate every equipped item's stat scaling into per-stat totals:
   * flats sum, percent bonuses stack additively into one multiplier
   * (`final = (base + flat) * multiplier`). Stats nothing modifies come
   * back as the identity (flat 0, multiplier 1).
   */
  computeStats(): LoadoutStats {
    const totals = createEmptyLoadoutStats();
    for (const { definition, level } of this.equipped()) {
      for (const scaling of definition.stats) {
        const contribution = statContributionAtLevel(scaling, level);
        totals[scaling.stat].flat += contribution.flat;
        totals[scaling.stat].multiplier += contribution.percent;
      }
    }
    return totals;
  }

  /** Abilities whose unlock level has been reached by their owning item. */
  unlockedAbilities(): readonly AbilityUnlock[] {
    return this.equipped().flatMap(({ definition, level }) =>
      (definition.unlocks ?? []).filter((unlock) => unlock.level <= level)
    );
  }

  /** Whether any equipped item has unlocked the given ability. */
  hasAbility(ability: AbilityId): boolean {
    return this.unlockedAbilities().some(
      (unlock) => unlock.ability === ability
    );
  }
}
