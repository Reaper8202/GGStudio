import type { PlatformSDK } from '../PlatformSDK';

/**
 * Placeholder for YouTube Playables (early-access/invite-only in 2026).
 * The game already honors the hard Playables rules — no external network
 * calls at runtime, single ZIP bundle (`npm run build:zip`), correct
 * pause/resume lifecycle — so wiring the real SDK here later is trivial.
 */
export class YouTubePlayablesProvider implements PlatformSDK {
  readonly isReal = false;

  async init(): Promise<void> {}

  loadingProgress(_fraction: number): void {}

  loadingFinished(): void {}

  gameplayStart(): void {}

  gameplayStop(): void {}

  async commercialBreak(): Promise<void> {}

  async rewardedBreak(): Promise<boolean> {
    // No rewarded inventory yet — grant so revive stays testable.
    return true;
  }

  async save(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }

  async load(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
}
