/**
 * Public API of the item system. See `docs/ITEMS.md` for how to add items.
 */
export * from "./types";
export { ItemRegistry } from "./ItemRegistry";
export { CarLoadout } from "./CarLoadout";
export {
  ALL_ITEMS,
  STARTER_ITEM_IDS,
  BASIC_ENGINE,
  BASIC_TURRET,
  DEFAULT_WHEELS,
} from "./definitions";

import { CarLoadout } from "./CarLoadout";
import { ItemRegistry } from "./ItemRegistry";
import { ALL_ITEMS, STARTER_ITEM_IDS } from "./definitions";

/**
 * Build the item catalog and a car loadout with the starter items
 * (default wheels, basic turret, basic engine) equipped at level 1.
 */
export function createItemSystem(): {
  registry: ItemRegistry;
  loadout: CarLoadout;
} {
  const registry = new ItemRegistry();
  registry.registerAll(ALL_ITEMS);
  const loadout = new CarLoadout(registry);
  for (const id of STARTER_ITEM_IDS) loadout.equip(id);
  return { registry, loadout };
}
