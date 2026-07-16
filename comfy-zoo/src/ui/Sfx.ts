/**
 * Raw WebAudio UI SFX (no Howler). Lazy AudioContext created on first user
 * gesture; OGGs fetched + decoded on demand from assets/audio/ui/. Missing
 * files fail silently (console.debug). Plan §2 event→file mapping.
 */

import type { EventBus } from '../core/EventBus';
import { store } from './dom';

/** Logical cue name → OGG filename (as shipped by the pipeline agent). */
const FILES = {
  menuOpen: 'UI SFX_InGameMenu_Open.ogg',
  menuClose: 'UI SFX_InGameMenu_Close.ogg',
  hover: 'UI SFX_MENU_Hover.ogg',
  scroll: 'UI SFX_MENU_Scroll.ogg',
  confirm: 'UI SFX_MENU_Confirm.ogg',
  back: 'UI SFX_MENU_Back.ogg',
  positive: 'UI SFX_FEEDBACK_Positive.ogg',
  negative: 'UI SFX_FEEDBACK_Negative.ogg',
  alert: 'UI SFX_FEEDBACK_Alert.ogg',
  woop: 'UI SFX_FEEDBACK_Woop.ogg',
  woom: 'UI SFX_FEEDBACK_Woom.ogg',
  coinGlock: 'UI SFX_EXTRA_Glockenspiel Hopping.ogg',
  coinMarimba: 'UI SFX_EXTRA_Marimba Hopping.ogg',
  start: 'UI SFX_EXTRA_Start Button.ogg',
  save: 'UI SFX_InGameMenu_Save.ogg',
  load: 'UI SFX_InGameMenu_Load.ogg',
  sad: 'UI SFX_EXTRA_Quick Sub Descending.ogg',
} as const;

export type SfxName = keyof typeof FILES;

const HINTS_KEY = 'comfyzoo.settings.sfx';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<SfxName, AudioBuffer | null>();
  private pending = new Map<SfxName, Promise<AudioBuffer | null>>();
  private enabled: boolean;
  private coinAlt = false;

  constructor() {
    this.enabled = store.get<boolean>(HINTS_KEY, true);
    // Create/resume context on the first user gesture (autoplay policy).
    const unlock = () => {
      void this.ensureContext();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('touchstart', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    store.set(HINTS_KEY, on);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
    }
  }

  private async ensureContext(): Promise<AudioContext | null> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 1 : 0;
      this.master.connect(this.ctx.destination);
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
      return this.ctx;
    } catch (e) {
      console.debug('[sfx] no AudioContext', e);
      return null;
    }
  }

  private async fetchBuffer(name: SfxName): Promise<AudioBuffer | null> {
    if (this.buffers.has(name)) return this.buffers.get(name)!;
    const existing = this.pending.get(name);
    if (existing) return existing;
    const ctx = this.ctx;
    if (!ctx) return null;
    const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
    const url = `${base}assets/audio/ui/${encodeURIComponent(FILES[name])}`;
    const p = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status}`);
        const raw = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(raw);
        this.buffers.set(name, buf);
        return buf;
      } catch (e) {
        console.debug(`[sfx] missing ${FILES[name]}`, e);
        this.buffers.set(name, null); // cache the miss; retry-free
        return null;
      } finally {
        this.pending.delete(name);
      }
    })();
    this.pending.set(name, p);
    return p;
  }

  /** Play a cue. gain scales 0..1 (Negative is softened by the caller). */
  play(name: SfxName, gain = 1): void {
    if (!this.enabled) return;
    void (async () => {
      const ctx = await this.ensureContext();
      if (!ctx || !this.master) return;
      const buf = await this.fetchBuffer(name);
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      if (gain !== 1) {
        const g = ctx.createGain();
        g.gain.value = gain;
        src.connect(g).connect(this.master);
      } else {
        src.connect(this.master);
      }
      src.start();
    })();
  }

  /** Alternating glockenspiel/marimba tick for coin-fly particles. */
  coinTick(): void {
    this.coinAlt = !this.coinAlt;
    this.play(this.coinAlt ? 'coinGlock' : 'coinMarimba', 0.7);
  }

  /**
   * Wire game-side bus events to cues. Component-driven cues (hover, confirm,
   * menu open/close, coin ticks, modal woop/woom) are triggered directly by the
   * components that own those interactions.
   */
  bind(bus: EventBus): void {
    bus.on('animal:captured', () => this.play('positive'));
    bus.on('animal:captureFailed', () => this.play('negative', 0.55));
    bus.on('quest:completed', () => this.play('positive'));
    bus.on('animal:sad', () => this.play('sad'));
    bus.on('animal:hungry', () => this.play('alert', 0.7));
    bus.on('coins:insufficient', () => this.play('negative', 0.5));
    bus.on('save:completed', () => this.play('save', 0.6));
    bus.on('ui:settingChanged', (p) => {
      if (p.key === 'sfx') this.setEnabled(p.value);
    });
  }
}
