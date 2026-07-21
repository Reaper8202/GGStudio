import { describe, expect, it } from 'vitest';
import { getPartDef } from '../src/core/parts.ts';
import {
  effectivePartDef,
  getEffectiveDef,
  upgradePrice,
} from '../src/core/upgrades.ts';

describe('part upgrades', () => {
  it('returns the catalog object unchanged at level one', () => {
    const engine = getPartDef('engine-small');
    expect(effectivePartDef(engine, 1)).toBe(engine);
    expect(effectivePartDef(engine, 0)).toBe(engine);
  });

  it('clamps levels and scales only the applicable payloads without mutating the base', () => {
    const engine = getPartDef('engine-small');
    const effective = effectivePartDef(engine, 99);

    expect(effective.health).toBeCloseTo(engine.health * 1.32);
    expect(effective.engine?.maxPowerKw).toBeCloseTo(
      engine.engine!.maxPowerKw * 1.32 * 1.56,
    );
    expect(effective.engine?.torqueCurve[1][1]).toBeCloseTo(
      engine.engine!.torqueCurve[1][1] * 1.32,
    );
    expect(engine.engine?.maxPowerKw).toBe(95);
    expect(engine.engine?.torqueCurve[1][1]).toBe(210);
    expect(effective.engine?.torqueCurve).not.toBe(engine.engine?.torqueCurve);
  });

  it('scales wheels, weapons, and armour by their respective rates', () => {
    const wheel = effectivePartDef(getPartDef('wheel-standard'), 2);
    const turret = getPartDef('turret');
    const weapon = effectivePartDef(turret, 2);
    const armour = effectivePartDef(getPartDef('armour-plate'), 2);

    expect(wheel.wheel?.frictionLong).toBeCloseTo(1.06);
    expect(weapon.weapon?.damage).toBeCloseTo(turret.weapon!.damage * 1.12);
    expect(weapon.weapon?.fireRate).toBeCloseTo(turret.weapon!.fireRate * 1.08);
    expect(armour.armour?.protection).toBeCloseTo(24 * 1.15);
  });

  it('computes upgrade prices and has defined no-metadata semantics', () => {
    const turret = getPartDef('turret');
    expect(upgradePrice(turret, 2)).toBe(90);
    expect(upgradePrice(turret, 3)).toBe(144);
    expect(() => upgradePrice(turret, 1)).toThrow(RangeError);
    expect(upgradePrice({ ...turret, upgrade: undefined }, 2)).toBeUndefined();
  });

  it('resolves a placed part from its config level', () => {
    const effective = getEffectiveDef({
      id: 'engine',
      defId: 'engine-small',
      pos: { x: 0, y: 0, z: 0 },
      orient: 0,
      config: { level: 2 },
    });
    expect(effective.engine?.maxPowerKw).toBeCloseTo(
      getPartDef('engine-small').engine!.maxPowerKw * 1.08 * 1.14,
    );
  });
});
