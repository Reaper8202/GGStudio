/**
 * Balance Lab: evaluates the shipped wave curves into a table of derived
 * metrics, so the difficulty and reward curves can be read directly instead of
 * inferred from play.
 *
 * Everything here comes from the real curve functions and the live `devTuning`
 * state, never from copied constants — a tuning change is reflected the next
 * time rows are generated, and a curve change cannot silently leave the Lab
 * reporting the old game.
 *
 * This module is dev tooling. Nothing in the running game imports it, so it is
 * dropped from the production bundle.
 */

import {
  kindShare,
  payPerThreat,
  spawnBoundSeconds,
  spawnOverflow,
  threatScaledPayout,
  waveKillReward,
  wavePopulation,
  waveThreat,
} from '../core/waveModel.ts';
import type { KindProfiles } from '../core/waveModel.ts';
import { KIND_ORDER, devTuning } from './devtuning/DevTuning.ts';
import {
  attackDamageMultiplierForWave,
  healthMultiplierForWave,
  hordeIntervalForWave,
  maxActiveZombiesForWave,
  speedMultiplierForWave,
  waveRewardForWave,
  zombieCompositionForWave,
} from './WaveManager.ts';
import type { WaveComposition } from './WaveManager.ts';
import { ZOMBIE_POOL_COUNTS } from './zombies/zombieConfig.ts';

/**
 * Every kind that is not a plain walker.
 *
 * Derived rather than listed, because a hand-written list is exactly what goes
 * stale when a kind is added: an unlisted kind would be counted in the wave's
 * population but not in its specialist share, quietly reporting a wave as more
 * walker-heavy than it is.
 */
export const SPECIALIST_KINDS: readonly string[] = KIND_ORDER.filter(
  (kind) => kind !== 'walker',
);

/**
 * Per-kind toughness and payout.
 *
 * Read straight off `devTuning.types`, because that is exactly what the spawner
 * multiplies by: `Zombie.spawn` computes health as
 * `base.health * waveMultiplier * types[kind].healthMult`. The per-kind
 * constants in `zombieConfig` are only the seed values for those fields, so
 * applying them again here would double-count a tougher kind.
 *
 * Built from `KIND_ORDER` so a new kind is measured the moment it exists.
 * `waveThreat` skips kinds it has no profile for, so a missing entry would not
 * fail loudly — it would just report the wave as easier than it is.
 */
export function kindProfiles(): KindProfiles {
  const { types } = devTuning;
  return Object.fromEntries(
    KIND_ORDER.map((kind) => [
      kind,
      {
        healthMultiplier: types[kind].healthMult,
        reward: types[kind].reward,
      },
    ]),
  );
}

/** One wave, measured. */
export interface WaveLabRow {
  wave: number;
  counts: WaveComposition;
  /** Zombies the wave asks for in total. */
  population: number;
  /** How many may exist at once. */
  maxActive: number;
  /** Population the cap forces to queue. Pure duration, not extra intensity. */
  overflow: number;
  /** Total effective hit points the wave puts up. */
  threat: number;
  /** Average effective hit points per zombie. */
  threatPerZombie: number;
  /** Money from kills alone. */
  killReward: number;
  /** Flat clear bonus. */
  wavePayout: number;
  /** Kills plus clear bonus. */
  totalPayout: number;
  /** Money per point of enemy health. Should be flat across a run. */
  payPerThreat: number;
  /**
   * What the wave would have to pay to hold money-per-threat at the rate wave
   * one sets. The gap between this and `totalPayout` is the reward shortfall.
   */
  flatPayout: number;
  /** Fraction of the wave that is not a plain walker, 0..1. */
  specialistShare: number;
  /** Seconds before the last zombie can even have spawned. */
  spawnFloorSeconds: number;
  healthMultiplier: number;
  speedMultiplier: number;
  damageMultiplier: number;
  hordeInterval: number;
}

/** Average horde size, which is what sets the spawn schedule on average. */
function meanHordeSize(): number {
  const min = Math.max(1, Math.floor(devTuning.wave.hordeSizeMin));
  const max = Math.max(min, Math.floor(devTuning.wave.hordeSizeMax));
  return (min + max) / 2;
}

/** Measure one wave against the curves as they are currently tuned. */
export function waveLabRow(wave: number): WaveLabRow {
  const counts = zombieCompositionForWave(wave);
  // `WaveComposition` is an interface, so it has no implicit index signature and
  // cannot be handed straight to the model's kind-agnostic `Record` parameters.
  // Copying once here keeps the model free of the survival layer's kind union.
  const countMap: Record<string, number> = { ...counts };
  const profiles = kindProfiles();
  const population = wavePopulation(countMap);
  const healthMultiplier = healthMultiplierForWave(wave);
  const threat = waveThreat(
    countMap,
    profiles,
    devTuning.base.health,
    healthMultiplier,
  );
  const killReward = waveKillReward(countMap, profiles);
  const wavePayout = waveRewardForWave(wave);
  const totalPayout = killReward + wavePayout;
  const hordeInterval = hordeIntervalForWave(wave);

  return {
    wave,
    counts,
    population,
    maxActive: maxActiveZombiesForWave(wave),
    overflow: spawnOverflow(population, maxActiveZombiesForWave(wave)),
    threat,
    threatPerZombie: population > 0 ? threat / population : 0,
    killReward,
    wavePayout,
    totalPayout,
    payPerThreat: payPerThreat(totalPayout, threat),
    // Filled by `waveLabRows`, which knows what wave one pays. A row measured on
    // its own has no run to be a shortfall against.
    flatPayout: totalPayout,
    specialistShare: kindShare(countMap, SPECIALIST_KINDS),
    spawnFloorSeconds: spawnBoundSeconds(
      population,
      meanHordeSize(),
      hordeInterval,
    ),
    healthMultiplier,
    speedMultiplier: speedMultiplierForWave(wave),
    damageMultiplier: attackDamageMultiplierForWave(wave),
    hordeInterval,
  };
}

/**
 * Measure waves 1..`lastWave`.
 *
 * Wave one sets the reference pay rate, so `flatPayout` on every later row
 * reads as "what this wave would pay if the game had never let the reward curve
 * fall behind the difficulty curve".
 */
export function waveLabRows(lastWave = 20): WaveLabRow[] {
  const last = Math.max(1, Math.floor(lastWave));
  const rows = Array.from({ length: last }, (_, index) =>
    waveLabRow(index + 1),
  );
  const rate = rows[0].payPerThreat;
  for (const row of rows) {
    row.flatPayout = threatScaledPayout(row.threat, rate);
  }
  return rows;
}

/** Headline findings a reader should not have to derive from the table. */
export interface WaveLabSummary {
  /** First wave that asks for more zombies than can be on screen, or null. */
  firstOverflowWave: number | null;
  /** How far pay-per-threat falls from the first wave to the last, as a ratio. */
  payDriftRatio: number;
  /**
   * Walker share of the deepest wave measured, 0..1.
   *
   * Peak share across the run would be useless: the first waves are all
   * walkers by design, so it reads 100% for any tuning. What matters is
   * whether late waves still ask the same question as early ones.
   */
  lateWalkerShare: number;
  /** Last wave on which any multiplier still changes, or null if none do. */
  lastEscalatingWave: number | null;
  /**
   * Kinds that could need more bodies at once than the spawner has.
   *
   * The spawner reuses dead bodies from a fixed per-kind pool, so what matters
   * is not how many a wave sends in total but how many can be alive together —
   * `min(count, maxActive)`. Exceed that and the spawner silently delivers
   * fewer, making a tuning that reads harder on paper weaker in play.
   */
  kindsOverPool: string[];
}

function escalates(a: WaveLabRow, b: WaveLabRow): boolean {
  return (
    a.healthMultiplier !== b.healthMultiplier ||
    a.speedMultiplier !== b.speedMultiplier ||
    a.damageMultiplier !== b.damageMultiplier ||
    a.maxActive !== b.maxActive ||
    a.hordeInterval !== b.hordeInterval
  );
}

export function summarize(rows: readonly WaveLabRow[]): WaveLabSummary {
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first === undefined || last === undefined) {
    return {
      firstOverflowWave: null,
      payDriftRatio: 1,
      lateWalkerShare: 0,
      lastEscalatingWave: null,
      kindsOverPool: [],
    };
  }

  // A kind only needs as many bodies as can be alive at once, which the global
  // active cap bounds. Comparing raw wave totals against the pool would flag
  // every deep wave, and a warning that always fires is a warning nobody reads.
  const peakConcurrent = new Map<string, number>();
  for (const row of rows) {
    for (const [kind, count] of Object.entries(row.counts)) {
      const concurrent = Math.min(count, row.maxActive);
      peakConcurrent.set(
        kind,
        Math.max(peakConcurrent.get(kind) ?? 0, concurrent),
      );
    }
  }
  const pools: Record<string, number> = ZOMBIE_POOL_COUNTS;
  const kindsOverPool = [...peakConcurrent.entries()]
    .filter(([kind, peak]) => pools[kind] !== undefined && peak > pools[kind])
    .map(([kind]) => kind);

  let lastEscalatingWave: number | null = null;
  for (let i = 1; i < rows.length; i += 1) {
    if (escalates(rows[i - 1], rows[i])) lastEscalatingWave = rows[i].wave;
  }

  return {
    firstOverflowWave: rows.find((row) => row.overflow > 0)?.wave ?? null,
    payDriftRatio:
      last.payPerThreat > 0 ? first.payPerThreat / last.payPerThreat : 1,
    lateWalkerShare: 1 - last.specialistShare,
    lastEscalatingWave,
    kindsOverPool,
  };
}
