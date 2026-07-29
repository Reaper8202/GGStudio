import type { PlatformSDK } from '../PlatformSDK';

/**
 * Dev/no-portal provider. Logs every lifecycle event (acceptance criterion 7
 * is asserted against these logs), fakes ads, persists via localStorage.
 */
export class LocalProvider implements PlatformSDK {
  readonly isReal = false;

  private log(msg: string): void {
    console.info(`[LocalSDK] ${msg}`);
  }

  async init(): Promise<void> {
    this.log('init');
  }

  loadingProgress(fraction: number): void {
    this.log(`loadingProgress ${fraction.toFixed(2)}`);
  }

  loadingFinished(): void {
    this.log('loadingFinished');
  }

  gameplayStart(): void {
    this.log('gameplayStart');
  }

  gameplayStop(): void {
    this.log('gameplayStop');
  }

  async commercialBreak(): Promise<void> {
    this.log('commercialBreak (no-op)');
  }

  async rewardedBreak(): Promise<boolean> {
    this.log('rewardedBreak (fake 1s ad, granting reward)');
    await new Promise((r) => setTimeout(r, 1000));
    return true;
  }

  async save(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable (private mode) — high score just won't persist */
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
