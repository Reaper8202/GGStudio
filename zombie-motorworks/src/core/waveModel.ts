/**
 * Derived balance metrics for a wave, independent of any engine or zombie
 * implementation.
 *
 * These answer questions the shipped curves cannot answer on their own: how
 * much work a wave actually is, how well it pays for that work, and how much of
 * it can be on screen at once. Kinds are plain string keys so `src/core/` stays
 * free of the survival layer's `ZombieKind` union — callers pass whatever set
 * of kinds they are modelling.
 */

/** What one zombie kind contributes to a wave's threat and payout. */
export interface ZombieKindProfile {
  /** This kind's multiplier on the shared base health. */
  healthMultiplier: number;
  /** Money paid for one kill. */
  reward: number;
}

export type WaveCounts = Readonly<Record<string, number>>;
export type KindProfiles = Readonly<Record<string, ZombieKindProfile>>;

function counted(counts: WaveCounts): [string, number][] {
  return Object.entries(counts).filter(
    ([, count]) => Number.isFinite(count) && count > 0,
  );
}

/** Total zombies a wave asks for, across every kind. */
export function wavePopulation(counts: WaveCounts): number {
  return counted(counts).reduce((total, [, count]) => total + count, 0);
}

/**
 * Total effective hit points a wave puts in front of the player.
 *
 * This is the honest measure of "how big is this wave": a wave of 20 tough
 * zombies and a wave of 40 weak ones are the same amount of shooting, and
 * comparing raw counts across waves hides that.
 */
export function waveThreat(
  counts: WaveCounts,
  profiles: KindProfiles,
  baseHealth: number,
  healthMultiplier: number,
): number {
  if (!Number.isFinite(baseHealth) || !Number.isFinite(healthMultiplier)) {
    return 0;
  }
  return counted(counts).reduce((total, [kind, count]) => {
    const profile = profiles[kind];
    if (profile === undefined) return total;
    return (
      total + count * baseHealth * profile.healthMultiplier * healthMultiplier
    );
  }, 0);
}

/** Money paid by killing every zombie in the wave, before any wave bonus. */
export function waveKillReward(
  counts: WaveCounts,
  profiles: KindProfiles,
): number {
  return counted(counts).reduce((total, [kind, count]) => {
    const profile = profiles[kind];
    return profile === undefined ? total : total + count * profile.reward;
  }, 0);
}

/**
 * Money earned per point of enemy health.
 *
 * The single most useful number for spotting reward drift: it should stay
 * roughly flat across a run. When it falls, waves are getting more expensive
 * faster than they pay, and a fixed-price shop quietly drifts out of reach.
 */
export function payPerThreat(payout: number, threat: number): number {
  if (!Number.isFinite(payout) || !Number.isFinite(threat) || threat <= 0) {
    return 0;
  }
  return payout / threat;
}

/**
 * Zombies the wave asks for that cannot be on screen yet.
 *
 * Overflow is not extra difficulty. Those zombies arrive as replacements for
 * ones already killed, so they extend the wave rather than thicken it: past the
 * cap, a bigger number means a longer wave at the same intensity.
 */
export function spawnOverflow(population: number, maxActive: number): number {
  if (!Number.isFinite(population) || !Number.isFinite(maxActive)) return 0;
  return Math.max(0, population - maxActive);
}

/**
 * Lower bound on wave length, in seconds, set purely by the spawn schedule.
 *
 * The real clear time also depends on pathing, weapon uptime and driving, none
 * of which are knowable here. This is the part that *is* exact: however fast
 * the player kills, the wave cannot end before its last zombie has spawned.
 */
export function spawnBoundSeconds(
  population: number,
  hordeSize: number,
  hordeInterval: number,
): number {
  if (
    !Number.isFinite(population) ||
    !Number.isFinite(hordeSize) ||
    !Number.isFinite(hordeInterval) ||
    population <= 0 ||
    hordeSize <= 0 ||
    hordeInterval <= 0
  ) {
    return 0;
  }
  return Math.max(0, Math.ceil(population / hordeSize) - 1) * hordeInterval;
}

/**
 * Share of a wave made up of the given kinds, 0..1.
 *
 * Used to check that later waves ask a different question rather than the same
 * question for longer: if the specialist share is flat across a run, every wave
 * is the wave before it with more walkers.
 */
export function kindShare(
  counts: WaveCounts,
  kinds: readonly string[],
): number {
  const population = wavePopulation(counts);
  if (population <= 0) return 0;
  const selected = kinds.reduce((total, kind) => {
    const count = counts[kind];
    return Number.isFinite(count) && count > 0 ? total + count : total;
  }, 0);
  return selected / population;
}

/**
 * Payout that holds money-per-threat at a fixed rate.
 *
 * Anchoring the payout to the wave's own threat means the pay curve cannot
 * drift out of step with the difficulty curve when the composition is retuned —
 * the two move together by construction instead of being two curves someone has
 * to remember to keep aligned.
 *
 * Not wired into the game. The Balance Lab charts it against the shipped
 * `waveRewardForWave` so the two curves can be compared before either is
 * adopted.
 */
export function threatScaledPayout(
  threat: number,
  ratePerThreat: number,
): number {
  if (
    !Number.isFinite(threat) ||
    !Number.isFinite(ratePerThreat) ||
    threat <= 0 ||
    ratePerThreat <= 0
  ) {
    return 0;
  }
  return Math.round(threat * ratePerThreat);
}
