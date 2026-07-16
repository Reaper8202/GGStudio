/** Starter engine. Level 7 unlocks the boost ability. */
import type { ItemDefinition } from "../types";

export const BASIC_ENGINE: ItemDefinition = {
  id: "basic-engine",
  name: "Basic Engine",
  description: "A salvage-yard block. Slow to start, easy to tune.",
  slot: "engine",
  maxLevel: 10,
  basePrice: 85,
  priceGrowth: 1.45,
  stats: [
    { stat: "enginePower", percentPerLevel: 0.1 },
    { stat: "topSpeed", percentPerLevel: 0.04, maxPercent: 0.32 },
  ],
  unlocks: [
    {
      level: 7,
      ability: "boost",
      name: "Nitro Boost",
      description: "Dump nitrous for a short burst of extreme acceleration.",
    },
  ],
};
