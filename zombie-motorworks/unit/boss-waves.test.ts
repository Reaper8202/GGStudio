import { describe, expect, it } from 'vitest';
import {
  WaveManager,
  spawnOrderForWave,
  zombieCompositionForWave,
  zombieCountForWave,
} from '../src/survival/WaveManager.ts';
import type { ZombieSystem } from '../src/survival/zombies/ZombieSystem.ts';
import type { ZombieKind } from '../src/survival/zombies/Zombie.ts';
import {
  BOSS_DEFINITIONS,
  BOSS_WAVE_INTERVAL,
  bossForWave,
  isBossWave,
  type BossDefinition,
} from '../src/survival/zombies/bossConfig.ts';

/** Fake pool that records what the director asked of it. */
function fakeZombies(overrides: Partial<ZombieSystem> = {}): {
  zombies: ZombieSystem;
  spawned: ZombieKind[];
  bossDefinitions: (BossDefinition | null)[];
  setActive: (count: number) => void;
} {
  const spawned: ZombieKind[] = [];
  const bossDefinitions: (BossDefinition | null)[] = [];
  let active = 0;
  const zombies = {
    setWaveMultipliers: () => undefined,
    setBossDefinition: (definition: BossDefinition | null) => {
      bossDefinitions.push(definition);
    },
    getActiveCount: () => active,
    trySpawnHorde: (kinds: readonly ZombieKind[]) => {
      spawned.push(...kinds);
      active += kinds.length;
      return kinds.length;
    },
    ...overrides,
  } as unknown as ZombieSystem;
  return {
    zombies,
    spawned,
    bossDefinitions,
    setActive: (count: number) => {
      active = count;
    },
  };
}

describe('boss wave scheduling', () => {
  it.each([5, 10, 15, 100])('summons a boss on wave %i', (wave) => {
    expect(isBossWave(wave)).toBe(true);
    expect(bossForWave(wave)).not.toBeNull();
  });

  it.each([1, 2, 4, 6, 9, 11])('leaves wave %i an ordinary horde', (wave) => {
    expect(isBossWave(wave)).toBe(false);
    expect(bossForWave(wave)).toBeNull();
  });

  it.each([
    { wave: Number.POSITIVE_INFINITY, safeWave: 1 },
    { wave: Number.NaN, safeWave: 1 },
    { wave: 0, safeWave: 1 },
    { wave: 5.9, safeWave: 5 },
  ])('hardens boss lookup input $wave to wave $safeWave', ({ wave, safeWave }) => {
    expect(isBossWave(wave)).toBe(isBossWave(safeWave));
    expect(bossForWave(wave)).toBe(bossForWave(safeWave));
  });

  it('cycles the rotation so every boss recurs', () => {
    const bossWaves = [5, 10, 15, 20, 25].map((wave) => bossForWave(wave));
    for (const boss of bossWaves) expect(boss).not.toBeNull();
    // With one boss registered every boss wave is the same encounter; once a
    // second is added this asserts the rotation advances rather than sticks.
    const distinct = new Set(bossWaves.map((boss) => boss?.id));
    expect(distinct.size).toBe(
      Math.min(bossWaves.length, Object.keys(BOSS_DEFINITIONS).length),
    );
  });

  it('replaces the whole horde with a single boss', () => {
    expect(zombieCompositionForWave(5)).toEqual({
      walker: 0,
      thrower: 0,
      worker: 0,
      'phone-addict': 0,
      boss: 1,
    });
    expect(zombieCountForWave(5)).toBe(1);
    expect(zombieCountForWave(10)).toBe(1);
  });

  it('puts the boss at the head of the spawn queue', () => {
    expect(spawnOrderForWave(5)).toEqual(['boss']);
    // Ordinary waves are untouched and still lead with walkers.
    expect(spawnOrderForWave(4)[0]).toBe('walker');
    expect(spawnOrderForWave(4)).not.toContain('boss');
  });

  it('hands the wave boss to the pool at wave start', () => {
    const { zombies, bossDefinitions } = fakeZombies();
    const waves = new WaveManager(zombies, {
      onRemainingChanged: () => undefined,
      onWaveComplete: () => undefined,
    });

    waves.startWave(4);
    expect(bossDefinitions.at(-1)).toBeNull();
    waves.startWave(5);
    expect(bossDefinitions.at(-1)).toBe(BOSS_DEFINITIONS['hammer-brute']);
  });

  it('does not clear a boss wave until the boss is dead', () => {
    const fake = fakeZombies();
    let completed = false;
    const waves = new WaveManager(fake.zombies, {
      onRemainingChanged: () => undefined,
      onWaveComplete: () => {
        completed = true;
      },
    });

    waves.startWave(BOSS_WAVE_INTERVAL);
    // Spawn the boss, then keep stepping while it is still standing.
    waves.fixedUpdate(1);
    expect(fake.spawned).toEqual(['boss']);
    waves.fixedUpdate(1);
    waves.fixedUpdate(1);
    expect(completed).toBe(false);
    expect(waves.remainingCount).toBe(1);

    // The boss dies: the wave may now clear.
    fake.setActive(0);
    waves.recordZombieKilled();
    expect(completed).toBe(true);
    expect(waves.remainingCount).toBe(0);
  });
});
