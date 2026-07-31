/**
 * CrazyGames SDK boundary. The encryption key is a build-time environment
 * variable; without it the game falls back to its local leaderboard. Submitted
 * scores are re-validated server-side by CrazyGames.
 */

const CRAZYGAMES_SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const CRAZYGAMES_BOOT_WAIT_MS = 3_000;
const CRAZYGAMES_RETRY_COOLDOWN_MS = 2_000;
const AES_GCM_IV_BYTES = 12;
const AES_KEY_BYTES = 32;

interface CrazyGamesScoreSubmission {
  encryptedScore: string;
  score: number;
}

interface CrazyGamesUserSdk {
  submitScore?: (
    submission: CrazyGamesScoreSubmission,
  ) => Promise<unknown> | unknown;
}

interface CrazyGamesGameSettings {
  readonly muteAudio?: boolean;
}

type CrazyGamesSettingsListener = (settings: CrazyGamesGameSettings) => void;

interface CrazyGamesGameSdk {
  readonly settings?: CrazyGamesGameSettings;
  addSettingsChangeListener?: (listener: CrazyGamesSettingsListener) => void;
  removeSettingsChangeListener?: (listener: CrazyGamesSettingsListener) => void;
  gameplayStart?: () => Promise<unknown> | unknown;
  gameplayStop?: () => Promise<unknown> | unknown;
  loadingStart?: () => Promise<unknown> | unknown;
  loadingStop?: () => Promise<unknown> | unknown;
}

interface CrazyGamesSdk {
  init?: () => Promise<unknown>;
  environment?: string;
  game?: CrazyGamesGameSdk;
  user?: CrazyGamesUserSdk;
}

declare global {
  interface Window {
    CrazyGames?: {
      SDK?: CrazyGamesSdk;
    };
  }
}

let initialization: Promise<boolean> | undefined;
let available = false;
let nextRetryAt = 0;
let loadingScript: HTMLScriptElement | null = null;
let scriptLoad: Promise<boolean> | undefined;
let settingsGame: CrazyGamesGameSdk | null = null;
let platformMuted = false;
let gameplayWanted = false;
let gameplayReported = false;
let gameplaySync: Promise<void> | undefined;
let loadingReported = false;

const muteListeners = new Set<(muted: boolean) => void>();

function currentSdk(): CrazyGamesSdk | undefined {
  return typeof window === 'undefined' ? undefined : window.CrazyGames?.SDK;
}

function usableSdk(): CrazyGamesSdk | undefined {
  const sdk = currentSdk();
  return sdk?.environment === 'local' || sdk?.environment === 'crazygames'
    ? sdk
    : undefined;
}

function loadCrazyGamesScript(): Promise<boolean> {
  if (currentSdk()?.environment === 'disabled') return Promise.resolve(false);
  if (usableSdk() !== undefined) return Promise.resolve(true);
  if (scriptLoad !== undefined) return scriptLoad;

  const attempt = new Promise<boolean>((resolve) => {
    let settled = false;
    let script: HTMLScriptElement | null = null;

    const finish = (loaded: boolean): void => {
      if (settled) return;
      settled = true;
      if (!loaded && script !== null) {
        script.onload = null;
        script.onerror = null;
        script.remove?.();
        if (loadingScript === script) loadingScript = null;
      }
      resolve(loaded);
    };

    try {
      if (typeof document === 'undefined') {
        finish(false);
        return;
      }

      script = document.createElement('script');
      script.src = CRAZYGAMES_SDK_URL;
      script.async = true;
      script.onload = () => finish(true);
      script.onerror = () => finish(false);
      loadingScript = script;

      const parent = document.head ?? document.documentElement;
      if (parent === null) {
        finish(false);
        return;
      }
      parent.appendChild(script);
    } catch {
      finish(false);
    }
  });
  scriptLoad = attempt.finally(() => {
    scriptLoad = undefined;
  });
  return scriptLoad;
}

function publishPlatformMute(muted: boolean): void {
  if (platformMuted === muted) return;
  platformMuted = muted;
  for (const listener of muteListeners) listener(platformMuted);
}

const onSettingsChanged: CrazyGamesSettingsListener = (settings): void => {
  publishPlatformMute(settings.muteAudio === true);
};

function attachSettingsListener(game: CrazyGamesGameSdk | undefined): void {
  if (settingsGame !== game) {
    settingsGame?.removeSettingsChangeListener?.(onSettingsChanged);
    settingsGame = game ?? null;
    settingsGame?.addSettingsChangeListener?.(onSettingsChanged);
  }
  publishPlatformMute(game?.settings?.muteAudio === true);
}

async function reportGameplayState(sdk: CrazyGamesSdk): Promise<void> {
  const game = sdk.game;
  const desired = gameplayWanted;
  if (desired === gameplayReported) return;
  const report = desired ? game?.gameplayStart : game?.gameplayStop;
  if (report === undefined) return;
  try {
    await report.call(game);
    gameplayReported = desired;
  } catch {
    // The disabled environment and temporary SDK failures must not stop play.
  }
}

async function initializeCrazyGames(): Promise<boolean> {
  try {
    if (typeof window === 'undefined') return false;
    if (usableSdk() === undefined && !(await loadCrazyGamesScript())) {
      nextRetryAt = Date.now() + CRAZYGAMES_RETRY_COOLDOWN_MS;
      return false;
    }

    const sdk = usableSdk();
    if (sdk?.init === undefined) return false;

    await sdk.init();
    available = true;
    nextRetryAt = 0;
    attachSettingsListener(sdk.game);
    await reportGameplayState(sdk);
    return true;
  } catch {
    nextRetryAt = Date.now() + CRAZYGAMES_RETRY_COOLDOWN_MS;
    return false;
  }
}

/**
 * Loads and initializes the CrazyGames SDK. Concurrent calls share one attempt;
 * a failed attempt is released after a short cooldown so a late network or SDK
 * recovery can succeed on the next lifecycle event or score submission.
 */
export function initCrazyGames(): Promise<boolean> {
  if (available) return Promise.resolve(true);
  if (initialization !== undefined) return initialization;
  if (Date.now() < nextRetryAt) return Promise.resolve(false);
  const attempt = initializeCrazyGames();
  initialization = attempt.finally(() => {
    initialization = undefined;
  });
  return initialization;
}

/**
 * Give the SDK a short chance to initialize before booting the game. The
 * underlying initialization is deliberately left alive after this watchdog;
 * a slow CDN response can still complete and service later lifecycle/score calls.
 */
export async function initCrazyGamesForBoot(): Promise<boolean> {
  const initializationAttempt = initCrazyGames();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      initializationAttempt,
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), CRAZYGAMES_BOOT_WAIT_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** True once init succeeded. */
export function isCrazyGamesAvailable(): boolean {
  return available;
}

/** Subscribe to the platform-level audio override; current state is emitted immediately. */
export function subscribeCrazyGamesAudioMute(
  listener: (muted: boolean) => void,
): () => void {
  muteListeners.add(listener);
  listener(platformMuted);
  void initCrazyGames();
  return () => muteListeners.delete(listener);
}

/**
 * Report whether the player is actively playing rather than in a menu, pause,
 * result card, or another gameplay break. Calls are coalesced and
 * the most recent desired state wins even while SDK initialization is pending.
 */
export function setCrazyGamesGameplayActive(active: boolean): void {
  gameplayWanted = Boolean(active);
  if (gameplaySync !== undefined) return;
  gameplaySync = (async () => {
    let before: boolean;
    do {
      before = gameplayWanted;
      if (await initCrazyGames()) {
        const sdk = usableSdk();
        if (sdk) await reportGameplayState(sdk);
      }
    } while (before !== gameplayWanted);
  })().finally(() => {
    gameplaySync = undefined;
  });
}

export async function startCrazyGamesLoading(): Promise<boolean> {
  if (!(await initCrazyGames())) return false;
  const game = usableSdk()?.game;
  if (loadingReported || game?.loadingStart === undefined) return false;
  try {
    await game.loadingStart();
    loadingReported = true;
    return true;
  } catch {
    return false;
  }
}

export async function stopCrazyGamesLoading(): Promise<boolean> {
  if (!(await initCrazyGames())) return false;
  const game = usableSdk()?.game;
  if (!loadingReported || game?.loadingStop === undefined) return false;
  try {
    await game.loadingStop();
    loadingReported = false;
    return true;
  } catch {
    return false;
  }
}

function decodeEncryptionKey(
  base64Key: string,
): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = globalThis.atob(base64Key);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.length === AES_KEY_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

function encodeBase64(bytes: Uint8Array): string | null {
  try {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return globalThis.btoa(binary);
  } catch {
    return null;
  }
}

/** Encrypts a score using CrazyGames' AES-GCM payload format. */
export async function encryptScore(
  score: number,
  base64Key: string,
): Promise<string | null> {
  try {
    const keyBytes = decodeEncryptionKey(base64Key);
    const cryptoApi = globalThis.crypto;
    if (keyBytes === null || cryptoApi?.subtle === undefined) return null;

    const iv = cryptoApi.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
    const key = await cryptoApi.subtle.importKey(
      'raw',
      keyBytes,
      'AES-GCM',
      false,
      ['encrypt'],
    );
    const plaintext = new TextEncoder().encode(String(score));
    const ciphertext = await cryptoApi.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext,
    );
    const payload = new Uint8Array(iv.length + ciphertext.byteLength);
    payload.set(iv);
    payload.set(new Uint8Array(ciphertext), iv.length);
    return encodeBase64(payload);
  } catch {
    return null;
  }
}

/**
 * Submits a final run score. Fire-and-forget: resolves false when the SDK or
 * the encryption key is unavailable, or when submission fails.
 */
export async function submitCrazyGamesScore(score: number): Promise<boolean> {
  try {
    const encryptionKey =
      import.meta.env.VITE_CRAZYGAMES_ENCRYPTION_KEY?.trim();
    if (!encryptionKey || !(await initCrazyGames())) return false;

    const encryptedScore = await encryptScore(score, encryptionKey);
    const user = usableSdk()?.user;
    if (encryptedScore === null || user?.submitScore === undefined)
      return false;

    await user?.submitScore?.({ encryptedScore, score });
    return true;
  } catch {
    return false;
  }
}
