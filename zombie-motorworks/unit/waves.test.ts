import { describe, expect, it } from 'vitest';
import {
  WaveManager,
  attackDamageMultiplierForWave,
  healthMultiplierForWave,
  hordeIntervalForWave,
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
      maxActive: 26,
      healthMultiplier: 1,
      speedMultiplier: 1,
      attackDamageMultiplier: 1,
      reward: 50,
    },
    {
      wave: 5,
      zombies: 31,
      maxActive: 34,
      healthMultiplier: 1.24,
      speedMultiplier: 1.1,
      attackDamageMultiplier: 1.24,
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

  it('scales walker counts to the 70 cap', () => {
    expect(zombieCompositionForWave(1).walker).toBe(13);
    expect(zombieCompositionForWave(5).walker).toBe(25);
    expect(zombieCompositionForWave(20).walker).toBe(70);
    expect(zombieCompositionForWave(50).walker).toBe(70);
  });

  it('caps health multiplier at 2.2x', () => {
    expect(healthMultiplierForWave(1)).toBe(1);
    expect(healthMultiplierForWave(10)).toBeCloseTo(1.54);
    expect(healthMultiplierForWave(21)).toBeCloseTo(2.2);
    expect(healthMultiplierForWave(50)).toBe(2.2);
  });

  it('caps speed multiplier at 1.45x', () => {
    expect(speedMultiplierForWave(1)).toBe(1);
    expect(speedMultiplierForWave(10)).toBeCloseTo(1.225);
    expect(speedMultiplierForWave(19)).toBe(1.45);
    expect(speedMultiplierForWave(50)).toBe(1.45);
  });

  it('scales attack damage monotonically from 1x to a 2x cap', () => {
    expect(attackDamageMultiplierForWave(1)).toBe(1);
    expect(attackDamageMultiplierForWave(10)).toBeCloseTo(1.54);
    for (let wave = 2; wave <= 50; wave += 1) {
      expect(attackDamageMultiplierForWave(wave)).toBeGreaterThanOrEqual(
        attackDamageMultiplierForWave(wave - 1),
      );
    }
    expect(attackDamageMultiplierForWave(18)).toBe(2);
    expect(attackDamageMultiplierForWave(50)).toBe(2);
  });

  it('caps active zombies at 48', () => {
    expect(maxActiveZombiesForWave(1)).toBe(26);
    expect(maxActiveZombiesForWave(12)).toBe(48);
    expect(maxActiveZombiesForWave(50)).toBe(48);
  });

  it.each([
    { wave: 1, interval: 1.45 },
    { wave: 5, interval: 1.45 },
    { wave: 6, interval: 1.25 },
    { wave: 12, interval: 1.25 },
    { wave: 13, interval: 1.05 },
    { wave: 30, interval: 1.05 },
  ])('uses the horde interval for wave $wave', ({ wave, interval }) => {
    expect(hordeIntervalForWave(wave)).toBe(interval);
  });

  it.each([
    { wave: Number.POSITIVE_INFINITY, safeWave: 1 },
    { wave: Number.NaN, safeWave: 1 },
    { wave: 0, safeWave: 1 },
    { wave: 5.9, safeWave: 5 },
  ])('hardens formula input $wave to wave $safeWave', ({ wave, safeWave }) => {
    expect(zombieCompositionForWave(wave)).toEqual(
      zombieCompositionForWave(safeWave),
    );
    expect(maxActiveZombiesForWave(wave)).toBe(
      maxActiveZombiesForWave(safeWave),
    );
    expect(healthMultiplierForWave(wave)).toBe(
      healthMultiplierForWave(safeWave),
    );
    expect(speedMultiplierForWave(wave)).toBe(
      speedMultiplierForWave(safeWave),
    );
    expect(attackDamageMultiplierForWave(wave)).toBe(
      attackDamageMultiplierForWave(safeWave),
    );
    expect(hordeIntervalForWave(wave)).toBe(hordeIntervalForWave(safeWave));
  });

  it('unlocks sparse specialists at their progression milestones', () => {
    expect(zombieCompositionForWave(1)).toEqual({
      walker: 13,
      gunslinger: 1,
      necromancer: 0,
      thrower: 0,
      worker: 0,
      'phone-addict': 0,
      kamikaze: 0,
    });
    expect(zombieCompositionForWave(4)).toEqual({
      walker: 22,
      gunslinger: 2,
      necromancer: 0,
      thrower: 1,
      worker: 0,
      'phone-addict': 0,
      kamikaze: 2,
    });
    expect(zombieCompositionForWave(7)).toEqual({
      walker: 31,
      gunslinger: 3,
      necromancer: 1,
      thrower: 3,
      worker: 1,
      'phone-addict': 0,
      kamikaze: 3,
    });
    expect(zombieCompositionForWave(10)).toEqual({
      walker: 40,
      gunslinger: 4,
      necromancer: 1,
      thrower: 4,
      worker: 2,
      'phone-addict': 1,
      kamikaze: 5,
    });
    expect(zombieCompositionForWave(20)).toEqual({
      walker: 70,
      gunslinger: 7,
      necromancer: 3,
      thrower: 9,
      worker: 5,
      'phone-addict': 3,
      kamikaze: 10,
    });
  });

  it('does not unlock specialists before their milestone waves', () => {
    expect(zombieCompositionForWave(2)).toEqual({
      walker: 16,
      gunslinger: 1,
      necromancer: 0,
      worker: 0,
      thrower: 0,
      'phone-addict': 0,
      kamikaze: 0,
    });
  });

  it('keeps every zombie kind within its pool at the concurrency cap', () => {
    const lateWaveComposition = zombieCompositionForWave(10_000);
    expect(ZOMBIE_POOL_COUNTS.walker).toBeGreaterThanOrEqual(
      maxActiveZombiesForWave(10_000),
    );
    expect(ZOMBIE_POOL_COUNTS.gunslinger).toBeGreaterThanOrEqual(
      lateWaveComposition.gunslinger,
    );
    expect(ZOMBIE_POOL_COUNTS.necromancer).toBeGreaterThanOrEqual(
      lateWaveComposition.necromancer,
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
    expect(ZOMBIE_POOL_COUNTS.kamikaze).toBeGreaterThanOrEqual(
      lateWaveComposition.kamikaze,
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
