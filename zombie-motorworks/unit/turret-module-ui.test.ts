import { describe, expect, it } from 'vitest';
import {
  nextTurretModulePurchase,
  turretModuleEconomy,
} from '../src/editor/EditorMode.ts';
import { sellRefund } from '../src/core/economy.ts';
import { getPartDef } from '../src/core/parts.ts';
import {
  EMP_PRICE_BY_LEVEL,
  PIERCING_PRICE_BY_LEVEL,
  turretModulePrice,
} from '../src/core/turretModules.ts';
import type { PartConfig, PlacedPart } from '../src/core/types.ts';
import { upgradePrice } from '../src/core/upgrades.ts';

describe('turret module garage logic', () => {
  it('uses the L1, L2, and L3 prices and stops past max for both modules', () => {
    expect([1, 2, 3].map((level) => turretModulePrice('emp', level))).toEqual(
      [...EMP_PRICE_BY_LEVEL.slice(1)],
    );
    expect(
      [1, 2, 3].map((level) => turretModulePrice('piercing', level)),
    ).toEqual([...PIERCING_PRICE_BY_LEVEL.slice(1)]);
    expect(turretModulePrice('emp', 4)).toBeNull();
    expect(turretModulePrice('piercing', 4)).toBeNull();
  });

  it('enables purchases at the exact price and disables them one dollar short', () => {
    const empPrice = EMP_PRICE_BY_LEVEL[1];
    expect(
      turretModuleEconomy({}, empPrice, { highestWaveCleared: 10 }).emp
        .canBuy,
    ).toBe(true);
    expect(
      turretModuleEconomy({}, empPrice - 1, { highestWaveCleared: 10 }).emp
        .canBuy,
    ).toBe(false);

    const piercingPrice = PIERCING_PRICE_BY_LEVEL[1];
    expect(turretModuleEconomy({}, piercingPrice, {}).piercing.canBuy).toBe(
      true,
    );
    expect(
      turretModuleEconomy({}, piercingPrice - 1, {}).piercing.canBuy,
    ).toBe(false);
  });

  it('gates EMP on wave or Phone Addict progress', () => {
    const money = Number.MAX_SAFE_INTEGER;
    expect(turretModuleEconomy({}, money, {}).emp.unlocked).toBe(false);
    expect(
      turretModuleEconomy({}, money, { highestWaveCleared: 10 }).emp.unlocked,
    ).toBe(true);
    expect(
      turretModuleEconomy({}, money, { phoneAddictsKilled: 1 }).emp.unlocked,
    ).toBe(true);
    expect(
      turretModuleEconomy({}, money, { highestWaveCleared: 9 }).emp.unlocked,
    ).toBe(false);
  });

  it('never progression-gates Piercing', () => {
    expect(
      turretModuleEconomy({}, PIERCING_PRICE_BY_LEVEL[1], {}).piercing,
    ).toMatchObject({ unlocked: true, canBuy: true });
  });

  it('raises only the purchased module and leaves generic level alone', () => {
    const original: PartConfig = {
      level: 3,
      empLevel: 1,
      piercingLevel: 1,
    };
    const empPurchase = nextTurretModulePurchase(original, 'emp');
    const piercingPurchase = nextTurretModulePurchase(original, 'piercing');

    expect(empPurchase?.config).toMatchObject({
      level: 3,
      empLevel: 2,
      piercingLevel: 1,
    });
    expect(piercingPurchase?.config).toMatchObject({
      level: 3,
      empLevel: 1,
      piercingLevel: 2,
    });
    expect(original).toEqual({ level: 3, empLevel: 1, piercingLevel: 1 });
  });

  it('refunds half of base cost, generic upgrades, and both module spends', () => {
    const def = getPartDef('turret');
    const turret: PlacedPart = {
      id: 'turret-with-modules',
      defId: def.id,
      pos: { x: 0, y: 0, z: 0 },
      orient: 0,
      config: { level: 3, empLevel: 3, piercingLevel: 3 },
    };
    const genericUpgradeSpend = [2, 3].reduce(
      (total, targetLevel) => total + (upgradePrice(def, targetLevel) ?? 0),
      0,
    );
    const moduleSpend = [
      ...EMP_PRICE_BY_LEVEL.slice(1),
      ...PIERCING_PRICE_BY_LEVEL.slice(1),
    ].reduce<number>((total, price) => total + price, 0);

    expect(sellRefund(turret)).toBe(
      Math.floor((def.cost + genericUpgradeSpend + moduleSpend) * 0.5),
    );
  });
});
