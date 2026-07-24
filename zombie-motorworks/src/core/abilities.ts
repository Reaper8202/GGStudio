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

/** Resolved zap-blast stats after applying a placed part's upgrade level. */
export interface ZapStats {
  /** Damage dealt to every zombie caught in the blast. */
  damage: number;
  /** Seconds between activations. */
  cooldownSeconds: number;
}

/** Damage added to the zap blast per upgrade level beyond the first. */
const ZAP_DAMAGE_PER_LEVEL = 25;

/**
 * Scales a zap ability by the placed part's upgrade level. Each level beyond the
 * first adds {@link ZAP_DAMAGE_PER_LEVEL} blast damage; the cooldown is fixed.
 * Level 1 → 90 dmg, level 5 → 190 (with the default tesla-coil payload).
 */
export function effectiveZap(def: AbilityDefinition, level = 1): ZapStats {
  const steps = Math.max(0, Math.floor(level) - 1);
  return {
    damage: (def.baseDamage ?? 0) + steps * ZAP_DAMAGE_PER_LEVEL,
    cooldownSeconds: def.cooldownSeconds,
  };
}

/** Resolved mind-control stats after applying a placed part's upgrade level. */
export interface CharmStats {
  /** Number of zombies turned to your side by one activation. */
  targets: number;
  /** Seconds the charmed zombies fight for you before reverting to hostile. */
  durationSeconds: number;
  /** Seconds between activations. */
  cooldownSeconds: number;
  /** Metres from the vehicle within which zombies can be charmed. */
  rangeM: number;
}

/** Charm duration added per upgrade level beyond the first. */
const CHARM_SECONDS_PER_LEVEL = 2;

/**
 * Scales a charm ability by the placed part's upgrade level. The number of
 * zombies charmed stays fixed (the headline "up to N"); each level beyond the
 * first extends how long they fight for you by {@link CHARM_SECONDS_PER_LEVEL}.
 * Level 1 → 12s, level 5 → 20s (with the default mind-control payload).
 */
export function effectiveCharm(def: AbilityDefinition, level = 1): CharmStats {
  const steps = Math.max(0, Math.floor(level) - 1);
  return {
    targets: def.baseTargets ?? 0,
    durationSeconds: def.baseDurationSeconds + steps * CHARM_SECONDS_PER_LEVEL,
    cooldownSeconds: def.cooldownSeconds,
    rangeM: def.rangeM ?? 0,
  };
}
