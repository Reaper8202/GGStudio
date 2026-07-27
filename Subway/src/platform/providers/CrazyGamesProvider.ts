import type { PlatformSDK } from '../PlatformSDK';

declare global {
  interface Window {
    CrazyGames?: any;
  }
}

/**
 * CrazyGames SDK v3 adapter. Verified against INTEGRATION.md (18 Jul 2026).
 * The SDK throws on any non-crazygames/local environment — every call is
 * guarded. CrazyGames auto-pauses the frame during ads, but audio mute +
 * input freeze is still done on our side via LifecycleGuard hooks.
 */
export class CrazyGamesProvider implements PlatformSDK {
  private sdk: any | null = null;
  isReal = false;

  async init(): Promise<void> {
    const cg = window.CrazyGames?.SDK;
    if (!cg) return;
    try {
      await cg.init();
      this.sdk = cg;
      this.isReal = cg.environment === 'crazygames';
      cg.game.loadingStart(); // paired with loadingStop() in loadingFinished()
    } catch (e) {
      console.warn('CrazyGames init failed', e);
    }
  }

  loadingProgress(_fraction: number): void {
    /* no per-fraction API */
  }

  loadingFinished(): void {
    try {
      this.sdk?.game.loadingStop();
    } catch {
      /* ignore */
    }
  }

  gameplayStart(): void {
    try {
      this.sdk?.game.gameplayStart();
    } catch {
      /* ignore */
    }
  }

  gameplayStop(): void {
    try {
      this.sdk?.game.gameplayStop();
    } catch {
      /* ignore */
    }
  }

  async commercialBreak(): Promise<void> {
    await this.requestAd('midgame');
  }

  async rewardedBreak(): Promise<boolean> {
    return this.requestAd('rewarded');
  }

  /** Wrap callback-based requestAd into a Promise. Resolves true only on adFinished. */
  private requestAd(type: 'midgame' | 'rewarded'): Promise<boolean> {
    if (!this.sdk || !this.isReal) return Promise.resolve(type === 'rewarded');
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (v: boolean) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      this.sdk.ad.requestAd(type, {
        adStarted: () => {},
        adFinished: () => done(true),
        adError: (_e: any) => done(false),
      });
    });
  }

  // Data module = localStorage-compatible API, synced cross-device for
  // logged-in users. The "Progress Save" toggle MUST be selected in the
  // submission flow or this is disabled. Rely solely on the Data Module when
  // present — no double-writing to localStorage.
  async save(key: string, value: string): Promise<void> {
    try {
      this.sdk ? this.sdk.data.setItem(key, value) : localStorage.setItem(key, value);
    } catch {
      /* ignore (1 MB cap → dataLimitExcedeed) */
    }
  }

  async load(key: string): Promise<string | null> {
    try {
      return this.sdk ? this.sdk.data.getItem(key) : localStorage.getItem(key);
    } catch {
      return null;
    }
  }
}
