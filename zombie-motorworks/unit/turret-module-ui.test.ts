import { describe, expect, it } from 'vitest';
import { sellRefund } from '../src/core/economy.ts';
import { getPartDef } from '../src/core/parts.ts';
import { upgradeStepFor } from '../src/core/partUpgrades.ts';
import {
  empShieldLeak,
  piercingDamageFraction,
} from '../src/core/turretModules.ts';
import { createWeapon } from '../src/runtime/weapons.ts';
import type { PlacedPart } from '../src/core/types.ts';
import { upgradePrice } from '../src/core/upgrades.ts';

function turret(level?: number): PlacedPart {
  return {
    id: 'blaster',
    defId: 'turret',
    pos: { x: 0, y: 0, z: 0 },
    orient: 0,
    config: level === undefined ? {} : { level },
  };
}

describe('turret EMP and piercing as upgrade unlocks', () => {
  it('names both effects on the turret chain rather than selling them apart', () => {
    const def = getPartDef('turret');
    expect(upgradeStepFor(def, 4)?.name).toBe('EMP Coil');
    expect(upgradeStepFor(def, 5)?.name).toBe('Piercing Rounds');
  });

  it('arms a built weapon straight from the part level', () => {
    expect(createWeapon(turret())).toMatchObject({
      empLevel: 0,
      piercingLevel: 0,
    });
    expect(createWeapon(turret(4))).toMatchObject({
      empLevel: 1,
      piercingLevel: 0,
    });
    expect(createWeapon(turret(5))).toMatchObject({
      empLevel: 2,
      piercingLevel: 1,
    });
    expect(createWeapon(turret(6))).toMatchObject({
      empLevel: 3,
      piercingLevel: 3,
    });
  });

  it('leaves every other gun without either effect at any level', () => {
    const sniper: PlacedPart = { ...turret(6), id: 'rifle', defId: 'sniper-light' };
    expect(createWeapon(sniper)).toMatchObject({
      empLevel: 0,
      piercingLevel: 0,
    });
  });

  it('turns those levels into the tuned shield leak and second-target damage', () => {
    const maxed = createWeapon(turret(6));
    expect(empShieldLeak(maxed.empLevel)).toBe(0.65);
    expect(piercingDamageFraction(maxed.piercingLevel)).toBe(0.6);

    const base = createWeapon(turret());
    expect(empShieldLeak(base.empLevel)).toBe(0.1);
    expect(piercingDamageFraction(base.piercingLevel)).toBe(0);
  });

  it('refunds half of base cost and upgrade spend, with no module spend left', () => {
    const def = getPartDef('turret');
    const upgradeSpend = [2, 3, 4].reduce(
      (total, targetLevel) => total + (upgradePrice(def, targetLevel) ?? 0),
      0,
    );
    expect(sellRefund(turret(4))).toBe(
      Math.floor((def.cost + upgradeSpend) * 0.5),
    );
  });
});
