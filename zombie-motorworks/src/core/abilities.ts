import type { AbilityDefinition } from './types.ts';

/** Resolved freeze stats after applying a placed part's upgrade level. */
export interface FreezeStats {
  /** Number of zombies frozen by one activation. */
  targets: number;
  /** Freeze duration in seconds. */
  durationSeconds: number;
  /** Seconds between activations. */
  cooldownSeconds: number;
  /** Metres from the vehicle within which zombies can be caught. */
  rangeM: number;
}

/** Resolved shield stats after applying a placed part's upgrade level. */
export interface ShieldStats {
  /** Seconds the vehicle stays invulnerable per activation. */
  durationSeconds: number;
  /** Seconds between activations. */
  cooldownSeconds: number;
}

/**
 * Scales a freeze ability by the placed part's upgrade level. Each level beyond
 * the first adds one target and one second of freeze; cooldown and range are
 * fixed. Level 1 → 3 targets / 4s, level 5 → 7 targets / 8s (with the default
 * ice-cannon payload).
 */
export function effectiveFreeze(
  def: AbilityDefinition,
  level = 1,
): FreezeStats {
  const steps = Math.max(0, Math.floor(level) - 1);
  return {
    targets: (def.baseTargets ?? 0) + steps,
    durationSeconds: def.baseDurationSeconds + steps,
    cooldownSeconds: def.cooldownSeconds,
    rangeM: def.rangeM ?? 0,
  };
}

/**
 * Scales a shield ability by the placed part's upgrade level. Each level beyond
 * the first adds one second of invulnerability; the cooldown is fixed. Level 1
 * → 4s / 25s cooldown, level 5 → 8s / 25s (with the default shield payload).
 */
export function effectiveShield(
  def: AbilityDefinition,
  level = 1,
): ShieldStats {
  const steps = Math.max(0, Math.floor(level) - 1);
  return {
    durationSeconds: def.baseDurationSeconds + steps,
    cooldownSeconds: def.cooldownSeconds,
  };
}
