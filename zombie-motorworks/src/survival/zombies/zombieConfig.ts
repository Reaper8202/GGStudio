import type { PlowDefinition } from '../../core/types.ts';

/** Wave-one zombie stats. WaveManager supplies health/speed/damage multipliers. */
export const BASE_ZOMBIE_STATS = {
  health: 40,
  speed: 3.2,
  attackDamage: 10.5,
  attackInterval: 1,
  reward: 3,
} as const;

/**
 * Large normal reserve plus small specialist reserves. The director requests
 * kinds explicitly, so pool makeup is gameplay balance rather than a hidden
 * spawn-order lottery.
 */
export const ZOMBIE_POOL_COUNTS = {
  walker: 58,
  thrower: 14,
  worker: 8,
  'phone-addict': 8,
  // Boss waves summon one boss; the spare slot is headroom for a future
  // encounter that fields two. Idle slots are parked bodies and cost nothing.
  boss: 2,
} as const;
export const ZOMBIE_POOL_SIZE = Object.values(ZOMBIE_POOL_COUNTS).reduce(
  (total, count) => total + count,
  0,
);

export const ZOMBIE_ATTACK_RANGE = 2.4;
/** Nearest-part-centroid distance used for true ram/swarm contact. */
export const ZOMBIE_CONTACT_RADIUS = 1.1;
export const ZOMBIE_ATTACK_EXIT_MARGIN = 0.35;

export const ZOMBIE_RADIUS = 0.32;
export const ZOMBIE_HALF_HEIGHT = 0.55;

/** Below 40 km/h, the car shoves but cannot ram-damage a zombie. */
export const MIN_IMPACT_SPEED = 40 / 3.6;
/** At 80 km/h and above, a ram is lethal regardless of zombie toughness. */
export const LETHAL_IMPACT_SPEED = 80 / 3.6;
/** Moderate-zone damage reaches base walker health at exactly 80 km/h. */
export const IMPACT_DAMAGE_PER_SPEED = 1.8;
export const KNOCKBACK_SPEED = 9;
export const KNOCKBACK_DURATION = 0.35;
export const IMPACT_COOLDOWN_SECONDS = 0.4;

/**
 * Bulldozer blade (`PlowDefinition`). The blade's own numbers — how wide it
 * catches, how many it carries, how hard the slam lands — live on the part, so
 * what is left here is the shape of the mechanic rather than its balance.
 */
/** How far ahead of the blade a wall counts as an impending slam, metres. */
export const PLOW_WALL_PROBE_M = 1.4;
/** Extra probe distance per m/s, so a fast rig fires before the wall stops it. */
export const PLOW_WALL_PROBE_PER_SPEED = 0.1;
/** One slam is one event: a blade cannot crush again inside this window. */
export const PLOW_CRUSH_COOLDOWN_SECONDS = 0.8;
/**
 * Held zombies are put in the knockback state — no chasing, no biting — and
 * the hold is refreshed every step the blade keeps them, so it lapses on its
 * own shortly after they roll off the end of it.
 */
export const PLOW_HOLD_SECONDS = 0.3;
/** Height gap between blade and body beyond which the blade rides over it. */
export const PLOW_HEIGHT_TOLERANCE_M = 1.2;
/** Below this closing speed a blade is furniture: it scoops nothing. */
export const PLOW_MIN_CARRY_SPEED_MPS = 2;
/** Centre-to-centre gap between bodies in a carried load. */
export const PLOW_SLOT_SPACING_M = ZOMBIE_RADIUS * 2.2;
/**
 * Blade centroid out to the front rank: half a cell of blade plus a body
 * radius, so the front rank rides against the face instead of inside it —
 * slots buried in the blade's own collider are slots the solver pushes out.
 */
export const PLOW_FACE_CLEARANCE_M = 0.62;
/** How hard a carried body is steered onto its slot, per second. */
export const PLOW_SLOT_STIFFNESS = 9;
/** Cap on that steering, so a body scooped off the tip is drawn in, not flung. */
export const PLOW_SLOT_MAX_SPEED = 7;

/** One body's place in a carried load, relative to the blade. */
export interface PlowSlot {
  /** Metres left of the blade's forward axis; negative is to its right. */
  readonly lateral: number;
  /** Metres ahead of the blade centroid. */
  readonly depth: number;
}

/**
 * Where every body in a full load rides.
 *
 * A blade holds a *pile*, not a row, so the load is laid out as a lattice of
 * ranks stacked ahead of the blade — as many abreast as the catch zone is wide,
 * then back in ranks until the capacity is spent. Each body gets its own place
 * and is steered onto it, which is what stops a load from squeezing itself out
 * the ends: bodies shoved into the same spot are bodies the physics solver has
 * to spit sideways.
 *
 * Slots come out front rank first, and centre-out within a rank, so a part-full
 * blade carries a wedge on its nose rather than two stragglers on the tips.
 */
export function plowSlots(plow: PlowDefinition): PlowSlot[] {
  // A body's slot is its centre, so the lattice is inset by a radius: the outer
  // rank has to sit inside the catch zone, not straddle its edge, or the blade
  // would keep losing the bodies it just steered out there.
  const usableWidth = plow.halfWidthM * 2 - ZOMBIE_RADIUS * 2;
  const columns = Math.max(1, Math.floor(usableWidth / PLOW_SLOT_SPACING_M));
  const centre = (columns - 1) / 2;
  const centreOut = Array.from({ length: columns }, (_, column) => column).sort(
    (a, b) => Math.abs(a - centre) - Math.abs(b - centre) || a - b,
  );
  const slots: PlowSlot[] = [];
  for (let i = 0; i < plow.capacity; i++) {
    const column = centreOut[i % columns];
    slots.push({
      lateral: (column - centre) * PLOW_SLOT_SPACING_M,
      depth:
        PLOW_FACE_CLEARANCE_M + Math.floor(i / columns) * PLOW_SLOT_SPACING_M,
    });
  }
  return slots;
}

/**
 * What one body in a slammed pile takes.
 *
 * Two things make a slam hurt: how fast the blade was closing on the wall, and
 * how many bodies are packed in there — a full blade turns the pile itself into
 * part of the hammer. Below the blade's minimum speed nothing is crushed at
 * all, which is what keeps the plough a manoeuvre rather than a passive weapon.
 */
export function plowCrushDamage(
  plow: PlowDefinition,
  closingSpeedMps: number,
  pileSize: number,
): number {
  if (closingSpeedMps < plow.minCrushSpeedMps || pileSize <= 0) return 0;
  const overSpeed = closingSpeedMps - plow.minCrushSpeedMps;
  const pileScale = 1 + plow.pileBonus * (pileSize - 1);
  return (plow.crushDamage + plow.crushDamagePerSpeed * overSpeed) * pileScale;
}

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

export const HORDE_SCATTER_RADIUS = 3.5;
export const MIN_SPAWN_DISTANCE_FROM_VEHICLE = 18;

/** A pack trims momentum without making the vehicle feel glued in place. */
export const SWARM_DRAG_PER_CONTACT = 0.03;
export const MAXIMUM_SWARM_DRAG = 0.3;
/** Baseline acceleration used to convert the small drag fraction into force. */
export const SWARM_DRAG_ACCELERATION = 9;

// Thrower: slow ranged zombie (zombie_city.vox). It stops at range and lobs
// slow box projectiles at the vehicle.
export const THROWER_SPEED_MULTIPLIER = 0.5;
export const THROWER_HEALTH_MULTIPLIER = 1.6;
export const THROWER_REWARD = 8;
export const THROWER_ATTACK_RANGE = 13;
export const THROWER_ATTACK_EXIT_MARGIN = 2;
export const THROWER_ATTACK_INTERVAL = 2.8;
export const THROWER_VISUAL_HEIGHT = 1; // pre-baseScale model height, m

// Phone Addict: projectile-proof zombie (PhoneAddict voxel pack). A personal
// bubble shield absorbs every gun hit — only flame, ramming, and grinder
// contact hurt it.
export const PHONE_ADDICT_HEALTH_MULTIPLIER = 1.2;
export const PHONE_ADDICT_SPEED_MULTIPLIER = 0.9;
export const PHONE_ADDICT_REWARD = 10;
export const PHONE_ADDICT_VISUAL_HEIGHT = 1.4; // pre-baseScale model height, m
/** Red ground-glow disc marking a shielded zombie, world metres. */
export const PHONE_ADDICT_GLOW_RADIUS = 1.15;
export const PHONE_ADDICT_GLOW_OPACITY = 0.65;

// Worker: mine-layer zombie (zombie_worker.vox). It approaches the vehicle
// until it gets within plant range, commits to a stationary arming channel no
// matter where the vehicle goes, drops the mine, then retreats and must close
// to plant range again before the next mine.
export const WORKER_HEALTH_MULTIPLIER = 1.3;
export const WORKER_SPEED_MULTIPLIER = 0.85;
export const WORKER_REWARD = 12;
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

// Landmines: stationary placeholder cylinders planted by workers. The worker's
// visible arming channel telegraphs the drop, then each mine has a short
// harmless arming window before becoming a hidden hazard.
export const LANDMINE_POOL_SIZE = 24;
export const LANDMINE_RADIUS = 0.45;
export const LANDMINE_HEIGHT = 0.22;
export const LANDMINE_TRIGGER_RADIUS = 1.2;
export const LANDMINE_DAMAGE = 36;
/** Damage falls off to zero at this radius from the blast centre. */
export const LANDMINE_BLAST_RADIUS = 1.5;
/** Visible, harmless arming window after a worker drops a mine. */
export const LANDMINE_ARM_SECONDS = 1.25;
/** Last wave on which mines stay permanently visible, as the tutorial encounter. */
export const LANDMINE_VISIBLE_THROUGH_WAVE = 7;
/** Every mine glints faintly this close, regardless of Mine Sweeper — last-second fairness. */
export const LANDMINE_GLINT_RADIUS = 3.5;
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
export const PROJECTILE_DAMAGE = 12.6;
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
