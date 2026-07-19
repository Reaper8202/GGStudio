import Phaser from 'phaser';
import { Depths, GAME_WIDTH, TextureKeys } from '../config/constants';

const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif';

/** In-canvas HUD: score, coins, distance, best. No DOM, no webfonts. */
export class Hud {
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly bestText: Phaser.GameObjects.Text;
  private readonly coinText: Phaser.GameObjects.Text;
  private readonly distText: Phaser.GameObjects.Text;
  private lastScore = -1;
  private lastCoins = -1;
  private lastDist = -1;

  constructor(scene: Phaser.Scene, best: number) {
    const style = (size: number, color = '#f2f5ff'): Phaser.Types.GameObjects.Text.TextStyle => ({
      fontFamily: FONT,
      fontSize: `${size}px`,
      fontStyle: 'bold',
      color,
    });

    this.scoreText = scene.add
      .text(24, 16, '0', style(40))
      .setDepth(Depths.Hud)
      .setShadow(0, 2, '#000000', 6);
    this.bestText = scene.add
      .text(24, 62, `BEST ${best}`, style(20, '#8f9bc4'))
      .setDepth(Depths.Hud);

    scene.add
      .image(GAME_WIDTH - 120, 36, TextureKeys.Coin)
      .setDepth(Depths.Hud)
      .setScale(0.9);
    this.coinText = scene.add
      .text(GAME_WIDTH - 96, 16, '0', style(36, '#ffd83d'))
      .setDepth(Depths.Hud)
      .setShadow(0, 2, '#000000', 6);

    this.distText = scene.add
      .text(GAME_WIDTH / 2, 20, '0m', style(22, '#8f9bc4'))
      .setOrigin(0.5, 0)
      .setDepth(Depths.Hud);
  }

  update(score: number, coins: number, meters: number): void {
    // setText only on change — no per-frame text re-layout or GC churn.
    if (score !== this.lastScore) {
      this.lastScore = score;
      this.scoreText.setText(String(score));
    }
    if (coins !== this.lastCoins) {
      this.lastCoins = coins;
      this.coinText.setText(String(coins));
    }
    const m = Math.floor(meters);
    if (m !== this.lastDist) {
      this.lastDist = m;
      this.distText.setText(`${m}m`);
    }
  }

  setBest(best: number): void {
    this.bestText.setText(`BEST ${best}`);
  }
}
