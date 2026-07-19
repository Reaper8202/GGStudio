import Phaser from 'phaser';
import {
  GAME_HEIGHT,
  GAME_WIDTH,
  RegistryKeys,
  SceneKeys,
} from '../config/constants';
import type { LifecycleGuard } from '../platform/LifecycleGuard';
import type { ScoreManager } from '../systems/ScoreManager';
import type { Sfx } from '../audio/Sfx';
import type { PlayScene } from './PlayScene';
import { addButton, addDim, textStyle, type ButtonHandle } from '../ui/Overlay';

interface GameOverData {
  canRevive: boolean;
  newBest: boolean;
}

/**
 * Overlay on top of the paused PlayScene: score recap, 1-tap restart, and a
 * once-per-run rewarded revive that resumes the same run.
 */
export class GameOverScene extends Phaser.Scene {
  private busy = false;

  constructor() {
    super(SceneKeys.GameOver);
  }

  create(data: GameOverData): void {
    this.busy = false;
    const platform = this.registry.get(RegistryKeys.Platform) as LifecycleGuard;
    const score = this.registry.get(RegistryKeys.Score) as ScoreManager;
    const sfx = this.registry.get(RegistryKeys.Sfx) as Sfx;
    const cx = GAME_WIDTH / 2;

    addDim(this, 0.6);
    this.add.text(cx, GAME_HEIGHT * 0.2, 'GAME OVER', textStyle(72)).setOrigin(0.5);
    this.add
      .text(cx, GAME_HEIGHT * 0.34, String(score.score), textStyle(60, '#ffd83d'))
      .setOrigin(0.5);
    this.add
      .text(
        cx,
        GAME_HEIGHT * 0.43,
        data.newBest
          ? 'NEW BEST!'
          : `BEST ${score.highScore}   ·   ${score.coins} coins`,
        textStyle(26, data.newBest ? '#35e0b8' : '#8f9bc4'),
      )
      .setOrigin(0.5);

    let reviveBtn: ButtonHandle | null = null;
    let restartBtn: ButtonHandle;

    if (data.canRevive) {
      reviveBtn = addButton(
        this,
        cx,
        GAME_HEIGHT * 0.58,
        360,
        72,
        '▶  REVIVE (watch ad)',
        0x35e0b8,
        () => {
          if (this.busy) return;
          this.busy = true;
          sfx.click();
          void platform.rewardedBreak().then((rewarded) => {
            if (rewarded) {
              const play = this.scene.get(SceneKeys.Play) as PlayScene;
              this.scene.stop();
              play.revive();
            } else {
              reviveBtn?.setLabel('AD NOT AVAILABLE');
              reviveBtn?.disable();
              this.busy = false;
            }
          });
        },
      );
    }

    restartBtn = addButton(
      this,
      cx,
      GAME_HEIGHT * (data.canRevive ? 0.72 : 0.6),
      360,
      72,
      'RUN AGAIN',
      0xf2f5ff,
      () => this.restart(platform, sfx, restartBtn, reviveBtn),
    );

    this.input.keyboard?.on('keydown-SPACE', () =>
      this.restart(platform, sfx, restartBtn, reviveBtn),
    );
    this.input.keyboard?.on('keydown-ENTER', () =>
      this.restart(platform, sfx, restartBtn, reviveBtn),
    );
  }

  private restart(
    platform: LifecycleGuard,
    sfx: Sfx,
    restartBtn: ButtonHandle,
    reviveBtn: ButtonHandle | null,
  ): void {
    if (this.busy) return;
    this.busy = true;
    sfx.click();
    restartBtn.disable();
    reviveBtn?.disable();
    // Interstitial opportunity between runs, then a fresh run.
    void platform.commercialBreak().then(() => {
      const play = this.scene.get(SceneKeys.Play) as PlayScene;
      this.scene.stop();
      play.scene.restart();
    });
  }
}
