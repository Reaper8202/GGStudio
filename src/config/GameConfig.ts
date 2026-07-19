/**
 * All balancing tunables live here — balancing needs no code changes.
 * Speeds are px/s in the 720×1280-ish virtual space; distance is "meters"
 * (world pixels / pixelsPerMeter).
 */
export const GameConfig = {
  lanes: 3,
  laneSwitchMs: 120,
  baseScrollSpeed: 420, // px/s
  maxScrollSpeed: 1100,
  speedRampPerMeter: 0.35,
  jumpMs: 600,
  slideMs: 550,
  spawn: {
    baseGapMs: 1400,
    minGapMs: 650,
    /** ms shaved off the wave gap per meter travelled (density ramp). */
    gapRampPerMeter: 0.9,
    coinChance: 0.55,
  },
  reviveInvulnMs: 1500,
  seed: undefined as number | undefined, // set for deterministic runs/tests

  // -- scoring --------------------------------------------------------------
  pixelsPerMeter: 100,
  scorePerMeter: 10,
  scorePerCoin: 25,

  // -- feel -----------------------------------------------------------------
  /** Extra safety margin (ms) added per required lane switch when the
   *  spawner checks that a wave is reachable. */
  laneSwitchBufferMs: 260,
  /** Height of the jump arc, px (visual offset of the sprite). */
  jumpHeightPx: 120,
};

export type GameConfigT = typeof GameConfig;
