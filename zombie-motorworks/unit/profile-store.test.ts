import { describe, expect, it } from 'vitest';
import {
  PROFILE_STORAGE_KEY,
  ProfileStore,
  type ProfileStorage,
} from '../src/app/profileStore.ts';
import {
  decodeProfile,
  defaultProfile,
  encodeProfile,
  STARTER_UNLOCKS,
  type PlayerProfile,
} from '../src/core/profile.ts';

class MemoryStorage implements ProfileStorage {
  readonly values = new Map<string, string>();
  reads = 0;
  writes = 0;

  getItem(key: string): string | null {
    this.reads++;
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes++;
    this.values.set(key, value);
  }
}

describe('profile store', () => {
  it('loads through the codec exactly once and returns the cached profile', () => {
    const storage = new MemoryStorage();
    storage.values.set(
      PROFILE_STORAGE_KEY,
      encodeProfile({
        schemaVersion: 1,
        money: 340,
        unlockedDefIds: ['frame-reinforced'],
      }),
    );
    const store = new ProfileStore(storage);

    const first = store.load();
    const second = store.load();

    expect(first).toEqual({
      schemaVersion: 1,
      money: 340,
      unlockedDefIds: [...STARTER_UNLOCKS, 'frame-reinforced'],
    });
    expect(second).toBe(first);
    expect(storage.reads).toBe(1);
  });

  it('saves with the codec and refreshes the cache without another read', () => {
    const storage = new MemoryStorage();
    const store = new ProfileStore(storage);
    const profile: PlayerProfile = {
      schemaVersion: 1,
      money: 85,
      unlockedDefIds: ['wheel-offroad'],
      currentBlueprintName: 'Tow Rig',
    };

    expect(() => store.save(profile)).not.toThrow();

    const persisted = storage.values.get(PROFILE_STORAGE_KEY);
    expect(decodeProfile(persisted)).toEqual({
      ...profile,
      unlockedDefIds: [...STARTER_UNLOCKS, 'wheel-offroad'],
    });
    expect(store.load()).toEqual(decodeProfile(encodeProfile(profile)));
    expect(store.load()).toBe(profile);
    expect(storage.reads).toBe(0);
    expect(storage.writes).toBe(1);
  });

  it('never throws when storage reads or writes fail', () => {
    const storage: ProfileStorage = {
      getItem() {
        throw new Error('read denied');
      },
      setItem() {
        throw new Error('write denied');
      },
    };
    const store = new ProfileStore(storage);

    expect(store.load()).toEqual(defaultProfile());
    expect(() => store.save(defaultProfile())).not.toThrow();
    expect(store.load()).toEqual(defaultProfile());
  });
});
