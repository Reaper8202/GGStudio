import {
  attackDamageMultiplierForWave,
  healthMultiplierForWave,
  speedMultiplierForWave,
  waveRewardForWave,
  zombieCompositionForWave,
} from './WaveManager.ts';
import type { WaveComposition } from './WaveManager.ts';
import {
  bossEncounterWarning,
  bossForWave,
  isBossWave,
  type BossEncounter,
} from './zombies/bossConfig.ts';
import {
  BASE_ZOMBIE_STATS,
  BEHEMOTH_HEALTH_MULTIPLIER,
  BEHEMOTH_REWARD,
  GUNSLINGER_HEALTH_MULTIPLIER,
  GUNSLINGER_REWARD,
  KAMIKAZE_HEALTH_MULTIPLIER,
  KAMIKAZE_REWARD,
  NECROMANCER_HEALTH_MULTIPLIER,
  NECROMANCER_REWARD,
  PHONE_ADDICT_HEALTH_MULTIPLIER,
  PHONE_ADDICT_REWARD,
  THROWER_HEALTH_MULTIPLIER,
  THROWER_REWARD,
  WORKER_HEALTH_MULTIPLIER,
  WORKER_REWARD,
  ZAMBONI_HEALTH_MULTIPLIER,
  ZAMBONI_REWARD,
} from './zombies/zombieConfig.ts';

export type SpecialistZombieKind =
  | 'gunslinger'
  | 'necromancer'
  | 'thrower'
  | 'worker'
  | 'phone-addict'
  | 'kamikaze'
  | 'behemoth'
  | 'zamboni';

const SPECIALIST_KINDS: readonly SpecialistZombieKind[] = [
  'gunslinger',
  'necromancer',
  'thrower',
  'worker',
  'phone-addict',
  'kamikaze',
  'behemoth',
  'zamboni',
];

const COMPOSITION_LABELS: Record<keyof WaveComposition, [string, string]> = {
  walker: ['walker', 'walkers'],
  gunslinger: ['gunslinger', 'gunslingers'],
  necromancer: ['necromancer', 'necromancers'],
  thrower: ['thrower', 'throwers'],
  worker: ['worker', 'workers'],
  'phone-addict': ['phone-addict', 'phone-addicts'],
  kamikaze: ['kamikaze', 'kamikazes'],
  behemoth: ['behemoth', 'behemoths'],
  zamboni: ['zamboni', 'zambonis'],
  boss: ['boss', 'bosses'],
};

const THREAT_WARNINGS: Record<SpecialistZombieKind, string> = {
  gunslinger: 'Gunslingers in the horde — slow, tough, and they hit hard.',
  necromancer:
    'Necromancers next — they stop and raise ranged throwers. Kill them mid-cast.',
  thrower: 'Ranged throwers next!',
  worker: 'Mine-laying workers next — mines go hidden from wave 8',
  // No wave number in the copy: boss waves shift when each specialist first
  // reaches the field, and this warning always fires on the wave before.
  'phone-addict':
    'Shielded Phone Addicts next — bring EMP. Buy EMP in the garage now.',
  kamikaze: 'Kamikazes incoming — small, fast, and they explode on contact.',
  behemoth:
    'Behemoths incoming — they hit like a wrecking ball. Watch the red ring and keep moving.',
  zamboni:
    "Zambonis incoming — they won't attack, but they'll ice the ground behind them. Watch your grip.",
};

/**
 * Specialist kinds that first appear on the requested wave. The comparison
 * skips back over boss waves, which field no specialists at all — otherwise
 * every specialist would re-announce itself as new on the wave after each boss.
 */
export function newThreatsForWave(wave: number): SpecialistZombieKind[] {
  let previousWave = wave - 1;
  while (previousWave > 0 && isBossWave(previousWave)) previousWave -= 1;
  const previous = zombieCompositionForWave(previousWave);
  const current = zombieCompositionForWave(wave);
  return SPECIALIST_KINDS.filter(
    (kind) => previous[kind] === 0 && current[kind] > 0,
  );
}

/**
 * Player-facing warnings for a wave. The boss warning is prepended rather than
 * derived from `newThreatsForWave`, because bosses recur every fifth wave
 * instead of unlocking once the way specialists do.
 */
export function threatWarningsForWave(wave: number): string[] {
  const warnings = newThreatsForWave(wave).map((kind) => THREAT_WARNINGS[kind]);
  const boss = bossForWave(wave);
  return boss ? [bossEncounterWarning(boss), ...warnings] : warnings;
}

/** Exact, compact composition with zero-count kinds omitted. */
export function formatWaveComposition(composition: WaveComposition): string {
  return (Object.keys(COMPOSITION_LABELS) as (keyof WaveComposition)[])
    .filter((kind) => composition[kind] > 0)
    .map((kind) => {
      const count = composition[kind];
      const [singular, plural] = COMPOSITION_LABELS[kind];
      return `${count} ${count === 1 ? singular : plural}`;
    })
    .join(' / ');
}

export interface WaveBalanceReport {
  wave: number;
  composition: WaveComposition;
  healthMultiplier: number;
  speedMultiplier: number;
  attackDamageMultiplier: number;
  effectiveTotalHp: number;
  totalPossibleReward: number;
}

/**
 * The HP a boss encounter's one kill contributes at wave-one scale — a
 * classic boss reads it straight off its definition; an elite boss stacks its
 * multiplier on top of the ordinary kind's own health the same way
 * `Zombie.spawn` does, since it never gets a `baseHealth` of its own.
 */
function bossBaseHealth(boss: BossEncounter): number {
  return boss.style === 'classic'
    ? boss.definition.baseHealth
    : BASE_ZOMBIE_STATS.health *
        BEHEMOTH_HEALTH_MULTIPLIER *
        boss.elite.healthMultiplier;
}

function bossReward(boss: BossEncounter): number {
  return boss.style === 'classic' ? boss.definition.reward : boss.elite.reward;
}

export function waveBalanceReport(wave: number): WaveBalanceReport {
  const composition = zombieCompositionForWave(wave);
  const healthMultiplier = healthMultiplierForWave(wave);
  const baseHealth = BASE_ZOMBIE_STATS.health * healthMultiplier;
  // A boss scales its own base health by the same wave multiplier, so its row
  // stays comparable with the horde it replaces.
  const boss = bossForWave(wave);
  const bossHp = boss
    ? composition.boss * bossBaseHealth(boss) * healthMultiplier
    : 0;
  const effectiveTotalHp = Math.round(
    composition.walker * baseHealth +
      composition.gunslinger * baseHealth * GUNSLINGER_HEALTH_MULTIPLIER +
      composition.necromancer * baseHealth * NECROMANCER_HEALTH_MULTIPLIER +
      composition.thrower * baseHealth * THROWER_HEALTH_MULTIPLIER +
      composition.worker * baseHealth * WORKER_HEALTH_MULTIPLIER +
      composition['phone-addict'] *
        baseHealth *
        PHONE_ADDICT_HEALTH_MULTIPLIER +
      composition.kamikaze * baseHealth * KAMIKAZE_HEALTH_MULTIPLIER +
      composition.behemoth * baseHealth * BEHEMOTH_HEALTH_MULTIPLIER +
      composition.zamboni * baseHealth * ZAMBONI_HEALTH_MULTIPLIER +
      bossHp,
  );
  const totalPossibleReward =
    composition.walker * BASE_ZOMBIE_STATS.reward +
    composition.gunslinger * GUNSLINGER_REWARD +
    composition.necromancer * NECROMANCER_REWARD +
    composition.thrower * THROWER_REWARD +
    composition.worker * WORKER_REWARD +
    composition['phone-addict'] * PHONE_ADDICT_REWARD +
    composition.kamikaze * KAMIKAZE_REWARD +
    composition.behemoth * BEHEMOTH_REWARD +
    composition.zamboni * ZAMBONI_REWARD +
    (boss ? composition.boss * bossReward(boss) : 0) +
    waveRewardForWave(wave);

  return {
    wave,
    composition,
    healthMultiplier,
    speedMultiplier: speedMultiplierForWave(wave),
    attackDamageMultiplier: attackDamageMultiplierForWave(wave),
    effectiveTotalHp,
    totalPossibleReward,
  };
}
