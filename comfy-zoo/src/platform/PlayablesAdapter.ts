/**
 * YouTube Playables adapter. No ad SDK on this platform — capabilities advertise
 * softTimerFallback so AdEventSystem turns every ad gate into a friendly wait
 * timer ("the Spirit Horse returns in a bit"). Saves stay in localStorage.
 * Pause/resume hooks are wired to visibility (the cert-relevant lifecycle is
 * also handled centrally in Game via visibilitychange).
 */
import { LocalAdapter } from './LocalAdapter';
import type { AdResult, PlatformCapabilities, PlatformAdapter } from './PlatformAdapter';

export function isPlayables(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('platform') === 'playables') {
      return true;
    }
  } catch {
    /* ignore */
  }
  return 'ytgame' in window;
}

export class PlayablesAdapter extends LocalAdapter {
  override readonly name: PlatformAdapter['name'] = 'playables';
  override readonly capabilities: PlatformCapabilities = {
    rewardedAds: false,
    interstitialAds: false,
    cloudSave: false,
    softTimerFallback: true,
  };

  override showRewarded(placement: string): Promise<AdResult> {
    this.track('rewarded_unavailable', { placement });
    return Promise.resolve('unavailable');
  }

  override showInterstitial(): Promise<AdResult> {
    return Promise.resolve('unavailable');
  }
}
