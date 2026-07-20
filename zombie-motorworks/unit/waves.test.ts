import { describe, expect, it } from 'vitest';
import {
  WaveManager,
  healthMultiplierForWave,
  maxActiveZombiesForWave,
  speedMultiplierForWave,
  waveRewardForWave,
  zombieCompositionForWave,
  zombieCountForWave,
} from '../src/survival/WaveManager.ts';
import type { ZombieSystem } from '../src/survival/zombies/ZombieSystem.ts';

describe('wave formulas', () => {
  it.each([
    {
      wave: 1,
      zombies: 31,
      maxActive: 27,
      healthMultiplier: 1,
      speedMultiplier: 1,
      reward: 125,
    },
    {
      wave: 5,
      zombies: 59,
      maxActive: 39,
      healthMultiplier: 1.6,
      speedMultiplier: 1.14,
      reward: 225,
    },
  ])('scales wave $wave', (expected) => {
    expect(zombieCountForWave(expected.wave)).toBe(expected.zombies);
    expect(maxActiveZombiesForWave(expected.wave)).toBe(expected.maxActive);
    expect(healthMultiplierForWave(expected.wave)).toBeCloseTo(
      expected.healthMultiplier,
    );
    expect(speedMultiplierForWave(expected.wave)).toBeCloseTo(
      expected.speedMultiplier,
    );
    expect(waveRewardForWave(expected.wave)).toBe(expected.reward);
  });

  it('caps active zombies at 56 and speed at 1.6x', () => {
    expect(maxActiveZombiesForWave(11)).toBe(56);
    expect(maxActiveZombiesForWave(50)).toBe(56);
    expect(speedMultiplierForWave(19)).toBe(1.6);
    expect(speedMultiplierForWave(50)).toBe(1.6);
  });

  it('unlocks sparse specialists at their progression milestones', () => {
    expect(zombieCompositionForWave(1)).toEqual({
      walker: 31,
      thrower: 0,
      worker: 0,
      'phone-addict': 0,
    });
    expect(zombieCompositionForWave(2)).toEqual({
      walker: 37,
      thrower: 3,
      worker: 0,
      'phone-addict': 0,
    });
    expect(zombieCompositionForWave(6)).toEqual({
      walker: 61,
      thrower: 5,
      worker: 2,
      'phone-addict': 0,
    });
    expect(zombieCompositionForWave(9)).toEqual({
      walker: 79,
      thrower: 6,
      worker: 3,
      'phone-addict': 2,
    });
  });

  it('makes debug kill-all account for every pending wave assignment', () => {
    let remaining = -1;
    let completion: { wave: number; reward: number } | null = null;
    const zombiePool = {
      setWaveMultipliers: () => undefined,
      getActiveCount: () => 0,
      trySpawnHorde: () => 0,
    } as unknown as ZombieSystem;
    const waves = new WaveManager(zombiePool, {
      onRemainingChanged: (value) => {
        remaining = value;
      },
      onWaveComplete: (wave, reward) => {
        completion = { wave, reward };
      },
    });

    waves.startWave(1);
    expect(waves.prepareDebugKillAll()).toBe(31);
    expect(remaining).toBe(0);
    expect(completion).toEqual({ wave: 1, reward: 125 });
  });
});
