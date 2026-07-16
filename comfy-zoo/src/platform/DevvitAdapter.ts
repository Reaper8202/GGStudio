/**
 * Reddit Devvit adapter — thin stub over local behavior for now. Monetization
 * there is Developer-Funds based (no ad SDK), so rewarded flows resolve like
 * local fake ads and saves live in webview localStorage until the Devvit Web
 * storage bridge is wired up.
 */
import { LocalAdapter } from './LocalAdapter';
import type { PlatformAdapter } from './PlatformAdapter';

export function isDevvit(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('platform') === 'devvit') {
      return true;
    }
  } catch {
    /* ignore */
  }
  return 'devvit' in window;
}

export class DevvitAdapter extends LocalAdapter {
  override readonly name: PlatformAdapter['name'] = 'devvit';

  override track(event: string, props?: Record<string, string | number>): void {
    console.debug('[track:devvit]', event, props ?? {});
  }
}
