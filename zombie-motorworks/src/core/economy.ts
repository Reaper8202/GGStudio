import { getPartDef } from './parts.ts';
import { STARTER_UNLOCKS } from './profile.ts';
import { getEffectiveDef, upgradePrice } from './upgrades.ts';
import type { PartDefinition, PlacedPart } from './types.ts';

/** Persistent run progress. Spendable money belongs only to PlayerProfile. */
export interface RunState {
  wave: number;
}

function placedLevel(placed: PlacedPart): number {
  const configuredLevel = placed.config.level ?? 1;
  if (!Number.isFinite(configuredLevel)) return 1;
  return Math.max(1, Math.floor(configuredLevel));
}

/** Total purchase price already paid for a placed part and its upgrades. */
export function partInvestment(placed: PlacedPart): number {
  const def = getEffectiveDef(placed);
  if (def.upgrade === undefined) return def.cost;

  let investment = def.cost;
  for (let level = 2; level <= placedLevel(placed); level += 1) {
    const price = upgradePrice(def, level);
    if (price !== undefined) investment += price;
  }
  return investment;
}

export function sellRefund(placed: PlacedPart): number {
  return Math.floor(partInvestment(placed) * 0.5);
}

export function placeCost(defId: string): number {
  return getPartDef(defId).cost;
}

export function nextUpgrade(
  placed: PlacedPart,
): { targetLevel: number; price: number } | null {
  const def: PartDefinition = getEffectiveDef(placed);
  if (def.upgrade === undefined) return null;

  const currentLevel = Math.min(def.upgrade.maxLevel, placedLevel(placed));
  if (currentLevel >= def.upgrade.maxLevel) return null;

  const targetLevel = currentLevel + 1;
  const price = upgradePrice(def, targetLevel);
  return price === undefined ? null : { targetLevel, price };
}

export function unlockCost(defId: string): number {
  return getPartDef(defId).unlockCost ?? 0;
}

export function isStarterUnlocked(defId: string): boolean {
  return STARTER_UNLOCKS.includes(defId as (typeof STARTER_UNLOCKS)[number]);
}

/** Returns true only for non-negative safe-integer balances and prices. */
export function canAfford(money: number, price: number): boolean {
  return (
    Number.isSafeInteger(money) &&
    Number.isSafeInteger(price) &&
    money >= 0 &&
    price >= 0 &&
    money >= price
  );
}
