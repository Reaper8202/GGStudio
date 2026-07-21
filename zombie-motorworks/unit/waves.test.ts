import { describe, expect, it } from 'vitest';
import {
  WaveManager,
  attackDamageMultiplierForWave,
  healthMultiplierForWave,
  maxActiveZombiesForWave,
  speedMultiplierForWave,
  waveRewardForWave,
  zombieCompositionForWave,
  zombieCountForWave,
} from '../src/survival/WaveManager.ts';
import type { ZombieSystem } from '../src/survival/zombies/ZombieSystem.ts';
import { ZOMBIE_POOL_COUNTS } from '../src/survival/zombies/zombieConfig.ts';

describe('wave formulas', () => {
  it.each([
    {
      wave: 1,
      zombies: 14,
      maxActive: 27,
      healthMultiplier: 1,
      speedMultiplier: 1,
      attackDamageMultiplier: 1,
      reward: 50,
    },
    {
      wave: 5,
      zombies: 32,
      maxActive: 39,
      healthMultiplier: 1.6,
      speedMultiplier: 1.14,
      attackDamageMultiplier: 1.32,
      reward: 90,
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
    expect(attackDamageMultiplierForWave(expected.wave)).toBeCloseTo(
      expected.attackDamageMultiplier,
    );
    expect(waveRewardForWave(expected.wave)).toBe(expected.reward);
  });

  it('caps active zombies at 56 and speed at 1.6x', () => {
    expect(maxActiveZombiesForWave(11)).toBe(56);
    expect(maxActiveZombiesForWave(50)).toBe(56);
    expect(speedMultiplierForWave(19)).toBe(1.6);
    expect(speedMultiplierForWave(50)).toBe(1.6);
  });

  it('scales attack damage monotonically from 1x to a 2.5x cap', () => {
    expect(attackDamageMultiplierForWave(1)).toBe(1);
    for (let wave = 2; wave <= 50; wave += 1) {
      expect(attackDamageMultiplierForWave(wave)).toBeGreaterThanOrEqual(
        attackDamageMultiplierForWave(wave - 1),
      );
    }
    expect(attackDamageMultiplierForWave(20)).toBe(2.5);
    expect(attackDamageMultiplierForWave(50)).toBe(2.5);
  });

  it('unlocks sparse specialists at their progression milestones', () => {
    expect(zombieCompositionForWave(1)).toEqual({
      walker: 14,
      thrower: 0,
      worker: 0,
      'phone-addict': 0,
    });
    expect(zombieCompositionForWave(3)).toEqual({
      walker: 22,
      worker: 0,
      thrower: 0,
      'phone-addict': 0,
    });
    expect(zombieCompositionForWave(4)).toEqual({
      walker: 26,
      thrower: 2,
      worker: 0,
      'phone-addict': 0,
    });
    expect(zombieCompositionForWave(7)).toEqual({
      walker: 38,
      thrower: 3,
      worker: 1,
      'phone-addict': 0,
    });
    expect(zombieCompositionForWave(10)).toEqual({
      walker: 50,
      thrower: 5,
      worker: 2,
      'phone-addict': 1,
    });
  });

  it('keeps every zombie kind within its pool at the concurrency cap', () => {
    const lateWaveComposition = zombieCompositionForWave(10_000);
    expect(ZOMBIE_POOL_COUNTS.walker).toBeGreaterThanOrEqual(
      maxActiveZombiesForWave(10_000),
    );
    expect(ZOMBIE_POOL_COUNTS.thrower).toBeGreaterThanOrEqual(
      lateWaveComposition.thrower,
    );
    expect(ZOMBIE_POOL_COUNTS.worker).toBeGreaterThanOrEqual(
      lateWaveComposition.worker,
    );
    expect(ZOMBIE_POOL_COUNTS['phone-addict']).toBeGreaterThanOrEqual(
      lateWaveComposition['phone-addict'],
    );
  });

  it('makes debug kill-all account for every pending wave assignment', () => {
    let remaining = -1;
    let completion: { wave: number; reward: number } | null = null;
    let waveMultipliers: number[] = [];
    const zombiePool = {
      setWaveMultipliers: (...multipliers: number[]) => {
        waveMultipliers = multipliers;
      },
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
    expect(waveMultipliers).toEqual([1, 1, 1]);
    expect(waves.prepareDebugKillAll()).toBe(14);
    expect(remaining).toBe(0);
    expect(completion).toEqual({ wave: 1, reward: 50 });
  });
});
