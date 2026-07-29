import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeScript {
  async: boolean;
  onerror: (() => void) | null;
  onload: (() => void) | null;
  src: string;
}

interface StubSdkOptions {
  init?: () => Promise<unknown>;
  submitScore?: (submission: {
    encryptedScore: string;
    score: number;
  }) => Promise<unknown> | unknown;
}

function encryptionKey(): string {
  const bytes = Array.from({ length: 32 }, (_, index) => index + 1);
  return btoa(String.fromCharCode(...bytes));
}

function installSdkEnvironment(options: StubSdkOptions): {
  appendedScripts: FakeScript[];
} {
  const appendedScripts: FakeScript[] = [];
  vi.stubGlobal('window', {
    CrazyGames: {
      SDK: {
        init: options.init,
        user: {
          submitScore: options.submitScore,
        },
      },
    },
  });
  vi.stubGlobal('document', {
    createElement: () => ({
      async: false,
      onerror: null,
      onload: null,
      src: '',
    }),
    documentElement: null,
    head: {
      appendChild(script: FakeScript) {
        appendedScripts.push(script);
        queueMicrotask(() => script.onload?.());
        return script;
      },
    },
  });
  return { appendedScripts };
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('CrazyGames SDK wrapper', () => {
  it('resolves false without throwing when CrazyGames is unavailable', async () => {
    const { initCrazyGames, submitCrazyGamesScore } =
      await import('../src/app/crazyGamesSdk.ts');

    await expect(initCrazyGames()).resolves.toBe(false);
    await expect(submitCrazyGamesScore(125)).resolves.toBe(false);
  });

  it('encrypts and submits a score once when the SDK is available', async () => {
    const init = vi.fn().mockResolvedValue(undefined);
    const submitScore = vi.fn().mockResolvedValue(undefined);
    const { appendedScripts } = installSdkEnvironment({
      init,
      submitScore,
    });
    vi.stubEnv('VITE_CRAZYGAMES_ENCRYPTION_KEY', encryptionKey());
    const { submitCrazyGamesScore } =
      await import('../src/app/crazyGamesSdk.ts');

    await expect(submitCrazyGamesScore(12_345)).resolves.toBe(true);

    expect(appendedScripts).toHaveLength(1);
    expect(init).toHaveBeenCalledOnce();
    expect(submitScore).toHaveBeenCalledOnce();
    const submission = submitScore.mock.calls[0]?.[0];
    expect(submission?.score).toBe(12_345);
    expect(submission?.encryptedScore).toBeTruthy();
    expect(submission?.encryptedScore).not.toBe('12345');
  });

  it('resolves false when the SDK throws during score submission', async () => {
    const submitScore = vi.fn(() => {
      throw new Error('SDK rejected');
    });
    installSdkEnvironment({
      init: vi.fn().mockResolvedValue(undefined),
      submitScore,
    });
    vi.stubEnv('VITE_CRAZYGAMES_ENCRYPTION_KEY', encryptionKey());
    const { submitCrazyGamesScore } =
      await import('../src/app/crazyGamesSdk.ts');

    await expect(submitCrazyGamesScore(850)).resolves.toBe(false);
    expect(submitScore).toHaveBeenCalledOnce();
  });

  it('shares initialization and injects the SDK script only once', async () => {
    const { appendedScripts } = installSdkEnvironment({
      init: vi.fn().mockResolvedValue(undefined),
    });
    const { initCrazyGames, isCrazyGamesAvailable } =
      await import('../src/app/crazyGamesSdk.ts');

    expect(isCrazyGamesAvailable()).toBe(false);
    const first = initCrazyGames();
    const second = initCrazyGames();

    expect(second).toBe(first);
    await expect(first).resolves.toBe(true);
    expect(isCrazyGamesAvailable()).toBe(true);
    await expect(initCrazyGames()).resolves.toBe(true);
    expect(appendedScripts).toHaveLength(1);
  });

  it('round-trips the CrazyGames AES-GCM score payload', async () => {
    const { encryptScore } = await import('../src/app/crazyGamesSdk.ts');
    const base64Key = encryptionKey();
    const encrypted = await encryptScore(98_765, base64Key);

    expect(encrypted).not.toBeNull();
    if (encrypted === null) throw new Error('Expected an encrypted score');

    const payload = decodeBase64(encrypted);
    const iv = payload.slice(0, 12);
    const ciphertext = payload.slice(12);
    const key = await crypto.subtle.importKey(
      'raw',
      decodeBase64(base64Key),
      'AES-GCM',
      false,
      ['decrypt'],
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    );

    expect(new TextDecoder().decode(plaintext)).toBe('98765');
  });
});
