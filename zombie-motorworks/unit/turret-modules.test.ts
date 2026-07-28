import { describe, expect, it } from 'vitest';
import {
  empShieldLeak,
  MINE_SWEEPER_MINIMAP_LEVEL,
  mineSweeperRadius,
  piercingDamageFraction,
  turretEmpLevel,
  turretPiercingLevel,
} from '../src/core/turretModules.ts';

const atLevel = (level?: number) => ({
  config: level === undefined ? {} : { level },
});

describe('turret fire tuning', () => {
  it('uses the exact EMP shield leak for every strength', () => {
    expect([0, 1, 2, 3].map(empShieldLeak)).toEqual([0.1, 0.35, 0.5, 0.65]);
  });

  it('uses the exact secondary-target damage fraction for every strength', () => {
    expect([0, 1, 2, 3].map(piercingDamageFraction)).toEqual([
      0, 0.3, 0.45, 0.6,
    ]);
  });

  it('derives EMP strength from the turret upgrade level alone', () => {
    // The EMP Coil is the level 4 unlock; the two above it tighten the coil.
    expect([1, 2, 3, 4, 5, 6].map((l) => turretEmpLevel(atLevel(l)))).toEqual([
      0, 0, 0, 1, 2, 3,
    ]);
    expect(turretEmpLevel(atLevel())).toBe(0);
    expect(turretEmpLevel(atLevel(99))).toBe(3);
    expect(turretEmpLevel(atLevel(Number.NaN))).toBe(0);
  });

  it('derives piercing strength from the same level', () => {
    // Piercing Rounds unlock at level 5 and the last level tops them out.
    expect(
      [1, 2, 3, 4, 5, 6].map((l) => turretPiercingLevel(atLevel(l))),
    ).toEqual([0, 0, 0, 0, 1, 3]);
    expect(turretPiercingLevel(atLevel())).toBe(0);
    expect(turretPiercingLevel(atLevel(99))).toBe(3);
  });

  it('gives a maxed turret the strongest leak and piercing on the ladder', () => {
    expect(empShieldLeak(turretEmpLevel(atLevel(6)))).toBe(0.65);
    expect(piercingDamageFraction(turretPiercingLevel(atLevel(6)))).toBe(0.6);
  });

  it('clamps Mine Sweeper levels to the configured reveal radii', () => {
    expect([0, 1, 2, 3].map(mineSweeperRadius)).toEqual([0, 14, 22, 30]);
    expect(mineSweeperRadius(Number.NaN)).toBe(0);
    expect(mineSweeperRadius(-1)).toBe(0);
    expect(mineSweeperRadius(99)).toBe(30);
    expect(MINE_SWEEPER_MINIMAP_LEVEL).toBe(2);
  });
});
