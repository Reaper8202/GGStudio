import {
  decodeProfile,
  encodeProfile,
  type PlayerProfile,
} from '../core/profile.ts';
import { gameStorage } from './gameStorage.ts';

export const PROFILE_STORAGE_KEY = 'scraprig.profile.v1';

export interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Cached profile persistence at the application boundary. */
export class ProfileStore {
  private cached: PlayerProfile | undefined;

  constructor(private readonly storage: ProfileStorage | null = gameStorage) {}

  load(): PlayerProfile {
    if (this.cached !== undefined) return this.cached;

    let json: string | null = null;
    try {
      json = this.storage?.getItem(PROFILE_STORAGE_KEY) ?? null;
    } catch {
      // Storage access can fail in privacy mode or under a restrictive origin.
    }
    this.cached = decodeProfile(json);
    return this.cached;
  }

  save(profile: PlayerProfile): void {
    const normalized = decodeProfile(encodeProfile(profile));
    profile.schemaVersion = normalized.schemaVersion;
    profile.money = normalized.money;
    profile.unlockedDefIds = [...normalized.unlockedDefIds];
    if (normalized.currentBlueprintName === undefined) {
      delete profile.currentBlueprintName;
    } else {
      profile.currentBlueprintName = normalized.currentBlueprintName;
    }
    if (this.storage === null) throw new Error('Profile storage unavailable');
    this.storage.setItem(PROFILE_STORAGE_KEY, encodeProfile(profile));
    this.cached = profile;
  }
}

export const profileStore = new ProfileStore();
