/**
 * CrazyGames SDK boundary. The encryption key is a build-time environment
 * variable; without it the game falls back to its local leaderboard. Submitted
 * scores are re-validated server-side by CrazyGames.
 */

const CRAZYGAMES_SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const CRAZYGAMES_LOAD_TIMEOUT_MS = 3_000;
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

interface CrazyGamesSdk {
  init?: () => Promise<unknown>;
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

function loadCrazyGamesScript(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (loaded: boolean): void => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      resolve(loaded);
    };

    try {
      if (typeof document === 'undefined') {
        finish(false);
        return;
      }

      const script = document.createElement('script');
      script.src = CRAZYGAMES_SDK_URL;
      script.async = true;
      script.onload = () => finish(true);
      script.onerror = () => finish(false);

      timeout = setTimeout(() => finish(false), CRAZYGAMES_LOAD_TIMEOUT_MS);

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
}

async function initializeCrazyGames(): Promise<boolean> {
  try {
    if (typeof window === 'undefined') return false;
    if (!(await loadCrazyGamesScript())) return false;

    const sdk = window.CrazyGames?.SDK;
    if (sdk?.init === undefined) return false;

    await sdk?.init?.();
    available = true;
    return true;
  } catch {
    return false;
  }
}

/** Loads and initializes the CrazyGames SDK. Resolves false when unavailable. */
export function initCrazyGames(): Promise<boolean> {
  initialization ??= initializeCrazyGames();
  return initialization;
}

/** True once init succeeded. */
export function isCrazyGamesAvailable(): boolean {
  return available;
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
    const user = window.CrazyGames?.SDK?.user;
    if (encryptedScore === null || user?.submitScore === undefined)
      return false;

    await user?.submitScore?.({ encryptedScore, score });
    return true;
  } catch {
    return false;
  }
}
