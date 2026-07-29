/**
 * The dev tuner is a build-time/runtime opt-in that never ships enabled in the
 * public CrazyGames build. It mounts only when the URL carries `?dev=1` (or in a
 * Vite dev build, which is already developer-only). Kept in its own module so
 * both `main.ts` and `SurvivalMode` can ask the same question cheaply.
 */
let cachedDevMode: boolean | null = null;

export function isDevMode(): boolean {
  if (cachedDevMode !== null) return cachedDevMode;
  let enabled = false;
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    enabled = params.get('dev') === '1';
  } catch {
    enabled = false;
  }
  cachedDevMode = enabled;
  return enabled;
}

/** Test/manual override so unit tests can force the flag deterministically. */
export function setDevModeForTesting(value: boolean | null): void {
  cachedDevMode = value;
}
