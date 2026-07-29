/**
 * The combat ability bar: up to three boxes centred along the bottom of the
 * screen, one per equipped ability part, each showing its keybind, what it does
 * at the part's current level, and a cooldown sweep that drains as it recharges.
 *
 * Boxes are buttons, so an ability can be fired with the mouse as well as its
 * key — handy on a trackpad where the left hand is busy steering. A slot only
 * exists while the part backing it is bolted on and alive, so the bar shrinks
 * the moment a zombie tears the emitter off.
 *
 * The renderer diffs against what is already on screen, so a bar full of ready
 * abilities costs no DOM writes per frame.
 */

/** One filled slot, handed to {@link AbilityBar.render} once a frame. */
export interface AbilitySlotView {
  /** Placed part backing the slot; identity for diffing, not shown. */
  partId: string;
  /** Uppercase key badge, e.g. "Q". */
  keyLabel: string;
  /** Single glyph for the ability's kind. */
  glyph: string;
  /** Ability name, e.g. "Cryo Nova". */
  name: string;
  /** Short line under the name: what one activation does at this level. */
  detail: string;
  /** Hover text: the ability's blurb plus the part it came from. */
  tooltip: string;
  /** Full cooldown in seconds, the denominator of the sweep. */
  cooldownSeconds: number;
  /** Seconds left before it can fire again; 0 when ready. */
  remainingSeconds: number;
}

interface AbilitySlotBox {
  readonly root: HTMLButtonElement;
  readonly glyph: HTMLSpanElement;
  readonly name: HTMLSpanElement;
  readonly detail: HTMLSpanElement;
  readonly key: HTMLSpanElement;
  readonly sweep: HTMLSpanElement;
  readonly timer: HTMLSpanElement;
  filled: boolean;
  partId: string;
  lastName: string;
  lastDetail: string;
  lastRemaining: number;
  lastFraction: number;
}

/** Cooldown sweep steps, so the fill only redraws on visible changes. */
const SWEEP_STEPS = 60;

export class AbilityBar {
  private readonly root: HTMLDivElement;
  private readonly boxes: AbilitySlotBox[] = [];
  private visible = true;

  constructor(
    parent: HTMLElement,
    slotCount: number,
    private readonly onActivate: (slot: number) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'survival-ability-bar';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Abilities');
    parent.appendChild(this.root);
    for (let slot = 0; slot < slotCount; slot++) {
      this.boxes.push(this.createBox(slot));
    }
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.root.hidden = !visible;
  }

  /**
   * Draw the current loadout. Slots past the end of `views` are emptied, so a
   * rig that loses an ability part loses its box on the next frame.
   */
  render(views: readonly (AbilitySlotView | undefined)[]): void {
    for (let slot = 0; slot < this.boxes.length; slot++) {
      const box = this.boxes[slot];
      const view = views[slot];
      if (view === undefined) {
        this.clearBox(box);
        continue;
      }
      this.fillBox(box, view);
    }
  }

  dispose(): void {
    this.root.remove();
  }

  private clearBox(box: AbilitySlotBox): void {
    if (!box.filled) return;
    box.filled = false;
    box.partId = '';
    box.root.hidden = true;
  }

  private fillBox(box: AbilitySlotBox, view: AbilitySlotView): void {
    if (!box.filled) {
      box.filled = true;
      box.root.hidden = false;
    }
    if (box.partId !== view.partId || box.lastName !== view.name) {
      box.partId = view.partId;
      box.lastName = view.name;
      box.name.textContent = view.name;
      box.glyph.textContent = view.glyph;
      box.key.textContent = view.keyLabel;
      box.root.title = view.tooltip;
      box.root.setAttribute(
        'aria-label',
        `${view.name}, key ${view.keyLabel}`,
      );
    }
    if (box.lastDetail !== view.detail) {
      box.lastDetail = view.detail;
      box.detail.textContent = view.detail;
    }

    const ready = view.remainingSeconds <= 0;
    const fraction =
      ready || view.cooldownSeconds <= 0
        ? 0
        : Math.round(
            (Math.min(view.remainingSeconds, view.cooldownSeconds) /
              view.cooldownSeconds) *
              SWEEP_STEPS,
          ) / SWEEP_STEPS;
    if (fraction !== box.lastFraction) {
      box.lastFraction = fraction;
      box.sweep.style.transform = `scaleY(${fraction})`;
    }

    // Whole seconds, rounded up: "1" stays on screen for the last second
    // rather than blinking to "0" while the ability is still recharging.
    const remaining = ready ? 0 : Math.ceil(view.remainingSeconds);
    if (remaining === box.lastRemaining) return;
    box.lastRemaining = remaining;
    box.timer.textContent = ready ? '' : `${remaining}`;
    box.root.classList.toggle('is-ready', ready);
    box.root.classList.toggle('is-cooling', !ready);
    box.root.setAttribute('aria-disabled', ready ? 'false' : 'true');
  }

  private createBox(slot: number): AbilitySlotBox {
    const root = document.createElement('button');
    root.type = 'button';
    root.className = 'survival-ability-slot is-ready';
    root.dataset.slot = `${slot}`;
    root.hidden = true;

    const glyph = document.createElement('span');
    glyph.className = 'survival-ability-slot__glyph';
    glyph.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'survival-ability-slot__name';
    const detail = document.createElement('span');
    detail.className = 'survival-ability-slot__detail';
    const key = document.createElement('span');
    key.className = 'survival-ability-slot__key';
    const sweep = document.createElement('span');
    sweep.className = 'survival-ability-slot__sweep';
    sweep.setAttribute('aria-hidden', 'true');
    const timer = document.createElement('span');
    timer.className = 'survival-ability-slot__timer';

    root.append(sweep, glyph, name, detail, key, timer);
    // Fire on pointerdown for the same latency as the keybind, and keep focus
    // on the canvas: a focused button would swallow the next Space or Enter.
    root.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.button !== 0) return;
      this.onActivate(slot);
    });
    this.root.appendChild(root);

    return {
      root,
      glyph,
      name,
      detail,
      key,
      sweep,
      timer,
      filled: false,
      partId: '',
      lastName: '',
      lastDetail: '',
      lastRemaining: 0,
      lastFraction: 0,
    };
  }
}
