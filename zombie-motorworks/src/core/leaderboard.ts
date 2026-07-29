import { isBiomeId, type BiomeId } from './biomes.ts';

/** One completed run ranked on the local leaderboard. */
export interface LeaderboardEntry {
  /** Final run score. */
  score: number;
  /** Wave the run ended on. */
  wave: number;
  kills: number;
  /** Epoch ms when the run ended. */
  at: number;
  /** Whole seconds spent in the arena across the whole run. */
  durationSeconds?: number;
  /** Arena the run was played in. Absent on runs recorded before biomes. */
  biomeId?: BiomeId;
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

/** Rows the game-over overlay shows, where vertical space is tight. */
export const GAME_OVER_LEADERBOARD_ROWS = 5;

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

/** Whole seconds, or undefined when the persisted value is unusable. */
function normalizeDuration(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  const seconds = Math.round(value);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

/** Drops the optional fields a run recorded by an older build never had. */
function withOptionalFields(entry: LeaderboardEntry): LeaderboardEntry {
  const durationSeconds = normalizeDuration(entry.durationSeconds);
  return {
    score: entry.score,
    wave: entry.wave,
    kills: entry.kills,
    at: entry.at,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(isBiomeId(entry.biomeId) ? { biomeId: entry.biomeId } : {}),
  };
}

/** `m:ss`, or `h:mm:ss` past an hour. Missing durations read as a dash. */
export function formatRunDuration(seconds: number | undefined): string {
  const total = normalizeDuration(seconds);
  if (total === undefined) return '—';

  const minutes = Math.floor(total / 60) % 60;
  const remainder = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  if (total >= 3600) {
    return `${Math.floor(total / 3600)}:${pad(minutes)}:${pad(remainder)}`;
  }
  return `${minutes}:${pad(remainder)}`;
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
  return rankEntries(parsed.filter(isLeaderboardEntry).map(withOptionalFields));
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
 * just finished, or null when it did not place. `limit` caps how many rows the
 * view shows; a highlighted run below the cut takes the last visible slot so
 * the player always sees where they landed.
 */
export function leaderboardRows(
  entries: readonly LeaderboardEntry[],
  highlightRank: number | null = null,
  limit = LEADERBOARD_MAX_ENTRIES,
): LeaderboardRow[] {
  const rows = rankEntries(entries).map((entry, index) => ({
    ...entry,
    rank: index + 1,
    isCurrentRun: highlightRank !== null && index + 1 === highlightRank,
  }));
  if (limit <= 0 || rows.length <= limit) return rows;

  const visible = rows.slice(0, limit);
  const highlighted = rows.find((row) => row.isCurrentRun);
  if (highlighted === undefined || highlighted.rank <= limit) return visible;
  return [...visible.slice(0, limit - 1), highlighted];
}

/** Serializes only the supported leaderboard schema fields. */
export function encodeLeaderboard(
  entries: readonly LeaderboardEntry[],
): string {
  return JSON.stringify(entries.map(withOptionalFields));
}
