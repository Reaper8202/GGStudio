import { GameConfig } from '../config/GameConfig';
import { SaveKeys } from '../config/constants';
import type { PlatformSDK } from '../platform/PlatformSDK';

/** score = f(distance) + coins; high score persists via the platform SDK. */
export class ScoreManager {
  distanceUnits = 0;
  coins = 0;
  highScore = 0;
  private savedHigh = 0;

  constructor(private readonly platform: PlatformSDK) {}

  /** Load persisted high score (await before showing menus/HUD). */
  async init(): Promise<void> {
    const raw = await this.platform.load(SaveKeys.HighScore);
    const parsed = raw === null ? NaN : parseInt(raw, 10);
    this.highScore = Number.isFinite(parsed) ? parsed : 0;
    this.savedHigh = this.highScore;
  }

  get meters(): number {
    return this.distanceUnits / GameConfig.unitsPerMeter;
  }

  get score(): number {
    return (
      Math.floor(this.meters * GameConfig.scorePerMeter) +
      this.coins * GameConfig.scorePerCoin
    );
  }

  addDistance(units: number): void {
    this.distanceUnits += units;
  }

  collectCoin(): void {
    this.coins++;
  }

  resetRun(): void {
    this.distanceUnits = 0;
    this.coins = 0;
  }

  /** Call on game over; persists only on improvement. */
  async commit(): Promise<boolean> {
    const s = this.score;
    if (s <= this.highScore) return false;
    this.highScore = s;
    if (s > this.savedHigh) {
      this.savedHigh = s;
      await this.platform.save(SaveKeys.HighScore, String(s));
    }
    return true;
  }
}
