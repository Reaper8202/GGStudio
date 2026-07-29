export type TimelineNodeState = 'past' | 'current' | 'future';

export interface TimelineNode {
  wave: number;
  state: TimelineNodeState;
  /** Specialist kind ids that first appear on this wave (may be empty). */
  threats: readonly string[];
  /** True when this wave introduces something new and deserves a marker. */
  isMilestone: boolean;
}

export interface WaveTimeline {
  nodes: readonly TimelineNode[];
  currentWave: number;
  killedThisWave: number;
  totalThisWave: number;
  /** Clear progress of the current wave, clamped to 0..1. */
  progress: number;
}

export interface WaveTimelineInput {
  currentWave: number;
  killedThisWave: number;
  totalThisWave: number;
  /** Injected so core stays independent of the survival module. */
  threatsForWave: (wave: number) => readonly string[];
  /** Waves shown behind the current one. Default 2. */
  windowBack?: number;
  /** Waves shown ahead of the current one. Default 4. */
  windowForward?: number;
}

/** Human-readable label per specialist kind, for tooltips and aria-labels. */
export const THREAT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  thrower: 'Throwers',
  worker: 'Mine layers',
  'phone-addict': 'Phone Addicts (shielded)',
});

export type WaveIconKind = 'zombie' | 'threat' | 'boss';

/**
 * Which icon a wave shows. Pure — no DOM, no emoji.
 *
 * This is identity only: whether a wave is cleared, running, or ahead is
 * carried by `node.state`, so a boss wave keeps its skull once it is behind
 * the player instead of collapsing into a generic "cleared" marker.
 *
 * Phone Addicts are the heaviest known specialist, so their introduction is
 * the boss icon, ranked ahead of ordinary specialist introductions.
 */
export function waveIcon(node: TimelineNode): WaveIconKind {
  if (node.threats.includes('phone-addict')) return 'boss';
  if (node.isMilestone) return 'threat';
  return 'zombie';
}

function normalizeWave(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

function normalizeWindow(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function buildWaveTimeline(input: WaveTimelineInput): WaveTimeline {
  const currentWave = normalizeWave(input.currentWave);
  const killedThisWave = finiteOrZero(input.killedThisWave);
  const totalThisWave = finiteOrZero(input.totalThisWave);
  const windowBack = normalizeWindow(input.windowBack, 2);
  const windowForward = normalizeWindow(input.windowForward, 4);
  const nodeCount = windowBack + 1 + windowForward;
  const firstWave = Math.max(1, currentWave - windowBack);
  const nodes = Array.from({ length: nodeCount }, (_, index): TimelineNode => {
    const wave = firstWave + index;
    const threats = [...input.threatsForWave(wave)];
    const state: TimelineNodeState =
      wave < currentWave ? 'past' : wave === currentWave ? 'current' : 'future';

    return {
      wave,
      state,
      threats,
      isMilestone: threats.length > 0,
    };
  });
  const progress =
    totalThisWave > 0
      ? Math.min(1, Math.max(0, killedThisWave / totalThisWave))
      : 0;

  return {
    nodes,
    currentWave,
    killedThisWave,
    totalThisWave,
    progress,
  };
}
