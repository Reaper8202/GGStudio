/**
 * Dev-only record of how waves actually felt to play.
 *
 * The Balance Lab can measure what a wave asks of the player, but not whether
 * it was fun, fair or a slog — that judgement only exists in the person holding
 * the controller. This captures it at the moment it is freshest, on the
 * wave-clear card, alongside the numbers that wave actually produced, so a
 * tuning change can be argued about with both halves of the evidence present.
 *
 * Session state on purpose. It is a note passed from a playtest to whoever is
 * tuning next, not a telemetry pipeline, and it dies with the tab.
 */

/** Too easy, about right, or too hard. */
export type FeelRating = 'easy' | 'right' | 'hard';

export interface FeelEntry {
  wave: number;
  rating: FeelRating;
  /** Seconds the wave took to clear. */
  seconds: number;
  /** Vehicle integrity at wave end, 0..100. */
  integrityPct: number;
  kills: number;
  /** Free-text remark, if the player added one. */
  note?: string;
}

const entries: FeelEntry[] = [];

/**
 * Record a rating, replacing any earlier one for the same wave.
 *
 * Re-rating matters because the same wave gets replayed repeatedly while a
 * tuning is being dialled in; keeping every attempt would bury the verdict that
 * is actually current under the ones that led to it.
 */
export function recordFeel(entry: FeelEntry): void {
  const at = entries.findIndex((existing) => existing.wave === entry.wave);
  if (at === -1) entries.push(entry);
  else entries[at] = entry;
  entries.sort((a, b) => a.wave - b.wave);
}

export function feelEntries(): readonly FeelEntry[] {
  return entries;
}

export function clearFeelLog(): void {
  entries.length = 0;
}

const RATING_LABEL: Record<FeelRating, string> = {
  easy: 'too easy',
  right: 'about right',
  hard: 'too hard',
};

function pad(value: string, width: number): string {
  return value.length >= width
    ? value
    : ' '.repeat(width - value.length) + value;
}

/**
 * Compact, pasteable summary of a play session.
 *
 * Plain text rather than JSON because its destination is a message to a person,
 * where a wall of braces buries the three columns that carry the argument.
 */
export function formatFeelReport(log: readonly FeelEntry[]): string {
  if (log.length === 0) {
    return 'FEEL REPORT — nothing rated yet.';
  }

  const counts = { easy: 0, right: 0, hard: 0 };
  for (const entry of log) counts[entry.rating] += 1;

  const lines = [
    `FEEL REPORT — ${log.length} wave${log.length === 1 ? '' : 's'} rated ` +
      `(${counts.easy} too easy, ${counts.right} about right, ${counts.hard} too hard)`,
    'wave  verdict        time  integrity  kills  note',
  ];
  for (const entry of log) {
    const line =
      `${pad(String(entry.wave), 4)}  ` +
      `${RATING_LABEL[entry.rating].padEnd(13)}  ` +
      `${pad(`${Math.round(entry.seconds)}s`, 4)}  ` +
      `${pad(`${Math.round(entry.integrityPct)}%`, 9)}  ` +
      `${pad(String(entry.kills), 5)}  ` +
      `${entry.note ?? ''}`;
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}
