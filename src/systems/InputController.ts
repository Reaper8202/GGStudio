import Phaser from 'phaser';
import { Intent, type IntentT } from '../config/constants';

const SWIPE_THRESHOLD = 28; // px in screen space

/**
 * Unifies keyboard (← → ↑/Space ↓) and touch swipes into intent events.
 * Gameplay listens to intents only — it never reads raw input, so desktop
 * and mobile behave identically. `enabled=false` freezes input during ads.
 */
export class InputController extends Phaser.Events.EventEmitter {
  enabled = true;

  /** Fired on ANY accepted input — PlayScene uses it for gameplayStart. */
  static readonly ANY = 'intent-any';

  private swipeStart: { x: number; y: number } | null = null;

  constructor(scene: Phaser.Scene) {
    super();

    const kb = scene.input.keyboard;
    if (kb) {
      // preventDefault on arrows/space so the host page never scrolls.
      kb.addCapture([
        Phaser.Input.Keyboard.KeyCodes.LEFT,
        Phaser.Input.Keyboard.KeyCodes.RIGHT,
        Phaser.Input.Keyboard.KeyCodes.UP,
        Phaser.Input.Keyboard.KeyCodes.DOWN,
        Phaser.Input.Keyboard.KeyCodes.SPACE,
      ]);
      kb.on('keydown-LEFT', () => this.fire(Intent.Left));
      kb.on('keydown-RIGHT', () => this.fire(Intent.Right));
      kb.on('keydown-UP', () => this.fire(Intent.Jump));
      kb.on('keydown-SPACE', () => this.fire(Intent.Jump));
      kb.on('keydown-DOWN', () => this.fire(Intent.Slide));
    }

    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.swipeStart = { x: p.x, y: p.y };
    });
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!this.swipeStart) return;
      const dx = p.x - this.swipeStart.x;
      const dy = p.y - this.swipeStart.y;
      this.swipeStart = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return; // tap
      if (Math.abs(dx) > Math.abs(dy)) {
        this.fire(dx > 0 ? Intent.Right : Intent.Left);
      } else {
        this.fire(dy > 0 ? Intent.Slide : Intent.Jump);
      }
    });
  }

  private fire(intent: IntentT): void {
    if (!this.enabled) return;
    this.emit(InputController.ANY, intent);
    this.emit(intent);
  }
}
