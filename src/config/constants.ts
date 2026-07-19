/** Virtual resolution (16:9). Scale.FIT letterboxes to the real viewport. */
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export const SceneKeys = {
  Boot: 'Boot',
  Preload: 'Preload',
  Menu: 'Menu',
  Play: 'Play',
  GameOver: 'GameOver',
} as const;

export const TextureKeys = {
  PlayerRun: 'tex-player-run',
  PlayerJump: 'tex-player-jump',
  PlayerSlide: 'tex-player-slide',
  Shadow: 'tex-shadow',
  ObstacleLow: 'tex-obstacle-low',
  ObstacleHigh: 'tex-obstacle-high',
  ObstacleBlock: 'tex-obstacle-block',
  Coin: 'tex-coin',
  Road: 'tex-road',
  Pixel: 'tex-pixel',
} as const;

export const Depths = {
  Road: 0,
  Shadow: 5,
  Entities: 10, // + y/1000 for soft y-sorting
  Player: 20,
  Hud: 100,
  Overlay: 110,
} as const;

export const SaveKeys = {
  HighScore: 'lane-runner.highscore',
} as const;

export const RegistryKeys = {
  Platform: 'platform',
  Sfx: 'sfx',
  Score: 'score',
  HintShown: 'hint-shown',
} as const;

/** Input intents emitted by InputController (keyboard and swipe unified). */
export const Intent = {
  Left: 'intent-left',
  Right: 'intent-right',
  Jump: 'intent-jump',
  Slide: 'intent-slide',
} as const;
export type IntentT = (typeof Intent)[keyof typeof Intent];

export const Colors = {
  bg: 0x0b0e1a,
  road: 0x151a2e,
  roadEdge: 0x232a4a,
  laneLine: 0x2e3760,
  player: 0x35e0b8,
  playerDark: 0x1a9e80,
  obstacleLow: 0xff5c7a,
  obstacleHigh: 0xffb02e,
  obstacleBlock: 0x8a5cff,
  coin: 0xffd83d,
  coinDark: 0xc9a41f,
  text: 0xf2f5ff,
  shadow: 0x000000,
} as const;
