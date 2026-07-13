/**
 * Endless wave formulas (Agent C: Combat), exactly as specified in
 * `docs/BUILD_SPEC.md` — all as functions of the 1-based wave number.
 * `WaveManager` is the only consumer that drives `state.wave`.
 */

/** Total zombies assigned to a wave (spawned over time, not all at once). */
export function zombieCountForWave(wave: number): number {
  return 8 + wave * 3;
}

/** Hard cap on simultaneously-active (spawned, not-yet-dead) zombies. */
export function maxActiveZombiesForWave(wave: number): number {
  return Math.min(8 + wave, 30);
}

/** Multiplier applied to `BASE_ZOMBIE_STATS.health` for this wave. */
export function healthMultiplierForWave(wave: number): number {
  return 1 + (wave - 1) * 0.12;
}

/** Multiplier applied to `BASE_ZOMBIE_STATS.speed` for this wave, capped. */
export function speedMultiplierForWave(wave: number): number {
  return 1 + Math.min((wave - 1) * 0.025, 0.5);
}

/** Money awarded when the wave is fully cleared (on top of per-kill money). */
export function waveRewardForWave(wave: number): number {
  return 100 + wave * 25;
}

/** Seconds between individual zombie spawns while a wave is filling up. */
export const SPAWN_INTERVAL_SECONDS = 0.65;

/** Minimum distance (world units) a chosen spawn point must be from the
 *  vehicle so zombies never pop in right next to the player. */
export const MIN_SPAWN_DISTANCE_FROM_VEHICLE = 18;
