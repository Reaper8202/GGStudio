import type { PartConfig, PlacedPart } from './types.ts';

export const TURRET_MODULE_MAX_LEVEL = 3;

/** Fraction of gun damage that reaches a Phone Addict through its bubble shield. */
export const EMP_SHIELD_LEAK_BY_LEVEL = [0.1, 0.35, 0.5, 0.65] as const;

/** Fraction of primary damage dealt to a piercing round's second target. */
export const PIERCING_DAMAGE_BY_LEVEL = [0, 0.3, 0.45, 0.6] as const;

/** Cumulative price to go from level n-1 to level n; index 0 unused. */
export const EMP_PRICE_BY_LEVEL = [0, 100, 175, 300] as const;
export const PIERCING_PRICE_BY_LEVEL = [0, 125, 225, 375] as const;

/** Mine reveal radius in metres by Mine Sweeper upgrade level; index 0 = no part. */
export const MINE_SWEEPER_RADIUS_BY_LEVEL = [0, 14, 22, 30] as const;
/** Level at which revealed mines also appear on the minimap. */
export const MINE_SWEEPER_MINIMAP_LEVEL = 2;

export type TurretModule = 'emp' | 'piercing';

function clampedLevel(level: number, maxLevel: number): number {
  if (Number.isNaN(level)) return 0;
  return Math.min(maxLevel, Math.max(0, Math.floor(level)));
}

/** Clamps any stored value to a valid module level. */
export function turretModuleLevel(
  config: PartConfig,
  module: TurretModule,
): number {
  const stored = module === 'emp' ? config.empLevel : config.piercingLevel;
  return clampedLevel(stored ?? 0, TURRET_MODULE_MAX_LEVEL);
}

/** Price of the next level, or null at max level. */
export function turretModulePrice(
  module: TurretModule,
  targetLevel: number,
): number | null {
  if (targetLevel > TURRET_MODULE_MAX_LEVEL) return null;
  const level = clampedLevel(targetLevel, TURRET_MODULE_MAX_LEVEL);
  const prices =
    module === 'emp' ? EMP_PRICE_BY_LEVEL : PIERCING_PRICE_BY_LEVEL;
  return prices[level];
}

/** Total money already sunk into both modules on a placed part. */
export function turretModuleInvestment(placed: PlacedPart): number {
  if (placed.defId !== 'turret') return 0;

  let investment = 0;
  for (const module of ['emp', 'piercing'] as const) {
    const level = turretModuleLevel(placed.config, module);
    const prices =
      module === 'emp' ? EMP_PRICE_BY_LEVEL : PIERCING_PRICE_BY_LEVEL;
    for (let targetLevel = 1; targetLevel <= level; targetLevel += 1) {
      investment += prices[targetLevel];
    }
  }
  return investment;
}

export function mineSweeperRadius(level: number): number {
  return MINE_SWEEPER_RADIUS_BY_LEVEL[
    clampedLevel(level, MINE_SWEEPER_RADIUS_BY_LEVEL.length - 1)
  ];
}

/**
 * Shield leak multiplier for a gun hit on a Phone Addict.
 * Level 0 is the baseline 10% leak that exists even without the module, so the
 * turret can never be a hard soft-lock against a shielded-only field.
 */
export function empShieldLeak(empLevel: number): number {
  return EMP_SHIELD_LEAK_BY_LEVEL[
    clampedLevel(empLevel, TURRET_MODULE_MAX_LEVEL)
  ];
}

/** Secondary-target damage fraction; 0 means no piercing shot at all. */
export function piercingDamageFraction(piercingLevel: number): number {
  return PIERCING_DAMAGE_BY_LEVEL[
    clampedLevel(piercingLevel, TURRET_MODULE_MAX_LEVEL)
  ];
}

/** EMP is buyable once the player has cleared wave 10 or killed a Phone Addict. */
export function isEmpUnlocked(progress: {
  highestWaveCleared?: number;
  phoneAddictsKilled?: number;
}): boolean {
  return (
    (progress.highestWaveCleared ?? 0) >= 10 ||
    (progress.phoneAddictsKilled ?? 0) >= 1
  );
}

/** Piercing has no progression gate beyond owning a turret. */
export function isPiercingUnlocked(): boolean {
  return true;
}
