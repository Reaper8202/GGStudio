/**
 * On-screen driving controls for touch devices. Each held button synthesizes
 * window keydown/keyup events (arrows / F), so the driving modes' existing
 * keyboard handling works unchanged and desktop input is untouched.
 */

export function isTouchDevice(): boolean {
  return (
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(pointer: coarse)').matches
  );
}

export class TouchControls {
  readonly root = document.createElement('div');
  private readonly held = new Set<string>();

  constructor(parent: HTMLElement) {
    this.root.className = 'touch-controls';
    const steer = document.createElement('div');
    steer.className = 'touch-cluster touch-cluster-left';
    steer.append(this.button('ArrowLeft', '◀'), this.button('ArrowRight', '▶'));
    const drive = document.createElement('div');
    drive.className = 'touch-cluster touch-cluster-right';
    drive.append(
      this.button('f', 'FIRE', 'touch-fire'),
      this.button('ArrowDown', '▼'),
      this.button('ArrowUp', '▲'),
    );
    this.root.append(steer, drive);
    parent.appendChild(this.root);
  }

  dispose(): void {
    for (const key of [...this.held]) this.setHeld(key, false);
    this.root.remove();
  }

  private button(key: string, label: string, extra = ''): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = extra ? `touch-btn ${extra}` : 'touch-btn';
    el.textContent = label;
    el.dataset.key = key;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      // Block the compatibility mouse events and long-press selection.
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events (tests) carry no active pointer to capture.
      }
      this.setHeld(key, true);
    });
    const release = (): void => this.setHeld(key, false);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    return el;
  }

  private setHeld(key: string, down: boolean): void {
    if (down === this.held.has(key)) return;
    if (down) this.held.add(key);
    else this.held.delete(key);
    window.dispatchEvent(
      new KeyboardEvent(down ? 'keydown' : 'keyup', { key }),
    );
  }
}
