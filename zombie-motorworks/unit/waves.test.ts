import { describe, expect, it } from 'vitest';
import {
  WaveManager,
  healthMultiplierForWave,
  maxActiveZombiesForWave,
  speedMultiplierForWave,
  waveRewardForWave,
  zombieCountForWave,
} from '../src/survival/WaveManager.ts';
import type { ZombieSystem } from '../src/survival/zombies/ZombieSystem.ts';

describe('wave formulas', () => {
  it.each([
    {
      wave: 1,
      zombies: 11,
      maxActive: 9,
      healthMultiplier: 1,
      speedMultiplier: 1,
      reward: 125,
    },
    {
      wave: 5,
      zombies: 23,
      maxActive: 13,
      healthMultiplier: 1.48,
      speedMultiplier: 1.1,
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

  it('caps active zombies at 30 and speed at 1.5x', () => {
    expect(maxActiveZombiesForWave(22)).toBe(30);
    expect(maxActiveZombiesForWave(50)).toBe(30);
    expect(speedMultiplierForWave(21)).toBe(1.5);
    expect(speedMultiplierForWave(50)).toBe(1.5);
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
    expect(waves.prepareDebugKillAll()).toBe(11);
    expect(remaining).toBe(0);
    expect(completion).toEqual({ wave: 1, reward: 125 });
  });
});
