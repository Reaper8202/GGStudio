/**
 * Catalog of every item that exists in the game. Definitions are validated
 * and deep-frozen on registration, so a bad item (duplicate id, unlock past
 * maxLevel, scaling that modifies nothing) fails loudly at boot instead of
 * silently misbehaving mid-run.
 */
import type { ItemDefinition, ItemSlot } from "./types";

export class ItemRegistry {
  private readonly definitions = new Map<string, ItemDefinition>();

  /** Add one item to the catalog. Throws on invalid or duplicate items. */
  register(definition: ItemDefinition): void {
    validateDefinition(definition);
    if (this.definitions.has(definition.id)) {
      throw new Error(`ItemRegistry: duplicate item id "${definition.id}"`);
    }
    this.definitions.set(definition.id, deepFreeze(definition));
  }

  registerAll(definitions: readonly ItemDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  /** Look up an item by id. Throws for unknown ids (always a code bug). */
  get(id: string): ItemDefinition {
    const definition = this.definitions.get(id);
    if (!definition) {
      throw new Error(`ItemRegistry: unknown item id "${id}"`);
    }
    return definition;
  }

  all(): readonly ItemDefinition[] {
    return [...this.definitions.values()];
  }

  inSlot(slot: ItemSlot): readonly ItemDefinition[] {
    return this.all().filter((definition) => definition.slot === slot);
  }
}

function validateDefinition(definition: ItemDefinition): void {
  const { id } = definition;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`ItemRegistry: item id "${id}" must be kebab-case`);
  }
  if (!Number.isInteger(definition.maxLevel) || definition.maxLevel < 1) {
    throw new Error(`ItemRegistry: "${id}" maxLevel must be an integer >= 1`);
  }
  if (definition.basePrice < 0 || definition.priceGrowth <= 0) {
    throw new Error(`ItemRegistry: "${id}" has invalid pricing`);
  }
  for (const scaling of definition.stats) {
    const growsPercent = scaling.basePercent || scaling.percentPerLevel;
    const growsFlat = scaling.baseFlat || scaling.flatPerLevel;
    if (!growsPercent && !growsFlat) {
      throw new Error(
        `ItemRegistry: "${id}" scaling for "${scaling.stat}" modifies nothing`
      );
    }
  }
  for (const unlock of definition.unlocks ?? []) {
    if (
      !Number.isInteger(unlock.level) ||
      unlock.level < 1 ||
      unlock.level > definition.maxLevel
    ) {
      throw new Error(
        `ItemRegistry: "${id}" unlock "${unlock.ability}" level ` +
          `${unlock.level} is outside 1..${definition.maxLevel}`
      );
    }
  }
}

function deepFreeze(definition: ItemDefinition): ItemDefinition {
  for (const scaling of definition.stats) Object.freeze(scaling);
  Object.freeze(definition.stats);
  for (const unlock of definition.unlocks ?? []) Object.freeze(unlock);
  if (definition.unlocks) Object.freeze(definition.unlocks);
  return Object.freeze(definition);
}
