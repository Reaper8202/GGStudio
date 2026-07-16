/**
 * Shared contract — every ad, save, and analytics call goes through this interface.
 * Porting to a new portal means writing one adapter file. DO NOT EDIT outside
 * orchestrator review.
 */

export interface PlatformCapabilities {
  rewardedAds: boolean;
  interstitialAds: boolean;
  cloudSave: boolean;
  /** Playables: no ad SDK — ad-gated content falls back to soft timers */
  softTimerFallback: boolean;
}

export type AdResult = 'completed' | 'dismissed' | 'unavailable' | 'error';

export interface PlatformAdapter {
  readonly name: 'local' | 'crazygames' | 'playables' | 'devvit';
  readonly capabilities: PlatformCapabilities;

  init(): Promise<void>;

  /** Wrap actual play vs. menu time (CrazyGames gameplayStart/Stop). */
  gameplayStart(): void;
  gameplayStop(): void;

  /** Celebratory hook (CrazyGames happytime) — call on captures and upgrades. */
  happyTime(): void;

  /** Resolves after the ad flow finishes. Core grants rewards only on 'completed'. */
  showRewarded(placement: string): Promise<AdResult>;
  /** Core is responsible for throttling (balance.interstitialMinIntervalSeconds). */
  showInterstitial(): Promise<AdResult>;

  /** Serialized save blob. Local adapters use localStorage; CrazyGames uses cloud. */
  save(data: string): Promise<void>;
  load(): Promise<string | null>;

  /** Lightweight custom analytics events (session_length, first_capture_time, …). */
  track(event: string, props?: Record<string, string | number>): void;

  /** Platform pause/resume lifecycle (Playables cert requirement). Core subscribes. */
  onPause(fn: () => void): void;
  onResume(fn: () => void): void;
}
