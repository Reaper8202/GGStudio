/**
 * Base tuning for the automatic roof turret (Agent C: Combat). Never
 * mutated at runtime — `TurretSystem` reads `state.modifiers` live each
 * frame/shot to scale damage/fire-rate/range from upgrades.
 */
import type { WeaponStats } from "../types";

export const STARTER_WEAPON: WeaponStats = {
  damage: 12,
  fireRate: 3, // shots per second
  range: 16,
  projectileSpeed: 30,
  targetRotationSpeed: 6, // radians/second
};

/** Pooled projectile instance count. */
export const PROJECTILE_POOL_SIZE = 24;

/** Radians of yaw misalignment allowed before the turret is considered
 *  "aimed" and will fire. */
export const AIM_TOLERANCE_RADIANS = 0.09;

/** Visual radius of a projectile "tracer" sphere. */
export const PROJECTILE_RADIUS = 0.1;

/** Sphere-vs-zombie hit-test radius (projectile treated as a point moving
 *  fast; this is effectively the target's hit radius). */
export const PROJECTILE_HIT_RADIUS = 0.55;

/** Muzzle flash duration, seconds. */
export const MUZZLE_FLASH_DURATION = 0.08;

/** Turret mount height above the vehicle position used for projectile
 *  spawn origin / visual placement (approximate, XZ hit-testing only). */
export const TURRET_HEIGHT = 1.9;

/** Barrel length used to offset the projectile spawn point in front of the
 *  turret pivot. */
export const BARREL_LENGTH = 0.9;
