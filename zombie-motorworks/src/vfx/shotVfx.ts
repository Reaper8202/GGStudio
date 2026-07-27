/**
 * Presentation rules that map a fired shot onto VFX choices.
 *
 * Kept as pure functions so both survival and the test chamber classify shots
 * identically, and so the mapping is unit-testable without a Three.js scene.
 * Runtime carries an ordinary catalog id; this layer owns the visual mapping.
 */

import type { DamageType } from '../core/types.ts';
import type { ImpactVfxKind, MuzzleVfxStyle } from './VfxSystem.ts';

type WeaponAppearanceId =
  'turret' | 'cannon-heavy' | 'ice-cannon' | 'sniper-light' | 'flamethrower';

interface WeaponImpactKinds {
  readonly zombie: ImpactVfxKind;
  readonly terrain: ImpactVfxKind;
  readonly shield: ImpactVfxKind;
}

const WEAPON_MUZZLES: Readonly<Record<WeaponAppearanceId, MuzzleVfxStyle>> = {
  turret: 'turret',
  'cannon-heavy': 'cannon-heavy',
  'ice-cannon': 'ice-cannon',
  'sniper-light': 'sniper-light',
  flamethrower: 'flamethrower',
};

const WEAPON_IMPACTS: Readonly<Record<WeaponAppearanceId, WeaponImpactKinds>> =
  {
    turret: {
      zombie: 'turret-zombie',
      terrain: 'turret-terrain',
      shield: 'turret-shield',
    },
    'cannon-heavy': {
      zombie: 'cannon-heavy-zombie',
      terrain: 'cannon-heavy-terrain',
      shield: 'cannon-heavy-shield',
    },
    'ice-cannon': {
      zombie: 'ice-cannon-zombie',
      terrain: 'ice-cannon-terrain',
      shield: 'ice-cannon-shield',
    },
    'sniper-light': {
      zombie: 'sniper-light-zombie',
      terrain: 'sniper-light-terrain',
      shield: 'sniper-light-shield',
    },
    flamethrower: {
      zombie: 'flamethrower-zombie',
      terrain: 'flamethrower-terrain',
      shield: 'flamethrower-shield',
    },
  };

/** The parts of a `TracerShot` that presentation cares about. */
export interface ShotAppearance {
  /** Required on runtime shots; optional here keeps old presentation fixtures valid. */
  readonly weaponDefId?: string;
  readonly damageType: DamageType;
  readonly damage: number;
  readonly slowFactor: number;
  readonly hitZombieHandle: number | null;
  readonly hitSurface: boolean;
}

/**
 * Map only known catalog weapons. An explicit unknown id has the documented
 * turret fallback; absent ids take the legacy number-based path for old test
 * fixtures and external adapters that predate `TracerShot.weaponDefId`.
 */
function weaponAppearanceId(weaponDefId: string): WeaponAppearanceId {
  if (Object.prototype.hasOwnProperty.call(WEAPON_MUZZLES, weaponDefId)) {
    return weaponDefId as WeaponAppearanceId;
  }
  return 'turret';
}

/** Barrel character is keyed by the firing part, never by upgraded damage. */
export function muzzleStyleForShot(shot: ShotAppearance): MuzzleVfxStyle {
  if (shot.weaponDefId !== undefined) {
    return WEAPON_MUZZLES[weaponAppearanceId(shot.weaponDefId)];
  }
  if (shot.damageType === 'aoe') return 'flame';
  if (shot.slowFactor > 0) return 'ice';
  if (shot.damage < 20) return 'standard';
  return shot.damageType === 'hitscan' ? 'sniper' : 'heavy';
}

/**
 * What the shot terminated against, or null when it simply ran out of range in
 * mid-air and should leave nothing behind. Shield impacts retain the firing
 * weapon's accent rather than replacing it with a generic effect.
 */
export function impactKindForShot(
  shot: ShotAppearance,
  shielded: boolean,
): ImpactVfxKind | null {
  const landed = shot.hitZombieHandle !== null || shot.hitSurface;
  if (!landed) return null;

  if (shot.weaponDefId !== undefined) {
    const kinds = WEAPON_IMPACTS[weaponAppearanceId(shot.weaponDefId)];
    if (shot.hitZombieHandle !== null) {
      return shielded ? kinds.shield : kinds.zombie;
    }
    return kinds.terrain;
  }

  // Legacy appearance inputs did not have a catalog id. Keep their previous
  // classification so downstream adapters can migrate without visual breakage.
  if (shot.damageType === 'aoe') return 'burn';
  if (shot.hitZombieHandle !== null) {
    if (shielded) return 'shield';
    return shot.slowFactor > 0 ? 'ice' : 'flesh';
  }
  return 'hard';
}
