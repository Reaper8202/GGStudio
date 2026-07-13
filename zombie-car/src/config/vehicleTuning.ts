/**
 * Base handling values for the starter vehicle. Never mutated at runtime —
 * `RunModifiers` (upgrades) and swarm contacts apply TEMPORARY multipliers
 * on top of these each frame; see `src/vehicle/Vehicle.ts`.
 */
import type { VehicleTuning } from "../types";

export const STARTER_TUNING: VehicleTuning = {
  // Matches the summed component mass of STARTER_BLUEPRINT (220 chassis +
  // 4x20 wheels + 35 bumper + 140 engine + 15 turret mount = 490 kg).
  mass: 490,
  // m/s^2 applied along the forward axis while accelerating/reversing.
  acceleration: 9,
  reverseAcceleration: 5,
  // Top speeds, m/s (~14 m/s forward ≈ 50 km/h; reverse is deliberately slower).
  maximumForwardSpeed: 14,
  maximumReverseSpeed: 6,
  // m/s^2 decel applied when input opposes current motion.
  brakingForce: 16,
  // m/s^2 coast-down decel applied when there is no input at all.
  rollingResistance: 4,
  // Fraction of lateral (sideways) velocity cancelled per fixedUpdate step —
  // gives a brief, mild drift through sharp turns instead of ice-skating.
  lateralGrip: 0.28,
  // Max yaw turn rate, radians/second, at low speed.
  steeringStrength: 3.0,
  // Multiplier applied to steering rate at maximum speed (reduces twitchiness).
  highSpeedSteeringMultiplier: 0.45,
  // Environment-impact damage per m/s of sudden velocity change above
  // IMPACT_DAMAGE_MIN_SPEED.
  collisionDamageMultiplier: 3.5,
  // Drag penalty added per touching/attacking zombie (before the Anti-Swarm
  // upgrade's contactPenaltyMultiplier and the maximumZombieDrag cap).
  zombieDragPerContact: 0.09,
  // Hard cap on total swarm drag (fraction of acceleration/max speed/steering
  // removed) — even a huge swarm leaves the vehicle able to crawl away.
  maximumZombieDrag: 0.8,
};

/** Fraction of `maximumZombieDrag` above which the HUD shows SWARMED. */
export const SWARMED_THRESHOLD = 0.45;

/** Minimum |Δv| (m/s) between fixedUpdates to register as an environment impact. */
export const IMPACT_DAMAGE_MIN_SPEED = 6;

/** Per-impact cooldown (seconds) so impact damage/shake is frame-rate independent. */
export const IMPACT_COOLDOWN_SECONDS = 0.25;

/** Seconds of held input + near-zero speed before stuck auto-recovery kicks in. */
export const STUCK_RECOVERY_SECONDS = 3;

/** Seconds overturned (up·worldUp < 0.3) before overturn auto-recovery kicks in. */
export const OVERTURNED_RECOVERY_SECONDS = 2;
