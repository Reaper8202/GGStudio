/**
 * Garage hotbar: the handful of block types the player keeps armed for
 * one-click placement. The inventory holds every block type they own; the
 * hotbar is the curated slice of it that fits on the build bar.
 */

import { PART_CATALOG } from './parts.ts';
import { SIMPLE_PART_IDS } from './tutorial.ts';

/** Block types the build bar can hold at once. */
export const HOTBAR_CAPACITY = 5;

function isPlaceableType(defId: string): boolean {
  return PART_CATALOG[defId] !== undefined;
}

/** Owned block types in catalog order — the bar a new garage starts with. */
export function seedHotbar(
  inventory: Readonly<Record<string, number>>,
): string[] {
  return SIMPLE_PART_IDS.filter((id) => (inventory[id] ?? 0) > 0).slice(
    0,
    HOTBAR_CAPACITY,
  );
}

/**
 * Normalizes a saved bar: unknown ids and duplicates drop out and the bar never
 * exceeds capacity. `undefined` means the player has never curated one, so it
 * is seeded from what they own; an empty array is a deliberate choice and is
 * left empty. Slots survive running out of stock — the block type stays
 * chosen, it just cannot be armed until more is bought.
 */
export function resolveHotbar(
  saved: readonly string[] | undefined,
  inventory: Readonly<Record<string, number>>,
): string[] {
  const source = saved ?? seedHotbar(inventory);
  const slots: string[] = [];
  for (const defId of source) {
    if (slots.length >= HOTBAR_CAPACITY) break;
    if (!isPlaceableType(defId) || slots.includes(defId)) continue;
    slots.push(defId);
  }
  return slots;
}

/**
 * Appends a block type to the first free slot. A full bar, a duplicate, or an
 * unknown id leaves the bar untouched, so callers can offer this after every
 * purchase without checking first.
 */
export function withHotbarSlot(
  hotbar: readonly string[],
  defId: string,
): string[] {
  if (
    hotbar.includes(defId) ||
    hotbar.length >= HOTBAR_CAPACITY ||
    !isPlaceableType(defId)
  ) {
    return [...hotbar];
  }
  return [...hotbar, defId];
}

/**
 * Inventory click: slotted types come off the bar, unslotted ones go on. A full
 * bar drops its most recent pick to make room, so a click always lands.
 */
export function toggleHotbarSlot(
  hotbar: readonly string[],
  defId: string,
): string[] {
  if (hotbar.includes(defId)) return hotbar.filter((id) => id !== defId);
  if (!isPlaceableType(defId)) return [...hotbar];
  return [...hotbar.slice(0, HOTBAR_CAPACITY - 1), defId];
}
