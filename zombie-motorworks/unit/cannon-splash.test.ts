import { describe, expect, it } from 'vitest';
import { getPartDef } from '../src/core/parts.ts';
import { effectivePartDef } from '../src/core/upgrades.ts';
import { ZombieSystem } from '../src/survival/zombies/ZombieSystem.ts';

interface FakeZombie {
  readonly collider: { handle: number };
  readonly position: { x: number; y: number; z: number };
  damageTaken: number;
  takeDamage(amount: number): boolean;
}

function zombie(handle: number, x: number, z: number): FakeZombie {
  return {
    collider: { handle },
    position: { x, y: 0.9, z },
    damageTaken: 0,
    takeDamage(amount: number) {
      this.damageTaken += amount;
      return false;
    },
  };
}

/**
 * `explodeAt` only walks `aliveTargets`, so the blast can be exercised against
 * a bare instance without a Rapier world or a zombie pool.
 */
function explode(
  targets: FakeZombie[],
  x: number,
  z: number,
  radius: number,
  damage: number,
  skipHandle: number | null = null,
): number {
  const system = Object.create(ZombieSystem.prototype) as ZombieSystem;
  Object.assign(system, {
    disposed: false,
    aliveTargets: targets,
    blastDirection: { x: 0, y: 0, z: 0 },
    rebuildAliveTargets: () => {},
  });
  return system.explodeAt(x, 0.9, z, radius, damage, skipHandle);
}

describe('Heavy Cannon shell', () => {
  it('carries a blast payload in the catalog', () => {
    const weapon = getPartDef('cannon-heavy').weapon!;
    expect(weapon.aimMode).toBe('manual');
    expect(weapon.splashRadiusM).toBeGreaterThan(0);
    expect(weapon.splashDamage).toBeGreaterThan(0);
  });

  it('scales blast damage with upgrades but keeps the radius fixed', () => {
    const base = getPartDef('cannon-heavy').weapon!;
    const upgraded = effectivePartDef(getPartDef('cannon-heavy'), 4).weapon!;
    expect(upgraded.splashDamage!).toBeCloseTo(base.splashDamage! * 1.36);
    expect(upgraded.splashRadiusM).toBe(base.splashRadiusM);
  });

  it('leaves every other weapon without a blast', () => {
    for (const id of ['turret', 'sniper-light', 'ice-cannon', 'flamethrower']) {
      expect(getPartDef(id).weapon?.splashRadiusM).toBeUndefined();
    }
  });
});

describe('ZombieSystem.explodeAt', () => {
  it('damages everything inside the radius and nothing outside it', () => {
    const inside = zombie(1, 0, 1);
    const outside = zombie(2, 0, 12);
    const hit = explode([inside, outside], 0, 0, 4.5, 26);

    expect(hit).toBe(1);
    expect(inside.damageTaken).toBeGreaterThan(0);
    expect(outside.damageTaken).toBe(0);
  });

  it('falls off linearly from the centre to the rim', () => {
    const centre = zombie(1, 0, 0);
    const middle = zombie(2, 0, 2);
    const rim = zombie(3, 0, 3.99);
    explode([centre, middle, rim], 0, 0, 4, 40);

    expect(centre.damageTaken).toBeCloseTo(40);
    expect(middle.damageTaken).toBeCloseTo(20);
    expect(rim.damageTaken).toBeLessThan(1);
  });

  it('skips the zombie the shell hit directly, which is charged separately', () => {
    const direct = zombie(7, 0, 0);
    const bystander = zombie(8, 0, 1);
    const hit = explode([direct, bystander], 0, 0, 4.5, 26, 7);

    expect(hit).toBe(1);
    expect(direct.damageTaken).toBe(0);
    expect(bystander.damageTaken).toBeGreaterThan(0);
  });

  it('ignores a blast with no radius or no damage', () => {
    const target = zombie(1, 0, 0);
    expect(explode([target], 0, 0, 0, 26)).toBe(0);
    expect(explode([target], 0, 0, 4.5, 0)).toBe(0);
    expect(target.damageTaken).toBe(0);
  });

  it('reaches a whole cluster from one shell', () => {
    const crowd = [
      zombie(1, 0, 0),
      zombie(2, 1, 1),
      zombie(3, -1, 1.5),
      zombie(4, 2, -1),
    ];
    expect(explode(crowd, 0, 0, 4.5, 26)).toBe(4);
    for (const target of crowd) expect(target.damageTaken).toBeGreaterThan(0);
  });
});
