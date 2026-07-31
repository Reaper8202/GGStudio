import RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it, vi } from 'vitest';
import type { PlacedPart } from '../src/core/types.ts';
import {
  GROUP_TERRAIN,
  GROUP_ZOMBIE,
  type AssembledVehicle,
} from '../src/runtime/assembler.ts';
import {
  createWeapon,
  stepWeapons,
  type TracerShot,
} from '../src/runtime/weapons.ts';
import { applyZombieShot } from '../src/survival/SurvivalMode.ts';
import type { Zombie, ZombieKind } from '../src/survival/zombies/Zombie.ts';
import { ZombieSystem } from '../src/survival/zombies/ZombieSystem.ts';
import { MAX_PART_LEVEL } from '../src/core/partUpgrades.ts';
import {
  empShieldLeak,
  piercingDamageFraction,
  turretEmpLevel,
  turretPiercingLevel,
} from '../src/core/turretModules.ts';

interface FakeCollider {
  readonly handle: number;
  collisionGroups(): number;
}

interface FakeHit {
  readonly collider: FakeCollider;
  readonly timeOfImpact: number;
}

interface FiredShot {
  readonly shot: TracerShot;
  readonly castRay: ReturnType<typeof vi.fn>;
  readonly primaryCollider: FakeCollider | null;
  readonly recoil: ReturnType<typeof vi.fn>;
  readonly shotsFired: number;
}

function turret(): PlacedPart {
  return {
    id: 'turret',
    defId: 'turret',
    pos: { x: 0, y: 0, z: 0 },
    orient: 0,
    config: {},
  };
}

function hit(handle: number, group: number, timeOfImpact: number): FakeHit {
  return {
    collider: {
      handle,
      collisionGroups: () => (group << 16) | 0xffff,
    },
    timeOfImpact,
  };
}

function fire(
  piercingLevel: number,
  hits: readonly (FakeHit | null)[],
  empLevel = 0,
): FiredShot {
  let hitIndex = 0;
  const castRay = vi.fn(() => hits[hitIndex++] ?? null);
  const world = { castRay } as unknown as RAPIER.World;
  const recoil = vi.fn();
  const vehicle = {
    body: {
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      translation: () => ({ x: 0, y: 0, z: 0 }),
      applyImpulseAtPoint: recoil,
    },
  } as unknown as AssembledVehicle;
  const weapon = createWeapon(turret());
  // EMP/piercing level is normally derived from the turret's own upgrade
  // level (see turretModules.ts), whose ladder skips some values — level 2
  // secondary damage, for one, is unreachable from any turret level. This
  // suite is about how a shot is composed once the weapon already carries a
  // level, not about the ladder that assigns one, so it sets both directly.
  weapon.empLevel = empLevel;
  weapon.piercingLevel = piercingLevel;
  const result = stepWeapons(
    world,
    vehicle,
    [weapon],
    new Set([weapon.partId]),
    { aimYawWorld: 0, fire: true },
    0,
  );
  const shot = result.shots[0];
  if (!shot) throw new Error('Expected the turret to fire');
  return {
    shot,
    castRay,
    primaryCollider: hits[0]?.collider ?? null,
    recoil,
    shotsFired: weapon.shotsFired,
  };
}

interface FakeTarget {
  readonly zombie: Zombie;
  readonly health: () => number;
}

function fakeTarget(kind: ZombieKind, startingHealth = 100): FakeTarget {
  let health = startingHealth;
  const zombie = {
    kind,
    get isTargetable(): boolean {
      return health > 0;
    },
    flashShield: vi.fn(),
    takeDamage: (amount: number): boolean => {
      health -= amount;
      return health <= 0;
    },
  } as unknown as Zombie;
  return { zombie, health: () => health };
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

describe('turret piercing rounds', () => {
  it('produces no secondary hit at level zero', () => {
    const fired = fire(0, [hit(1, GROUP_ZOMBIE, 2), hit(2, GROUP_ZOMBIE, 2)]);

    expect(fired.castRay).toHaveBeenCalledOnce();
    expect(fired.shot.empLevel).toBe(0);
    expect(fired.shot.pierceZombieHandle).toBeNull();
    expect(fired.shot.pierceDamage).toBe(0);
    expect(fired.shot.pierceTo).toBeNull();
  });

  it.each([
    [1, 0.3],
    [3, 0.6],
  ])('deals the exact level-%s secondary fraction', (level, fraction) => {
    const fired = fire(level, [
      hit(1, GROUP_ZOMBIE, 2),
      hit(2, GROUP_ZOMBIE, 2),
    ]);

    expect(fired.shot.pierceZombieHandle).toBe(2);
    expect(fired.shot.pierceDamage).toBe(fired.shot.damage * fraction);
  });

  it('owns the unreachable level-2 fraction in the pure helper', () => {
    // The placed-part ladder jumps from piercing 1 to 3, so level 2 cannot be
    // exercised through a turret rig.
    expect(piercingDamageFraction(2)).toBe(0.45);
  });

  it('maps a real turret upgrade level onto both strength ladders', () => {
    // The cases above set the strengths directly so they can cover values the
    // ladder skips. This is the other half of that contract: which strengths a
    // turret actually reaches by being upgraded. Both come off one level, so a
    // turret that pierces necessarily has a strong coil too.
    const levels = [1, 2, 3, 4, 5, 6];
    expect(levels.map((level) => turretEmpLevel({ config: { level } }))).toEqual([
      0, 0, 0, 1, 2, 3,
    ]);
    expect(
      levels.map((level) => turretPiercingLevel({ config: { level } })),
    ).toEqual([0, 0, 0, 0, 1, 3]);
    expect(MAX_PART_LEVEL).toBe(levels.at(-1));
  });

  it('casts only once beyond the primary and excludes its collider', () => {
    const fired = fire(3, [
      hit(1, GROUP_ZOMBIE, 2),
      hit(2, GROUP_ZOMBIE, 2),
      hit(3, GROUP_ZOMBIE, 1),
    ]);

    expect(fired.castRay).toHaveBeenCalledTimes(2);
    expect(fired.castRay.mock.calls[1]?.[5]).toBe(fired.primaryCollider);
    expect(fired.shot.pierceZombieHandle).toBe(2);
  });

  it('limits continuation to the remaining original range', () => {
    const firstHitDistance = 3;
    const fired = fire(1, [
      hit(1, GROUP_ZOMBIE, firstHitDistance),
      hit(2, GROUP_ZOMBIE, 1),
    ]);

    expect(fired.castRay.mock.calls[0]?.[1]).toBe(8);
    expect(fired.castRay.mock.calls[1]?.[1]).toBeCloseTo(
      8 - firstHitDistance - 0.0001,
    );

    const edge = fire(1, [hit(1, GROUP_ZOMBIE, 7.99995)]);
    expect(edge.castRay).toHaveBeenCalledOnce();
    expect(edge.shot.pierceZombieHandle).toBeNull();
    expect(edge.shot.pierceTo).toBeNull();
  });

  it('does not pierce when terrain is the primary hit', () => {
    const fired = fire(3, [hit(10, GROUP_TERRAIN, 2), hit(2, GROUP_ZOMBIE, 1)]);

    expect(fired.castRay).toHaveBeenCalledOnce();
    expect(fired.shot.hitZombieHandle).toBeNull();
    expect(fired.shot.pierceZombieHandle).toBeNull();
    expect(fired.shot.pierceTo).toBeNull();
  });

  it('lets terrain on the continuation block a secondary zombie', () => {
    const fired = fire(3, [
      hit(1, GROUP_ZOMBIE, 2),
      hit(10, GROUP_TERRAIN, 1),
      hit(2, GROUP_ZOMBIE, 1),
    ]);

    expect(fired.castRay).toHaveBeenCalledTimes(2);
    expect(fired.shot.pierceZombieHandle).toBeNull();
    expect(fired.shot.pierceDamage).toBe(0);
    expect(fired.shot.pierceTo).not.toBeNull();
  });

  it('terminates before secondary damage when the primary is a Phone Addict', () => {
    const fired = fire(3, [hit(1, GROUP_ZOMBIE, 2), hit(2, GROUP_ZOMBIE, 2)]);
    const primary = fakeTarget('phone-addict');
    const secondary = fakeTarget('walker');
    const system = zombieSystem(
      new Map([
        [1, primary],
        [2, secondary],
      ]),
    );

    const pierceContinues = applyZombieShot(system, fired.shot, {
      x: 0,
      y: 0,
      z: 1,
    });

    expect(pierceContinues).toBe(false);
    expect(primary.health()).toBe(
      100 - fired.shot.damage * empShieldLeak(fired.shot.empLevel),
    );
    expect(secondary.health()).toBe(100);
  });

  it('composes piercing damage before the secondary shield leak', () => {
    const fired = fire(
      1,
      [hit(1, GROUP_ZOMBIE, 2), hit(2, GROUP_ZOMBIE, 2)],
      2,
    );
    const primary = fakeTarget('walker');
    const secondary = fakeTarget('phone-addict');
    const system = zombieSystem(
      new Map([
        [1, primary],
        [2, secondary],
      ]),
    );

    const pierceContinues = applyZombieShot(system, fired.shot, {
      x: 0,
      y: 0,
      z: 1,
    });

    expect(pierceContinues).toBe(true);
    expect(primary.health()).toBe(100 - fired.shot.damage);
    expect(secondary.health()).toBe(100 - fired.shot.damage * 0.3 * 0.5);
  });

  it.each([0, 3])(
    'applies recoil and trigger accounting once at level %s',
    (level) => {
      const fired = fire(level, [
        hit(1, GROUP_ZOMBIE, 2),
        hit(2, GROUP_ZOMBIE, 2),
      ]);

      expect(fired.recoil).toHaveBeenCalledOnce();
      expect(fired.shotsFired).toBe(1);
    },
  );
});
