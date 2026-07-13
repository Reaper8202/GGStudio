/**
 * Base tuning for pooled zombies (Agent C: Combat). Never mutated at
 * runtime — `WaveManager` derives per-wave health/speed multipliers from
 * `waveConfig.ts` and hands them to `ZombieSystem`, which applies them on
 * top of `BASE_ZOMBIE_STATS` at spawn time.
 */
import type { ZombieStats } from "../types";

/** Wave-1 (unscaled) zombie stats. */
export const BASE_ZOMBIE_STATS: ZombieStats = {
  health: 30,
  speed: 3.2,
  attackDamage: 6,
  attackInterval: 1.0,
  reward: 10,
};

/** Pooled zombie instance count (a little above the wave-30 active cap so a
 *  handful of corpses can still be mid-death-animation without blocking new
 *  spawns). */
export const ZOMBIE_POOL_SIZE = 34;

/** Distance (world units) from the vehicle center at which a chasing zombie
 *  switches to Attacking, and the radius used for vehicle-impact/swarm
 *  contact checks. Tuned against the ~2x3.6 starter chassis footprint. */
export const ZOMBIE_ATTACK_RANGE = 2.4;
/** Same radius reused for "is this zombie touching/attacking the vehicle"
 *  swarm-contact counting. */
export const ZOMBIE_CONTACT_RADIUS = ZOMBIE_ATTACK_RANGE;
/** Hysteresis added when leaving Attacking back to Chasing so a zombie
 *  sitting right at the boundary doesn't flicker states every frame. */
export const ZOMBIE_ATTACK_EXIT_MARGIN = 0.35;

/** Zombie capsule collider dimensions. */
export const ZOMBIE_RADIUS = 0.32;
export const ZOMBIE_HALF_HEIGHT = 0.55;

/** Below this vehicle speed (m/s), a touching zombie is only pushed by
 *  physical collision response, never damaged. */
export const MIN_IMPACT_SPEED = 5;
/** Zombie damage per m/s of vehicle speed above (well, at-and-above)
 *  `MIN_IMPACT_SPEED`. */
export const IMPACT_DAMAGE_PER_SPEED = 3.5;
/** Knockback speed (m/s) applied away from the vehicle on impact. */
export const KNOCKBACK_SPEED = 9;
/** Seconds spent in KnockedBack before a surviving zombie resumes chasing. */
export const KNOCKBACK_DURATION = 0.35;
/** Per-zombie cooldown after a vehicle impact before it can be hit again —
 *  guards against multiple hits in the same short window if knockback
 *  doesn't clear the contact radius immediately. */
export const IMPACT_COOLDOWN_SECONDS = 0.4;

/** Spawning state: brief rise/fade-in, zombie poses no threat and does not
 *  move or count toward swarm contacts during this window. */
export const SPAWN_RISE_DURATION = 0.45;
/** Death feedback (fall/shrink) duration before the zombie returns to the
 *  pool. */
export const DEATH_FEEDBACK_DURATION = 0.6;

/** Cheap O(n^2) separation pass (n <= ~30): zombies closer than this are
 *  pushed apart so they clump instead of stacking. */
export const SEPARATION_RADIUS = 1.0;
export const SEPARATION_STRENGTH = 2.2;

/** Obstacle-correction tuning (no navmesh): a short forward probe plus a
 *  "stuck while chasing" fallback both trigger a temporary lateral detour. */
export const OBSTACLE_PROBE_DISTANCE = 1.6;
/** Height (world units above ground) the obstacle probe ray is cast at.
 *  Deliberately BELOW the capsule center (~0.87) so knee-high obstacles —
 *  e.g. the 0.8-tall barriers flanking the SE ramp — still block the probe;
 *  a center-height ray passes clean over them, the detour never triggers,
 *  and the zombie grinds into the wall forever. */
export const OBSTACLE_PROBE_HEIGHT = 0.4;
export const STUCK_SPEED_THRESHOLD = 0.5;
export const STUCK_TIME_THRESHOLD = 0.5;
export const DETOUR_DURATION = 0.7;
/** How strongly the lateral detour direction is blended into the steering
 *  direction (0 = ignored, 1 = fully sideways). */
export const DETOUR_BLEND = 0.9;

/** Hard failsafe (guarantees waves always complete): if a Chasing zombie's
 *  total displacement stays below `STUCK_TELEPORT_DISPLACEMENT` for
 *  `STUCK_TELEPORT_SECONDS`, it is teleport-respawned (keeping its current
 *  health/stats) at a fresh far-from-vehicle spawn point. Catches any
 *  geometry trap the steering detour can't escape (wedged corners,
 *  friction-stalled against walls, bad spawn placement). */
export const STUCK_TELEPORT_DISPLACEMENT = 0.5;
export const STUCK_TELEPORT_SECONDS = 4;

/** Visual variation applied once per pool slot at construction. */
export const SCALE_VARIATION = 0.12;
export const WALK_BOB_FREQUENCY = 9;
export const WALK_BOB_AMPLITUDE = 0.05;

/** Brief forward nudge played on each attack hit. */
export const LUNGE_DURATION = 0.18;
export const LUNGE_DISTANCE = 0.16;

/** Brief emissive flash played when a zombie takes weapon damage. */
export const HIT_FLASH_DURATION = 0.12;
