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
  ELITE_BOSSES,
  bossForWave,
  isBossWave,
  type BossEncounter,
} from '../src/survival/zombies/bossConfig.ts';

/** Fake pool that records what the director asked of it. */
function fakeZombies(overrides: Partial<ZombieSystem> = {}): {
  zombies: ZombieSystem;
  spawned: ZombieKind[];
  bossEncounters: (BossEncounter | null)[];
  setActive: (count: number) => void;
} {
  const spawned: ZombieKind[] = [];
  const bossEncounters: (BossEncounter | null)[] = [];
  let active = 0;
  const zombies = {
    setWaveMultipliers: () => undefined,
    setBossEncounter: (encounter: BossEncounter | null) => {
      bossEncounters.push(encounter);
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
    bossEncounters,
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
    // One classic boss, one elite boss registered: this asserts the rotation
    // advances between the two rather than sticking on one.
    const distinct = new Set(
      bossWaves.map((boss) =>
        boss?.style === 'classic' ? boss.definition.id : boss?.elite.id,
      ),
    );
    const registered =
      Object.keys(BOSS_DEFINITIONS).length + Object.keys(ELITE_BOSSES).length;
    expect(distinct.size).toBe(Math.min(bossWaves.length, registered));
  });

  it('keeps every specialist curve at zero but still fields a horde around the boss', () => {
    const composition = zombieCompositionForWave(5);
    expect(composition).toEqual({
      walker: composition.walker,
      gunslinger: 3,
      necromancer: 0,
      thrower: 0,
      worker: 0,
      'phone-addict': 0,
      kamikaze: 0,
      behemoth: 0,
      zamboni: 0,
      boss: 1,
    });
    expect(composition.walker).toBeGreaterThan(0);
    expect(zombieCountForWave(5)).toBe(composition.walker + 3 + 1);
    expect(zombieCountForWave(10)).toBeGreaterThan(1);
  });

  it('puts the boss at the head of the spawn queue', () => {
    // Wave 5's boss is the elite Behemoth: an ordinary kind under the hood, so
    // the queue asks for 'behemoth' directly rather than for 'boss'.
    expect(spawnOrderForWave(5)[0]).toBe('behemoth');
    expect(spawnOrderForWave(5)).toContain('gunslinger');
    expect(spawnOrderForWave(5)).toContain('walker');
    // Wave 10's boss is the classic Alchemist, still its own pooled kind.
    expect(spawnOrderForWave(10)[0]).toBe('boss');
    // Ordinary waves are untouched and still lead with walkers.
    expect(spawnOrderForWave(4)[0]).toBe('walker');
    expect(spawnOrderForWave(4)).not.toContain('boss');
  });

  it('hands the wave boss encounter to the pool at wave start', () => {
    const { zombies, bossEncounters } = fakeZombies();
    const waves = new WaveManager(zombies, {
      onRemainingChanged: () => undefined,
      onWaveComplete: () => undefined,
    });

    waves.startWave(4);
    expect(bossEncounters.at(-1)).toBeNull();
    waves.startWave(5);
    expect(bossEncounters.at(-1)).toBe(bossForWave(5));
    waves.startWave(9);
    expect(bossEncounters.at(-1)).toBeNull();
    waves.startWave(10);
    expect(bossEncounters.at(-1)).toBe(bossForWave(10));
  });

  it('alternates the two bosses across boss waves', () => {
    // Rotation index is wave / 5 - 1, so the pair alternates indefinitely.
    expect(bossForWave(5)).toEqual({ style: 'elite', elite: ELITE_BOSSES.behemoth });
    expect(bossForWave(10)).toEqual({
      style: 'classic',
      definition: BOSS_DEFINITIONS['acid-alchemist'],
    });
    expect(bossForWave(15)).toEqual({ style: 'elite', elite: ELITE_BOSSES.behemoth });
    expect(bossForWave(20)).toEqual({
      style: 'classic',
      definition: BOSS_DEFINITIONS['acid-alchemist'],
    });
  });

});
