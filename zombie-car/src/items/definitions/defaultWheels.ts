/** Starter wheel set. Pure handling stats, no ability unlocks. */
import type { ItemDefinition } from "../types";

export const DEFAULT_WHEELS: ItemDefinition = {
  id: "default-wheels",
  name: "Default Wheels",
  description: "Worn road tires. Better rubber means better cornering.",
  slot: "wheels",
  maxLevel: 8,
  basePrice: 60,
  priceGrowth: 1.4,
  stats: [
    { stat: "grip", percentPerLevel: 0.06 },
    { stat: "topSpeed", percentPerLevel: 0.02 },
  ],
};
