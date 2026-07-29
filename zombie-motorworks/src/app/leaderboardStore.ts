import {
  decodeLeaderboard,
  encodeLeaderboard,
  insertEntry,
  isPersonalBest,
  type LeaderboardEntry,
} from '../core/leaderboard.ts';

export const LEADERBOARD_STORAGE_KEY = 'scraprig.leaderboard.v1';

export interface LeaderboardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): LeaderboardStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Cached local leaderboard persistence at the application boundary. */
export class LeaderboardStore {
  private cached: LeaderboardEntry[] | undefined;

  constructor(
    private readonly storage: LeaderboardStorage | null = browserStorage(),
  ) {}

  /** Top entries, best first. Never throws. */
  load(): LeaderboardEntry[] {
    if (this.cached !== undefined) return this.cached;

    let json: string | null = null;
    try {
      json = this.storage?.getItem(LEADERBOARD_STORAGE_KEY) ?? null;
    } catch {
      // Storage access can fail in privacy mode or under a restrictive origin.
    }
    this.cached = decodeLeaderboard(json);
    return this.cached;
  }

  /**
   * Inserts a finished run and persists the truncated board.
   * Returns the new board plus where this run landed.
   * Persistence failure still returns the correct in-memory result.
   */
  record(entry: LeaderboardEntry): {
    entries: LeaderboardEntry[];
    rank: number | null;
    isPersonalBest: boolean;
  } {
    const previous = this.load();
    const entryIsPersonalBest = isPersonalBest(previous, entry.score);
    const entries = insertEntry(previous, entry);
    const index = entries.indexOf(entry);
    const rank = index === -1 ? null : index + 1;

    this.cached = entries;
    try {
      this.storage?.setItem(
        LEADERBOARD_STORAGE_KEY,
        encodeLeaderboard(entries),
      );
    } catch {
      // A failed leaderboard write must not break a completed run.
    }

    return { entries, rank, isPersonalBest: entryIsPersonalBest };
  }

  clear(): void {
    this.cached = [];
    try {
      this.storage?.removeItem(LEADERBOARD_STORAGE_KEY);
    } catch {
      // Clearing local rankings must remain safe when storage is unavailable.
    }
  }
}

export const leaderboardStore = new LeaderboardStore();
