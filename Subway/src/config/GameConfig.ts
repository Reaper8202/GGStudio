/**
 * All balancing tunables live here — balancing needs no code changes.
 * Units: world units (1 unit ≈ 1 m). The player stands at z = 0; obstacles
 * spawn far ahead at negative z and travel toward the camera (+z).
 */
export const GameConfig = {
  lanes: 3,
  laneSwitchMs: 120,
  baseScrollSpeed: 11, // units/s
  maxScrollSpeed: 28,
  speedRampPerMeter: 0.02,
  jumpMs: 650,
  slideMs: 600,
  spawn: {
    baseGapMs: 1400,
    minGapMs: 650,
    /** ms shaved off the wave gap per meter travelled (density ramp). */
    gapRampPerMeter: 0.9,
    coinChance: 0.55,
  },
  reviveInvulnMs: 1500,
  seed: undefined as number | undefined, // set for deterministic runs/tests

  // -- rideable platforms ---------------------------------------------------
  platform: {
    /** Length along z, world units. MUST stay below the minimum wave
     *  z-spacing (~13.6u) so a platform never overlaps the next wave. */
    length: 10,
    height: 1.1,
    /** Short drop back to ground level when running off the end. */
    fallMs: 150,
  },

  // -- scoring --------------------------------------------------------------
  unitsPerMeter: 1,
  scorePerMeter: 10,
  scorePerCoin: 25,

  // -- feel -----------------------------------------------------------------
  /** Extra safety margin (ms) added per required lane switch when the
   *  spawner checks that a wave is reachable. */
  laneSwitchBufferMs: 260,
  /** Peak height of the jump arc, world units. */
  jumpHeight: 1.7,
};

export type GameConfigT = typeof GameConfig;
