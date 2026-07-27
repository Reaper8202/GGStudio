import { describe, expect, it, vi } from 'vitest';
import { applyZombieShot } from '../src/survival/SurvivalMode.ts';
import type { TracerShot } from '../src/runtime/weapons.ts';
import type { ZombieHitResult } from '../src/survival/zombies/ZombieSystem.ts';

const DIR = { x: 0, y: 0, z: 1 };

function shot(overrides: Partial<TracerShot> = {}): TracerShot {
  return {
    from: { x: 0, y: 0, z: 0 },
    to: { x: 0, y: 0, z: 1 },
    weaponDefId: 'turret',
    hitZombieHandle: 1,
    hitSurface: false,
    damage: 6,
    damageType: 'projectile',
    empLevel: 0,
    piercingLevel: 0,
    pierceZombieHandle: null,
    pierceDamage: 0,
    pierceTo: null,
    slowFactor: 0.5,
    slowDurationSeconds: 2.5,
    splashRadiusM: 0,
    splashDamage: 0,
    ...overrides,
  };
}

function fakeZombies(opts: {
  hitResult?: ZombieHitResult;
  shielded?: boolean;
}) {
  return {
    hitZombieHandle: vi.fn(() => opts.hitResult ?? 'damaged'),
    isShieldedTarget: vi.fn(() => opts.shielded ?? false),
    slowZombieHandle: vi.fn(),
  };
}

describe('ice-fire slow via applyZombieShot', () => {
  it('slows the struck zombie on a normal connect', () => {
    const zombies = fakeZombies({ hitResult: 'damaged' });
    applyZombieShot(zombies, shot(), DIR);
    expect(zombies.slowZombieHandle).toHaveBeenCalledWith(1, 0.5, 2.5);
  });

  it('does not slow when the weapon carries no slow', () => {
    const zombies = fakeZombies({ hitResult: 'damaged' });
    applyZombieShot(
      zombies,
      shot({ slowFactor: 0, slowDurationSeconds: 0 }),
      DIR,
    );
    expect(zombies.slowZombieHandle).not.toHaveBeenCalled();
  });

  it('does not slow a shot fully absorbed by a shield', () => {
    const zombies = fakeZombies({ hitResult: 'shielded', shielded: true });
    applyZombieShot(zombies, shot(), DIR);
    expect(zombies.slowZombieHandle).not.toHaveBeenCalled();
  });

  it('also slows a pierced secondary target', () => {
    const zombies = fakeZombies({ hitResult: 'damaged' });
    applyZombieShot(
      zombies,
      shot({ pierceZombieHandle: 2, pierceDamage: 3 }),
      DIR,
    );
    expect(zombies.slowZombieHandle).toHaveBeenCalledWith(1, 0.5, 2.5);
    expect(zombies.slowZombieHandle).toHaveBeenCalledWith(2, 0.5, 2.5);
  });
});
