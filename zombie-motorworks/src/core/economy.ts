import type { BiomeId } from './biomes.ts';
import { getPartDef } from './parts.ts';
import { STARTER_UNLOCKS } from './profile.ts';
import { getEffectiveDef, upgradePrice } from './upgrades.ts';
import type { PartDefinition, PlacedPart } from './types.ts';

/** Persistent run progress. Spendable money belongs only to PlayerProfile. */
export interface RunState {
  wave: number;
  partHp?: Record<string, number>;
  biomeId?: BiomeId;
  seed?: number;
  /** Arena seconds accumulated across every wave of the run so far. */
  elapsedSeconds?: number;
}

/** Cost to restore one part to its effective maximum HP. */
export function partRepairCost(
  baseCost: number,
  currentHp: number,
  maxHp: number,
): number {
  if (maxHp <= 0 || currentHp >= maxHp || baseCost <= 0) return 0;
  const missingFraction = Math.min(
    1,
    Math.max(0, (maxHp - currentHp) / maxHp),
  );
  return Math.ceil(baseCost * missingFraction * 0.5);
}

export interface RepairLineItem {
  id: string;
  cost: number;
  missingHp: number;
}

export interface RepairPlan {
  items: RepairLineItem[];
  totalCost: number;
  integrityPct: number;
}

/** Summarize current vehicle integrity and all paid repair line items. */
export function repairPlan(
  parts: {
    id: string;
    baseCost: number;
    currentHp: number;
    maxHp: number;
  }[],
): RepairPlan {
  const items: RepairLineItem[] = [];
  let totalCost = 0;
  let totalHp = 0;
  let totalMaxHp = 0;

  for (const part of parts) {
    totalHp += Math.min(part.currentHp, part.maxHp);
    totalMaxHp += part.maxHp;

    const missingHp = Math.max(0, part.maxHp - part.currentHp);
    const cost = partRepairCost(
      part.baseCost,
      part.currentHp,
      part.maxHp,
    );
    if (cost <= 0 || missingHp <= 0) continue;
    items.push({ id: part.id, cost, missingHp });
    totalCost += cost;
  }

  return {
    items,
    totalCost,
    integrityPct: totalMaxHp > 0 ? (100 * totalHp) / totalMaxHp : 0,
  };
}

/** Preserve a part's HP percentage when its effective maximum HP changes. */
export function scaledHpOnUpgrade(
  currentHp: number,
  oldMaxHp: number,
  newMaxHp: number,
): number {
  if (oldMaxHp <= 0) return newMaxHp;
  const hpFraction = Math.min(1, Math.max(0, currentHp / oldMaxHp));
  return hpFraction * newMaxHp;
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

/**
 * Money sunk into a placed part's unlocks, above the base block price.
 *
 * Inventory stock is counted per block type and carries no level, so pulling a
 * part off the rig hands back a base block. This is what has to be refunded in
 * full for that move to cost the player nothing — unlike a sale, they keep the
 * block, so the unlocks are un-bought rather than sold at a loss.
 */
export function unlockInvestment(placed: PlacedPart): number {
  return Math.max(0, partInvestment(placed) - getEffectiveDef(placed).cost);
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
