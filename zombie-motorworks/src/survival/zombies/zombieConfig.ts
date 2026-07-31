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
  zamboni: 4,
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

/**
 * Steps per second for the Alchemist boss's walk. Slower than the Necromancer's
 * 1.05 would suggest for its speed, because the rig's legs pivot at the apron
 * hem rather than the pelvis (see `glb-rigger/green-alchemist.rig.json`): the
 * visible leg is short, so a brisk cadence reads as scurrying rather than as
 * the deliberate stalk the boss is meant to have.
 */
export const ALCHEMIST_WALK_CADENCE = 0.95;

/**
 * How far past its hold range a vial boss will follow the vehicle before it
 * gives up on the throw and goes back to chasing. Far larger than the ordinary
 * `ZOMBIE_ATTACK_EXIT_MARGIN`, because a vial boss's cooldown only advances
 * while it is in the attack state: a narrow margin let any moving vehicle keep
 * knocking it back to chasing and reset its progress, so it barely threw at all.
 */
export const VIAL_ATTACK_EXIT_MARGIN = 12;

// Zamboni: unrigged single-mesh vehicle-zombie (zamboni.glb). It never
// targets or attacks the vehicle — it patrols between arena spawn points,
// laying a continuous ice hazard line behind it, and only reacts to being
// shot, rammed, or meleed like any other zombie. Tanky, like the machine it
// is, but not sluggish — it needs to actually catch up to where the vehicle
// has been driving.
export const ZAMBONI_HEALTH_MULTIPLIER = 5;
export const ZAMBONI_SPEED_MULTIPLIER = 0.65;
export const ZAMBONI_REWARD = 22;
export const ZAMBONI_VISUAL_HEIGHT = 1.65; // pre-baseScale model height, m
/** Distance to a patrol waypoint that counts as "arrived", world metres. */
export const ZAMBONI_WAYPOINT_ARRIVAL_M = 3;
/**
 * The source model bakes noticeably lighter paint than the rest of the horde
 * — this multiplies every material's base colour down before it ever meets
 * the vertex-colour tint, so it reads as part of the same night graveyard.
 */
export const ZAMBONI_COLOR_DARKEN = 0.55;

// Ice trail: a pooled hazard trail the Zamboni Zombie lays behind itself, as
// a continuous thick line of joined segments rather than a series of
// separate blobs — the zombie emits a new segment every time it has moved
// `ICE_TRAIL_EMIT_DISTANCE_M`, connecting it to its last emission point, so
// consecutive segments always share an endpoint. Segments are permanent for
// the wave — they never fade or expire on their own — and are only cleared
// when the wave completes or the run resets, the same lifecycle as
// `Landmines`.
export const ICE_TRAIL_POOL_SIZE = 220;
/** World-metre distance the Zamboni moves between one ice segment and the next. */
export const ICE_TRAIL_EMIT_DISTANCE_M = 2;
/** Full width of the line, world metres — also the hazard's contact width. */
export const ICE_TRAIL_WIDTH_M = 2.2;
export const ICE_TRAIL_HEIGHT_M = 0.03;
export const ICE_TRAIL_COLOR = 0xbfe9ff;
/** Grip multiplier applied on top of the terrain underneath a patch. */
export const ICE_TRAIL_GRIP_MULTIPLIER = 0.2;

// Gas trail: the vial boss's toxic wake. Its hazard shape is the same
// joined-segment chain `ICE_TRAIL_*` uses for the Zamboni, but the trail has
// no ground geometry at all — nothing is drawn on the floor. What the player
// sees is smoke: `GasTrail` keeps venting VFX puffs out of the boss along the
// chain while each segment is young, so the hazard reads as a drifting cloud
// hanging in the air behind it. Pure damage, no grip penalty —
// `ACID_PUDDLE_GRIP_MULTIPLIER` already covers "stuck in acid".
export const GAS_TRAIL_POOL_SIZE = 64;
/** World-metre distance the boss moves between one gas segment and the next. */
export const GAS_TRAIL_EMIT_DISTANCE_M = 1;
/** Full width of the trail, world metres — the hazard's contact width. */
export const GAS_TRAIL_WIDTH_M = 3;
/** Height the smoke puffs are born at, roughly the boss's waist. */
export const GAS_TRAIL_HEIGHT_M = 0.5;
/** How long a single segment stays dangerous. Long enough for the cloud to stretch well behind the boss. */
export const GAS_TRAIL_LIFETIME_SECONDS = 12;
/**
 * Seconds between one segment venting a puff and the next. Only the youngest
 * segments vent (see below), so this is the per-segment rate, not the trail's.
 */
export const GAS_PUFF_INTERVAL_SECONDS = 0.35;
/**
 * A segment only vents while it is this young — older stretches of the trail
 * are still poisonous but have stopped producing new smoke, so the cloud
 * thins out behind the boss instead of every live segment puffing forever.
 */
export const GAS_PUFF_EMIT_WINDOW_SECONDS = 1.8;
/** Slightly gentler than a puddle's tick — this is incidental exposure from standing near the boss, not committing to a puddle. */
export const GAS_TRAIL_DAMAGE_PER_SECOND = 8;

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
 * at once: an enraged 3-vial barrage every `intervalSeconds` (1.2 s), each
 * puddle now living `puddleDurationSeconds` (30 s) — worst case that's
 * `3 * ceil(30 / 1.2)` = 75 overlapping puddles before the oldest expire.
 * Only one vial boss exists, so this never needs to scale further.
 */
export const ACID_PUDDLE_POOL_SIZE = 80;
/** Sickly acid green, matching the boss's own tint so the puddle reads as "its" hazard. */
export const ACID_PUDDLE_COLOR = 0x5cff2e;
export const ACID_PUDDLE_OPACITY = 0.55;
/** Last second of a puddle's life fades its opacity out, telegraphing it is about to clear. */
export const ACID_PUDDLE_FADE_SECONDS = 1;
/**
 * Grip multiplier (0..1) applied to every wheel touching a puddle, the same
 * hook `IceTrail.muAt` uses. Deliberately well above the ice trail's 0.2:
 * acid is not meant to make the car skate, it is meant to make it struggle —
 * the wheels still bite enough to steer, they just cannot put power down, so
 * acceleration out of a puddle is sluggish. The actual loss of speed comes
 * from `ACID_PUDDLE_DRAG_PER_SECOND` below.
 */
export const ACID_PUDDLE_GRIP_MULTIPLIER = 0.45;
/**
 * Horizontal velocity damping (per second, applied exponentially) while the
 * chassis is over any puddle — this is what actively drags the car down as it
 * crosses one, rather than merely letting it coast through on momentum. At
 * 2.4 a car entering at full speed sheds roughly half its speed per crossing
 * second and recovers the moment it is clear.
 */
export const ACID_PUDDLE_DRAG_PER_SECOND = 2.4;
/**
 * Poison is ticked on a timer rather than applied every physics step (1/60 s).
 * `applyDirectDamage` floors any nonzero hit to at least 1 HP — tuned for
 * one-shot impacts like a ram or an explosion — so a per-frame dose would floor
 * to 60 HP/s regardless of the source's DPS. Half-second ticks deliver
 * `damagePerSecond * 0.5`, comfortably above that floor for any sane DPS
 * value, while still reading as continuous damage. Only the boss's gas trail
 * feeds this now — puddles are a handling hazard, not a damage one.
 */
export const ACID_POISON_TICK_SECONDS = 0.5;
/** Circle segment count for the puddle disc — cheap and round enough at this size. */
export const ACID_PUDDLE_SEGMENTS = 24;
/**
 * How far each puddle's outline wobbles off a true circle, as a fraction of
 * its radius — a splash landing never stamps out a perfect disc.
 */
export const ACID_PUDDLE_BLOB_JITTER = 0.22;

// Bubbling: small toxic bubbles that pop up inside every live puddle. They
// spawn from whichever puddle rolled them and then live independently, so a
// puddle despawning early just leaves its last few bubbles to finish out —
// no back-reference needed, the same trick `AcidPuddles.pool` itself uses.
/** Comfortably covers ~8 puddles bubbling concurrently at the tuned rate below. */
export const ACID_BUBBLE_POOL_SIZE = 48;
/** Lighter, hotter green than the puddle itself so a bubble reads as popping out of it. */
export const ACID_BUBBLE_COLOR = 0xaaff66;
export const ACID_BUBBLE_OPACITY = 0.85;
export const ACID_BUBBLE_LIFE_MIN = 0.3;
export const ACID_BUBBLE_LIFE_MAX = 0.55;
export const ACID_BUBBLE_RADIUS_MIN = 0.045;
export const ACID_BUBBLE_RADIUS_MAX = 0.11;
/** How high a bubble drifts above the puddle surface over its lifetime. */
export const ACID_BUBBLE_RISE_HEIGHT = 0.05;
/** Seconds between a puddle rolling a new bubble; scaled down for bigger puddles. */
export const ACID_BUBBLE_INTERVAL_MIN = 0.1;
export const ACID_BUBBLE_INTERVAL_MAX = 0.22;

export const SCALE_VARIATION = 0.12;
export const WALK_BOB_FREQUENCY = 9;
export const WALK_BOB_AMPLITUDE = 0.05;
export const LUNGE_DURATION = 0.18;
export const LUNGE_DISTANCE = 0.16;
export const HIT_FLASH_DURATION = 0.12;
