/**
 * The aiming reticle: a pair of square brackets that track the pointer over the
 * viewport, replacing the OS cursor.
 *
 * The brackets are also the signature weapon's cooldown gauge. A low-opacity
 * bar rises inside them as the strike recharges and clears the moment it is
 * ready, so the player reads their cadence from the thing they are already
 * looking at instead of glancing down at a bar. Clicking while it is still
 * filling turns the whole reticle red and shakes it — a refusal that lands
 * where the eye already is.
 *
 * A rig with no signature block never calls `setCooldown`, so the brackets stay
 * empty and the cursor is decoration again.
 */
export class ScopeCursor {
  private readonly root: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly target: HTMLElement;
  private readonly previousCursor: string;
  private hitTimer: number | null = null;
  private denyTimer: number | null = null;
  /** Last fill fraction written, so a steady reticle costs no style writes. */
  private appliedFill = -1;
  private ready = true;

  private readonly finishHitFlash = (): void => {
    this.root.classList.remove('scope-cursor--hit', 'scope-cursor--kill');
    this.hitTimer = null;
  };

  private readonly finishDenyFlash = (): void => {
    this.root.classList.remove('scope-cursor--denied');
    this.denyTimer = null;
  };

  private readonly onEnter = (): void => {
    this.root.classList.add('visible');
  };

  private readonly onLeave = (): void => {
    this.root.classList.remove('visible');
  };

  private readonly onMove = (event: PointerEvent): void => {
    const rect = this.target.getBoundingClientRect();
    this.root.style.left = `${event.clientX - rect.left}px`;
    this.root.style.top = `${event.clientY - rect.top}px`;
  };

  /** Appends its own root element to `parent` and hides the OS cursor over `target`. */
  constructor(parent: HTMLElement, target: HTMLElement) {
    this.target = target;
    this.previousCursor = target.style.cursor;
    target.style.cursor = 'none';

    const root = document.createElement('div');
    root.className = 'scope-cursor';
    root.setAttribute('aria-hidden', 'true');

    // The gauge sits behind the brackets so the bracket strokes stay crisp
    // over it, and is clipped to the bracket square by its own container.
    const gauge = document.createElement('div');
    gauge.className = 'scope-cursor__gauge';
    const fill = document.createElement('div');
    fill.className = 'scope-cursor__fill';
    gauge.appendChild(fill);

    // Four L-shaped corners read as `[ ]` from any distance and, unlike a ring,
    // leave the middle of the reticle clear of the thing being aimed at.
    const brackets = document.createElement('div');
    brackets.className = 'scope-cursor__brackets';
    for (const corner of ['nw', 'ne', 'se', 'sw'] as const) {
      const bracket = document.createElement('div');
      bracket.className = `scope-cursor__bracket scope-cursor__bracket--${corner}`;
      brackets.appendChild(bracket);
    }

    const dot = document.createElement('div');
    dot.className = 'scope-cursor__dot';
    const hitMarker = document.createElement('div');
    hitMarker.className = 'scope-cursor__hit-marker';
    hitMarker.setAttribute('aria-hidden', 'true');
    for (const direction of ['nw', 'ne', 'se', 'sw'] as const) {
      const chevron = document.createElement('div');
      chevron.className = `scope-cursor__hit-chevron scope-cursor__hit-chevron--${direction}`;
      hitMarker.appendChild(chevron);
    }
    root.append(gauge, brackets, dot, hitMarker);
    parent.appendChild(root);
    this.root = root;
    this.fill = fill;

    target.addEventListener('pointerenter', this.onEnter);
    target.addEventListener('pointerleave', this.onLeave);
    target.addEventListener('pointermove', this.onMove);
  }

  /**
   * Set how full the recharge gauge reads, 0 (just fired) to 1 (ready).
   *
   * Quantised to whole percent before it is written, so a cooldown ticking
   * every frame costs at most one style write per visible step.
   */
  setCooldown(fraction: number): void {
    const clamped = Math.max(0, Math.min(1, fraction));
    const stepped = Math.round(clamped * 100) / 100;
    if (stepped === this.appliedFill) return;
    this.appliedFill = stepped;
    this.fill.style.transform = `scaleY(${stepped})`;
    const ready = stepped >= 1;
    if (ready === this.ready) return;
    this.ready = ready;
    this.root.classList.toggle('scope-cursor--charging', !ready);
  }

  /** Hide the gauge entirely, for a rig carrying no signature block. */
  clearCooldown(): void {
    this.setCooldown(1);
    this.root.classList.remove('scope-cursor--charging');
  }

  /** Flash a confirmation on the reticle. `kill` is the stronger variant. */
  flashHit(kind: 'hit' | 'kill'): void {
    if (this.hitTimer !== null) {
      window.clearTimeout(this.hitTimer);
      this.hitTimer = null;
    }
    this.root.classList.remove('scope-cursor--hit', 'scope-cursor--kill');
    // Restarting the keyframes makes rapid, deliberate hits read individually.
    void this.root.offsetWidth;
    this.root.classList.add(
      kind === 'kill' ? 'scope-cursor--kill' : 'scope-cursor--hit',
    );
    this.hitTimer = window.setTimeout(
      this.finishHitFlash,
      kind === 'kill' ? 260 : 180,
    );
  }

  /** Refuse a click: the brackets go red and shake for a moment. */
  flashDenied(): void {
    if (this.denyTimer !== null) {
      window.clearTimeout(this.denyTimer);
      this.denyTimer = null;
    }
    this.root.classList.remove('scope-cursor--denied');
    // Same keyframe restart as flashHit, so mashing a weapon on cooldown
    // shakes once per click rather than reading as one long wobble.
    void this.root.offsetWidth;
    this.root.classList.add('scope-cursor--denied');
    this.denyTimer = window.setTimeout(this.finishDenyFlash, 240);
  }

  dispose(): void {
    for (const timer of [this.hitTimer, this.denyTimer]) {
      if (timer !== null) window.clearTimeout(timer);
    }
    this.hitTimer = null;
    this.denyTimer = null;
    this.target.removeEventListener('pointerenter', this.onEnter);
    this.target.removeEventListener('pointerleave', this.onLeave);
    this.target.removeEventListener('pointermove', this.onMove);
    this.target.style.cursor = this.previousCursor;
    this.root.remove();
  }
}
