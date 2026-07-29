/**
 * Zombie Blaster fire tuning, plus the Mine Sweeper's reveal radius.
 *
 * EMP and piercing used to be two side modules bought separately from the part
 * itself. They are now unlocks on the turret's ordinary upgrade chain (see
 * `partUpgrades.ts`), so there is one ladder to climb and one number — the
 * part's level — that decides how the gun shoots.
 */

import { MAX_PART_LEVEL } from './partUpgrades.ts';
import type { PlacedPart } from './types.ts';

/** Fraction of gun damage that reaches a Phone Addict through its bubble shield. */
export const EMP_SHIELD_LEAK_BY_LEVEL = [0.1, 0.35, 0.5, 0.65] as const;

/** Fraction of primary damage dealt to a piercing round's second target. */
export const PIERCING_DAMAGE_BY_LEVEL = [0, 0.3, 0.45, 0.6] as const;

/** Mine reveal radius in metres by Mine Sweeper upgrade level; index 0 = no part. */
export const MINE_SWEEPER_RADIUS_BY_LEVEL = [0, 14, 22, 30] as const;
/** Level at which revealed mines also appear on the minimap. */
export const MINE_SWEEPER_MINIMAP_LEVEL = 2;

/**
 * EMP strength by turret upgrade level (index = level - 1). The EMP Coil unlock
 * lands at level 4 and the two levels above it tighten the coil, so a maxed
 * turret still reaches the strongest shield leak on the ladder.
 */
const EMP_LEVEL_BY_PART_LEVEL = [0, 0, 0, 1, 2, 3] as const;

/**
 * Piercing strength by turret upgrade level. The chain has room for the unlock
 * at level 5 and one improvement at 6, so it steps from the ladder's first rung
 * straight to its last rather than crawling a stop it cannot reach.
 */
const PIERCING_LEVEL_BY_PART_LEVEL = [0, 0, 0, 0, 1, 3] as const;

function clampedLevel(level: number, maxLevel: number): number {
  if (Number.isNaN(level)) return 0;
  return Math.min(maxLevel, Math.max(0, Math.floor(level)));
}

/** A placed part's upgrade level as an index into the per-level ladders. */
function partLevelIndex(placed: Pick<PlacedPart, 'config'>): number {
  const level = placed.config.level ?? 1;
  return clampedLevel(Number.isFinite(level) ? level : 1, MAX_PART_LEVEL) - 1;
}

/** EMP strength this turret shoots with, from its upgrade level alone. */
export function turretEmpLevel(placed: Pick<PlacedPart, 'config'>): number {
  return EMP_LEVEL_BY_PART_LEVEL[Math.max(0, partLevelIndex(placed))];
}

/** Piercing strength this turret shoots with, from its upgrade level alone. */
export function turretPiercingLevel(placed: Pick<PlacedPart, 'config'>): number {
  return PIERCING_LEVEL_BY_PART_LEVEL[Math.max(0, partLevelIndex(placed))];
}

export function mineSweeperRadius(level: number): number {
  return MINE_SWEEPER_RADIUS_BY_LEVEL[
    clampedLevel(level, MINE_SWEEPER_RADIUS_BY_LEVEL.length - 1)
  ];
}

/**
 * Shield leak multiplier for a gun hit on a Phone Addict.
 * Level 0 is the baseline 10% leak an un-upgraded turret still gets, so the gun
 * can never be a hard soft-lock against a shielded-only field.
 */
export function empShieldLeak(empLevel: number): number {
  return EMP_SHIELD_LEAK_BY_LEVEL[
    clampedLevel(empLevel, EMP_SHIELD_LEAK_BY_LEVEL.length - 1)
  ];
}

/** Secondary-target damage fraction; 0 means no piercing shot at all. */
export function piercingDamageFraction(piercingLevel: number): number {
  return PIERCING_DAMAGE_BY_LEVEL[
    clampedLevel(piercingLevel, PIERCING_DAMAGE_BY_LEVEL.length - 1)
  ];
}
