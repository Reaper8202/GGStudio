/**
 * Central tuning constants for the core loop / world (Agent A: Foundation
 * & World). All values here are read-only at runtime — systems read them
 * directly instead of hardcoding numbers inline.
 *
 * Owned by Agent A (`docs/STATUS.md` ownership table). Other agents' tuning
 * lives in their own config files (`vehicleTuning.ts`, `zombieConfig.ts`,
 * `waveConfig.ts`, `weaponConfig.ts`, `upgradeDefs.ts`, `economyConfig.ts`).
 */

/** Seconds shown/ticked down before each wave begins (emits 3, 2, 1). */
export const countdownSeconds = 3;

/** Fixed physics/simulation step, in seconds (60 Hz). */
export const fixedDt = 1 / 60;

/**
 * Upper bound applied to a single rendered frame's delta time, in seconds.
 * Prevents a spiral-of-death catch-up burst after a stall (e.g. tab
 * throttling, GC pause, breakpoint).
 */
export const maxFrameDt = 0.1;

/** Upper bound applied to `window.devicePixelRatio` for the renderer. */
export const devicePixelRatioCap = 2;

/** Money the player starts a run with (and returns to on restart). */
export const startingMoney = 200;

/** Construction-site world footprint and zombie spawn ring. */
export const world = {
  /** Half the side length of the (square) playable area, in world units. */
  halfSize: 35,
  /** Perimeter wall height, in world units. */
  wallHeight: 4,
  /** Perimeter wall thickness, in world units. */
  wallThickness: 1,
  /** Radius (from map center) of the zombie spawn-point ring. */
  spawnRadius: 32,
  /** Number of spawn points distributed evenly around the ring. */
  spawnPointCount: 14,
} as const;

/** Grouped export for convenience (`GameConfig.world.halfSize`, etc). */
export const GameConfig = {
  countdownSeconds,
  fixedDt,
  maxFrameDt,
  devicePixelRatioCap,
  startingMoney,
  world,
} as const;
