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

/** Zombies spawn as hordes: a whole group rises together around one shared
 *  spawn point, then nothing spawns until the next horde. Size ramps up
 *  slowly with the wave number. */
export function hordeSizeForWave(wave: number): number {
  const min = HORDE_SIZE_MIN;
  const max = Math.min(HORDE_SIZE_MIN + 1 + Math.floor(wave / 2), HORDE_SIZE_MAX);
  return min + Math.floor(Math.random() * (max - min + 1));
}

export const HORDE_SIZE_MIN = 3;
export const HORDE_SIZE_MAX = 8;

/** Seconds between horde spawns while a wave still has zombies to assign. */
export const HORDE_INTERVAL_SECONDS = 3.0;

/** Quick retry when a horde couldn't (fully) spawn — pool full or no valid
 *  spawn point — so the wave keeps filling without waiting a whole interval. */
export const HORDE_RETRY_SECONDS = 0.5;

/** Max distance (world units) each horde member scatters from the shared
 *  anchor spawn point, so the group reads as one clumped pack. */
export const HORDE_SCATTER_RADIUS = 2.5;

/** Minimum distance (world units) a chosen spawn point must be from the
 *  vehicle so zombies never pop in right next to the player. */
export const MIN_SPAWN_DISTANCE_FROM_VEHICLE = 18;
