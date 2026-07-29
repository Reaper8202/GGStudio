/** Input intents emitted by InputController (keyboard and swipe unified). */
export const Intent = {
  Left: 'left',
  Right: 'right',
  Jump: 'jump',
  Slide: 'slide',
} as const;
export type IntentT = (typeof Intent)[keyof typeof Intent];

export const SaveKeys = {
  /** Same key as the 2D version — existing high scores carry over. */
  HighScore: 'lane-runner.highscore',
  CrewColor: 'lane-runner.crewcolor',
} as const;

/** Selectable crewmate colors (cosmetic). Crimson is reserved for impostors. */
export const CREW_COLORS = [
  0x35e0b8, // teal (default)
  0x4da6ff, // blue
  0xff8ac2, // pink
  0xff9d3d, // orange
  0xa6e34d, // lime
  0xf2f5ff, // white
] as const;

/** World palette (Three.js hex colors). */
export const Palette = {
  bg: 0x0b0e1a,
  fog: 0x0b0e1a,
  floor: 0x1a2036,
  floorLine: 0x2e3760,
  laneGlow: 0x35e0b8,
  wall: 0x151a2e,
  wallGlow: 0x24b4ff,
  crew: 0x35e0b8,
  crewDark: 0x1a9e80,
  visor: 0x9fd8ff,
  imposter: 0x9c1535,
  imposterDark: 0x520a1d,
  imposterEye: 0xff3355,
  vent: 0x6b7699,
  ventDark: 0x3a4260,
  gate: 0xffb02e,
  gateBeam: 0xffd83d,
  coin: 0xffd83d,
  star: 0xbfd0ff,
} as const;

/**
 * Environment themes — the corridor look cycles with distance (applied by
 * Game via Track.setTheme; the choice is a pure function of distance, so
 * seeded runs stay deterministic).
 */
export const ThemePalettes = {
  /** Default space-station interior (matches Palette above). */
  station: {
    fog: 0x0b0e1a,
    floor: 0x1a2036,
    floorLine: 0x2e3760,
    laneGlow: 0x35e0b8,
    wall: 0x151a2e,
    wallGlow: 0x24b4ff,
    seam: 0x151a2e,
    /** 0..1 — how much of the wall above the guard rail is transparent. */
    wallOpenness: 0,
  },
  /** Hull exterior: low guard rails, open to the stars. */
  hull: {
    fog: 0x05070f,
    floor: 0x121729,
    floorLine: 0x232c4d,
    laneGlow: 0x24b4ff,
    wall: 0x0e1322,
    wallGlow: 0x8fb8ff,
    seam: 0x0b0e1a,
    wallOpenness: 0.7,
  },
  /** Reactor section: warm, hazard-striped, pulsing glow. */
  reactor: {
    fog: 0x190b0f,
    floor: 0x291420,
    floorLine: 0x51263a,
    laneGlow: 0xff9d3d,
    wall: 0x231019,
    wallGlow: 0xff5c3d,
    seam: 0x190b0f,
    wallOpenness: 0,
  },
} as const;
export type ThemeName = keyof typeof ThemePalettes;

export const THEME_CYCLE: readonly ThemeName[] = ['station', 'hull', 'reactor'];
export const THEME_SEGMENT_METERS = 400;
