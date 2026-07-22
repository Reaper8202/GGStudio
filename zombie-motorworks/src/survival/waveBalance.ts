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
  PHONE_ADDICT_HEALTH_MULTIPLIER,
  PHONE_ADDICT_REWARD,
  THROWER_HEALTH_MULTIPLIER,
  THROWER_REWARD,
  WORKER_HEALTH_MULTIPLIER,
  WORKER_REWARD,
} from './zombies/zombieConfig.ts';

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
      composition.thrower * baseHealth * THROWER_HEALTH_MULTIPLIER +
      composition.worker * baseHealth * WORKER_HEALTH_MULTIPLIER +
      composition['phone-addict'] *
        baseHealth *
        PHONE_ADDICT_HEALTH_MULTIPLIER,
  );
  const totalPossibleReward =
    composition.walker * BASE_ZOMBIE_STATS.reward +
    composition.thrower * THROWER_REWARD +
    composition.worker * WORKER_REWARD +
    composition['phone-addict'] * PHONE_ADDICT_REWARD +
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
