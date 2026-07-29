import { describe, expect, it } from 'vitest';
import {
  DAMAGE_TIER_THRESHOLDS,
  DamageNumberModel,
} from '../src/core/damageNumbers.ts';

describe('DamageNumberModel', () => {
  it('merges repeat hits inside the window and restarts the pop', () => {
    const model = new DamageNumberModel({ seed: 12 });
    model.add(7, 3, 1, 2, 3);
    model.update(0.2);
    model.add(7, 3, 9, 9, 9);

    expect(model.active).toHaveLength(1);
    expect(model.active[0]).toMatchObject({
      targetKey: 7,
      amount: 6,
      x: 1,
      y: 2,
      z: 3,
      popAge: 0,
    });
  });

  it('starts a fresh number after the merge window closes', () => {
    const model = new DamageNumberModel({ mergeSeconds: 0.45 });
    model.add(7, 3, 1, 2, 3);
    model.update(0.46);
    model.add(7, 3, 4, 5, 6);

    expect(model.active).toHaveLength(2);
    expect(model.active.map((number) => number.amount)).toEqual([3, 3]);
    expect(model.active[1]).toMatchObject({ x: 4, y: 5, z: 6 });
  });

  it('upgrades the tier as an accumulated total crosses thresholds', () => {
    const model = new DamageNumberModel();
    model.add(3, DAMAGE_TIER_THRESHOLDS.medium - 1, 0, 0, 0);
    expect(model.active[0]?.tier).toBe('low');

    model.add(3, 1, 0, 0, 0);
    expect(model.active[0]?.tier).toBe('medium');

    model.add(
      3,
      DAMAGE_TIER_THRESHOLDS.high - DAMAGE_TIER_THRESHOLDS.medium,
      0,
      0,
      0,
    );
    expect(model.active[0]?.tier).toBe('high');
  });

  it('retires expired numbers and recycles the oldest at capacity', () => {
    const model = new DamageNumberModel({ capacity: 2, lifeSeconds: 1 });
    model.add(1, 1, 0, 0, 0);
    model.add(2, 1, 0, 0, 0);
    model.add(3, 1, 0, 0, 0);

    expect(model.active.map((number) => number.targetKey)).toEqual([2, 3]);

    model.update(1);
    expect(model.active).toHaveLength(0);
  });

  it('uses deterministic, distinct jitter for a seed', () => {
    const first = new DamageNumberModel({ seed: 99 });
    const second = new DamageNumberModel({ seed: 99 });
    for (const model of [first, second]) {
      model.add(1, 1, 0, 0, 0);
      model.add(2, 1, 0, 0, 0);
    }

    expect(first.active.map(jitter)).toEqual(second.active.map(jitter));
    expect(jitter(first.active[0]!)).not.toEqual(jitter(first.active[1]!));
  });

  it('ignores invalid damage amounts without throwing', () => {
    const model = new DamageNumberModel();

    expect(() => {
      model.add(1, Number.NaN, 0, 0, 0);
      model.add(1, Number.POSITIVE_INFINITY, 0, 0, 0);
      model.add(1, 0, 0, 0, 0);
      model.add(1, -3, 0, 0, 0);
    }).not.toThrow();
    expect(model.active).toHaveLength(0);
  });
});

function jitter(number: {
  offsetX: number;
  offsetY: number;
}): [number, number] {
  return [number.offsetX, number.offsetY];
}
