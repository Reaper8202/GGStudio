export type TouchDriveDirection = 'forward' | 'reverse' | 'left' | 'right';

export interface TouchDriveInput {
  readonly forward: boolean;
  readonly reverse: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

/** Pointer ownership is state, not DOM state, so simultaneous holds compose. */
export interface TouchDriveState {
  readonly pointers: ReadonlyMap<number, TouchDriveDirection>;
}

export type TouchDriveEvent =
  | {
      readonly type: 'press';
      readonly pointerId: number;
      readonly direction: TouchDriveDirection;
    }
  | { readonly type: 'release'; readonly pointerId: number }
  | { readonly type: 'reset' };

const EMPTY_INPUT: TouchDriveInput = Object.freeze({
  forward: false,
  reverse: false,
  left: false,
  right: false,
});

export function createTouchDriveState(): TouchDriveState {
  return { pointers: new Map() };
}

/**
 * Pure pointer reducer used by the DOM controller. One pointer owns one button;
 * several pointers may hold the same button without releasing each other.
 */
export function reduceTouchDriveState(
  state: TouchDriveState,
  event: TouchDriveEvent,
): TouchDriveState {
  if (event.type === 'reset') {
    return state.pointers.size === 0 ? state : createTouchDriveState();
  }

  if (event.type === 'release') {
    if (!state.pointers.has(event.pointerId)) return state;
    const pointers = new Map(state.pointers);
    pointers.delete(event.pointerId);
    return { pointers };
  }

  if (state.pointers.get(event.pointerId) === event.direction) return state;
  const pointers = new Map(state.pointers);
  pointers.set(event.pointerId, event.direction);
  return { pointers };
}

/** Collapse active pointer ownership into input consumed by SurvivalMode. */
export function touchDriveInput(state: TouchDriveState): TouchDriveInput {
  if (state.pointers.size === 0) return EMPTY_INPUT;
  const active = new Set(state.pointers.values());
  return Object.freeze({
    forward: active.has('forward'),
    reverse: active.has('reverse'),
    left: active.has('left'),
    right: active.has('right'),
  });
}

interface ButtonBinding {
  readonly button: HTMLButtonElement;
  readonly direction: TouchDriveDirection;
  readonly onPointerDown: (event: PointerEvent) => void;
  readonly onPointerEnd: (event: PointerEvent) => void;
}

const BUTTONS: readonly {
  direction: TouchDriveDirection;
  label: string;
  glyph: string;
}[] = [
  { direction: 'forward', label: 'Drive forward', glyph: '↑' },
  { direction: 'left', label: 'Steer left', glyph: '←' },
  { direction: 'reverse', label: 'Brake or reverse', glyph: '↓' },
  { direction: 'right', label: 'Steer right', glyph: '→' },
];

/**
 * Four-button touch driving pad. Pointer capture keeps every held direction
 * live until that exact finger ends, even when it slides outside its button.
 */
export class TouchDriveControls {
  readonly root: HTMLDivElement;
  private readonly bindings: ButtonBinding[] = [];
  private state = createTouchDriveState();
  private snapshot: TouchDriveInput = EMPTY_INPUT;
  private disposed = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'survival-touch-controls';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Driving controls');

    for (const spec of BUTTONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `survival-touch-control survival-touch-control--${spec.direction}`;
      button.dataset.control = spec.direction;
      button.textContent = spec.glyph;
      button.setAttribute('aria-label', spec.label);
      button.setAttribute('aria-pressed', 'false');

      const onPointerDown = (event: PointerEvent): void => {
        // Ignore auxiliary mouse buttons while leaving every touch pointer free
        // to participate; secondary fingers are not `isPrimary`.
        if (event.button !== 0) return;
        event.preventDefault();
        this.press(event.pointerId, spec.direction);
        try {
          button.setPointerCapture(event.pointerId);
        } catch {
          // Capture can fail when a mode is disposed during the same gesture.
        }
      };
      const onPointerEnd = (event: PointerEvent): void => {
        event.preventDefault();
        this.release(event.pointerId);
      };

      button.addEventListener('pointerdown', onPointerDown);
      button.addEventListener('pointerup', onPointerEnd);
      button.addEventListener('pointercancel', onPointerEnd);
      button.addEventListener('lostpointercapture', onPointerEnd);
      this.bindings.push({
        button,
        direction: spec.direction,
        onPointerDown,
        onPointerEnd,
      });
      this.root.appendChild(button);
    }

    parent.appendChild(this.root);
    window.addEventListener('blur', this.onBlur);
  }

  /** Stable immutable snapshot; replaced only when active pointer state changes. */
  get input(): TouchDriveInput {
    return this.snapshot;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('blur', this.onBlur);
    for (const binding of this.bindings) {
      binding.button.removeEventListener('pointerdown', binding.onPointerDown);
      binding.button.removeEventListener('pointerup', binding.onPointerEnd);
      binding.button.removeEventListener('pointercancel', binding.onPointerEnd);
      binding.button.removeEventListener(
        'lostpointercapture',
        binding.onPointerEnd,
      );
      for (const pointerId of this.state.pointers.keys()) {
        if (!binding.button.hasPointerCapture(pointerId)) continue;
        try {
          binding.button.releasePointerCapture(pointerId);
        } catch {
          // A cancelled browser gesture may already have released capture.
        }
      }
    }
    this.reset();
    this.root.remove();
  }

  private press(pointerId: number, direction: TouchDriveDirection): void {
    if (this.disposed) return;
    this.state = reduceTouchDriveState(this.state, {
      type: 'press',
      pointerId,
      direction,
    });
    this.sync();
  }

  private release(pointerId: number): void {
    if (this.disposed) return;
    this.state = reduceTouchDriveState(this.state, {
      type: 'release',
      pointerId,
    });
    this.sync();
  }

  private reset(): void {
    this.state = reduceTouchDriveState(this.state, { type: 'reset' });
    this.sync();
  }

  private sync(): void {
    this.snapshot = touchDriveInput(this.state);
    for (const binding of this.bindings) {
      binding.button.setAttribute(
        'aria-pressed',
        String(this.snapshot[binding.direction]),
      );
    }
  }

  private readonly onBlur = (): void => this.reset();
}
