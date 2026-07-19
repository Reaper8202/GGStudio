import Phaser from 'phaser';
import { Colors, GAME_HEIGHT, GAME_WIDTH, RegistryKeys } from './config/constants';
import { selectProvider } from './platform/detect';
import { ScoreManager } from './systems/ScoreManager';
import { Sfx } from './audio/Sfx';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { MenuScene } from './scenes/MenuScene';
import { PlayScene } from './scenes/PlayScene';
import { GameOverScene } from './scenes/GameOverScene';

async function boot(): Promise<void> {
  // Platform first: the provider (Poki/CrazyGames/local) must be initialized
  // before any game code runs. Never throws — worst case we run as `local`.
  const platform = selectProvider();
  await platform.init();

  const sfx = new Sfx();
  const score = new ScoreManager(platform);
  await score.init();

  const game = new Phaser.Game({
    type: Phaser.AUTO, // WebGL, Canvas fallback
    parent: 'game',
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: Colors.bg,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, PreloadScene, MenuScene, PlayScene, GameOverScene],
  });

  // Dev-only hook for acceptance tests (never present on a real portal).
  if (!platform.isReal) {
    (globalThis as unknown as Record<string, unknown>).__game = game;
  }

  game.registry.set(RegistryKeys.Platform, platform);
  game.registry.set(RegistryKeys.Sfx, sfx);
  game.registry.set(RegistryKeys.Score, score);

  // Ad gate: for the duration of ANY ad — audio muted, input frozen, and the
  // game loop asleep so no game logic runs (portal QA requirement).
  const loop = game.loop as unknown as { sleep?: () => void; wake?: () => void };
  platform.onAdStart = () => {
    sfx.setMuted(true);
    game.input.enabled = false;
    loop.sleep?.();
  };
  platform.onAdEnd = () => {
    loop.wake?.();
    game.input.enabled = true;
    sfx.setMuted(false);
  };
}

void boot();
