import type { PlatformSDK } from '../PlatformSDK';

declare const PokiSDK: any; // injected global (script tag / portal)

/**
 * Poki adapter. Verified against INTEGRATION.md (18 Jul 2026).
 * Audio mute + input freeze during ads is handled by LifecycleGuard's
 * onAdStart/onAdEnd hooks, which fire around these calls.
 */
export class PokiProvider implements PlatformSDK {
  readonly isReal = typeof (globalThis as any).PokiSDK !== 'undefined';

  async init(): Promise<void> {
    if (!this.isReal) return;
    try {
      await PokiSDK.init();
      PokiSDK.setDebug(false);
    } catch (e) {
      // init can reject (e.g. adblock context) — never throw to caller
      console.warn('PokiSDK.init failed', e);
    }
  }

  loadingProgress(_fraction: number): void {
    // Current @poki/sdk has no progress fraction API — intentional no-op.
  }

  loadingFinished(): void {
    if (this.isReal) PokiSDK.gameLoadingFinished();
  }

  gameplayStart(): void {
    if (this.isReal) PokiSDK.gameplayStart();
  }

  gameplayStop(): void {
    if (this.isReal) PokiSDK.gameplayStop();
  }

  async commercialBreak(): Promise<void> {
    if (!this.isReal) return;
    try {
      // onStart: audio/input are already gated by LifecycleGuard
      await PokiSDK.commercialBreak(() => {});
    } catch {
      /* resume regardless */
    }
  }

  async rewardedBreak(): Promise<boolean> {
    if (!this.isReal) return true; // local dev grants reward
    try {
      // returns true only if the user watched the full video
      return await PokiSDK.rewardedBreak();
    } catch {
      return false;
    }
  }

  // HUMAN-VERIFY: core @poki/sdk exposes no cloud-save method.
  // Using localStorage. For cross-device save, integrate Poki's
  // "Arbitrary User Data Store" product and confirm its API first.
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
