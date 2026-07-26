/**
 * Decorative reticle that tracks the pointer over a viewport, replacing the
 * OS cursor so aiming reads as looking down a weapon scope.
 */
export class ScopeCursor {
  private readonly root: HTMLDivElement;
  private readonly target: HTMLElement;
  private readonly previousCursor: string;

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
    const ring = document.createElement('div');
    ring.className = 'scope-cursor__ring';
    const lineH = document.createElement('div');
    lineH.className = 'scope-cursor__line scope-cursor__line--h';
    const lineV = document.createElement('div');
    lineV.className = 'scope-cursor__line scope-cursor__line--v';
    const dot = document.createElement('div');
    dot.className = 'scope-cursor__dot';
    root.append(ring, lineH, lineV, dot);
    parent.appendChild(root);
    this.root = root;

    target.addEventListener('pointerenter', this.onEnter);
    target.addEventListener('pointerleave', this.onLeave);
    target.addEventListener('pointermove', this.onMove);
  }

  dispose(): void {
    this.target.removeEventListener('pointerenter', this.onEnter);
    this.target.removeEventListener('pointerleave', this.onLeave);
    this.target.removeEventListener('pointermove', this.onMove);
    this.target.style.cursor = this.previousCursor;
    this.root.remove();
  }
}
