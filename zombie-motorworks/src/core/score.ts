/** Zombie variants that award run score when killed. */
export type ScoreZombieKind =
  | 'walker'
  | 'gunslinger'
  | 'necromancer'
  | 'thrower'
  | 'phone-addict'
  | 'worker'
  | 'kamikaze'
  | 'behemoth';

/** Base points per kill, before the wave multiplier. */
export const SCORE_PER_KILL: Record<ScoreZombieKind, number> = {
  walker: 10,
  gunslinger: 20,
  necromancer: 45,
  worker: 25,
  thrower: 30,
  'phone-addict': 20,
  kamikaze: 15,
  behemoth: 80,
};

/** Points scale with wave depth so deep runs dominate the leaderboard. */
export function waveScoreMultiplier(wave: number): number {
  const normalizedWave = Number.isFinite(wave) && wave >= 1 ? wave : 1;
  return 1 + 0.1 * (normalizedWave - 1);
}

/** Points awarded for one kill on the given wave. Always a non-negative safe integer. */
export function killScore(kind: ScoreZombieKind, wave: number): number {
  const baseScore = SCORE_PER_KILL[kind];
  if (baseScore === undefined) return 0;

  const score = Math.floor(baseScore * waveScoreMultiplier(wave));
  return Number.isSafeInteger(score) && score >= 0 ? score : 0;
}

/** Bonus for fully clearing a wave. Always a non-negative safe integer. */
export function waveClearScore(wave: number): number {
  if (!Number.isFinite(wave) || wave < 1) return 0;

  const score = Math.floor(100 * wave);
  return Number.isSafeInteger(score) && score >= 0 ? score : 0;
}

/** Clamp helper used when accumulating, so overflow can never corrupt a run. */
export function addScore(total: number, delta: number): number {
  const score = total + delta;
  return Number.isSafeInteger(score) && score >= 0 ? score : total;
}
