import { selectProvider } from './platform/detect';
import { ScoreManager } from './systems/ScoreManager';
import { Sfx } from './audio/Sfx';
import { Game } from './game/Game';

async function boot(): Promise<void> {
  // Platform first: the provider (Poki/CrazyGames/local) must be initialized
  // before any game code runs. Never throws — worst case we run as `local`.
  const platform = selectProvider();
  await platform.init();

  const sfx = new Sfx();
  const score = new ScoreManager(platform);
  await score.init();

  const game = new Game(platform, score, sfx);

  // Ad gate: for the duration of ANY ad — audio muted, input frozen, and the
  // whole render loop frozen so no game logic runs (portal QA requirement).
  platform.onAdStart = () => {
    sfx.setMuted(true);
    game.setAdPaused(true);
  };
  platform.onAdEnd = () => {
    game.setAdPaused(false);
    sfx.setMuted(false);
  };

  // Everything is procedural — nothing to fetch. Keep the SDK loading
  // handshake so a future real asset load slots in here.
  platform.loadingProgress(0);
  platform.loadingProgress(1);
  platform.loadingFinished();
}

void boot();
