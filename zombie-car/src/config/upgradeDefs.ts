/**
 * The seven run-scoped upgrades purchasable in the Upgrade phase panel.
 * Owned by Agent D (UI & Progression), per `docs/STATUS.md`.
 *
 * Every `apply` RECOMPUTES its modifier from `newLevel` (idempotent —
 * re-applying the same level is always safe) and touches ONLY
 * `state.modifiers`, per the frozen `UpgradeDefinition` contract in
 * `src/types/index.ts`. `effectText(level)` is a pure function of level
 * (level 0 = base/no bonus) used by the upgrade panel for both the
 * "current effect" and "next effect" readouts.
 */
import type { GameState, UpgradeDefinition } from "../types";

/** Caps a linearly-scaling bonus at `max` (mirrors the spec's min()/max() clamps). */
function capAt(value: number, max: number): number {
  return Math.min(value, max);
}

function reinforcedChassisResistance(level: number): number {
  return capAt(0.08 * level, 0.6);
}

function antiSwarmMultiplier(level: number): number {
  return Math.max(1 - 0.13 * level, 0.35);
}

export const upgradeDefinitions: UpgradeDefinition[] = [
  {
    id: "weaponDamage",
    name: "Weapon Damage",
    description: "Overcharge the turret's cannon for harder-hitting shots.",
    basePrice: 80,
    priceGrowth: 1.5,
    apply: (state: GameState, newLevel: number): void => {
      state.modifiers.weaponDamageMultiplier = 1 + 0.25 * newLevel;
    },
    effectText: (level: number): string => `+${Math.round(level * 25)}% damage`,
  },
  {
    id: "fireRate",
    name: "Fire Rate",
    description: "Tune the turret's feed mechanism to fire faster.",
    basePrice: 90,
    priceGrowth: 1.5,
    apply: (state: GameState, newLevel: number): void => {
      state.modifiers.fireRateMultiplier = 1 + 0.2 * newLevel;
    },
    effectText: (level: number): string => `+${Math.round(level * 20)}% fire rate`,
  },
  {
    id: "weaponRange",
    name: "Weapon Range",
    description: "Upgrade targeting optics to engage zombies further out.",
    basePrice: 70,
    priceGrowth: 1.45,
    maximumLevel: 6,
    apply: (state: GameState, newLevel: number): void => {
      state.modifiers.weaponRangeMultiplier = 1 + 0.15 * newLevel;
    },
    effectText: (level: number): string => `+${Math.round(level * 15)}% range`,
  },
  {
    id: "vehicleArmor",
    name: "Vehicle Armor",
    description: "Bolt on extra plating to raise maximum health.",
    basePrice: 100,
    priceGrowth: 1.4,
    apply: (state: GameState, newLevel: number): void => {
      state.modifiers.maxHealthBonus = 25 * newLevel;
    },
    effectText: (level: number): string => `+${25 * level} max HP`,
  },
  {
    id: "enginePower",
    name: "Engine Power",
    description: "Tune the engine for stronger acceleration and top speed.",
    basePrice: 85,
    priceGrowth: 1.45,
    maximumLevel: 8,
    apply: (state: GameState, newLevel: number): void => {
      state.modifiers.enginePowerMultiplier = 1 + 0.12 * newLevel;
    },
    effectText: (level: number): string => `+${Math.round(level * 12)}% engine power`,
  },
  {
    id: "reinforcedChassis",
    name: "Reinforced Chassis",
    description: "Reinforce the frame to shrug off incoming damage.",
    basePrice: 110,
    priceGrowth: 1.5,
    maximumLevel: 7,
    apply: (state: GameState, newLevel: number): void => {
      state.modifiers.damageResistance = reinforcedChassisResistance(newLevel);
    },
    effectText: (level: number): string =>
      `-${Math.round(reinforcedChassisResistance(level) * 100)}% damage taken`,
  },
  {
    id: "antiSwarm",
    name: "Anti-Swarm",
    description: "Wider bumpers and grippier tires resist zombie swarms.",
    basePrice: 100,
    priceGrowth: 1.5,
    maximumLevel: 5,
    apply: (state: GameState, newLevel: number): void => {
      state.modifiers.contactPenaltyMultiplier = antiSwarmMultiplier(newLevel);
    },
    effectText: (level: number): string =>
      `-${Math.round((1 - antiSwarmMultiplier(level)) * 100)}% swarm penalty`,
  },
];
