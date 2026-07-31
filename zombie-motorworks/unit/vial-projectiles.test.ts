import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BOX_PROJECTILE,
  VIAL_PROJECTILE,
  ThrowerProjectiles,
} from '../src/survival/zombies/ThrowerProjectiles.ts';
import {
  PROJECTILE_DAMAGE,
  PROJECTILE_HORIZONTAL_SPEED,
  VIAL_HORIZONTAL_SPEED,
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

describe('vial projectiles', () => {
  it('flies slower than a thrower box over the same shot', () => {
    // The whole reason vials have their own spec: the boss's shot has to be
    // the more readable, more dodgeable one, same as the needle bolt it replaced.
    expect(VIAL_HORIZONTAL_SPEED).toBeLessThan(PROJECTILE_HORIZONTAL_SPEED);

    const boxes = new ThrowerProjectiles(new THREE.Scene());
    const vials = new ThrowerProjectiles(new THREE.Scene());
    boxes.launch(0, 2, 0, 14, 1, 0, BOX_PROJECTILE);
    vials.launch(0, 2, 0, 14, 1, 0, {
      ...VIAL_PROJECTILE,
      damage: 9,
    });

    for (let i = 0; i < 30; i++) {
      boxes.update(STEP, NEVER_HIT);
      vials.update(STEP, NEVER_HIT);
    }

    expect(travelled(vials, 0, 0)).toBeLessThan(travelled(boxes, 0, 0));
    boxes.dispose();
    vials.dispose();
  });

  it('arcs like a thrown lob rather than the flattened bolt it replaced', () => {
    // Unlike the old needle boss (reduced gravityScale to stay flat), a vial
    // uses full gravity — VIAL_GRAVITY_SCALE is 1, same as the thrower's box —
    // so it should genuinely arc upward on its way in, not skim close to the
    // launch height.
    const pool = new ThrowerProjectiles(new THREE.Scene());
    const fromY = 4.3;
    pool.launch(0, fromY, 0, 14, 1, 0, { ...VIAL_PROJECTILE, damage: 9 });

    let peak = fromY;
    for (let i = 0; i < 120; i++) {
      pool.update(STEP, NEVER_HIT);
      const [live] = pool.activeProjectiles();
      if (live === undefined) break;
      peak = Math.max(peak, live.y);
    }

    expect(peak).toBeGreaterThan(fromY + 1.5);
    pool.dispose();
  });

  it('carries its own damage and hit radius to the impact test', () => {
    const pool = new ThrowerProjectiles(new THREE.Scene());
    pool.launch(0, 2, 0, 6, 1, 0, { ...VIAL_PROJECTILE, damage: 9 });

    const seen: { damage: number; hitRadius: number }[] = [];
    pool.update(STEP, (_x, _y, _z, damage, hitRadius) => {
      seen.push({ damage, hitRadius });
      return false;
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].damage).toBe(9);
    expect(seen[0].hitRadius).toBe(VIAL_PROJECTILE.hitRadius);
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
    pool.launch(0, 2, 0, 6, 1, 0, { ...VIAL_PROJECTILE, damage: 9 });
    expect(pool.activeProjectiles()).toHaveLength(1);

    pool.update(STEP, () => true);
    expect(pool.activeProjectiles()).toHaveLength(0);
    pool.dispose();
  });

  it('fans three vials to equal distance so a barrage lands together', () => {
    // Mirrors ZombieSystem.fireVialsFrom: rotating the aim vector rather than
    // nudging the target point keeps every vial's flight time identical.
    const pool = new ThrowerProjectiles(new THREE.Scene());
    const dx = 14;
    const dz = 0;
    const halfFan = ((30 / 2) * Math.PI) / 180;

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
        { ...VIAL_PROJECTILE, damage: 9 },
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

  it('bursts a puddle wherever it lands via onLand, carrying its puddle payload', () => {
    const pool = new ThrowerProjectiles(new THREE.Scene());
    const puddle = {
      radiusM: 3.2,
      durationSeconds: 5,
      poisonDamagePerSecond: 10,
    };
    pool.launch(0, 2, 0, 6, 1, 0, { ...VIAL_PROJECTILE, damage: 9, puddle });

    const landed: { variant: string; puddle: typeof puddle | undefined }[] = [];
    // Impact immediately: the vial should still report its puddle payload to
    // onLand even though it never reached the ground on its own.
    pool.update(STEP, () => true, (_x, _y, _z, variant, landedPuddle) => {
      landed.push({ variant, puddle: landedPuddle });
    });

    expect(landed).toHaveLength(1);
    expect(landed[0].variant).toBe('vial');
    expect(landed[0].puddle).toEqual(puddle);
    pool.dispose();
  });

  it('never reports a puddle for a plain thrower box', () => {
    const pool = new ThrowerProjectiles(new THREE.Scene());
    pool.launch(0, 2, 0, 6, 1, 0, BOX_PROJECTILE);

    const landed: unknown[] = [];
    pool.update(STEP, () => true, (_x, _y, _z, _variant, puddle) => {
      landed.push(puddle);
    });

    expect(landed).toEqual([undefined]);
    pool.dispose();
  });
});
