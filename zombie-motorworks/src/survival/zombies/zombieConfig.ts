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
 * spawn-order lottery. The thrower reserve carries extra headroom because
 * necromancer raises draw from it on top of whatever the wave itself spawns.
 */
export const ZOMBIE_POOL_COUNTS = {
  walker: 58,
  gunslinger: 10,
  necromancer: 6,
  thrower: 26,
  worker: 8,
  'phone-addict': 8,
  kamikaze: 16,
  behemoth: 5,
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

// Gunslinger: the rigged GLB character (gunslinger.rigged.glb). Closes to
// revolver range and stops instead of meleeing. One attack cycle is three
// beats: draw the guns and level them, hold that aim while a line from the
// barrel out to a predicted impact point locks in and sits static (a scope
// icon marks the far end), then fire — the shot itself is the same line
// flashing bright rather than a travelling projectile. Damage only lands if
// the vehicle is still near the locked point when it fires, so a vehicle that
// moved off it is a clean dodge. Slower and tougher than a walker to make up
// for staying out of melee range.
export const GUNSLINGER_HEALTH_MULTIPLIER = 1.8;
export const GUNSLINGER_SPEED_MULTIPLIER = 0.8;
export const GUNSLINGER_REWARD = 9;
export const GUNSLINGER_VISUAL_HEIGHT = 1.6; // pre-baseScale model height, m
/** Steps per second for its walk cycle; the rig's own stalking cadence. */
export const GUNSLINGER_WALK_CADENCE = 1.4;
/** Closing to this range commits it to the draw/aim/fire cycle instead of melee. */
export const GUNSLINGER_ATTACK_RANGE = 16;
export const GUNSLINGER_ATTACK_EXIT_MARGIN = 2;
/** Guns rising from the holster to a level, held aim. */
export const GUNSLINGER_DRAW_SECONDS = 0.3;
/** How long the locked telegraph line sits static before the shot fires. */
export const GUNSLINGER_TELEGRAPH_SECONDS = 1;
/** Recoil beats plus holstering, once the shot is already away. */
export const GUNSLINGER_RECOVER_SECONDS = 0.5;
/** One full draw/telegraph/fire/holster cycle, seconds. */
export const GUNSLINGER_ATTACK_INTERVAL =
  GUNSLINGER_DRAW_SECONDS +
  GUNSLINGER_TELEGRAPH_SECONDS +
  GUNSLINGER_RECOVER_SECONDS;
export const GUNSLINGER_TELEGRAPH_OPACITY = 0.85;
/** How long the line flashes bright when the shot actually fires. */
export const GUNSLINGER_SHOT_FLASH_SECONDS = 0.15;
/** World-metre size of the small scope reticle marking the locked point. */
export const GUNSLINGER_SCOPE_ICON_SIZE = 0.4;
/** How close the vehicle must still be to the locked point for the shot to land. */
export const GUNSLINGER_HIT_TOLERANCE = 0.9;
/** Fixed length of the telegraph/shot line out from the muzzle; the scope icon sits at its far end. */
export const GUNSLINGER_LINE_LENGTH = 25;
/**
 * Prediction lead, in seconds of the vehicle's current velocity — shorter than
 * the telegraph hold itself, so the lock stays close to where the vehicle
 * actually is rather than reaching far out ahead of it.
 */
export const GUNSLINGER_LEAD_SECONDS = 0.35;
/**
 * World-metre height above the capsule centre the raised guns fire from.
 * Only a fallback: the muzzle is read off the right forearm bone (the
 * revolver's rig mount) whenever the model has finished loading.
 */
export const GUNSLINGER_MUZZLE_HEIGHT =
  -(ZOMBIE_HALF_HEIGHT + ZOMBIE_RADIUS) + GUNSLINGER_VISUAL_HEIGHT * 0.55;

// Necromancer: the rigged GLB caster (necromancer.rigged.glb). It closes to
// summon range, stands still through a telegraphed channel, and raises a group
// of throwers out of the ground beside it. Slow, head and shoulders taller than
// anything else in the horde, and expensive to ignore — every second it is left
// alive is more ranged pressure, so it is worth killing before the fire it
// calls in.
export const NECROMANCER_HEALTH_MULTIPLIER = 4.2;
export const NECROMANCER_SPEED_MULTIPLIER = 0.7;
export const NECROMANCER_REWARD = 16;
/**
 * Pre-baseScale model height, m. Deliberately the tallest silhouette in the
 * horde: with no always-on ground marker, size is what identifies the caster at
 * a distance.
 */
export const NECROMANCER_VISUAL_HEIGHT = 2.45;
/** Steps per second for its walk cycle; a slower shamble than the gunslinger. */
export const NECROMANCER_WALK_CADENCE = 1.05;
/** Closing to this range commits it to a channel. */
export const NECROMANCER_SUMMON_RANGE = 18;
/** How long it stands still to raise a group. */
export const NECROMANCER_SUMMON_SECONDS = 3.2;
/** Rest between channels, so one caster cannot chain-summon. */
export const NECROMANCER_SUMMON_COOLDOWN = 9;
/** Throwers raised per completed channel. */
export const NECROMANCER_SUMMON_COUNT = 3;
/** Radius of the ring the raised throwers claw out of, world metres. */
export const NECROMANCER_SUMMON_RADIUS = 2.4;

// Summoning sigil: a runic circle that burns into the ground under the caster
// for the length of a channel and nothing else. The necromancer carries no
// always-on halo, so purple on the ground means one thing only — a raise is
// happening right now, at that spot.
/** Radius of the sigil at full charge, world metres. */
export const NECROMANCER_SIGIL_RADIUS = 2.6;
export const NECROMANCER_SIGIL_OPACITY = 0.95;
/** Sigil rotation, rad/s; the outer and inner rings counter-turn. */
export const NECROMANCER_SIGIL_SPIN = 0.55;
/** Fraction of the channel the sigil takes to open to full size. */
export const NECROMANCER_SIGIL_OPEN_FRACTION = 0.22;
/** Seconds between motes rising off the caster mid-channel. */
export const NECROMANCER_CHANNEL_VFX_INTERVAL = 0.16;

// Kamikaze: the small rigged GLB sprinter (kamikaze.rigged.glb). Fragile and
// far faster than anything else in the horde, it beelines the vehicle and
// detonates the instant it closes to arm's length rather than settling into
// the ordinary melee attack loop — one hit either way, its own or a bullet's,
// so it lives only a few seconds once it is in view.
export const KAMIKAZE_HEALTH_MULTIPLIER = 0.5;
export const KAMIKAZE_SPEED_MULTIPLIER = 1.85;
export const KAMIKAZE_REWARD = 7;
// Height 1.0 puts a thrower at ordinary adult height once baseScale is
// applied (see THROWER_VISUAL_HEIGHT); kamikaze sits well under that so it
// visibly reads as small, even in a crowd of walkers.
export const KAMIKAZE_VISUAL_HEIGHT = 0.85; // pre-baseScale model height, m
/** Strides per second for its sprint cycle; the rig's own frantic cadence. */
export const KAMIKAZE_RUN_CADENCE = 2.6;
/** Closing to this range detonates it — tighter than the ordinary melee range. */
export const KAMIKAZE_DETONATE_RANGE = 1.4;
/** Vehicle-part blast damage at the centre, falling off to zero at the radius below. */
export const KAMIKAZE_EXPLOSION_DAMAGE = 42;
export const KAMIKAZE_EXPLOSION_RADIUS = 2.6;
/** Purely visual flash-sphere radius, independent of the damage falloff above. */
export const KAMIKAZE_EXPLOSION_VFX_RADIUS = 2;

// Kamikaze warning blink: a small pulsing glow while it is sprinting, so a
// bomber lost in a crowd of walkers still reads as "about to go off" at a
// glance rather than only once it is already on top of the vehicle.
export const KAMIKAZE_BLINK_RADIUS = 0.1;
export const KAMIKAZE_BLINK_INTERVAL = 0.3; // seconds per on/off cycle
export const KAMIKAZE_BLINK_OPACITY = 1;

// Behemoth: the rigged GLB boss (behemoth.rigged.glb). The toughest, rarest,
// and slowest thing in the horde — it chases the vehicle and only commits to
// a two-handed overhead wind-up (a red ground ring at its feet, the same
// telegraph mechanism the Worker and Necromancer use) once it is within smash
// range, then slams down for area damage around itself rather than a
// single-part hit. Unlike the Worker's plant and the Necromancer's raise, the
// wind-up itself is not committed — a vehicle that drives back out of range
// mid-wind-up aborts the swing and sends it back to chasing, so staying
// mobile is a real defence, not just a matter of dodging the final ring.
export const BEHEMOTH_HEALTH_MULTIPLIER = 6;
export const BEHEMOTH_SPEED_MULTIPLIER = 0.6;
export const BEHEMOTH_REWARD = 24;
export const BEHEMOTH_VISUAL_HEIGHT = 2.7; // pre-baseScale model height, m — the tallest silhouette in the horde
/** Steps per second for its walk cycle; the rig's own lumbering shamble. */
export const BEHEMOTH_WALK_CADENCE = 0.9;
/** Closing to this range commits it to the wind-up/smash cycle. */
export const BEHEMOTH_ATTACK_RANGE = 4.2;
/** Wind-up aborts back to chasing once the vehicle clears this much past the attack range. */
export const BEHEMOTH_ATTACK_EXIT_MARGIN = 1.2;
/** Both arms rising overhead before the slam. */
export const BEHEMOTH_WINDUP_SECONDS = 0.9;
/** Stagger after the slam before it can chase again. */
export const BEHEMOTH_RECOVER_SECONDS = 0.7;
/**
 * One full wind-up/slam/recover cycle, seconds. `behemothPose.ts`'s
 * `smashPose` spends its own `SMASH_IMPACT` fraction of this on the wind-up
 * and the rest on recovery, so the two files never need to agree on a
 * separate hand-kept split.
 */
export const BEHEMOTH_ATTACK_INTERVAL =
  BEHEMOTH_WINDUP_SECONDS + BEHEMOTH_RECOVER_SECONDS;
/** AOE damage falloff radius around the impact point, world metres. */
export const BEHEMOTH_SMASH_RADIUS = 3.4;
/** Peak vehicle-part damage at the centre of the blast. */
export const BEHEMOTH_SMASH_DAMAGE = 48;
/** Purely visual blast size, independent of the damage falloff above. */
export const BEHEMOTH_SMASH_VFX_RADIUS = 2.6;
/** Ground warning ring colour while it winds up — distinct from the Worker's amber and the Necromancer's violet. */
export const BEHEMOTH_RING_COLOR = 0xff3020;

// Phone Addict: projectile-proof zombie (PhoneAddict voxel pck). A personal
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

/**
 * Shared by thrower boxes and boss vials. `launch` silently drops a shot when
 * the pool is full, so this has headroom for an enraged 3-vial barrage landing
 * on top of a full thrower wave (the debug spawn-one-of-each path can mix them).
 */
export const PROJECTILE_POOL_SIZE = 32;
export const PROJECTILE_HORIZONTAL_SPEED = 9; // m/s, still a dodgeable lob
export const PROJECTILE_MIN_FLIGHT_TIME = 0.5;
export const PROJECTILE_MAX_FLIGHT_TIME = 2.5;
export const PROJECTILE_DAMAGE = 12.6;
export const PROJECTILE_HIT_RADIUS = 1.3;
export const PROJECTILE_LIFETIME = 6;
export const PROJECTILE_LAUNCH_HEIGHT = 1.2;
export const PROJECTILE_SIZE = 0.5;

// Vials: the boss projectile fired by a `vial` boss attack. Same pooled
// ballistic system as the thrower's boxes — full gravity, tumbling in flight —
// rather than the flattened, point-first needle bolt this replaced. Per-vial
// damage comes from the BossDefinition (so it scales with the wave), not from a
// constant here.
/**
 * Between the thrower's 9 m/s box and the needle boss's old 7 m/s bolt — a
 * hand-thrown vial is heavier than a tumbling box but still a real throw, not a
 * fired shot. The boss's own `attack.projectileSpeedMps` is the live value;
 * this is the shared default.
 */
export const VIAL_HORIZONTAL_SPEED = 7.5; // m/s
/**
 * Wider clamps than the thrower's. Past `speed * MAX_FLIGHT_TIME` a shot would
 * be forced to travel *faster* than its nominal speed to arrive in time, so the
 * ceiling has to sit beyond the boss's working range (~16 m at 7.5 m/s = 2.13 s).
 */
export const VIAL_MIN_FLIGHT_TIME = 0.5;
export const VIAL_MAX_FLIGHT_TIME = 3;
/**
 * Full gravity, same as the thrower's box (`BOX_PROJECTILE.gravityScale`): a
 * hand-tossed vial should read as thrown, arcing high, not fired flat the way
 * the needle it replaced did. See `launch()` in ThrowerProjectiles.ts for how
 * this and `horizontalSpeed` together fix the arc height.
 */
export const VIAL_GRAVITY_SCALE = 1;
/** Between the box's 1.3 and the old needle's 0.9 — a direct hit still matters, but less than the puddle. */
export const VIAL_HIT_RADIUS = 1.1;
export const VIAL_LIFETIME = 6;
/** Small glass capsule, in world metres — the same shape the puddle-forming splash leaves behind. */
export const VIAL_CAPSULE_RADIUS = 0.1;
export const VIAL_CAPSULE_LENGTH = 0.22;
/**
 * Fraction of the boss's visual height, measured up from its feet, that a vial
 * leaves from. Matches where `buildVialArm` hangs the prop, so the throw appears
 * to come out of the raised arm rather than the boss's chest.
 */
export const VIAL_LAUNCH_HEIGHT_FRACTION = 0.78;

// Acid puddles: what a vial leaves behind wherever it lands, vehicle or bare
// ground. A flat ground disc with no Rapier body, ticked by ZombieSystem the
// same way it ticks landmine proximity and boss slams — see `AcidPuddles.ts`.
/**
 * Comfortably above the largest number of puddles the alchemist can have alive
 * at once: an enraged 3-vial barrage, plus the tail end of the volley before it
 * (puddles at `poisonDamagePerSecond` * 5 s durations easily outlive the ~3.2 s
 * gap between throws). Never needs to be huge — only one vial boss exists.
 */
export const ACID_PUDDLE_POOL_SIZE = 8;
/** Sickly acid green, matching the boss's own tint so the puddle reads as "its" hazard. */
export const ACID_PUDDLE_COLOR = 0x5cff2e;
export const ACID_PUDDLE_OPACITY = 0.55;
/** Last second of a puddle's life fades its opacity out, telegraphing it is about to clear. */
export const ACID_PUDDLE_FADE_SECONDS = 1;
/**
 * Poison is ticked on a timer rather than applied every physics step (1/60 s).
 * `applyDirectDamage` floors any nonzero hit to at least 1 HP — tuned for
 * one-shot impacts like a ram or an explosion — so a per-frame dose would floor
 * to 60 HP/s regardless of `poisonDamagePerSecond`. Half-second ticks deliver
 * `poisonDamagePerSecond * 0.5`, comfortably above that floor for any sane DPS
 * value, while still reading as continuous damage.
 */
export const ACID_POISON_TICK_SECONDS = 0.5;
/** Circle segment count for the puddle disc — cheap and round enough at this size. */
export const ACID_PUDDLE_SEGMENTS = 24;

export const SCALE_VARIATION = 0.12;
export const WALK_BOB_FREQUENCY = 9;
export const WALK_BOB_AMPLITUDE = 0.05;
export const LUNGE_DURATION = 0.18;
export const LUNGE_DISTANCE = 0.16;
export const HIT_FLASH_DURATION = 0.12;
