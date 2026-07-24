import { GameConfig } from '../config/GameConfig';

/**
 * Maps distance travelled (meters) to scroll speed, wave gap and a 0..1
 * difficulty scalar. Pure functions of distance → deterministic under a seed.
 */
export class DifficultyDirector {
  speedAt(meters: number): number {
    return Math.min(
      GameConfig.maxScrollSpeed,
      GameConfig.baseScrollSpeed + GameConfig.speedRampPerMeter * meters,
    );
  }

  gapMsAt(meters: number): number {
    return Math.max(
      GameConfig.spawn.minGapMs,
      GameConfig.spawn.baseGapMs - GameConfig.spawn.gapRampPerMeter * meters,
    );
  }

  /** 0 at start → 1 at ~800 m; drives obstacle pattern weights. */
  difficulty01(meters: number): number {
    return Math.min(1, meters / 800);
  }
}
