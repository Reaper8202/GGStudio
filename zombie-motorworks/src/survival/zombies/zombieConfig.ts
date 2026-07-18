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

export const SCALE_VARIATION = 0.12;
export const WALK_BOB_FREQUENCY = 9;
export const WALK_BOB_AMPLITUDE = 0.05;
export const LUNGE_DURATION = 0.18;
export const LUNGE_DISTANCE = 0.16;
export const HIT_FLASH_DURATION = 0.12;
