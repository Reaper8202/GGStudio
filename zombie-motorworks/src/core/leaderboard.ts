/** One completed run ranked on the local leaderboard. */
export interface LeaderboardEntry {
  /** Final run score. */
  score: number;
  /** Wave the run ended on. */
  wave: number;
  kills: number;
  /** Epoch ms when the run ended. */
  at: number;
}

/** How a finished run placed once it was recorded on the local board. */
export interface RunOutcome {
  score: number;
  wave: number;
  kills: number;
  isPersonalBest: boolean;
  /** 1-based rank on the local board, or null when the run did not place. */
  rank: number | null;
  entries: readonly LeaderboardEntry[];
}

/** Maximum number of completed runs retained on the leaderboard. */
export const LEADERBOARD_MAX_ENTRIES = 10;

function compareEntries(
  left: LeaderboardEntry,
  right: LeaderboardEntry,
): number {
  return (
    right.score - left.score ||
    right.wave - left.wave ||
    right.kills - left.kills ||
    left.at - right.at
  );
}

function rankEntries(entries: readonly LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort(compareEntries).slice(0, LEADERBOARD_MAX_ENTRIES);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isLeaderboardEntry(value: unknown): value is LeaderboardEntry {
  return (
    isRecord(value) &&
    isNonNegativeSafeInteger(value.score) &&
    isNonNegativeSafeInteger(value.wave) &&
    isNonNegativeSafeInteger(value.kills) &&
    isNonNegativeSafeInteger(value.at)
  );
}

/** Returns a new ranked list ordered by score, wave, kills, then earlier time. */
export function insertEntry(
  entries: readonly LeaderboardEntry[],
  entry: LeaderboardEntry,
): LeaderboardEntry[] {
  return rankEntries([...entries, entry]);
}

/** Highest-ranked entry, or null when the board is empty. */
export function personalBest(
  entries: readonly LeaderboardEntry[],
): LeaderboardEntry | null {
  return rankEntries(entries)[0] ?? null;
}

/** True when `score` strictly beats every score already on the board. */
export function isPersonalBest(
  entries: readonly LeaderboardEntry[],
  score: number,
): boolean {
  return score > 0 && entries.every((entry) => score > entry.score);
}

/** Returns [] rather than letting malformed persisted data escape. */
export function decodeLeaderboard(
  json: string | null | undefined,
): LeaderboardEntry[] {
  if (json === null || json === undefined) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  return rankEntries(parsed.filter(isLeaderboardEntry));
}

/** One display row of the ranked board. */
export interface LeaderboardRow extends LeaderboardEntry {
  /** 1-based position on the board. */
  rank: number;
  /** True for the run that just finished, so the view can highlight it. */
  isCurrentRun: boolean;
}

/**
 * Ranked rows for display. `highlightRank` is the 1-based rank of the run that
 * just finished, or null when it did not place.
 */
export function leaderboardRows(
  entries: readonly LeaderboardEntry[],
  highlightRank: number | null = null,
): LeaderboardRow[] {
  return rankEntries(entries).map((entry, index) => ({
    ...entry,
    rank: index + 1,
    isCurrentRun: highlightRank !== null && index + 1 === highlightRank,
  }));
}

/** Serializes only the supported leaderboard schema fields. */
export function encodeLeaderboard(
  entries: readonly LeaderboardEntry[],
): string {
  return JSON.stringify(
    entries.map((entry) => ({
      score: entry.score,
      wave: entry.wave,
      kills: entry.kills,
      at: entry.at,
    })),
  );
}
