import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BOX_PROJECTILE,
  NEEDLE_PROJECTILE,
  ThrowerProjectiles,
} from '../src/survival/zombies/ThrowerProjectiles.ts';
import {
  NEEDLE_HORIZONTAL_SPEED,
  PROJECTILE_DAMAGE,
  PROJECTILE_HORIZONTAL_SPEED,
} from '../src/survival/zombies/zombieConfig.ts';

const STEP = 1 / 60;
const NEVER_HIT = () => false;

/** Horizontal distance a projectile has covered from its launch point. */
function travelled(
  pool: ThrowerProjectiles,
  fromX: number,
  fromZ: number,
): number {
  const [live] = pool.activeProjectiles();
  return Math.hypot(live.x - fromX, live.z - fromZ);
}

describe('needle projectiles', () => {
  it('flies slower than a thrower box over the same shot', () => {
    // The whole reason needles exist as their own spec: the boss's shot has to be
    // the more readable, more dodgeable one.
    expect(NEEDLE_HORIZONTAL_SPEED).toBeLessThan(PROJECTILE_HORIZONTAL_SPEED);

    const boxes = new ThrowerProjectiles(new THREE.Scene());
    const needles = new ThrowerProjectiles(new THREE.Scene());
    boxes.launch(0, 2, 0, 14, 1, 0, BOX_PROJECTILE);
    needles.launch(0, 2, 0, 14, 1, 0, {
      ...NEEDLE_PROJECTILE,
      damage: 22,
    });

    for (let i = 0; i < 30; i++) {
      boxes.update(STEP, NEVER_HIT);
      needles.update(STEP, NEVER_HIT);
    }

    expect(travelled(needles, 0, 0)).toBeLessThan(travelled(boxes, 0, 0));
    boxes.dispose();
    needles.dispose();
  });

  it('stays flat instead of mortaring over the rig', () => {
    // A slower ballistic shot has to be lobbed higher to hang in the air long
    // enough, so without the reduced gravity a 7 m/s needle would sail well above
    // the vehicle on its way in. Cap the arc close to the launch height.
    const pool = new ThrowerProjectiles(new THREE.Scene());
    const fromY = 4.3;
    pool.launch(0, fromY, 0, 14, 1, 0, { ...NEEDLE_PROJECTILE, damage: 22 });

    let peak = fromY;
    for (let i = 0; i < 120; i++) {
      pool.update(STEP, NEVER_HIT);
      const [live] = pool.activeProjectiles();
      if (live === undefined) break;
      peak = Math.max(peak, live.y);
    }

    expect(peak).toBeLessThan(fromY + 1);
    pool.dispose();
  });

  it('carries its own damage and hit radius to the impact test', () => {
    const pool = new ThrowerProjectiles(new THREE.Scene());
    pool.launch(0, 2, 0, 6, 1, 0, { ...NEEDLE_PROJECTILE, damage: 22 });

    const seen: { damage: number; hitRadius: number }[] = [];
    pool.update(STEP, (_x, _y, _z, damage, hitRadius) => {
      seen.push({ damage, hitRadius });
      return false;
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].damage).toBe(22);
    expect(seen[0].hitRadius).toBe(NEEDLE_PROJECTILE.hitRadius);
    pool.dispose();
  });

  it('still defaults to the thrower box, damage and all', () => {
    const pool = new ThrowerProjectiles(new THREE.Scene());
    // No spec argument: the thrower's existing call site must be unchanged.
    pool.launch(0, 2, 0, 6, 1, 0);

    const seen: number[] = [];
    pool.update(STEP, (_x, _y, _z, damage) => {
      seen.push(damage);
      return false;
    });

    expect(pool.activeProjectiles()[0].variant).toBe('box');
    expect(seen[0]).toBe(PROJECTILE_DAMAGE);
    pool.dispose();
  });

  it('despawns on a reported impact', () => {
    const pool = new ThrowerProjectiles(new THREE.Scene());
    pool.launch(0, 2, 0, 6, 1, 0, { ...NEEDLE_PROJECTILE, damage: 22 });
    expect(pool.activeProjectiles()).toHaveLength(1);

    pool.update(STEP, () => true);
    expect(pool.activeProjectiles()).toHaveLength(0);
    pool.dispose();
  });

  it('fans three needles to equal distance so a spray lands together', () => {
    // Mirrors ZombieSystem.fireNeedlesFrom: rotating the aim vector rather than
    // nudging the target point keeps every needle's flight time identical.
    const pool = new ThrowerProjectiles(new THREE.Scene());
    const dx = 14;
    const dz = 0;
    const halfFan = ((16 / 2) * Math.PI) / 180;

    for (let i = 0; i < 3; i++) {
      const offset = -halfFan + (2 * halfFan * i) / 2;
      const cos = Math.cos(offset);
      const sin = Math.sin(offset);
      pool.launch(
        0,
        2,
        0,
        dx * cos - dz * sin,
        1,
        dx * sin + dz * cos,
        { ...NEEDLE_PROJECTILE, damage: 22 },
      );
    }

    const live = pool.activeProjectiles();
    expect(live).toHaveLength(3);

    for (let i = 0; i < 40; i++) pool.update(STEP, NEVER_HIT);

    const distances = pool
      .activeProjectiles()
      .map((p) => Math.hypot(p.x, p.z));
    expect(distances).toHaveLength(3);
    for (const distance of distances) {
      expect(distance).toBeCloseTo(distances[0], 5);
    }
    // And they genuinely spread rather than stacking on one line.
    const spread = pool.activeProjectiles().map((p) => p.z);
    expect(Math.max(...spread) - Math.min(...spread)).toBeGreaterThan(0.5);
    pool.dispose();
  });
});
