import { LocalProvider } from './providers/LocalProvider';
import { PokiProvider } from './providers/PokiProvider';
import { CrazyGamesProvider } from './providers/CrazyGamesProvider';
import { LifecycleGuard } from './LifecycleGuard';
import type { PlatformSDK } from './PlatformSDK';

/**
 * Choose the active provider at runtime:
 *   1. explicit `?provider=poki|crazy|local` query param
 *   2. sniff injected vendor globals
 *   3. fall back to LocalProvider
 * The result is always wrapped in LifecycleGuard.
 * CrazyGames local testing: append `?useLocalSdk=true` (their SDK flag).
 */
export function selectProvider(): LifecycleGuard {
  const provider = pick();
  console.info(`[Platform] provider: ${provider.constructor.name}`);
  return new LifecycleGuard(provider);
}

function pick(): PlatformSDK {
  const q = new URLSearchParams(location.search).get('provider');
  if (q === 'poki') return new PokiProvider();
  if (q === 'crazy') return new CrazyGamesProvider();
  if (q === 'local') return new LocalProvider();

  if (typeof (globalThis as any).PokiSDK !== 'undefined') return new PokiProvider();
  if (typeof window.CrazyGames !== 'undefined') return new CrazyGamesProvider();
  return new LocalProvider();
}
