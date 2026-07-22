import { describe, expect, it, vi } from 'vitest';
import type { Zombie } from '../src/survival/zombies/Zombie.ts';
import type { ZombieKind } from '../src/survival/zombies/Zombie.ts';
import { ZombieSystem } from '../src/survival/zombies/ZombieSystem.ts';

interface FakeTarget {
  readonly zombie: Zombie;
  readonly health: () => number;
  readonly flashShield: ReturnType<typeof vi.fn>;
}

function fakeTarget(kind: ZombieKind, startingHealth = 1_000): FakeTarget {
  let health = startingHealth;
  const flashShield = vi.fn();
  const zombie = {
    kind,
    get isTargetable(): boolean {
      return health > 0;
    },
    flashShield,
    takeDamage: (amount: number): boolean => {
      health -= amount;
      return health <= 0;
    },
  } as unknown as Zombie;
  return { zombie, health: () => health, flashShield };
}

function zombieSystem(targets: ReadonlyMap<number, FakeTarget>): ZombieSystem {
  const system = Object.create(ZombieSystem.prototype) as ZombieSystem;
  const zombies = [...targets.values()].map((target) => target.zombie);
  const state = system as unknown as {
    disposed: boolean;
    colliderToZombie: Map<number, Zombie>;
    pool: Zombie[];
    aliveTargets: Zombie[];
  };
  state.disposed = false;
  state.colliderToZombie = new Map(
    [...targets].map(([handle, target]) => [handle, target.zombie]),
  );
  state.pool = zombies;
  state.aliveTargets = [...zombies];
  return system;
}

describe('turret EMP shield leak', () => {
  it('leaks exactly 10% for an un-modded turret and reports shielding', () => {
    const target = fakeTarget('phone-addict');
    const system = zombieSystem(new Map([[1, target]]));

    const result = system.hitZombieHandle(1, 100);

    expect(result).toBe('shielded');
    expect(result).not.toBe('damaged');
    expect(target.health()).toBe(990);
    expect(target.flashShield).toHaveBeenCalledOnce();
    expect(system.isShieldedTarget(1)).toBe(true);
  });

  it.each([
    [1, 35],
    [2, 50],
    [3, 65],
  ])('leaks exactly the level-%s EMP fraction', (empLevel, leakedDamage) => {
    const target = fakeTarget('phone-addict');
    const system = zombieSystem(new Map([[1, target]]));

    expect(system.hitZombieHandle(1, 100, undefined, 'hitscan', empLevel)).toBe(
      'shielded',
    );
    expect(target.health()).toBe(1_000 - leakedDamage);
  });

  it('deals full damage to a walker regardless of EMP level', () => {
    const target = fakeTarget('walker');
    const system = zombieSystem(new Map([[1, target]]));

    expect(system.hitZombieHandle(1, 100, undefined, 'hitscan', 3)).toBe(
      'damaged',
    );
    expect(target.health()).toBe(900);
    expect(system.isShieldedTarget(1)).toBe(false);
  });

  it('lets aoe damage bypass the shield at full strength', () => {
    const target = fakeTarget('phone-addict');
    const system = zombieSystem(new Map([[1, target]]));

    expect(system.hitZombieHandle(1, 100, undefined, 'aoe', 0)).toBe(
      'damaged',
    );
    expect(target.health()).toBe(900);
    expect(target.flashShield).not.toHaveBeenCalled();
  });

  it('kills a Phone Addict when leaked damage exceeds its remaining health', () => {
    const target = fakeTarget('phone-addict', 9);
    const system = zombieSystem(new Map([[1, target]]));

    expect(system.hitZombieHandle(1, 100)).toBe('killed');
    expect(target.health()).toBe(0 - 1);
    expect(target.flashShield).toHaveBeenCalledOnce();
  });
});
