/**
 * ⭐ The architectural spine. Gameplay code talks ONLY to this interface —
 * never to a vendor SDK. Providers live in ./providers, selection happens in
 * ./detect.ts, and every provider is wrapped in LifecycleGuard (which
 * enforces the portal QA event-timing contract).
 */
export interface PlatformSDK {
  /** Call once at boot. Loads/inits the vendor SDK. Never throws to caller. */
  init(): Promise<void>;

  /** Report asset-load progress 0..1 during Preload (Poki wants this). */
  loadingProgress(fraction: number): void;
  loadingFinished(): void;

  /** Fire on the player's FIRST input of a run — NOT on scene load. */
  gameplayStart(): void;

  /** Fire on ANY interruption: game over, pause, menu open, revive prompt. */
  gameplayStop(): void;

  /**
   * Interstitial between runs / returning from pause.
   * MUST await before resuming gameplay. No game logic runs during the ad.
   */
  commercialBreak(): Promise<void>;

  /**
   * Rewarded video (used for revive). Resolves true if fully watched.
   * Caller grants the reward only on true.
   */
  rewardedBreak(): Promise<boolean>;

  /** Cloud save/load (falls back to localStorage in LocalProvider). */
  save(key: string, value: string): Promise<void>;
  load(key: string): Promise<string | null>;

  /** true only on a real portal environment (ads available). */
  readonly isReal: boolean;
}
