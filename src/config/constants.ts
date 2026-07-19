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
} as const;

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
