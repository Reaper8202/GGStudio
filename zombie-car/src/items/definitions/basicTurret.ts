/** Starter roof turret. */
import type { ItemDefinition } from "../types";

export const BASIC_TURRET: ItemDefinition = {
  id: "basic-turret",
  name: "Basic Turret",
  description: "An automatic roof cannon with plenty of room to grow.",
  slot: "weapon",
  maxLevel: 10,
  basePrice: 80,
  priceGrowth: 1.5,
  stats: [
    { stat: "weaponDamage", percentPerLevel: 0.12 },
    { stat: "weaponFireRate", percentPerLevel: 0.08 },
    { stat: "weaponRange", percentPerLevel: 0.05, maxPercent: 0.45 },
  ],
};
