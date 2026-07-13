/**
 * Single wiring entry point for Agent C's systems (Combat: zombies, waves,
 * weapons, effects). `main.ts` (Agent A) calls
 * `createCombatSystems(ctx, world, vehicle)` once, after the vehicle exists,
 * and registers the returned systems with the director/loop in order
 * zombies -> waves -> weapons -> effects, per docs/STATUS.md's integration
 * contract.
 */
import type { GameContext, VehicleApi, WorldApi } from "../types";
import { EffectsSystem } from "../effects/EffectsSystem";
import { ZombieSystem } from "./ZombieSystem";
import { WaveManager } from "../waves/WaveManager";
import { TurretSystem } from "../weapons/TurretSystem";

export { Zombie } from "./Zombie";
export { ZombieSystem } from "./ZombieSystem";
export { WaveManager } from "../waves/WaveManager";
export { TurretSystem } from "../weapons/TurretSystem";
export { EffectsSystem } from "../effects/EffectsSystem";

export interface CombatSystems {
  zombies: ZombieSystem;
  waves: WaveManager;
  weapons: TurretSystem;
  effects: EffectsSystem;
}

/**
 * Builds every combat system. Construction order (effects -> zombies ->
 * waves -> weapons) satisfies internal dependencies; the caller registers
 * the returned systems with the loop in the order zombies -> waves ->
 * weapons -> effects.
 */
export function createCombatSystems(
  ctx: GameContext,
  world: WorldApi,
  vehicle: VehicleApi
): CombatSystems {
  const effects = new EffectsSystem(ctx, vehicle);
  const zombies = new ZombieSystem(ctx, world, vehicle, effects);
  const waves = new WaveManager(ctx, zombies);
  const weapons = new TurretSystem(ctx, vehicle, zombies, effects);

  return { zombies, waves, weapons, effects };
}
