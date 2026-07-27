/**
 * Presentation rules that map a fired shot onto VFX choices.
 *
 * Kept as pure functions so both survival and the test chamber classify shots
 * identically, and so the mapping is unit-testable without a Three.js scene.
 * The runtime deliberately does not carry a "muzzle style" field: how a weapon
 * looks is a presentation decision derived from what it does.
 */

import type { DamageType } from '../core/types.ts';
import type { ImpactVfxKind, MuzzleVfxStyle } from './VfxSystem.ts';

/** The parts of a `TracerShot` that presentation cares about. */
export interface ShotAppearance {
  readonly damageType: DamageType;
  readonly damage: number;
  readonly slowFactor: number;
  readonly hitZombieHandle: number | null;
  readonly hitSurface: boolean;
}

/**
 * Barrel character. Thresholds sit well clear of the fully upgraded damage of
 * the tier below (a maxed turret reaches ~5, a maxed cannon ~63), so an
 * upgrade never silently changes a weapon's muzzle.
 */
export function muzzleStyleForShot(shot: ShotAppearance): MuzzleVfxStyle {
  if (shot.damageType === 'aoe') return 'flame';
  if (shot.slowFactor > 0) return 'ice';
  if (shot.damage < 20) return 'standard';
  return shot.damageType === 'hitscan' ? 'sniper' : 'heavy';
}

/**
 * What the shot terminated against, or null when it simply ran out of range in
 * mid-air and should leave nothing behind. `shielded` is the phone-addict
 * bubble outcome, which ricochets rather than wounds.
 */
export function impactKindForShot(
  shot: ShotAppearance,
  shielded: boolean,
): ImpactVfxKind | null {
  const landed = shot.hitZombieHandle !== null || shot.hitSurface;
  // Flame washes around the phone addict's bubble at full strength, and it
  // sets light to headstones as readily as to zombies — one effect for both.
  if (shot.damageType === 'aoe') return landed ? 'burn' : null;
  if (shot.hitZombieHandle !== null) {
    if (shielded) return 'shield';
    return shot.slowFactor > 0 ? 'ice' : 'flesh';
  }
  return shot.hitSurface ? 'hard' : null;
}
