import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeScript {
  async: boolean;
  onerror: (() => void) | null;
  onload: (() => void) | null;
  src: string;
}

interface StubSdkOptions {
  environment?: string;
  game?: {
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?: (
      listener: (settings: { muteAudio?: boolean }) => void,
    ) => void;
    removeSettingsChangeListener?: (
      listener: (settings: { muteAudio?: boolean }) => void,
    ) => void;
    gameplayStart?: () => Promise<unknown> | unknown;
    gameplayStop?: () => Promise<unknown> | unknown;
    loadingStart?: () => Promise<unknown> | unknown;
    loadingStop?: () => Promise<unknown> | unknown;
  };
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
  const sdk = {
    environment: options.environment ?? 'local',
    game: options.game,
    init: options.init,
    user: {
      submitScore: options.submitScore,
    },
  };
  const fakeWindow: {
    CrazyGames?: {
      SDK: typeof sdk;
    };
  } = {};
  vi.stubGlobal('window', fakeWindow);
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
        queueMicrotask(() => {
          fakeWindow.CrazyGames = { SDK: sdk };
          script.onload?.();
        });
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
  vi.useRealTimers();
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

  it('boots after the watchdog without cancelling late SDK initialization', async () => {
    vi.useFakeTimers();
    let releaseInit: (() => void) | undefined;
    const init = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseInit = resolve;
        }),
    );
    installSdkEnvironment({ init });
    const sdk = await import('../src/app/crazyGamesSdk.ts');

    const bootAttempt = sdk.initCrazyGamesForBoot();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(bootAttempt).resolves.toBe(false);

    releaseInit?.();
    await expect(sdk.initCrazyGames()).resolves.toBe(true);
    expect(sdk.isCrazyGamesAvailable()).toBe(true);
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

  it('reports loading/gameplay state once and follows platform mute changes', async () => {
    const gameplayStart = vi.fn();
    const gameplayStop = vi.fn();
    const loadingStart = vi.fn();
    const loadingStop = vi.fn();
    let settingsListener:
      ((settings: { muteAudio?: boolean }) => void) | undefined;
    installSdkEnvironment({
      environment: 'local',
      init: vi.fn().mockResolvedValue(undefined),
      game: {
        settings: { muteAudio: true },
        addSettingsChangeListener: vi.fn((listener) => {
          settingsListener = listener;
        }),
        gameplayStart,
        gameplayStop,
        loadingStart,
        loadingStop,
      },
    });
    const sdk = await import('../src/app/crazyGamesSdk.ts');
    const muteListener = vi.fn();
    const unsubscribe = sdk.subscribeCrazyGamesAudioMute(muteListener);

    await expect(sdk.initCrazyGames()).resolves.toBe(true);
    expect(muteListener).toHaveBeenLastCalledWith(true);
    settingsListener?.({ muteAudio: false });
    expect(muteListener).toHaveBeenLastCalledWith(false);

    expect(await sdk.startCrazyGamesLoading()).toBe(true);
    expect(await sdk.startCrazyGamesLoading()).toBe(false);
    expect(await sdk.stopCrazyGamesLoading()).toBe(true);
    expect(loadingStart).toHaveBeenCalledOnce();
    expect(loadingStop).toHaveBeenCalledOnce();

    sdk.setCrazyGamesGameplayActive(true);
    await vi.waitFor(() => expect(gameplayStart).toHaveBeenCalledOnce());
    sdk.setCrazyGamesGameplayActive(true);
    await Promise.resolve();
    expect(gameplayStart).toHaveBeenCalledOnce();
    sdk.setCrazyGamesGameplayActive(false);
    await vi.waitFor(() => expect(gameplayStop).toHaveBeenCalledOnce());

    unsubscribe();
    settingsListener?.({ muteAudio: true });
    expect(muteListener).toHaveBeenCalledTimes(3);
  });

  it('retries initialization after a failed attempt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const init = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined);
    const { appendedScripts } = installSdkEnvironment({ init });
    const { initCrazyGames } = await import('../src/app/crazyGamesSdk.ts');

    await expect(initCrazyGames()).resolves.toBe(false);
    vi.setSystemTime(4_000);
    await expect(initCrazyGames()).resolves.toBe(true);
    expect(init).toHaveBeenCalledTimes(2);
    expect(appendedScripts).toHaveLength(1);
    vi.useRealTimers();
  });

  it('does not call game APIs in the disabled environment', async () => {
    const gameplayStart = vi.fn();
    vi.stubGlobal('window', {
      CrazyGames: {
        SDK: {
          environment: 'disabled',
          init: vi.fn(),
          game: { gameplayStart },
        },
      },
    });
    const sdk = await import('../src/app/crazyGamesSdk.ts');

    await expect(sdk.initCrazyGames()).resolves.toBe(false);
    sdk.setCrazyGamesGameplayActive(true);
    await Promise.resolve();
    expect(gameplayStart).not.toHaveBeenCalled();
  });
});
