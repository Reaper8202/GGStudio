import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

describe('audio volume preferences', () => {
  const storage = new MemoryStorage();
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  );

  beforeAll(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    });
  });

  beforeEach(() => {
    storage.clear();
    vi.resetModules();
  });

  afterAll(() => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('stores SFX and music as independent clamped values', async () => {
    const audio = await import('../src/app/sfx.ts');

    audio.setSfxVolume(0.35);
    audio.setMusicVolume(0.8);

    expect(audio.getSfxVolume()).toBe(0.35);
    expect(audio.getMusicVolume()).toBe(0.8);
    expect(storage.getItem(audio.SFX_VOLUME_STORAGE_KEY)).toBe('0.35');
    expect(storage.getItem(audio.MUSIC_VOLUME_STORAGE_KEY)).toBe('0.8');

    audio.setSfxVolume(-4);
    audio.setMusicVolume(7);
    expect(audio.getSfxVolume()).toBe(0);
    expect(audio.getMusicVolume()).toBe(1);
  });

  it('uses the legacy global mute only when new values are absent', async () => {
    storage.setItem('scraprig.sfx.muted', 'true');
    const audio = await import('../src/app/sfx.ts');

    expect(audio.getSfxVolume()).toBe(0);
    expect(audio.getMusicVolume()).toBe(0);
  });

  it('ignores legacy mute when independent values already exist', async () => {
    storage.setItem('scraprig.sfx.muted', 'true');
    storage.setItem('scraprig.sfx.volume', '0.4');
    storage.setItem('scraprig.music.volume', '0.65');
    const audio = await import('../src/app/sfx.ts');

    expect(audio.getSfxVolume()).toBe(0.4);
    expect(audio.getMusicVolume()).toBe(0.65);
  });

  it('lets platform mute override without changing either saved preference', async () => {
    const audio = await import('../src/app/sfx.ts');
    audio.setSfxVolume(0.4);
    audio.setMusicVolume(0.65);

    audio.setPlatformAudioMuted(true);
    expect(audio.isSfxMuted()).toBe(true);
    expect(audio.getSfxVolume()).toBe(0.4);
    expect(audio.getMusicVolume()).toBe(0.65);

    audio.setPlatformAudioMuted(false);
    expect(audio.isSfxMuted()).toBe(false);
    expect(audio.getSfxVolume()).toBe(0.4);
    expect(audio.getMusicVolume()).toBe(0.65);
  });
});
