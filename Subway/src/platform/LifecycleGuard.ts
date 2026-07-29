import type { PlatformSDK } from './PlatformSDK';

/**
 * Wraps any provider and enforces the event-timing contract portal QA
 * rejects on (spec §5.2):
 *  - gameplayStart/gameplayStop strictly paired (never two of the same in a row)
 *  - no SDK events fire during an ad
 *  - audio muted + input frozen for the duration of any ad via the
 *    onAdStart/onAdEnd hooks (set by main.ts)
 * Violations are swallowed (never forwarded to the vendor SDK) and logged, so
 * acceptance testing can assert on `[SDKGuard]` warnings.
 */
export class LifecycleGuard implements PlatformSDK {
  private inGameplay = false;
  private inAd = false;

  /** Hooks for the game shell: mute audio / freeze input during ads. */
  onAdStart: () => void = () => {};
  onAdEnd: () => void = () => {};

  constructor(private readonly inner: PlatformSDK) {}

  get isReal(): boolean {
    return this.inner.isReal;
  }

  private violation(msg: string): void {
    console.warn(`[SDKGuard] VIOLATION: ${msg}`);
  }

  async init(): Promise<void> {
    try {
      await this.inner.init();
    } catch (e) {
      console.warn('[SDKGuard] init failed (continuing without portal)', e);
    }
  }

  loadingProgress(fraction: number): void {
    if (this.inAd) return this.violation('loadingProgress during ad');
    this.inner.loadingProgress(fraction);
  }

  loadingFinished(): void {
    if (this.inAd) return this.violation('loadingFinished during ad');
    this.inner.loadingFinished();
  }

  gameplayStart(): void {
    if (this.inAd) return this.violation('gameplayStart during ad');
    if (this.inGameplay) return this.violation('gameplayStart while already in gameplay');
    this.inGameplay = true;
    this.inner.gameplayStart();
  }

  gameplayStop(): void {
    if (this.inAd) return this.violation('gameplayStop during ad');
    if (!this.inGameplay) return this.violation('gameplayStop while not in gameplay');
    this.inGameplay = false;
    this.inner.gameplayStop();
  }

  async commercialBreak(): Promise<void> {
    if (this.inAd) return this.violation('commercialBreak during ad');
    if (this.inGameplay) this.violation('commercialBreak during active gameplay (stop first)');
    this.inAd = true;
    this.onAdStart();
    try {
      await this.inner.commercialBreak();
    } catch {
      /* resume regardless */
    } finally {
      this.inAd = false;
      this.onAdEnd();
    }
  }

  async rewardedBreak(): Promise<boolean> {
    if (this.inAd) {
      this.violation('rewardedBreak during ad');
      return false;
    }
    if (this.inGameplay) this.violation('rewardedBreak during active gameplay (stop first)');
    this.inAd = true;
    this.onAdStart();
    try {
      return await this.inner.rewardedBreak();
    } catch {
      return false;
    } finally {
      this.inAd = false;
      this.onAdEnd();
    }
  }

  save(key: string, value: string): Promise<void> {
    return this.inner.save(key, value);
  }

  load(key: string): Promise<string | null> {
    return this.inner.load(key);
  }
}
