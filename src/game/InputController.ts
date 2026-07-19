import { Intent, type IntentT } from '../config/constants';
import { Emitter } from './Emitter';

const SWIPE_THRESHOLD = 28; // px in screen space

/**
 * Unifies keyboard (← → ↑/Space ↓) and touch swipes into intent events —
 * gameplay never reads raw input, so desktop and mobile behave identically.
 * `enabled=false` freezes gameplay input (ads, pause, menus).
 * preventDefault on arrows/space keeps the host page from scrolling.
 */
export class InputController extends Emitter {
  enabled = false;

  /** Fired on ANY accepted input (used to unlock audio). */
  static readonly ANY = 'any';

  private swipeStart: { x: number; y: number } | null = null;

  /**
   * Fire the swipe the moment the finger crosses the threshold (pointermove)
   * instead of waiting for lift-off — that finger-travel + lift time is the
   * bulk of perceived input latency on phones. One intent per gesture.
   */
  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.swipeStart) return;
    const dx = e.clientX - this.swipeStart.x;
    const dy = e.clientY - this.swipeStart.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;
    this.swipeStart = null; // gesture consumed
    if (Math.abs(dx) > Math.abs(dy)) {
      this.fire(dx > 0 ? Intent.Right : Intent.Left);
    } else {
      this.fire(dy > 0 ? Intent.Slide : Intent.Jump);
    }
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const map: Record<string, IntentT | undefined> = {
      ArrowLeft: Intent.Left,
      ArrowRight: Intent.Right,
      ArrowUp: Intent.Jump,
      Space: Intent.Jump,
      ArrowDown: Intent.Slide,
    };
    const intent = map[e.code];
    if (intent === undefined) return;
    e.preventDefault(); // page must never scroll on arrows/space when embedded
    this.fire(intent);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.swipeStart = { x: e.clientX, y: e.clientY };
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    // Fallback for gestures that ended without crossing the threshold
    // mid-move (e.g. very fast flicks where only down/up were delivered).
    if (!this.swipeStart) return;
    const dx = e.clientX - this.swipeStart.x;
    const dy = e.clientY - this.swipeStart.y;
    this.swipeStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return; // tap
    if (Math.abs(dx) > Math.abs(dy)) {
      this.fire(dx > 0 ? Intent.Right : Intent.Left);
    } else {
      this.fire(dy > 0 ? Intent.Slide : Intent.Jump);
    }
  };

  constructor() {
    super();
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  private fire(intent: IntentT): void {
    if (!this.enabled) return;
    this.emit(InputController.ANY, intent);
    this.emit(intent);
  }
}
