/**
 * Shared, engine-independent data model for the vehicle construction system.
 *
 * Vehicle-local axes: X = width (+X is the vehicle's right), Y = height (up),
 * Z = forward. Grid positions are integers. Blueprints contain only
 * serializable identifiers, positions, rotations, configurations, and
 * relationships — never runtime object references.
 */

export interface Vec3i {
  x: number;
  y: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** One of the six axis-aligned faces of a grid cell. */
export type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

/** Index into the canonical table of 24 axis-aligned orientations (0 = identity). */
export type OrientationIndex = number;

export type PartCategory =
  'structural' | 'functional' | 'movement' | 'protection' | 'weapon';

/**
 * Socket types. Compatibility is defined centrally in the placement service.
 * - frame: generic structural face-to-face connection
 * - wheel-mount: provided by wheel/suspension mount parts, required by wheels
 * - engine-mount: provided by engine mounts, required by engines
 * - hardpoint: provided by weapon hardpoints, required by weapons
 * - armour: provided by any structural face, consumed by face-mounted armour/shell
 */
export type SocketType =
  'frame' | 'wheel-mount' | 'engine-mount' | 'hardpoint' | 'armour';

export interface StructuralSocket {
  /** Unique within the part definition. */
  id: string;
  /** Local cell the socket belongs to (orientation 0). */
  cell: Vec3i;
  /** Face of that cell the socket sits on (orientation 0). */
  face: Face;
  type: SocketType;
}

export type SuspensionPreset = 'light' | 'standard' | 'heavy-duty' | 'off-road';

export interface SuspensionParams {
  restLength: number; // m, below the wheel mount anchor
  travel: number; // m
  stiffness: number; // N/m
  damping: number; // N·s/m
  /** Suspension load rating, N: static loads beyond this warn and bottom out at runtime. */
  maxLoad: number;
}

/**
 * Player-facing suspension presets scale the wheel definition's base
 * suspension. Applied multiplicatively by analyzer and runtime alike.
 */
export const SUSPENSION_PRESET_MULTIPLIERS: Record<
  SuspensionPreset,
  { stiffness: number; damping: number; travel: number; maxLoad: number }
> = {
  light: { stiffness: 0.6, damping: 0.7, travel: 0.85, maxLoad: 0.6 },
  standard: { stiffness: 1.0, damping: 1.0, travel: 1.0, maxLoad: 1.0 },
  'heavy-duty': { stiffness: 1.8, damping: 1.6, travel: 0.75, maxLoad: 1.9 },
  'off-road': { stiffness: 1.1, damping: 1.15, travel: 1.6, maxLoad: 1.3 },
};

export interface WheelDefinition {
  radius: number; // m
  width: number; // m
  /** Local axle axis at orientation 0. Wheels spin around this axis. */
  axleAxis: Vec3i;
  /** Local suspension travel direction at orientation 0 (usually -Y). */
  suspensionDir: Vec3i;
  maxSteerAngleDeg: number; // usable only when configured as steering
  /**
   * Turns by driving each side of the vehicle at a different speed instead of
   * angling the hub — tank treads. Set alongside maxSteerAngleDeg 0.
   */
  skidSteer?: boolean;
  /**
   * Hard ceiling on how fast this wheel's contact surface may travel (m/s), and
   * therefore on how fast it can push the vehicle. A belt is geared for grunt,
   * not speed; without this the only thing holding a tracked rig back was the
   * energy it wasted spinning its tracks, which is not a design, it is a bug.
   * Undefined means "no gearing limit", which is every ordinary wheel.
   */
  maxSurfaceSpeedMps?: number;
  driveTorqueLimit: number; // N·m the hub survives
  brakeTorque: number; // N·m
  frictionLong: number; // longitudinal friction coefficient multiplier
  frictionLat: number; // lateral friction coefficient multiplier
  /** Tire load rating, N (distinct from suspension.maxLoad, the spring rating). */
  maxLoad: number;
  /** Base suspension parameters; PartConfig.suspensionPreset scales these. */
  suspension: SuspensionParams;
}

export interface EngineDefinition {
  /** Torque curve as [rpm, N·m] samples, ascending rpm. */
  torqueCurve: [number, number][];
  maxRpm: number;
  idleRpm: number;
  maxPowerKw: number;
  fuelPerSecondAtFull: number; // litres/s at full throttle
}

export type WeaponMountType = 'fixed' | 'turret';

/**
 * How a weapon's damage is delivered. Defensive effects key off this:
 * the phone addict's bubble shield stops projectile and hitscan hits but
 * not aoe (flame washes around it).
 */
export type DamageType = 'projectile' | 'hitscan' | 'aoe';

export interface WeaponDefinition {
  mountType: WeaponMountType;
  /**
   * Auto weapons acquire their own targets in range; manual weapons only ever
   * follow the player's aim input. Either way a held trigger overrides every
   * weapon onto the player's cursor point.
   */
  aimMode: 'auto' | 'manual';
  /** Horizontal firing arc in degrees (centered on part forward; 360 for turrets). */
  arcDeg: number;
  damageType: DamageType;
  damage: number;
  fireRate: number; // shots/s
  recoilImpulse: number; // N·s applied opposite to fire direction at the mount
  projectileSpeed: number; // m/s
  rangeM: number;
  /** Auto weapons ignore targets closer than this (sniper dead zone). */
  minRangeM?: number;
  /**
   * Horizontal spray cone, degrees. When set, each trigger pull casts
   * raysPerShot rays fanned across the cone (flamethrower-style burst);
   * damage applies per ray.
   */
  coneDeg?: number;
  /** Rays per trigger pull for cone weapons; default 1. */
  raysPerShot?: number;
  /**
   * 'periodic' weapons ignore fire input and aim entirely: they discharge
   * along their mounted direction every cooldown (flamethrower nozzle).
   * Default 'triggered' fires on player/auto-aim input.
   */
  fireMode?: 'triggered' | 'periodic';
  /**
   * Periodic burst cycle: the weapon sprays for burstSeconds (ticking at
   * fireRate) then stays quiet until burstIntervalSeconds has elapsed since
   * the burst began. Both must be set together.
   */
  burstSeconds?: number;
  burstIntervalSeconds?: number;
  /**
   * Auto-aim preference: 'ranged' targets thrower zombies before walkers;
   * 'strongest' locks onto the zombie with the most current health.
   */
  targetPriority?: 'ranged' | 'strongest';
  /**
   * Cryo weapons (Ice Cannon normal fire): on hit, slow the struck zombie to
   * `slowFactor` of its speed for `slowDurationSeconds`. Both set together;
   * the Q ability is a separate full freeze.
   */
  slowFactor?: number;
  slowDurationSeconds?: number;
  /**
   * Tracer rendering style. 'electric' draws blue lightning zaps (Tesla Coil);
   * default (undefined) uses the standard gold tracer.
   */
  tracerStyle?: 'electric';
  /**
   * Auto-aim weapon that still waits for the player's trigger: the auto-aim
   * system tracks a target and keeps the mount pointed at it, but the weapon
   * only fires while the player holds fire (left click / F) instead of firing
   * itself the instant a target is acquired. Used for slow, precious shots.
   *
   * Meaningless on a manual-aim weapon, which already only fires on the
   * player's trigger.
   */
  manualFire?: boolean;
  /**
   * Explosive payload (Missile Launcher). On impact, every zombie within
   * `splashRadiusM` of the point of impact takes `splashDamage` at the centre,
   * falling off linearly to nothing at the rim, on top of the direct hit.
   * Blast damage is delivered as `aoe` regardless of the weapon's own
   * `damageType`, so it washes around the phone addict's bubble the way flame
   * does. Both fields must be set together; 0/undefined means no splash.
   */
  splashRadiusM?: number;
  splashDamage?: number;
}

/**
 * The click-targeted headline attack carried by a Build's signature block.
 *
 * Unlike a `WeaponDefinition` this is not stepped by the weapon loop and never
 * auto-acquires: the player picks a point on the ground with the left mouse
 * button and the strike lands there. Unlike an `AbilityDefinition` it is not in
 * the Q/E/R bar — it is the build's primary fire, and its cooldown is drawn
 * inside the reticle rather than in the ability bar.
 *
 * All three kinds resolve as one blast with linear falloff from the impact
 * point, so `radiusM` and `damage` mean the same thing across the set; what
 * separates them is reach, cadence, delivery delay, and the status they leave
 * on what survives.
 */
export interface SignatureDefinition {
  /**
   * 'lightning' snaps a bolt onto the zombie nearest the cursor and arcs from
   * it to its neighbours; 'fireball' lobs an arcing bolus that bursts and
   * leaves the survivors burning; 'nuke' calls a shell that falls for
   * `delaySeconds` before a very large blast.
   *
   * Only 'lightning' is a chain; the other two are blasts with linear falloff
   * from the impact point.
   */
  kind: 'lightning' | 'fireball' | 'nuke';
  /** Seconds between shots at level 1; upgrades shorten it. */
  cooldownSeconds: number;
  /** Damage at the centre of the blast at level 1, falling off to the rim. */
  baseDamage: number;
  /**
   * Blast radius in metres at level 1. For a chain this is not a blast at all
   * — it is how far from the cursor the first body may be found.
   */
  baseRadiusM: number;
  /**
   * Fires itself the moment it comes off cooldown, at whatever the cursor is
   * over, with no click. For a weapon on a cadence fast enough that clicking it
   * would be a chore rather than a decision — the player aims, and the weapon
   * keeps up.
   *
   * An auto-firing signature only spends its cooldown on a shot that found a
   * target, so it never burns itself on empty ground.
   */
  autoFire?: boolean;
  /**
   * Chain weapons only: how many bodies one shot hits in total, the first plus
   * its jumps.
   */
  chainTargets?: number;
  /** Chain weapons only: how far the arc may jump body-to-body, metres. */
  chainRangeM?: number;
  /**
   * Chain weapons only: share of the damage carried into each jump, so the
   * first body struck always takes the most. Fixed across levels.
   */
  chainFalloff?: number;
  /**
   * Metres from the rig the player may place the strike. Clicks past this are
   * clamped back onto the ring rather than refused, so the shot always fires
   * somewhere sensible instead of eating the click.
   */
  rangeM: number;
  /**
   * Metres per second the payload travels to the point (fireball's arc). Zero
   * or undefined lands it on the frame it was fired.
   */
  travelSpeedMps?: number;
  /**
   * Fixed seconds between the click and the detonation, on top of any travel
   * time — the nuke's fall. The impact ring is telegraphed for the whole
   * window, so the delay is a cost the player plays around, not a surprise.
   */
  delaySeconds?: number;
  /** Seconds of burn (blackened, smoking) left on caught zombies. */
  burnSeconds?: number;
  /** Seconds of shock (blue arc glow) left on caught zombies. */
  shockSeconds?: number;
}

/**
 * Player-triggered active ability carried by a part. Unlike a
 * WeaponDefinition these do not auto-fire or follow aim — they discharge on a
 * key press and run on their own cooldown, handled outside the weapon firing
 * loop. A part may carry both a `weapon` (normal fire) and an `ability`.
 *
 * An ability only exists while its part is bolted on and alive. Survival shows
 * the equipped ones in the centre-screen bar (Q / E / R); when the rig carries
 * more ability parts than the bar has slots, the player picks which ones make
 * the cut in the garage — see `activeAbility` on PartConfig and
 * `resolveAbilityLoadout` in core/abilities.ts.
 */
export interface AbilityDefinition {
  /**
   * 'freeze' flash-freezes the nearest zombies in place; 'shield' wraps the
   * vehicle in a bubble granting temporary invulnerability; 'zap' detonates a
   * lightning blast around the vehicle that damages every zombie in range;
   * 'charm' mind-controls the nearest zombies to fight for you for a while,
   * then they revert to hostile; 'rocket' launches a large rocket that
   * detonates a high-damage blast on the thickest part of the horde;
   * 'thump' slams a shockwave outward that knocks every nearby zombie back;
   * 'pulse' slams out a damaging ring of force; 'overdrive' floods the
   * drivetrain with torque; 'hellfire' overcharges the part's own flame nozzle;
   * 'phase' blinks the rig forward through whatever is in the way;
   * 'flamelance' opens an unbroken sheet of flame along the rig's heading for
   * the whole duration, with no host weapon behind it; 'reinforce' throws up a
   * hex ward that soaks a pool of damage before the hull takes any — extra
   * health on a timer, bought with a drivetrain that drags.
   */
  kind:
    | 'freeze'
    | 'shield'
    | 'zap'
    | 'charm'
    | 'rocket'
    | 'thump'
    | 'pulse'
    | 'overdrive'
    | 'hellfire'
    | 'phase'
    | 'flamelance'
    | 'reinforce';
  /**
   * Overrides the kind's entry in `ABILITY_KIND_META` for the HUD box and the
   * garage panel. Set when one kind backs two abilities the player should read
   * as different things — a Build's signature dash is an `overdrive`, but
   * calling it "Overdrive" in the bar would tell the player it came from a
   * Nitro Injector they never bought.
   */
  label?: string;
  glyph?: string;
  blurb?: string;
  /**
   * Upgrade level the host part must reach before the ability reaches the bar
   * at all; 1 (the default) means it ships with the part. Set above 1 for an
   * ability riding on a part that is already useful on its own — the nozzle is
   * bought for its flame, and Hellfire is what the upgrade chain leads to.
   */
  unlockLevel?: number;
  /** Seconds between activations (fixed across levels). */
  cooldownSeconds: number;
  /** Effect duration in seconds at level 1 (grows with upgrade level). */
  baseDurationSeconds: number;
  /**
   * Freeze/charm/pulse: metres from the vehicle within which zombies can be
   * caught. Rocket reuses this as the blast radius of the detonation; thump
   * reuses it as the knockback radius of the shockwave. Phase: metres the
   * blink covers at level 1 (grows with upgrade level).
   */
  rangeM?: number;
  /**
   * Freeze/charm only: zombies affected at level 1 (charm keeps this fixed
   * across levels; freeze grows it with upgrade level).
   */
  baseTargets?: number;
  /**
   * Zap/rocket/pulse: blast damage at level 1 (grows with upgrade level).
   * Thump reuses this as the level-1 knockback speed in m/s (grows with
   * level).
   */
  baseDamage?: number;
  /** Overdrive only: drive-torque multiplier at level 1 (grows with level). */
  baseTorqueMultiplier?: number;
  /**
   * Overdrive only: multiplier on the vehicle's top-speed ceiling at level 1
   * (grows with upgrade level). Without it the extra torque would only be felt
   * below the normal cap, so a rig already flat out would feel nothing.
   */
  baseTopSpeedMultiplier?: number;
  /**
   * Overdrive only: propellant thrust in m/s^2 at level 1 (grows with upgrade
   * level), pushed through the chassis along its heading. This is what makes
   * the surge work with the throttle shut or the drive wheels stalled — the torque
   * multiplier alone does nothing when the engine is not being asked for
   * anything.
   */
  baseThrustAccel?: number;
  /**
   * Hellfire only: multiplier on the host weapon's damage at level 1 (grows
   * with upgrade level).
   */
  baseDamageMultiplier?: number;
  /**
   * Hellfire only: multipliers on the host weapon's reach and spray cone while
   * the overcharge runs. Fixed across levels — upgrades buy heat and duration,
   * not a wider nozzle.
   */
  rangeMultiplier?: number;
  coneMultiplier?: number;
  /**
   * Flame lance only: damage per tick, ticks per second, reach in metres, and
   * the width of the sheet in degrees. The lance has no host weapon to borrow
   * numbers from, so it carries its own. `baseDamage` is the per-tick damage;
   * reach grows with level, the rest are fixed.
   */
  ticksPerSecond?: number;
  coneDeg?: number;
  /**
   * Reinforce only: what the plating costs in mobility, as a multiplier on
   * drive torque and top speed while it holds (0..1). Fixed across levels —
   * upgrades buy a longer hold, never a cheaper one.
   */
  mobilityMultiplier?: number;
  /**
   * Reinforce only: how much damage the ward soaks at level 1 before it
   * shatters (grows with upgrade level). This is the ability's real cost
   * control — the timer says how long the ward may last, this says how much
   * horde it can actually eat, and a wave that out-damages the pool breaks it
   * early rather than waiting the player out.
   */
  baseShieldHp?: number;
}

/** Contact weapon (grinder drum, spikes, sawblade): damages any zombie touching the part. */
export interface MeleeDefinition {
  /** Damage per contact hit; cadence is the zombie impact cooldown. */
  damage: number;
  /** Mesh treatment; default 'drum' (toothed grinder roller). */
  visual?: 'drum' | 'spikes' | 'blade' | 'plow';
  /** Present on blades that scoop zombies up instead of throwing them off. */
  plow?: PlowDefinition;
}

/**
 * A bulldozer blade. Instead of knocking a zombie clear, the blade takes hold
 * of everything in front of it and carries it along, and the pile only pays for
 * it when the rig drives that pile into something solid.
 *
 * The blade therefore suppresses the ordinary ram: a zombie riding it takes
 * `MeleeDefinition.damage` per contact tick and nothing else, however fast the
 * rig is going. All the damage is in the slam.
 */
export interface PlowDefinition {
  /** Half the width of the catch zone in front of the blade, metres. */
  halfWidthM: number;
  /** How far ahead of the blade a zombie is still caught, metres. */
  reachM: number;
  /** Most zombies one blade carries; the overflow is rammed normally. */
  capacity: number;
  /** Damage each carried zombie takes in a slam at the minimum speed. */
  crushDamage: number;
  /** Extra crush damage per m/s of closing speed above the minimum. */
  crushDamagePerSpeed: number;
  /** Below this closing speed the blade only shoves; nothing is crushed. */
  minCrushSpeedMps: number;
  /** Share of the crush each *other* body in the pile adds (pile-on). */
  pileBonus: number;
}

export interface ArmourDefinition {
  /** Face-mounted armour occupies a face, not a cell volume. */
  faceMounted: boolean;
  protection: number; // flat damage absorbed while intact
  cosmetic: boolean; // cosmetic shell: negligible protection
}

export interface UpgradeDefinition {
  /** Highest purchasable level; level 1 is the catalog base definition. */
  maxLevel: number;
  /** Price to move from level 1 to level 2. */
  basePrice: number;
  /** Multiplier applied to each successive upgrade price. */
  priceGrowth: number;
}

export interface PartDefinition {
  id: string;
  name: string;
  category: PartCategory;
  description: string;
  /** Occupied local cells at orientation 0. Single or multi-cell. */
  cells: Vec3i[];
  /**
   * Local cells that must remain empty (orientation 0) — wheel travel volume,
   * weapon breech clearance, steering swing, etc.
   */
  clearanceCells: Vec3i[];
  /** Allowed orientation indices; undefined = all 24. */
  allowedOrientations?: OrientationIndex[];
  sockets: StructuralSocket[];
  /**
   * Socket type this part must attach through (its own socket of this type
   * must meet a compatible provider). Undefined = any frame connection.
   */
  requiresMount?: SocketType;
  massKg: number;
  health: number;
  cost: number;
  /** Per-level stat and health scaling metadata. Undefined means not upgradeable. */
  upgrade?: UpgradeDefinition;
  /** One-time price to unlock a catalog part; absent means already available. */
  unlockCost?: number;
  /** Multiplier on the strength of structural connections into this part. */
  reinforcement: number;
  /**
   * Fraction of a ram impact this part shrugs off, 0..1 — 0 (the default)
   * feels every collision in full, 0.75 takes a quarter of it. For hardware
   * built to be driven into things: a plough blade that loses its own health
   * ramming a wall is a blade the player learns not to use as one.
   */
  impactResistance?: number;
  /** Only one instance allowed per vehicle (root chassis). */
  unique?: boolean;
  /** True for the root chassis that anchors connectivity. */
  isRoot?: boolean;
  /**
   * The signature block of a Build (`src/core/builds.ts`). It ships bolted to
   * the rig the player picked and is theirs for the run: it is not on the store
   * shelf at any price and cannot be sold off the vehicle, because a player who
   * scrapped it would have no way to get their build's identity back. Upgrading
   * it works exactly like any other part.
   */
  buildSignature?: boolean;
  wheel?: WheelDefinition;
  engine?: EngineDefinition;
  weapon?: WeaponDefinition;
  /** Click-targeted primary fire; only Build signature blocks carry one. */
  signature?: SignatureDefinition;
  ability?: AbilityDefinition;
  melee?: MeleeDefinition;
  armour?: ArmourDefinition;
  fuelCapacity?: number; // litres
  cargoCapacity?: number; // kg
  /** Approximate render/collider box size per cell, metres (default 1). */
  visualScale?: number;
}

/** Paint swatches available on every part (customization). */
export const PAINT_COLORS = {
  scrap: 0x8a8f98,
  red: 0xc84c4c,
  blue: 0x4d79c7,
  green: 0x5f9b55,
  yellow: 0xd6a928,
  purple: 0x8b5bb5,
} as const;

export type PaintColor = keyof typeof PAINT_COLORS;

export interface PartConfig {
  /** Upgrade level; omitted means the catalog base level (1). */
  level?: number;
  driven?: boolean;
  steering?: boolean;
  /** Invert steering direction (rear-steer axles). */
  steerInverted?: boolean;
  braking?: boolean;
  /**
   * Legacy tick for "equip this ability": kept so blueprints saved before the
   * garage ability panel existed still resolve the same way. New edits write
   * `abilitySlot` instead.
   */
  activeAbility?: boolean;
  /**
   * For parts with an `ability`: which of the three ability-bar boxes the
   * player dropped it into (0 → Q, 1 → E, 2 → R), or
   * `BENCHED_ABILITY_SLOT` (-1) when they took it out of the bar. Undefined
   * means "wherever it fits", which is how every ability starts out.
   */
  abilitySlot?: number;
  suspensionPreset?: SuspensionPreset;
  /** Player-chosen paint; undefined = the part's default colour. */
  paint?: PaintColor;
}

export interface PlacedPart {
  /** Instance id, unique within the blueprint. */
  id: string;
  defId: string;
  pos: Vec3i;
  orient: OrientationIndex;
  config: PartConfig;
}

export interface VehicleBlueprint {
  schemaVersion: number;
  id: string;
  name: string;
  parts: PlacedPart[];
}

export interface StructuralConnection {
  aId: string;
  bId: string;
  aSocketId: string;
  bSocketId: string;
  maxForce: number; // N
  maxTorque: number; // N·m
  health: number; // 0..1 remaining
}

export interface DrivetrainConnection {
  /** Engine placed-part id feeding this wheel placed-part id. */
  engineId: string;
  wheelId: string;
}

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  /** Affected placed part ids, when known. */
  partIds: string[];
  /** Affected world grid cells, when known. */
  cells: Vec3i[];
  suggestion?: string;
}

export interface PlacementResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface ValidationReport {
  /** Hard errors: vehicle cannot be meaningfully assembled / test-driven. */
  errors: ValidationIssue[];
  /** Physics/design warnings: never block experimentation. */
  warnings: ValidationIssue[];
  /** Informational notes. */
  infos: ValidationIssue[];
}

export interface WheelContactEstimate {
  partId: string;
  /** Expected contact point in vehicle-local metres (at suspension rest). */
  point: Vec3;
  /** Estimated static load share, N. */
  load: number;
  grounded: boolean;
}

export interface VehicleAnalysisReport {
  totalMassKg: number;
  centreOfMass: Vec3; // vehicle-local metres
  frontMassFraction: number; // 0..1 mass ahead of CoM midpoint (by wheelbase)
  leftMassFraction: number;
  wheelContacts: WheelContactEstimate[];
  /** Convex hull (XZ, metres) of expected grounded wheel contacts. */
  supportPolygon: { x: number; z: number }[];
  /** Min horizontal distance from CoM projection to polygon edge; negative = outside. */
  stabilityMarginM: number;
  rolloverRisk: 'low' | 'medium' | 'high' | 'extreme';
  trackWidthM: number;
  wheelbaseM: number;
  groundClearanceM: number;
  powerToWeightKwPerT: number;
  /** Combined sustained weapon damage per second before ammo constraints. */
  totalDps: number;
  /** Gear-limited road-speed estimate from engine RPM and driven wheel radius. */
  estimatedTopSpeedKph: number;
  drivenWheelLoadFraction: number; // share of static load on driven wheels
  estimatedMaxSlopeDeg: number;
  fuelCapacityL: number;
  totalCost: number;
  warnings: ValidationIssue[];
}

/** Grid bounds (inclusive), vehicle-local cells. */
export const GRID_MIN: Vec3i = { x: -6, y: 0, z: -8 };
export const GRID_MAX: Vec3i = { x: 6, y: 8, z: 8 };

/** World metres per grid cell. */
export const CELL_SIZE = 0.5;

export const BLUEPRINT_SCHEMA_VERSION = 4;
