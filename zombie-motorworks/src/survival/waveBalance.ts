import {
  attackDamageMultiplierForWave,
  healthMultiplierForWave,
  speedMultiplierForWave,
  waveRewardForWave,
  zombieCompositionForWave,
} from './WaveManager.ts';
import type { WaveComposition } from './WaveManager.ts';
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
} from './zombies/zombieConfig.ts';

export type SpecialistZombieKind =
  | 'gunslinger'
  | 'necromancer'
  | 'thrower'
  | 'worker'
  | 'phone-addict'
  | 'kamikaze'
  | 'behemoth';

const SPECIALIST_KINDS: readonly SpecialistZombieKind[] = [
  'gunslinger',
  'necromancer',
  'thrower',
  'worker',
  'phone-addict',
  'kamikaze',
  'behemoth',
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
};

const THREAT_WARNINGS: Record<SpecialistZombieKind, string> = {
  gunslinger: 'Gunslingers in the horde — slow, tough, and they hit hard.',
  necromancer:
    'Necromancers next — they stop and raise ranged throwers. Kill them mid-cast.',
  thrower: 'Ranged throwers next!',
  worker: 'Mine-laying workers next — mines go hidden from wave 8',
  'phone-addict':
    'Shielded Phone Addicts next — bring EMP. Buy EMP in the garage before wave 10.',
  kamikaze: 'Kamikazes incoming — small, fast, and they explode on contact.',
  behemoth:
    'Behemoths incoming — they hit like a wrecking ball. Watch the red ring and keep moving.',
};

/** Specialist kinds that first appear on the requested wave. */
export function newThreatsForWave(wave: number): SpecialistZombieKind[] {
  const previous = zombieCompositionForWave(wave - 1);
  const current = zombieCompositionForWave(wave);
  return SPECIALIST_KINDS.filter(
    (kind) => previous[kind] === 0 && current[kind] > 0,
  );
}

/** Player-facing warnings for specialists introduced by a wave. */
export function threatWarningsForWave(wave: number): string[] {
  return newThreatsForWave(wave).map((kind) => THREAT_WARNINGS[kind]);
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

export function waveBalanceReport(wave: number): WaveBalanceReport {
  const composition = zombieCompositionForWave(wave);
  const healthMultiplier = healthMultiplierForWave(wave);
  const baseHealth = BASE_ZOMBIE_STATS.health * healthMultiplier;
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
      composition.behemoth * baseHealth * BEHEMOTH_HEALTH_MULTIPLIER,
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
