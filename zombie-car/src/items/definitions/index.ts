/**
 * Every item definition in the game, one file per item.
 *
 * To add a new item: create `src/items/definitions/<yourItem>.ts` and add
 * it to `ALL_ITEMS` below — nothing else is required for it to exist in
 * the game. See `docs/ITEMS.md` for the full guide.
 */
import type { ItemDefinition } from "../types";
import { BASIC_ENGINE } from "./basicEngine";
import { BASIC_TURRET } from "./basicTurret";
import { DEFAULT_WHEELS } from "./defaultWheels";

export { BASIC_ENGINE, BASIC_TURRET, DEFAULT_WHEELS };

export const ALL_ITEMS: readonly ItemDefinition[] = [
  BASIC_ENGINE,
  DEFAULT_WHEELS,
  BASIC_TURRET,
];

/** Items every new car starts with, equipped at level 1. */
export const STARTER_ITEM_IDS: readonly string[] = [
  DEFAULT_WHEELS.id,
  BASIC_TURRET.id,
  BASIC_ENGINE.id,
];
