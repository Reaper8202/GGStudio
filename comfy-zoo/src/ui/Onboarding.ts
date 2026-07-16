/**
 * Onboarding — ZERO text walls. An animated paw cursor (hand-drawn SVG) that
 * demonstrates first-time actions in-world, each demo playing once (persisted in
 * localStorage 'comfyzoo.onboarding') and cancelling early if the player does the
 * action first:
 *   - fresh save on 'game:ready': paw glides from center toward screen-lower area
 *     and pulses (move + capture demo).
 *   - after first 'animal:captured': paw taps where the action button / E hint is.
 *   - after first 'animal:housed': paw taps the menu leaf, then the Build entry.
 */

import type { UIContext } from './context';
import { el, store } from './dom';

interface OnboardState {
  moveCapture: boolean;
  actionTap: boolean;
  buildTap: boolean;
}

const KEY = 'comfyzoo.onboarding';
const PAW_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <ellipse cx="12" cy="16" rx="5.2" ry="4"/>
  <circle cx="5.4" cy="11.2" r="2.3"/><circle cx="9.3" cy="7.2" r="2.4"/>
  <circle cx="14.7" cy="7.2" r="2.4"/><circle cx="18.6" cy="11.2" r="2.3"/></svg>`;

export class Onboarding {
  private ctx: UIContext;
  private paw: HTMLElement;
  private state: OnboardState;
  private animTimer = 0;
  private playing = false;

  constructor(ctx: UIContext) {
    this.ctx = ctx;
    this.state = store.get<OnboardState>(KEY, { moveCapture: false, actionTap: false, buildTap: false });
    this.paw = el('div', { class: 'paw-cursor hidden', html: PAW_SVG });
    ctx.root.append(this.paw);
    this.bind();
  }

  private save(): void {
    store.set(KEY, this.state);
  }

  private bind(): void {
    const bus = this.ctx.bus;
    bus.on('game:ready', () => {
      if (!this.state.moveCapture) this.demoMoveCapture();
    });
    // Cancel move/capture demo the moment the player captures anything.
    bus.on('animal:captured', () => {
      this.cancel();
      if (!this.state.moveCapture) {
        this.state.moveCapture = true;
        this.save();
      }
      if (!this.state.actionTap) this.demoActionTap();
    });
    bus.on('animal:housed', () => {
      this.cancel();
      if (!this.state.actionTap) {
        this.state.actionTap = true;
        this.save();
      }
      if (!this.state.buildTap) this.demoBuildTap();
    });
    // If the player opens Build themselves, retire the build demo.
    bus.on('ui:menuOpened', (p) => {
      if (p.menu === 'build' && !this.state.buildTap) {
        this.state.buildTap = true;
        this.save();
        this.cancel();
      }
    });
  }

  private cancel(): void {
    this.playing = false;
    if (this.animTimer) clearTimeout(this.animTimer);
    this.paw.classList.add('hidden');
    this.paw.classList.remove('pulse', 'tap');
  }

  private place(x: number, y: number): void {
    this.paw.style.left = `${x}px`;
    this.paw.style.top = `${y}px`;
  }

  private demoMoveCapture(): void {
    this.playing = true;
    this.paw.classList.remove('hidden');
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    // Glide from center toward the nearby cow (assumed just below-center in view).
    this.place(cx, cy);
    this.paw.classList.add('glide');
    this.animTimer = window.setTimeout(() => {
      if (!this.playing) return;
      this.place(cx + 40, cy + window.innerHeight * 0.18);
      this.animTimer = window.setTimeout(() => {
        if (!this.playing) return;
        this.paw.classList.remove('glide');
        this.paw.classList.add('pulse');
        // Loop the pulse until the player captures (handled by cancel()).
      }, 900);
    }, 60);
  }

  private demoActionTap(): void {
    this.playing = true;
    this.paw.classList.remove('hidden', 'glide', 'pulse');
    // Aim at the action button (touch) or the E-hint region (desktop): bottom-right.
    const x = this.ctx.isTouch() ? window.innerWidth - 70 : window.innerWidth / 2;
    const y = this.ctx.isTouch() ? window.innerHeight - 80 : window.innerHeight * 0.62;
    this.place(x, y);
    this.paw.classList.add('tap');
    this.animTimer = window.setTimeout(() => this.retireActionTap(), 4200);
  }

  private retireActionTap(): void {
    if (!this.state.actionTap) {
      this.state.actionTap = true;
      this.save();
    }
    this.cancel();
  }

  private demoBuildTap(): void {
    this.playing = true;
    this.paw.classList.remove('hidden', 'glide', 'pulse');
    // Tap the menu leaf (top-right)…
    this.place(window.innerWidth - 44, 48);
    this.paw.classList.add('tap');
    this.animTimer = window.setTimeout(() => {
      if (!this.playing) return;
      // …then where the Shop radial item appears just below the leaf.
      this.place(window.innerWidth - 70, 108);
      this.animTimer = window.setTimeout(() => this.retireBuildTap(), 2400);
    }, 1600);
  }

  private retireBuildTap(): void {
    if (!this.state.buildTap) {
      this.state.buildTap = true;
      this.save();
    }
    this.cancel();
  }
}
