/**
 * Dev / standalone adapter: localStorage saves, fake ads that resolve
 * 'completed' after ~1.5 s (the UI shows its own modal during the wait), and
 * console.debug analytics. Capabilities: everything except cloud save.
 */
import type {
  AdResult,
  PlatformAdapter,
  PlatformCapabilities,
} from './PlatformAdapter';

const SAVE_KEY = 'comfyZoo.save.v1';
const FAKE_AD_MS = 1500;

export class LocalAdapter implements PlatformAdapter {
  readonly name: PlatformAdapter['name'] = 'local';
  readonly capabilities: PlatformCapabilities = {
    rewardedAds: true,
    interstitialAds: true,
    cloudSave: false,
    softTimerFallback: false,
  };

  protected pauseFns: (() => void)[] = [];
  protected resumeFns: (() => void)[] = [];

  async init(): Promise<void> {
    /* nothing to initialize locally */
  }

  gameplayStart(): void {
    this.track('gameplay_start');
  }

  gameplayStop(): void {
    this.track('gameplay_stop');
  }

  happyTime(): void {
    this.track('happy_time');
  }

  showRewarded(placement: string): Promise<AdResult> {
    this.track('rewarded_shown', { placement });
    return new Promise((resolve) => {
      setTimeout(() => resolve('completed'), FAKE_AD_MS);
    });
  }

  showInterstitial(): Promise<AdResult> {
    this.track('interstitial_shown');
    return new Promise((resolve) => {
      setTimeout(() => resolve('completed'), 400);
    });
  }

  async save(data: string): Promise<void> {
    try {
      localStorage.setItem(SAVE_KEY, data);
    } catch {
      /* storage full / private mode — non-fatal */
    }
  }

  async load(): Promise<string | null> {
    try {
      return localStorage.getItem(SAVE_KEY);
    } catch {
      return null;
    }
  }

  track(event: string, props?: Record<string, string | number>): void {
    console.debug('[track]', event, props ?? {});
  }

  onPause(fn: () => void): void {
    this.pauseFns.push(fn);
  }

  onResume(fn: () => void): void {
    this.resumeFns.push(fn);
  }
}
