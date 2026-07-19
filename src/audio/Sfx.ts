/**
 * Zero-asset sound effects: tiny WebAudio synth blips instead of audio files.
 * Keeps the bundle free of audio weight and needs no external requests.
 * The AudioContext is created lazily on first user gesture (autoplay policy).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private _muted = false;

  /** Call from any user-input handler; safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this._muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
      } catch {
        return; // no audio available — game plays silently
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Muted during ads (LifecycleGuard hooks call this). */
  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setValueAtTime(muted ? 0 : 0.5, this.ctx.currentTime);
    }
  }

  get muted(): boolean {
    return this._muted;
  }

  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    durMs: number,
    gain = 0.6,
  ): void {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return;
    const t0 = this.ctx.currentTime;
    const dur = durMs / 1000;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  jump(): void {
    this.tone('square', 240, 520, 140, 0.25);
  }

  slide(): void {
    this.tone('sawtooth', 300, 140, 130, 0.2);
  }

  coin(): void {
    this.tone('sine', 880, 1320, 90, 0.3);
  }

  hit(): void {
    this.tone('sawtooth', 220, 40, 350, 0.5);
  }

  click(): void {
    this.tone('triangle', 600, 500, 60, 0.25);
  }

  revive(): void {
    this.tone('sine', 440, 880, 250, 0.3);
  }
}
