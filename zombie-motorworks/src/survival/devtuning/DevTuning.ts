import type { ZombieKind } from '../zombies/Zombie.ts';
import {
  BASE_ZOMBIE_STATS,
  BEHEMOTH_ATTACK_INTERVAL,
  BEHEMOTH_ATTACK_RANGE,
  BEHEMOTH_HEALTH_MULTIPLIER,
  BEHEMOTH_REWARD,
  BEHEMOTH_SMASH_DAMAGE,
  BEHEMOTH_SMASH_RADIUS,
  BEHEMOTH_SPEED_MULTIPLIER,
  GUNSLINGER_ATTACK_INTERVAL,
  GUNSLINGER_ATTACK_RANGE,
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
  gunslingerAttackRange: number;
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
  behemothAttackRange: number;
  behemothSmashDamage: number;
  behemothSmashRadius: number;
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
  'behemoth',
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
        attackInterval: GUNSLINGER_ATTACK_INTERVAL,
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
      behemoth: {
        healthMult: BEHEMOTH_HEALTH_MULTIPLIER,
        speedMult: BEHEMOTH_SPEED_MULTIPLIER,
        damageMult: 1,
        attackInterval: BEHEMOTH_ATTACK_INTERVAL,
        reward: BEHEMOTH_REWARD,
        countOverride: null,
      },
    },
    wave: {
      health: { perWave: 0.06, cap: 2.2 },
      speed: { perWave: 0.025, cap: 1.45 },
      damage: { perWave: 0.06, cap: 2 },
      composition: {
        walker: { startWave: 1, base: 13, perStep: 3, every: 1, cap: 70 },
        gunslinger: { startWave: 3, base: 1, perStep: 2, every: 1, cap: 10 },
        necromancer: { startWave: 6, base: 1, perStep: 1, every: 5, cap: 4 },
        thrower: { startWave: 3, base: 1, perStep: 1, every: 2, cap: 10 },
        worker: { startWave: 7, base: 1, perStep: 1, every: 3, cap: 6 },
        'phone-addict': { startWave: 10, base: 1, perStep: 1, every: 4, cap: 6 },
        kamikaze: { startWave: 4, base: 2, perStep: 1, every: 2, cap: 10 },
        behemoth: { startWave: 8, base: 1, perStep: 1, every: 6, cap: 3 },
      },
      hordeInterval: 1.45,
      hordeSizeMin: 8,
      hordeSizeMax: 14,
      maxActiveBase: 24,
      maxActivePerWave: 2,
      maxActiveCap: 48,
    },
    specialist: {
      gunslingerAttackRange: GUNSLINGER_ATTACK_RANGE,
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
      behemothAttackRange: BEHEMOTH_ATTACK_RANGE,
      behemothSmashDamage: BEHEMOTH_SMASH_DAMAGE,
      behemothSmashRadius: BEHEMOTH_SMASH_RADIUS,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Copy every leaf of `incoming` that matches the shape of `target`.
 *
 * Shape-led rather than input-led on purpose: a pasted snapshot only writes
 * fields the tuning already has, of the type it already has, so a stale or
 * hand-edited config can add junk keys or wrong types without corrupting the
 * live state. `countOverride` is the one nullable field, so null passes too.
 */
function mergeShape(target: object, incoming: unknown): void {
  if (!isRecord(incoming)) return;
  const fields = target as Record<string, unknown>;
  for (const [key, current] of Object.entries(fields)) {
    if (!(key in incoming)) continue;
    const next = incoming[key];
    if (isRecord(current)) {
      mergeShape(current, next);
      continue;
    }
    // The one nullable leaf: null restores "use the wave formula", and has to
    // be accepted even when the live value is currently a pinned number.
    if (key === 'countOverride' && next === null) {
      fields[key] = null;
      continue;
    }
    if (typeof next === 'number' && Number.isFinite(next)) {
      fields[key] = next;
    }
  }
}

/**
 * Load a snapshot produced by `exportTuningJSON`, then notify.
 *
 * Returns false and leaves the tuning untouched when the text is not valid
 * JSON, so a bad paste is a no-op rather than a half-applied config. Cheats are
 * session state and are never read from a snapshot.
 */
export function importTuningJSON(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (!isRecord(parsed)) return false;

  mergeShape(devTuning.base, parsed.base);
  mergeShape(devTuning.types, parsed.types);
  mergeShape(devTuning.wave, parsed.wave);
  mergeShape(devTuning.specialist, parsed.specialist);
  notifyTuningChanged();
  return true;
}

export { KIND_ORDER };
