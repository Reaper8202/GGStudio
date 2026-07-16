import { describe, expect, it } from 'vitest';
import {
  connectionDamage,
  impactImpulseNs,
  partDamage,
} from '../src/runtime/damage.ts';

describe('impact damage model', () => {
  it('does no damage below the safe impact force', () => {
    const impulseNs = impactImpulseNs(80_000);

    expect(impulseNs).toBe(0);
    expect(partDamage(impulseNs)).toBe(0);
    expect(connectionDamage(impulseNs, 120_000)).toBe(0);
  });

  it('lets an 80 HP part and a frame connection survive a one-tick 3 m drop force', () => {
    const impulseNs = impactImpulseNs(335_000);
    const damageHp = partDamage(impulseNs);
    const edgeDamage = connectionDamage(impulseNs, 120_000);

    expect(impulseNs).toBeCloseTo(3_916.67, 2);
    expect(damageHp).toBeCloseTo(60.26, 2);
    expect(damageHp).toBeLessThan(80);
    expect(edgeDamage).toBeCloseTo(0.78, 2);
    expect(edgeDamage).toBeLessThan(1);
  });

  it('destroys a block or its single frame edge in a one-tick 60 km/h wall impact', () => {
    const impulseNs = impactImpulseNs(727_000);
    const damageHp = partDamage(impulseNs);
    const edgeDamage = connectionDamage(impulseNs, 120_000);

    expect(damageHp).toBeCloseTo(160.77, 2);
    expect(damageHp).toBeGreaterThan(150);
    expect(edgeDamage).toBeGreaterThanOrEqual(1);
  });
});
