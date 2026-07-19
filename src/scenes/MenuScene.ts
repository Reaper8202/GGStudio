import Phaser from 'phaser';
import {
  GAME_HEIGHT,
  GAME_WIDTH,
  RegistryKeys,
  SceneKeys,
  TextureKeys,
} from '../config/constants';
import type { LifecycleGuard } from '../platform/LifecycleGuard';
import type { ScoreManager } from '../systems/ScoreManager';
import type { Sfx } from '../audio/Sfx';
import { textStyle } from '../ui/Overlay';

/**
 * 1-tap start: any pointer-down or Space/Enter launches the run — exactly
 * one click from portal load to gameplay.
 */
export class MenuScene extends Phaser.Scene {
  private starting = false;

  constructor() {
    super(SceneKeys.Menu);
  }

  create(): void {
    this.starting = false;
    const cx = GAME_WIDTH / 2;

    this.add.text(cx, GAME_HEIGHT * 0.24, 'LANE RUNNER', textStyle(84)).setOrigin(0.5);
    this.add
      .text(cx, GAME_HEIGHT * 0.36, 'dodge · jump · slide · collect', textStyle(26, '#8f9bc4'))
      .setOrigin(0.5);

    const score = this.registry.get(RegistryKeys.Score) as ScoreManager;
    if (score.highScore > 0) {
      this.add
        .text(cx, GAME_HEIGHT * 0.46, `BEST  ${score.highScore}`, textStyle(32, '#ffd83d'))
        .setOrigin(0.5);
    }

    const prompt = this.add
      .text(cx, GAME_HEIGHT * 0.62, 'TAP OR PRESS SPACE TO RUN', textStyle(34))
      .setOrigin(0.5);
    this.tweens.add({
      targets: prompt,
      alpha: 0.35,
      duration: 600,
      yoyo: true,
      repeat: -1,
    });

    this.add
      .text(
        cx,
        GAME_HEIGHT * 0.86,
        '← → move      ↑ / swipe up jump      ↓ / swipe down slide',
        textStyle(22, '#8f9bc4'),
      )
      .setOrigin(0.5);
    this.add.image(cx, GAME_HEIGHT * 0.74, TextureKeys.PlayerRun).setScale(1.2);

    this.input.on('pointerdown', () => this.startRun());
    this.input.keyboard?.on('keydown-SPACE', () => this.startRun());
    this.input.keyboard?.on('keydown-ENTER', () => this.startRun());
  }

  private startRun(): void {
    if (this.starting) return;
    this.starting = true;

    const sfx = this.registry.get(RegistryKeys.Sfx) as Sfx;
    sfx.unlock();
    sfx.click();

    const platform = this.registry.get(RegistryKeys.Platform) as LifecycleGuard;
    // Poki canonical flow: signal a commercial opportunity, then start the run.
    void platform.commercialBreak().then(() => {
      this.scene.start(SceneKeys.Play);
    });
  }
}
