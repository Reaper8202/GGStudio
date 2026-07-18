/** Wave-one zombie stats. WaveManager supplies health/speed multipliers. */
export const BASE_ZOMBIE_STATS = {
  health: 30,
  speed: 3.2,
  attackDamage: 10,
  attackInterval: 1,
  reward: 10,
} as const;

/** A little above the maximum active cap so death feedback cannot starve it. */
export const ZOMBIE_POOL_SIZE = 34;

export const ZOMBIE_ATTACK_RANGE = 2.4;
/** Nearest-part-centroid distance used for true ram/swarm contact. */
export const ZOMBIE_CONTACT_RADIUS = 1.1;
export const ZOMBIE_ATTACK_EXIT_MARGIN = 0.35;

export const ZOMBIE_RADIUS = 0.32;
export const ZOMBIE_HALF_HEIGHT = 0.55;

export const MIN_IMPACT_SPEED = 5;
export const IMPACT_DAMAGE_PER_SPEED = 3.5;
export const KNOCKBACK_SPEED = 9;
export const KNOCKBACK_DURATION = 0.35;
export const IMPACT_COOLDOWN_SECONDS = 0.4;

export const SPAWN_RISE_DURATION = 0.45;
export const DEATH_FEEDBACK_DURATION = 0.6;

export const SEPARATION_RADIUS = 1;
export const SEPARATION_STRENGTH = 2.2;

export const OBSTACLE_PROBE_DISTANCE = 1.6;
export const OBSTACLE_PROBE_HEIGHT = 0.4;
export const STUCK_SPEED_THRESHOLD = 0.5;
export const STUCK_TIME_THRESHOLD = 0.5;
export const DETOUR_DURATION = 0.7;
export const DETOUR_BLEND = 0.9;

export const STUCK_TELEPORT_DISPLACEMENT = 0.5;
export const STUCK_TELEPORT_SECONDS = 4;

export const HORDE_SCATTER_RADIUS = 2.5;
export const MIN_SPAWN_DISTANCE_FROM_VEHICLE = 18;

/** The retired arcade vehicle lost 9% handling per touching zombie, capped at 80%. */
export const SWARM_DRAG_PER_CONTACT = 0.09;
export const MAXIMUM_SWARM_DRAG = 0.8;
/** Its baseline acceleration was 9m/s²; retain that physical drag scale. */
export const SWARM_DRAG_ACCELERATION = 9;

// Thrower: slow ranged zombie (zombie_city.vox). Every Nth pool slot is a
// thrower; it stops at range and lobs slow box projectiles at the vehicle.
export const THROWER_POOL_STRIDE = 5; // pool indices at (stride-1) mod stride
export const THROWER_SPEED_MULTIPLIER = 0.5;
export const THROWER_HEALTH_MULTIPLIER = 1.6;
export const THROWER_REWARD = 25;
export const THROWER_ATTACK_RANGE = 13;
export const THROWER_ATTACK_EXIT_MARGIN = 2;
export const THROWER_ATTACK_INTERVAL = 2.8;
export const THROWER_VISUAL_HEIGHT = 1; // pre-baseScale model height, m

export const PROJECTILE_POOL_SIZE = 24;
export const PROJECTILE_HORIZONTAL_SPEED = 9; // m/s, still a dodgeable lob
export const PROJECTILE_MIN_FLIGHT_TIME = 0.5;
export const PROJECTILE_MAX_FLIGHT_TIME = 2.5;
export const PROJECTILE_DAMAGE = 12;
export const PROJECTILE_HIT_RADIUS = 1.3;
export const PROJECTILE_LIFETIME = 6;
export const PROJECTILE_LAUNCH_HEIGHT = 1.2;
export const PROJECTILE_SIZE = 0.5;

export const SCALE_VARIATION = 0.12;
export const WALK_BOB_FREQUENCY = 9;
export const WALK_BOB_AMPLITUDE = 0.05;
export const LUNGE_DURATION = 0.18;
export const LUNGE_DISTANCE = 0.16;
export const HIT_FLASH_DURATION = 0.12;
