/**
 * CrazyGames adapter. Detected via window.CrazyGames or ?platform=crazygames.
 * The SDK script is injected dynamically ONLY when detected; every call is
 * guarded and falls back to local behavior, so this file typechecks and runs
 * without the SDK present.
 */
import type {
  AdResult,
  PlatformAdapter,
  PlatformCapabilities,
} from './PlatformAdapter';

// ---- minimal ambient SDK surface (kept local; no external types) ----------
interface CGAdCallbacks {
  adFinished?: () => void;
  adError?: (error: unknown) => void;
  adStarted?: () => void;
}

interface CrazyGamesSDK {
  init?: () => Promise<void>;
  game?: {
    gameplayStart?: () => void;
    gameplayStop?: () => void;
    happytime?: () => void;
    loadingStart?: () => void;
    loadingStop?: () => void;
  };
  ad?: {
    requestAd?: (type: 'rewarded' | 'midgame', callbacks: CGAdCallbacks) => void;
  };
  data?: {
    getItem?: (key: string) => string | null;
    setItem?: (key: string, value: string) => void;
  };
  user?: unknown;
}

declare global {
  interface Window {
    CrazyGames?: { SDK?: CrazyGamesSDK };
  }
}
// ---------------------------------------------------------------------------

const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const SAVE_KEY = 'comfyZoo.save.v1';

export function isCrazyGames(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.CrazyGames) return true;
  try {
    return new URLSearchParams(window.location.search).get('platform') === 'crazygames';
  } catch {
    return false;
  }
}

export class CrazyGamesAdapter implements PlatformAdapter {
  readonly name: PlatformAdapter['name'] = 'crazygames';
  readonly capabilities: PlatformCapabilities = {
    rewardedAds: true,
    interstitialAds: true,
    cloudSave: true,
    softTimerFallback: false,
  };

  private sdk: CrazyGamesSDK | null = null;
  private pauseFns: (() => void)[] = [];
  private resumeFns: (() => void)[] = [];

  async init(): Promise<void> {
    try {
      if (!window.CrazyGames?.SDK) await this.injectScript();
      this.sdk = window.CrazyGames?.SDK ?? null;
      if (this.sdk?.init) await this.sdk.init();
    } catch (e) {
      console.debug('[crazygames] SDK unavailable, degrading gracefully', e);
      this.sdk = null;
    }
  }

  private injectScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK_URL;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('sdk load failed'));
      document.head.appendChild(s);
    });
  }

  gameplayStart(): void {
    try {
      this.sdk?.game?.gameplayStart?.();
    } catch {
      /* ignore */
    }
  }

  gameplayStop(): void {
    try {
      this.sdk?.game?.gameplayStop?.();
    } catch {
      /* ignore */
    }
  }

  happyTime(): void {
    try {
      this.sdk?.game?.happytime?.();
    } catch {
      /* ignore */
    }
  }

  private requestAd(type: 'rewarded' | 'midgame'): Promise<AdResult> {
    const request = this.sdk?.ad?.requestAd;
    if (!request) return Promise.resolve('unavailable');
    return new Promise<AdResult>((resolve) => {
      try {
        request(type, {
          adFinished: () => {
            this.resumeFns.forEach((f) => f());
            resolve('completed');
          },
          adError: () => {
            this.resumeFns.forEach((f) => f());
            resolve('error');
          },
          adStarted: () => this.pauseFns.forEach((f) => f()),
        });
      } catch {
        resolve('error');
      }
    });
  }

  showRewarded(placement: string): Promise<AdResult> {
    this.track('rewarded_requested', { placement });
    return this.requestAd('rewarded');
  }

  showInterstitial(): Promise<AdResult> {
    this.track('interstitial_requested');
    return this.requestAd('midgame');
  }

  async save(data: string): Promise<void> {
    try {
      // SDK data module syncs to cloud for logged-in users, localStorage otherwise
      if (this.sdk?.data?.setItem) {
        this.sdk.data.setItem(SAVE_KEY, data);
        return;
      }
    } catch {
      /* fall through to localStorage */
    }
    try {
      localStorage.setItem(SAVE_KEY, data);
    } catch {
      /* non-fatal */
    }
  }

  async load(): Promise<string | null> {
    try {
      if (this.sdk?.data?.getItem) {
        const v = this.sdk.data.getItem(SAVE_KEY);
        if (v !== null) return v;
      }
    } catch {
      /* fall through */
    }
    try {
      return localStorage.getItem(SAVE_KEY);
    } catch {
      return null;
    }
  }

  track(event: string, props?: Record<string, string | number>): void {
    console.debug('[track:crazygames]', event, props ?? {});
  }

  onPause(fn: () => void): void {
    this.pauseFns.push(fn);
  }

  onResume(fn: () => void): void {
    this.resumeFns.push(fn);
  }
}
