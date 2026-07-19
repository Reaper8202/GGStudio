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

// Phone Addict: projectile-proof zombie (PhoneAddict voxel pack). A personal
// bubble shield absorbs every gun hit — only flame, ramming, and grinder
// contact hurt it. Fills the pool slots at this remainder of the thrower
// stride, so walkers, throwers, and addicts never collide.
export const PHONE_ADDICT_POOL_REMAINDER = 2;
export const PHONE_ADDICT_HEALTH_MULTIPLIER = 1.2;
export const PHONE_ADDICT_SPEED_MULTIPLIER = 0.9;
export const PHONE_ADDICT_REWARD = 30;
export const PHONE_ADDICT_VISUAL_HEIGHT = 1.4; // pre-baseScale model height, m
/** Red ground-glow disc marking a shielded zombie, world metres. */
export const PHONE_ADDICT_GLOW_RADIUS = 1.15;
export const PHONE_ADDICT_GLOW_OPACITY = 0.65;

// Worker: mine-layer zombie (zombie_worker.vox). Fills the pool slots at this
// remainder of the thrower stride. It approaches the vehicle until it gets
// within plant range, commits to a stationary arming channel no matter where
// the vehicle goes, drops the mine, then retreats and must close to plant
// range again before the next mine.
export const WORKER_POOL_REMAINDER = 0;
export const WORKER_HEALTH_MULTIPLIER = 1.3;
export const WORKER_SPEED_MULTIPLIER = 0.85;
export const WORKER_REWARD = 35;
export const WORKER_VISUAL_HEIGHT = 1.4; // pre-baseScale model height, m
/** Reaching this close to the vehicle triggers the arming channel. */
export const WORKER_PLANT_RANGE = 10;
/** After a plant, the worker backs off past this before it can arm again. */
export const WORKER_RETREAT_RANGE = 16;

// Arming channel: the worker stands still this long to arm a mine, radiating
// a ground ring that pulses faster as the plant completes.
export const WORKER_PLANT_SECONDS = 5;
export const WORKER_RING_MAX_RADIUS = 2.4; // world metres at full expansion
export const WORKER_RING_MIN_RATE = 0.8; // pulses/s at the start of arming
export const WORKER_RING_MAX_RATE = 3.2; // pulses/s just before the plant
export const WORKER_RING_OPACITY = 0.85;

// Landmines: stationary pulsing red placeholder cylinders planted by workers.
// The worker's visible arming channel already telegraphs the plant, so a mine
// is live the moment it appears. It detonates with a flash when the vehicle
// runs one over, and every survivor is cleared when the wave completes.
export const LANDMINE_POOL_SIZE = 24;
export const LANDMINE_RADIUS = 0.45;
export const LANDMINE_HEIGHT = 0.22;
export const LANDMINE_TRIGGER_RADIUS = 1.5;
export const LANDMINE_DAMAGE = 60;
export const LANDMINE_PULSE_FREQUENCY = 6; // rad/s
export const LANDMINE_PULSE_AMPLITUDE = 0.2; // fraction of base scale
export const LANDMINE_EXPLOSION_POOL_SIZE = 6;
export const LANDMINE_EXPLOSION_RADIUS = 2.2; // final flash-sphere radius, m
export const LANDMINE_EXPLOSION_DURATION = 0.4;

export const SHIELD_FLASH_DURATION = 0.45;
export const SHIELD_FLASH_MAX_OPACITY = 0.4;
export const SHIELD_RADIUS = 1.3;

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
