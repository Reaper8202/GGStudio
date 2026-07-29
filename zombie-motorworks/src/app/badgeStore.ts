import { BADGES, getBadge } from '../core/badges.ts';

export const BADGE_STORAGE_KEY = 'scraprig.badges.v1';
export const WAVE_TIMES_STORAGE_KEY = 'scraprig.waveTimes.v1';

export interface BadgeRecord {
  id: string;
  /** Epoch ms of the first time this badge was ever earned. */
  firstEarnedAt: number;
  /** Lifetime times earned. */
  count: number;
}

export type BadgeCollection = Record<string, BadgeRecord>;

export interface BadgeRecordResult {
  collection: BadgeCollection;
  /** Ids earned for the very first time by this call — these get the flourish. */
  newlyEarned: readonly string[];
}

export interface BadgeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): BadgeStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeCollection(json: string | null): BadgeCollection {
  if (json === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (!isObject(parsed)) return {};

  const collection: BadgeCollection = {};
  for (const value of Object.values(parsed)) {
    if (!isObject(value)) continue;
    const { id, firstEarnedAt, count } = value;
    if (
      typeof id !== 'string' ||
      !Number.isFinite(firstEarnedAt) ||
      !Number.isFinite(count) ||
      (count as number) < 1 ||
      getBadge(id) === undefined
    ) {
      continue;
    }
    collection[id] = {
      id,
      firstEarnedAt: firstEarnedAt as number,
      count: count as number,
    };
  }
  return collection;
}

type WaveTimes = Record<string, number>;

function decodeWaveTimes(json: string | null): WaveTimes {
  if (json === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (!isObject(parsed)) return {};

  const waveTimes: WaveTimes = {};
  for (const [key, value] of Object.entries(parsed)) {
    const wave = Number(key);
    if (
      !Number.isFinite(wave) ||
      wave < 1 ||
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value <= 0
    ) {
      continue;
    }
    waveTimes[String(wave)] = value;
  }
  return waveTimes;
}

/** Cached badge and wave-time persistence at the application boundary. */
export class BadgeStore {
  private cached: BadgeCollection | undefined;
  private cachedWaveTimes: WaveTimes | undefined;

  constructor(
    private readonly storage: BadgeStorage | null = browserStorage(),
  ) {}

  load(): BadgeCollection {
    if (this.cached !== undefined) return this.cached;

    let json: string | null = null;
    try {
      json = this.storage?.getItem(BADGE_STORAGE_KEY) ?? null;
    } catch {
      // Storage access can fail in privacy mode or under a restrictive origin.
    }
    this.cached = decodeCollection(json);
    return this.cached;
  }

  /** Awards each id, bumping counts. `at` defaults to `Date.now()`. */
  record(ids: readonly string[], at: number = Date.now()): BadgeRecordResult {
    const collection = this.load();
    const newlyEarned: string[] = [];
    const earnedAt = Number.isFinite(at) ? at : Date.now();

    for (const id of new Set(ids)) {
      if (getBadge(id) === undefined) continue;
      const previous = collection[id];
      if (previous === undefined) {
        collection[id] = { id, firstEarnedAt: earnedAt, count: 1 };
        newlyEarned.push(id);
      } else {
        collection[id] = { ...previous, count: previous.count + 1 };
      }
    }

    this.cached = collection;
    if (ids.length > 0) {
      try {
        this.storage?.setItem(BADGE_STORAGE_KEY, JSON.stringify(collection));
      } catch {
        // A failed badge write must not break a completed reward sequence.
      }
    }

    return { collection, newlyEarned };
  }

  /** Best (lowest) recorded clear time in seconds for `wave`, or null. */
  bestTimeForWave(wave: number): number | null {
    if (!Number.isFinite(wave) || wave < 1) return null;
    return this.loadWaveTimes()[String(wave)] ?? null;
  }

  /** Keeps the lower of the stored and given time. */
  recordWaveTime(wave: number, seconds: number): void {
    if (
      !Number.isFinite(wave) ||
      wave < 1 ||
      !Number.isFinite(seconds) ||
      seconds <= 0
    ) {
      return;
    }

    const waveTimes = this.loadWaveTimes();
    const key = String(wave);
    const previous = waveTimes[key];
    if (previous !== undefined && previous <= seconds) return;

    waveTimes[key] = seconds;
    this.cachedWaveTimes = waveTimes;
    try {
      this.storage?.setItem(WAVE_TIMES_STORAGE_KEY, JSON.stringify(waveTimes));
    } catch {
      // A failed best-time write must not interrupt the wave-clear flow.
    }
  }

  clear(): void {
    this.cached = {};
    this.cachedWaveTimes = {};
    try {
      this.storage?.removeItem(BADGE_STORAGE_KEY);
    } catch {
      // Clearing badges must remain safe when storage is unavailable.
    }
    try {
      this.storage?.removeItem(WAVE_TIMES_STORAGE_KEY);
    } catch {
      // Clearing wave times must remain safe when storage is unavailable.
    }
  }

  private loadWaveTimes(): WaveTimes {
    if (this.cachedWaveTimes !== undefined) return this.cachedWaveTimes;

    let json: string | null = null;
    try {
      json = this.storage?.getItem(WAVE_TIMES_STORAGE_KEY) ?? null;
    } catch {
      // Storage access can fail in privacy mode or under a restrictive origin.
    }
    this.cachedWaveTimes = decodeWaveTimes(json);
    return this.cachedWaveTimes;
  }
}

export const badgeStore = new BadgeStore();

/** How many distinct badges exist vs. how many have been earned. */
export function badgeProgress(collection: BadgeCollection): {
  earned: number;
  total: number;
} {
  return {
    earned: BADGES.filter(({ id }) => collection[id] !== undefined).length,
    total: BADGES.length,
  };
}
