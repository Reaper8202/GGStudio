/**
 * Combat alert presentation: the stacked warning chips and the screen-edge
 * damage vignette.
 *
 * Both are DOM rather than post-processing — the game renders through a plain
 * `WebGLRenderer` with no composer, and a vignette is exactly the kind of
 * full-screen tint the compositor does for free. The renderer diffs against
 * what is already on screen, so a steady state costs no DOM writes at all.
 */

import {
  MAX_VISIBLE_WARNINGS,
  type VehicleWarning,
} from './vehicleWarnings.ts';

/** Seconds for one hit's red flash to fade out. */
const HIT_FADE_SECONDS = 0.85;
/** Damage in one step that saturates the flash on its own. */
const HIT_SATURATION_DAMAGE = 55;
/** Ceiling on the hit flash, so a pile-on never fully blinds the player. */
const MAX_HIT_INTENSITY = 0.92;
/** Opacity below which the vignette element is switched off entirely. */
const VIGNETTE_EPSILON = 0.02;

interface WarningRow {
  readonly root: HTMLDivElement;
  readonly icon: HTMLSpanElement;
  readonly title: HTMLElement;
  readonly detail: HTMLSpanElement;
  id: string;
  severity: string;
  iconKind: string;
}

export class WarningHud {
  private readonly stack: HTMLDivElement;
  private readonly rows: WarningRow[] = [];
  private readonly vignette: HTMLDivElement;
  private readonly hitLayer: HTMLDivElement;
  private readonly criticalLayer: HTMLDivElement;

  /** Current hit-flash strength, 0..1, decayed every frame. */
  private hitIntensity = 0;
  private lastAppliedHit = -1;
  private criticalActive = false;
  private visibleCount = 0;

  constructor(root: HTMLElement) {
    this.vignette = document.createElement('div');
    this.vignette.className = 'survival-vignette';
    this.vignette.setAttribute('aria-hidden', 'true');
    this.hitLayer = document.createElement('div');
    this.hitLayer.className = 'survival-vignette__hit';
    this.criticalLayer = document.createElement('div');
    this.criticalLayer.className = 'survival-vignette__critical';
    this.vignette.append(this.criticalLayer, this.hitLayer);
    root.appendChild(this.vignette);

    this.stack = document.createElement('div');
    this.stack.className = 'survival-warnings';
    // Alerts are status, not alerts-that-steal-focus: a polite live region
    // announces them without interrupting whatever else is being read.
    this.stack.setAttribute('role', 'status');
    this.stack.setAttribute('aria-live', 'polite');
    root.appendChild(this.stack);

    for (let i = 0; i < MAX_VISIBLE_WARNINGS; i++) {
      this.rows.push(this.createRow());
    }
  }

  /**
   * Register damage taken this step. Repeated hits stack toward the ceiling
   * rather than resetting, so a swarm reads as sustained pressure.
   */
  reportDamage(amount: number): void {
    if (amount <= 0) return;
    this.hitIntensity = Math.min(
      MAX_HIT_INTENSITY,
      this.hitIntensity + amount / HIT_SATURATION_DAMAGE,
    );
  }

  /** Decay the hit flash and repaint only when the value visibly moved. */
  update(frameDt: number): void {
    if (this.hitIntensity > 0) {
      this.hitIntensity = Math.max(
        0,
        this.hitIntensity - frameDt / HIT_FADE_SECONDS,
      );
    }
    const applied =
      this.hitIntensity < VIGNETTE_EPSILON
        ? 0
        : Math.round(this.hitIntensity * 20) / 20;
    if (applied === this.lastAppliedHit) return;
    this.lastAppliedHit = applied;
    this.hitLayer.style.opacity = String(applied);
    this.hitLayer.style.display = applied === 0 ? 'none' : 'block';
  }

  /**
   * Turn on the slow red pulse that sits behind the hit flash while the
   * vehicle is close to failing.
   */
  setCritical(critical: boolean): void {
    if (critical === this.criticalActive) return;
    this.criticalActive = critical;
    this.criticalLayer.classList.toggle('is-active', critical);
  }

  /** Show `warnings` (already ranked), reusing rows whose content is unchanged. */
  setWarnings(warnings: readonly VehicleWarning[]): void {
    const count = Math.min(warnings.length, this.rows.length);
    for (let i = 0; i < count; i++) {
      this.applyRow(this.rows[i], warnings[i]);
    }
    if (count === this.visibleCount) return;
    for (let i = count; i < this.rows.length; i++) {
      const row = this.rows[i];
      if (row.root.hidden) continue;
      row.root.hidden = true;
      row.id = '';
    }
    this.visibleCount = count;
  }

  dispose(): void {
    this.stack.remove();
    this.vignette.remove();
    this.rows.length = 0;
  }

  private applyRow(row: WarningRow, warning: VehicleWarning): void {
    if (row.root.hidden) row.root.hidden = false;
    if (row.id === warning.id && row.detail.textContent === warning.detail) {
      return;
    }
    if (row.severity !== warning.severity) {
      row.root.classList.remove(`survival-warning--${row.severity}`);
      row.root.classList.add(`survival-warning--${warning.severity}`);
      row.severity = warning.severity;
    }
    if (row.iconKind !== warning.icon) {
      row.icon.classList.remove(`survival-warning__icon--${row.iconKind}`);
      row.icon.classList.add(`survival-warning__icon--${warning.icon}`);
      row.iconKind = warning.icon;
    }
    if (row.id !== warning.id) {
      row.title.textContent = warning.title;
      // Restart the entry animation only when the alert itself changed, not
      // when its numbers ticked.
      row.root.classList.remove('is-new');
      void row.root.offsetWidth;
      row.root.classList.add('is-new');
      row.id = warning.id;
    }
    row.detail.textContent = warning.detail;
  }

  private createRow(): WarningRow {
    const root = document.createElement('div');
    root.className = 'panel survival-warning survival-warning--caution';
    root.hidden = true;
    const icon = document.createElement('span');
    icon.className = 'survival-warning__icon survival-warning__icon--hull';
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    copy.className = 'survival-warning__copy';
    const title = document.createElement('strong');
    const detail = document.createElement('span');
    copy.append(title, detail);
    root.append(icon, copy);
    this.stack.appendChild(root);
    return {
      root,
      icon,
      title,
      detail,
      id: '',
      severity: 'caution',
      iconKind: 'hull',
    };
  }
}
