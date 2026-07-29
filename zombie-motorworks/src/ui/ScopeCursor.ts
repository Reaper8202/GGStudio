/**
 * Decorative reticle that tracks the pointer over a viewport, replacing the
 * OS cursor so aiming reads as looking down a weapon scope.
 */
export class ScopeCursor {
  private readonly root: HTMLDivElement;
  private readonly target: HTMLElement;
  private readonly previousCursor: string;
  private hitTimer: number | null = null;

  private readonly finishHitFlash = (): void => {
    this.root.classList.remove('scope-cursor--hit', 'scope-cursor--kill');
    this.hitTimer = null;
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
    const ring = document.createElement('div');
    ring.className = 'scope-cursor__ring';
    const lineH = document.createElement('div');
    lineH.className = 'scope-cursor__line scope-cursor__line--h';
    const lineV = document.createElement('div');
    lineV.className = 'scope-cursor__line scope-cursor__line--v';
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
    root.append(ring, lineH, lineV, dot, hitMarker);
    parent.appendChild(root);
    this.root = root;

    target.addEventListener('pointerenter', this.onEnter);
    target.addEventListener('pointerleave', this.onLeave);
    target.addEventListener('pointermove', this.onMove);
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

  dispose(): void {
    if (this.hitTimer !== null) {
      window.clearTimeout(this.hitTimer);
      this.hitTimer = null;
    }
    this.target.removeEventListener('pointerenter', this.onEnter);
    this.target.removeEventListener('pointerleave', this.onLeave);
    this.target.removeEventListener('pointermove', this.onMove);
    this.target.style.cursor = this.previousCursor;
    this.root.remove();
  }
}
