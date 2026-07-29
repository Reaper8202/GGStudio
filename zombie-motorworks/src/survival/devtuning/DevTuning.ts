import type { ZombieKind } from '../zombies/Zombie.ts';
import {
  BASE_ZOMBIE_STATS,
  GUNSLINGER_HEALTH_MULTIPLIER,
  GUNSLINGER_REWARD,
  GUNSLINGER_SPEED_MULTIPLIER,
  KAMIKAZE_DETONATE_RANGE,
  KAMIKAZE_EXPLOSION_DAMAGE,
  KAMIKAZE_EXPLOSION_RADIUS,
  KAMIKAZE_HEALTH_MULTIPLIER,
  KAMIKAZE_REWARD,
  KAMIKAZE_SPEED_MULTIPLIER,
  LANDMINE_DAMAGE,
  NECROMANCER_HEALTH_MULTIPLIER,
  NECROMANCER_REWARD,
  NECROMANCER_SPEED_MULTIPLIER,
  NECROMANCER_SUMMON_COUNT,
  NECROMANCER_SUMMON_RANGE,
  NECROMANCER_SUMMON_SECONDS,
  PHONE_ADDICT_HEALTH_MULTIPLIER,
  PHONE_ADDICT_REWARD,
  PHONE_ADDICT_SPEED_MULTIPLIER,
  PROJECTILE_DAMAGE,
  THROWER_ATTACK_INTERVAL,
  THROWER_ATTACK_RANGE,
  THROWER_HEALTH_MULTIPLIER,
  THROWER_REWARD,
  THROWER_SPEED_MULTIPLIER,
  WORKER_HEALTH_MULTIPLIER,
  WORKER_PLANT_RANGE,
  WORKER_PLANT_SECONDS,
  WORKER_REWARD,
  WORKER_SPEED_MULTIPLIER,
} from '../zombies/zombieConfig.ts';

/**
 * Per-zombie-kind tuning. Health/speed/damage are multipliers over the shared
 * base (matching how the game already derives stats), shown in the panel as the
 * resolved absolute value. `countOverride` of null means "use the wave formula".
 */
export interface ZombieKindTuning {
  healthMult: number;
  speedMult: number;
  /** Per-kind attack-damage multiplier — new axis the dev tuner adds. */
  damageMult: number;
  attackInterval: number;
  reward: number;
  /** null = auto (wave-composition formula); a number pins this wave's count. */
  countOverride: number | null;
}

/** A per-wave growth curve: `base + perWave * (wave - 1)`, clamped to `cap`. */
export interface CurveTuning {
  perWave: number;
  cap: number;
}

/** Composition growth for one specialist kind (walkers use `base`/`perWave`). */
export interface CompositionCurve {
  /** First wave this kind appears (1 for walkers). */
  startWave: number;
  base: number;
  /** Extra count added every `every` waves after startWave. */
  perStep: number;
  every: number;
  cap: number;
}

export interface WaveTuning {
  health: CurveTuning;
  speed: CurveTuning;
  damage: CurveTuning;
  composition: Record<ZombieKind, CompositionCurve>;
  hordeInterval: number;
  hordeSizeMin: number;
  hordeSizeMax: number;
  maxActiveBase: number;
  maxActivePerWave: number;
  maxActiveCap: number;
}

export interface SpecialistTuning {
  throwerAttackRange: number;
  necromancerSummonRange: number;
  necromancerSummonSeconds: number;
  necromancerSummonCount: number;
  projectileDamage: number;
  workerPlantRange: number;
  workerPlantSeconds: number;
  landmineDamage: number;
  kamikazeDetonateRange: number;
  kamikazeExplosionDamage: number;
  kamikazeExplosionRadius: number;
}

export interface CheatTuning {
  godMode: boolean;
  freezeSpawns: boolean;
  /** Frame-time multiplier: 1 = real time, <1 slow-mo, >1 fast-forward. */
  timeScale: number;
}

export interface DevTuningState {
  base: {
    health: number;
    speed: number;
    attackDamage: number;
    attackInterval: number;
    reward: number;
  };
  types: Record<ZombieKind, ZombieKindTuning>;
  wave: WaveTuning;
  specialist: SpecialistTuning;
  cheats: CheatTuning;
}

const KIND_ORDER: readonly ZombieKind[] = [
  'walker',
  'gunslinger',
  'necromancer',
  'thrower',
  'worker',
  'phone-addict',
  'kamikaze',
];

/** Fresh default state cloned from the shipped constants — the "reset" target. */
export function defaultTuning(): DevTuningState {
  return {
    base: {
      health: BASE_ZOMBIE_STATS.health,
      speed: BASE_ZOMBIE_STATS.speed,
      attackDamage: BASE_ZOMBIE_STATS.attackDamage,
      attackInterval: BASE_ZOMBIE_STATS.attackInterval,
      reward: BASE_ZOMBIE_STATS.reward,
    },
    types: {
      walker: {
        healthMult: 1,
        speedMult: 1,
        damageMult: 1,
        attackInterval: BASE_ZOMBIE_STATS.attackInterval,
        reward: BASE_ZOMBIE_STATS.reward,
        countOverride: null,
      },
      gunslinger: {
        healthMult: GUNSLINGER_HEALTH_MULTIPLIER,
        speedMult: GUNSLINGER_SPEED_MULTIPLIER,
        damageMult: 1,
        attackInterval: BASE_ZOMBIE_STATS.attackInterval,
        reward: GUNSLINGER_REWARD,
        countOverride: null,
      },
      necromancer: {
        healthMult: NECROMANCER_HEALTH_MULTIPLIER,
        speedMult: NECROMANCER_SPEED_MULTIPLIER,
        damageMult: 1,
        attackInterval: BASE_ZOMBIE_STATS.attackInterval,
        reward: NECROMANCER_REWARD,
        countOverride: null,
      },
      thrower: {
        healthMult: THROWER_HEALTH_MULTIPLIER,
        speedMult: THROWER_SPEED_MULTIPLIER,
        damageMult: 1,
        attackInterval: THROWER_ATTACK_INTERVAL,
        reward: THROWER_REWARD,
        countOverride: null,
      },
      worker: {
        healthMult: WORKER_HEALTH_MULTIPLIER,
        speedMult: WORKER_SPEED_MULTIPLIER,
        damageMult: 1,
        attackInterval: BASE_ZOMBIE_STATS.attackInterval,
        reward: WORKER_REWARD,
        countOverride: null,
      },
      'phone-addict': {
        healthMult: PHONE_ADDICT_HEALTH_MULTIPLIER,
        speedMult: PHONE_ADDICT_SPEED_MULTIPLIER,
        damageMult: 1,
        attackInterval: BASE_ZOMBIE_STATS.attackInterval,
        reward: PHONE_ADDICT_REWARD,
        countOverride: null,
      },
      kamikaze: {
        healthMult: KAMIKAZE_HEALTH_MULTIPLIER,
        speedMult: KAMIKAZE_SPEED_MULTIPLIER,
        damageMult: 1,
        attackInterval: BASE_ZOMBIE_STATS.attackInterval,
        reward: KAMIKAZE_REWARD,
        countOverride: null,
      },
      // Inert: a boss reads every stat from its `BossDefinition` in
      // `zombies/bossConfig.ts`, which stays the single source of truth for boss
      // balance. This row exists only so the record stays exhaustive over
      // ZombieKind, and `boss` is deliberately absent from KIND_ORDER so the
      // panel never offers sliders that would do nothing.
      boss: {
        healthMult: 1,
        speedMult: 1,
        damageMult: 1,
        attackInterval: BASE_ZOMBIE_STATS.attackInterval,
        reward: 0,
        countOverride: null,
      },
    },
    wave: {
      health: { perWave: 0.06, cap: 2.2 },
      speed: { perWave: 0.025, cap: 1.45 },
      damage: { perWave: 0.06, cap: 2 },
      composition: {
        walker: { startWave: 1, base: 13, perStep: 3, every: 1, cap: 70 },
        gunslinger: { startWave: 1, base: 1, perStep: 1, every: 3, cap: 8 },
        necromancer: { startWave: 6, base: 1, perStep: 1, every: 5, cap: 4 },
        thrower: { startWave: 3, base: 1, perStep: 1, every: 2, cap: 10 },
        worker: { startWave: 7, base: 1, perStep: 1, every: 3, cap: 6 },
        'phone-addict': { startWave: 10, base: 1, perStep: 1, every: 4, cap: 6 },
        kamikaze: { startWave: 4, base: 2, perStep: 1, every: 2, cap: 10 },
        // Degenerate on purpose: boss waves short-circuit ahead of the curves in
        // `zombieCompositionForWave`, so this is never consulted.
        boss: { startWave: 1, base: 0, perStep: 0, every: 1, cap: 0 },
      },
      hordeInterval: 1.45,
      hordeSizeMin: 8,
      hordeSizeMax: 14,
      maxActiveBase: 24,
      maxActivePerWave: 2,
      maxActiveCap: 48,
    },
    specialist: {
      throwerAttackRange: THROWER_ATTACK_RANGE,
      necromancerSummonRange: NECROMANCER_SUMMON_RANGE,
      necromancerSummonSeconds: NECROMANCER_SUMMON_SECONDS,
      necromancerSummonCount: NECROMANCER_SUMMON_COUNT,
      projectileDamage: PROJECTILE_DAMAGE,
      workerPlantRange: WORKER_PLANT_RANGE,
      workerPlantSeconds: WORKER_PLANT_SECONDS,
      landmineDamage: LANDMINE_DAMAGE,
      kamikazeDetonateRange: KAMIKAZE_DETONATE_RANGE,
      kamikazeExplosionDamage: KAMIKAZE_EXPLOSION_DAMAGE,
      kamikazeExplosionRadius: KAMIKAZE_EXPLOSION_RADIUS,
    },
    cheats: {
      godMode: false,
      freezeSpawns: false,
      timeScale: 1,
    },
  };
}

type Listener = () => void;

/**
 * Process-wide mutable tuning singleton. Game systems read `devTuning` directly
 * in their spawn/step paths, so a slider change takes effect on the next spawn
 * (and, via subscribers, is re-applied to living zombies immediately). This is a
 * dev-only tool; the object is plain and mutation is intentional.
 */
export const devTuning: DevTuningState = defaultTuning();

const listeners = new Set<Listener>();

export function subscribeTuning(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Notify subscribers (e.g. re-apply live stats, refresh the panel readout). */
export function notifyTuningChanged(): void {
  for (const listener of listeners) listener();
}

/** Reset everything to shipped defaults, then notify. */
export function resetTuning(): void {
  const fresh = defaultTuning();
  devTuning.base = fresh.base;
  devTuning.types = fresh.types;
  devTuning.wave = fresh.wave;
  devTuning.specialist = fresh.specialist;
  // Cheats are session state, not balance — leave them as the caller set them.
  notifyTuningChanged();
}

/** Serialisable snapshot for the panel's "copy config as JSON" (cheats omitted). */
export function exportTuningJSON(): string {
  return JSON.stringify(
    {
      base: devTuning.base,
      types: devTuning.types,
      wave: devTuning.wave,
      specialist: devTuning.specialist,
    },
    null,
    2,
  );
}

export { KIND_ORDER };
