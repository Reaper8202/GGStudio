/**
 * RuntimeVehicle: owns the assembled body plus engine/fuel state,
 * and coordinates drivetrain → wheels → weapons each step. The test chamber
 * owns the Rapier world/step loop; it calls preStep() before world.step()
 * and feeds contact-force events to onContactForce()/finishStep() after.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type {
  PartDefinition,
  StructuralConnection,
  Vec3,
  VehicleBlueprint,
} from '../core/types.ts';
import type { AssembledVehicle, GetDef, RuntimeWheel } from './assembler.ts';
import { assembleVehicle } from './assembler.ts';
import type { AckermannGeometry, WheelTelemetry } from './wheels.ts';
import { MIRROR_PLANE_X_M, computeAckermann, stepWheels } from './wheels.ts';
import type { EngineOutput, GearboxState } from './drivetrain.ts';
import { distributeTorque, engineStep, updateGearbox } from './drivetrain.ts';
import type { RuntimeWeapon, TracerShot } from './weapons.ts';
import { createWeapon, overchargeWeapon, stepWeapons } from './weapons.ts';
import {
  applyDirectDamage as damagePart,
  applyImpactDamage,
  resolveStructure,
  type DetachedIsland,
} from './damage.ts';
import type { SurfaceKind } from './surfaces.ts';
import { rotateByQuat } from './vec.ts';
import {
  VEHICLE_PERFORMANCE_REFERENCE_MASS_KG,
  vehicleMassPerformanceFactor,
} from '../core/mass.ts';

export interface VehicleControls {
  throttle: number; // 0..1
  brake: number; // 0..1
  /** 0..1: reverse drive, engages only while near-stopped; throttle wins. */
  reverse?: number;
  steer: number; // -1..1
  fire: boolean;
  aimYawWorld: number; // rad
  /**
   * World point the player is aiming at. Manual turrets pitch onto it so they
   * shoot exactly where the cursor is, rather than firing flat along the yaw.
   */
  aimPoint?: Vec3;
  /** Per-placed-weapon overrides; absent entries retain the global aim/fire. */
  weaponAim?: ReadonlyMap<string, { aimYawWorld: number; fire: boolean }>;
}

export const AUTO_HOLD_SPEED = 1.5; // m/s

/** Apply the parking brake only for the final low-speed part of a coast. */
export function brakeInputWithAutoHold(
  controls: Pick<VehicleControls, 'throttle' | 'reverse' | 'brake'>,
  forwardSpeed: number,
): number {
  const noDriveInput = controls.throttle <= 0 && (controls.reverse ?? 0) <= 0;
  return controls.brake <= 0 && noDriveInput && Math.abs(forwardSpeed) < AUTO_HOLD_SPEED
    ? 1
    : controls.brake;
}

export interface VehicleTelemetry {
  speedKmh: number;
  rpm: number;
  gear: number;
  fuel: number;
  fuelCapacity: number;
  groundedWheels: number;
  totalWheels: number;
  overloadedWheels: string[];
  aliveParts: number;
  detachedParts: number;
  shotsThisStep: TracerShot[];
  /** Cumulative rounds fired across every weapon this run (weapons are unlimited). */
  totalShotsFired: number;
}

export interface RuntimePartTarget {
  partId: string;
  position: Vec3;
  distance: number;
}

interface RuntimeEngine {
  partId: string;
  def: NonNullable<PartDefinition['engine']>;
  gearbox: GearboxState;
  rpm: number;
}

// Skid steer (tank treads). At full lock the inner belt drops to
// (1 - SKID_STEER_BIAS) of its share and the outer belt takes the rest, so a
// mixed wheel+tread rig arcs under power without pivoting too hard. A bias
// above 1 makes the inner belt counter-rotate for a true pivot-in-place.
const SKID_STEER_BIAS = 0.9;
// Torque each belt gets purely from steering, so a tracked rig can pivot with
// the throttle shut instead of needing to roll first.
const SKID_PIVOT_TORQUE = 1800; // N·m

// Excavator mode: an all-tread rig (treads and no hub-steering wheels) should
// spin on the spot like a tracked excavator. The inner belt counter-rotates
// (bias > 1) and each side gets a strong opposing steer torque, so full lock
// with the throttle shut rotates the chassis in place.
const EXCAVATOR_SKID_STEER_BIAS = 1.85;
const EXCAVATOR_PIVOT_TORQUE = 3400; // N·m

/**
 * Rewrite drive torque for tread-style wheels so steering input turns into a
 * left/right speed difference. Angled-hub wheels are left untouched, so a rig
 * mixing treads and wheels gets both behaviours at once. When `excavator` is
 * set (all-tread rig) the inner belt counter-rotates for a pivot-in-place.
 *
 * Positive steer turns toward -x (matching steerTargets), so the left belt is
 * the one that slows down.
 */
function applySkidSteer(
  drivenWheels: RuntimeWheel[],
  driveTorques: Map<string, number>,
  steer: number,
  excavator: boolean,
): void {
  if (Math.abs(steer) < 1e-3) return;
  const bias = excavator ? EXCAVATOR_SKID_STEER_BIAS : SKID_STEER_BIAS;
  const pivotTorque = excavator ? EXCAVATOR_PIVOT_TORQUE : SKID_PIVOT_TORQUE;
  for (const w of drivenWheels) {
    if (!w.wheelDef.skidSteer || w.broken) continue;
    const side = Math.sign(w.anchorLocal.x - MIRROR_PLANE_X_M);
    if (side === 0) continue; // Centreline belt has no side to favour.
    const base = driveTorques.get(w.partId) ?? 0;
    const biased =
      base * (1 + side * steer * bias) + side * steer * pivotTorque;
    const limit = w.wheelDef.driveTorqueLimit;
    driveTorques.set(w.partId, Math.max(-limit, Math.min(limit, biased)));
  }
}

/**
 * True when the rig steers purely by treads — it has at least one skid-steer
 * tread and no hub-steering-capable wheels — so it should pivot like an
 * excavator. Keyed off the wheel definition (can this hub angle?) rather than
 * the derived steering flag, so the result is stable regardless of which axle
 * the layout happens to nominate.
 */
export function isAllTreadRig(
  attachedWheels: Pick<RuntimeWheel, 'wheelDef'>[],
): boolean {
  let hasTread = false;
  for (const w of attachedWheels) {
    if (w.wheelDef.skidSteer) hasTread = true;
    else if (w.wheelDef.maxSteerAngleDeg > 0) return false;
  }
  return hasTread;
}

// Soft yaw-rate limiter: above this |angvel.y|, pull it down exponentially
// each step. Corner impacts against walls/terrain (cuboid colliders, no
// angular damping) can otherwise impart a yaw spike that free-spins with
// nothing to arrest it once wheels are unloaded/airborne. Only the yaw
// (world Y) component is touched — x/z must stay free so a genuine
// high-CoM rollover can still tip the vehicle over.
const YAW_RATE_SOFT_LIMIT = 3.5; // rad/s
const YAW_RATE_PULLDOWN_PER_S = 6; // exponential decay rate while above the limit

// Vehicle stability and energy guards. Downforce is applied as an impulse so
// systems that rebuild external forces later in the step cannot erase it.
const BASE_DOWNFORCE_ACCEL = 2.25; // m/s^2, in addition to gravity
const SPEED_DOWNFORCE_COEFFICIENT = 0.0032; // m/s^2 per horizontal (m/s)^2
const MAX_DOWNFORCE_ACCEL = 6;
const AERO_DRAG_COEFFICIENT = 0.0025;
const HEAVY_BUILD_DRAG_COEFFICIENT = 0.05;
const LATERAL_STABILITY_RATE_PER_S = 4.2;
const MAX_LATERAL_CORRECTION_MPS_PER_STEP = 0.45;
const GROUNDED_ROLL_PITCH_DAMPING_PER_S = 3.2;
const TURN_ROLL_PITCH_DAMPING_BONUS_PER_S = 2.4;
// Top speed is emergent, but the anti-explosion clamp below sets its ceiling.
// That ceiling scales with total engine power (see updateTopSpeedCap), so
// bolting on engines makes the vehicle genuinely faster — bounded by a hard,
// solver-safe maximum.
const BASE_TOP_SPEED_MPS = 42; // ~151 km/h baseline (a modest bump over the old flat 38)
const TOP_SPEED_PER_KW = 0.05; // m/s of ceiling added per engine kW
const HARD_MAX_SPEED_MPS = 55; // absolute cap that keeps Rapier stable
const MAX_POST_SOLVE_SPEED_GAIN_MPS = 1.25;
const MAX_POST_SOLVE_ANGULAR_SPEED = 8;
const MAX_POST_SOLVE_ANGULAR_GAIN = 1.5;

// Reverse: engages only below this forward speed (S is a brake above it),
// locks the gearbox to first gear with the torque negated, and stops pushing
// once reverse speed reaches the cap.
const REVERSE_ENGAGE_MAX_FORWARD_MPS = 0.6;
const REVERSE_MAX_SPEED_MPS = 5;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class RuntimeVehicle {
  readonly assembled: AssembledVehicle;
  readonly colliderToPart = new Map<number, string>();
  private readonly weapons: RuntimeWeapon[] = [];
  private readonly engines: RuntimeEngine[] = [];
  private geom: AckermannGeometry;
  private fuel = 0;
  private fuelCapacity = 0;
  /** Seconds of remaining shield invulnerability; >0 blocks all damage. */
  private invulnTimer = 0;
  /** Seconds of remaining overdrive torque surge; 0 when not boosting. */
  private overdriveTimer = 0;
  /** Drive-torque multiplier applied while `overdriveTimer` runs. */
  private overdriveMultiplier = 1;
  /**
   * Multiplier on the anti-explosion speed ceiling while overdriving. Without
   * it the surge would only be felt up to the normal cap, and a rig already at
   * cap would feel nothing at all.
   */
  private overdriveSpeedMultiplier = 1;
  /**
   * Thrust in m/s^2 applied along the rig's heading while overdriving,
   * independent of throttle and of whether the drive wheels have any grip.
   */
  private overdriveThrustAccel = 0;
  private topSpeedCap = BASE_TOP_SPEED_MPS;
  private lastWheelTelemetry: WheelTelemetry = {
    groundedCount: 0,
    meanDrivenOmega: 0,
    overloadedWheels: [],
  };
  private lastShots: TracerShot[] = [];
  private lastRpm = 0;
  private lastGear = 0;
  private readonly velocityBeforeSolve = { x: 0, y: 0, z: 0 };
  private readonly angularVelocityBeforeSolve = { x: 0, y: 0, z: 0 };
  private readonly stabilityImpulse = { x: 0, y: 0, z: 0 };
  islands: DetachedIsland[] = [];

  constructor(
    private readonly world: RAPIER.World,
    bp: VehicleBlueprint,
    getDef: GetDef,
    connections: StructuralConnection[],
    spawn: {
      translation: { x: number; y: number; z: number };
      yawRad?: number;
    },
  ) {
    this.assembled = assembleVehicle(world, bp, getDef, connections, spawn);
    for (const [id, part] of this.assembled.parts) {
      for (const h of part.colliderHandles) this.colliderToPart.set(h, id);
      if (part.def.engine) {
        this.engines.push({
          partId: id,
          def: part.def.engine,
          gearbox: { gear: 0, shiftCooldown: 0 },
          rpm: part.def.engine.idleRpm,
        });
      }
      if (part.def.weapon) this.weapons.push(createWeapon(part.placed, getDef));
      this.fuelCapacity += part.def.fuelCapacity ?? 0;
    }
    this.fuel = this.fuelCapacity;
    this.updateTopSpeedCap();
    this.geom = computeAckermann(this.assembled.wheels);
  }

  get body(): RAPIER.RigidBody {
    return this.assembled.body;
  }

  /** Signed speed along the vehicle's forward (+Z) axis, m/s. */
  forwardSpeed(): number {
    const fwd = rotateByQuat(this.body.rotation(), { x: 0, y: 0, z: 1 });
    const v = this.body.linvel();
    return v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;
  }

  applyDirectDamage(partId: string, amount: number): void {
    if (this.invulnTimer > 0) return;
    damagePart(this.assembled, partId, amount);
  }

  /**
   * Shield ability: make the whole vehicle immune to damage for `seconds`.
   * Re-activation extends to the longer remaining time.
   */
  grantInvulnerability(seconds: number): void {
    if (seconds <= 0) return;
    this.invulnTimer = Math.max(this.invulnTimer, seconds);
  }

  /** True while the shield bubble is holding. */
  get isInvulnerable(): boolean {
    return this.invulnTimer > 0;
  }

  /**
   * Overdrive ability: multiply drive torque by `multiplier` for `seconds`,
   * and lift the speed ceiling by `speedMultiplier` so the surge is felt at
   * the top end too. Re-activation takes the longer time and the stronger
   * pull rather than stacking, so spamming it can never run away with the
   * drivetrain.
   */
  grantOverdrive(
    seconds: number,
    multiplier: number,
    speedMultiplier = 1,
    thrustAccel = 0,
  ): void {
    if (seconds <= 0 || multiplier <= 1) return;
    this.overdriveTimer = Math.max(this.overdriveTimer, seconds);
    this.overdriveMultiplier = Math.max(this.overdriveMultiplier, multiplier);
    this.overdriveSpeedMultiplier = Math.max(
      this.overdriveSpeedMultiplier,
      Math.max(1, speedMultiplier),
    );
    this.overdriveThrustAccel = Math.max(
      this.overdriveThrustAccel,
      Math.max(0, thrustAccel),
    );
  }

  /**
   * The speed ceiling in force this step: the engine-derived cap, lifted while
   * an overdrive surge runs but never past the hard limit that keeps the
   * solver stable.
   */
  private currentSpeedCeiling(): number {
    if (this.overdriveTimer <= 0) return this.topSpeedCap;
    return Math.min(
      HARD_MAX_SPEED_MPS,
      this.topSpeedCap * this.overdriveSpeedMultiplier,
    );
  }

  /** True while the overdrive surge is running. */
  get isOverdriving(): boolean {
    return this.overdriveTimer > 0;
  }

  /**
   * Hellfire ability: overcharge one part's own weapon for `seconds` — hotter,
   * further, and wider than its stock spray, and (for the flamethrower's
   * periodic nozzle) with no pause between bursts. Returns false when the part
   * carries no weapon, so the caller can decline to start a cooldown.
   */
  grantHellfire(
    partId: string,
    seconds: number,
    multipliers: {
      damageMultiplier: number;
      rangeMultiplier: number;
      coneMultiplier: number;
    },
  ): boolean {
    const weapon = this.weapons.find((w) => w.partId === partId);
    if (weapon === undefined) return false;
    overchargeWeapon(weapon, seconds, multipliers);
    return true;
  }

  /** True while any weapon on the rig is running a Hellfire overcharge. */
  get isOvercharged(): boolean {
    return this.weapons.some((w) => w.overcharge !== null);
  }

  /** Find the closest attached, living part by its collider-centre centroid. */
  nearestLivePart(point: Vec3): RuntimePartTarget | null {
    const bodyPos = this.body.translation();
    const bodyRot = this.body.rotation();
    let nearest: RuntimePartTarget | null = null;
    let nearestDistanceSq = Infinity;

    for (const [id, part] of this.assembled.parts) {
      if (
        !part.alive ||
        part.health <= 0 ||
        part.detached ||
        part.colliderCentresM.length === 0
      )
        continue;

      const localCentre = part.colliderCentresM.reduce(
        (sum, centre) => ({
          x: sum.x + centre.x,
          y: sum.y + centre.y,
          z: sum.z + centre.z,
        }),
        { x: 0, y: 0, z: 0 },
      );
      const count = part.colliderCentresM.length;
      localCentre.x /= count;
      localCentre.y /= count;
      localCentre.z /= count;

      const rotated = rotateByQuat(bodyRot, localCentre);
      const position = {
        x: bodyPos.x + rotated.x,
        y: bodyPos.y + rotated.y,
        z: bodyPos.z + rotated.z,
      };
      const dx = position.x - point.x;
      const dy = position.y - point.y;
      const dz = position.z - point.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearest = { partId: id, position, distance: Math.sqrt(distanceSq) };
      }
    }

    return nearest;
  }

  /** Attached vehicle health as a percentage of the original total. */
  integrityPct(): number {
    let currentHealth = 0;
    let maxHealth = 0;
    for (const [, part] of this.assembled.parts) {
      maxHealth += part.def.health;
      if (part.alive && !part.detached) {
        currentHealth += Math.min(part.def.health, Math.max(0, part.health));
      }
    }
    return maxHealth > 0 ? (currentHealth / maxHealth) * 100 : 0;
  }

  /** Root loss ends the run. */
  isDestroyed(): boolean {
    const root = this.assembled.parts.get(this.assembled.rootPartId);
    return !root || !root.alive || root.detached;
  }

  private attachedAliveIds(): Set<string> {
    const out = new Set<string>();
    for (const [id, p] of this.assembled.parts)
      if (p.alive && !p.detached) out.add(id);
    return out;
  }

  /** Stable blueprint IDs for every living part still attached to the root body. */
  survivingPartIds(): string[] {
    return [...this.attachedAliveIds()];
  }

  /** Serializable current HP for every original blueprint part. */
  partHpSnapshot(): Record<string, number> {
    const snapshot: Record<string, number> = {};
    for (const [id, part] of this.assembled.parts) {
      snapshot[id] = part.alive ? Math.max(0, part.health) : 0;
    }
    return snapshot;
  }

  /** Restore per-part HP from a snapshot; parts at or below 0 HP are killed. */
  applyPartHpSnapshot(snapshot: Record<string, number>): DetachedIsland[] {
    for (const [id, health] of Object.entries(snapshot)) {
      const part = this.assembled.parts.get(id);
      if (!part) continue;
      part.health = Math.min(part.def.health, health);
    }
    // Restoring a part at zero HP has to break the rig apart exactly the way
    // taking that last hit would, so the caller gets the islands back and can
    // give them meshes like any other mid-run detachment.
    return this.finishStep();
  }

  preStep(
    dt: number,
    controls: VehicleControls,
    surfaceOf: (colliderHandle: number) => SurfaceKind,
  ): void {
    if (this.invulnTimer > 0) {
      this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    }
    if (this.overdriveTimer > 0) {
      this.overdriveTimer = Math.max(0, this.overdriveTimer - dt);
      if (this.overdriveTimer === 0) {
        this.overdriveMultiplier = 1;
        this.overdriveSpeedMultiplier = 1;
        this.overdriveThrustAccel = 0;
      }
    }
    const body = this.assembled.body;
    const velocityAtStart = body.linvel();
    const angularVelocityAtStart = body.angvel();
    this.velocityBeforeSolve.x = velocityAtStart.x;
    this.velocityBeforeSolve.y = velocityAtStart.y;
    this.velocityBeforeSolve.z = velocityAtStart.z;
    this.angularVelocityBeforeSolve.x = angularVelocityAtStart.x;
    this.angularVelocityBeforeSolve.y = angularVelocityAtStart.y;
    this.angularVelocityBeforeSolve.z = angularVelocityAtStart.z;

    const attached = this.attachedAliveIds();
    const forwardSpeed = this.forwardSpeed();
    const throttle = controls.throttle;
    const brake = brakeInputWithAutoHold(controls, forwardSpeed);
    const steer = controls.steer;
    const reverseInput = throttle <= 0 ? (controls.reverse ?? 0) : 0;
    const reversing =
      reverseInput > 0 &&
      forwardSpeed < REVERSE_ENGAGE_MAX_FORWARD_MPS &&
      forwardSpeed > -REVERSE_MAX_SPEED_MPS;
    const demand = reversing ? reverseInput : throttle;

    // Live drivetrain: engines attached+alive with fuel; wheels attached+driven.
    const liveEngines = this.engines.filter(
      (e) => attached.has(e.partId) && this.fuel > 0,
    );
    const drivenWheels = this.assembled.wheels.filter(
      (w) => !w.broken && attached.has(w.partId) && w.driven,
    );
    const attachedWheels = this.assembled.wheels.filter(
      (w) => !w.broken && attached.has(w.partId),
    );
    const excavatorSteer = isAllTreadRig(attachedWheels);

    let totalTorque = 0;
    let rpmDisplay = 0;
    for (const eng of liveEngines) {
      // Reverse locks first gear (its ratio doubles as the reverse ratio)
      // and negates the wheel torque; the automatic gearbox stays frozen.
      if (reversing && eng.gearbox.gear !== 0) {
        eng.gearbox = { gear: 0, shiftCooldown: eng.gearbox.shiftCooldown };
      }
      const out: EngineOutput = engineStep(
        eng.def,
        eng.gearbox,
        demand,
        this.lastWheelTelemetry.meanDrivenOmega,
        dt,
      );
      if (!reversing) {
        eng.gearbox = updateGearbox(eng.gearbox, out.rpm, eng.def, dt);
      }
      eng.rpm = out.rpm;
      totalTorque +=
        drivenWheels.length > 0
          ? (reversing ? -1 : 1) * out.wheelTorqueTotal
          : 0;
      this.fuel = Math.max(0, this.fuel - out.fuelUsed);
      rpmDisplay = Math.max(rpmDisplay, out.rpm);
    }
    this.lastRpm = rpmDisplay;
    this.lastGear = liveEngines[0]?.gearbox.gear ?? 0;

    const mass = Math.max(1, body.mass());
    const massPerformance = vehicleMassPerformanceFactor(mass);
    totalTorque *= massPerformance;
    // Overdrive rides on top of the mass penalty, so the surge is worth most
    // to the heavy rigs the penalty hurts.
    if (this.overdriveTimer > 0) totalTorque *= this.overdriveMultiplier;

    const torques = distributeTorque(
      totalTorque,
      drivenWheels.map((w) => w.wheelDef.driveTorqueLimit),
    );
    const driveTorques = new Map<string, number>();
    drivenWheels.forEach((w, i) => driveTorques.set(w.partId, torques[i]));
    if (liveEngines.length > 0) {
      applySkidSteer(drivenWheels, driveTorques, steer, excavatorSteer);
    }

    this.lastWheelTelemetry = stepWheels(
      this.world,
      this.assembled.body,
      this.assembled.wheels,
      this.geom,
      { throttle, brake, steer, driveTorques },
      dt,
      surfaceOf,
    );

    this.applyStabilityForces(dt, mass, steer);
    this.applyOverdriveThrust(dt, mass, reversing);

    const weaponResult = stepWeapons(
      this.world,
      this.assembled,
      this.weapons,
      attached,
      {
        fire: controls.fire,
        aimYawWorld: controls.aimYawWorld,
        weaponAim: controls.weaponAim,
      },
      dt,
    );
    this.lastShots = weaponResult.shots;
  }

  /**
   * Clear stored tire energy before an assisted recovery. A wheel that
   * free-spun while inverted must not dump that energy into the ground as
   * soon as the chassis is put upright again.
   */
  resetRecoveryState(): void {
    this.assembled.body.resetForces(true);
    this.assembled.body.resetTorques(true);
    for (const wheel of this.assembled.wheels) {
      wheel.omega = 0;
      wheel.steerAngle = 0;
      wheel.compression = 0;
      wheel.grounded = false;
      wheel.contactPointW = null;
      wheel.loadN = 0;
    }
    this.lastWheelTelemetry = {
      groundedCount: 0,
      meanDrivenOmega: 0,
      overloadedWheels: [],
    };
    for (const engine of this.engines) {
      engine.rpm = engine.def.idleRpm;
      engine.gearbox = { gear: 0, shiftCooldown: 0 };
    }
    this.lastRpm = 0;
    this.lastGear = 0;
  }

  /**
   * Called immediately after world.step(). Contact solvers may legitimately
   * remove any amount of velocity, but they are not allowed to manufacture a
   * large burst of linear or angular energy when a block catches an edge.
   */
  postStepStability(dt: number): void {
    const body = this.assembled.body;
    const speedCeiling = this.currentSpeedCeiling();
    const velocity = body.linvel();
    let correctedX = velocity.x;
    let correctedY = velocity.y;
    let correctedZ = velocity.z;
    let velocityCorrected = false;
    const horizontalSpeed = Math.hypot(correctedX, correctedZ);
    const horizontalSpeedBefore = Math.hypot(
      this.velocityBeforeSolve.x,
      this.velocityBeforeSolve.z,
    );
    const allowedHorizontalSpeed = Math.min(
      speedCeiling,
      horizontalSpeedBefore + MAX_POST_SOLVE_SPEED_GAIN_MPS,
    );
    if (horizontalSpeed > allowedHorizontalSpeed && horizontalSpeed > 1e-6) {
      const scale = allowedHorizontalSpeed / horizontalSpeed;
      correctedX *= scale;
      correctedZ *= scale;
      velocityCorrected = true;
    }

    // Keep vertical impact energy from being converted into a sideways launch,
    // then retain a second overall cap for pure linear solver explosions.
    const speed = Math.hypot(correctedX, correctedY, correctedZ);
    const speedBefore = Math.hypot(
      this.velocityBeforeSolve.x,
      this.velocityBeforeSolve.y,
      this.velocityBeforeSolve.z,
    );
    const allowedSpeed = Math.min(
      speedCeiling,
      speedBefore + MAX_POST_SOLVE_SPEED_GAIN_MPS,
    );
    if (speed > allowedSpeed && speed > 1e-6) {
      const scale = allowedSpeed / speed;
      correctedX *= scale;
      correctedY *= scale;
      correctedZ *= scale;
      velocityCorrected = true;
    }
    if (velocityCorrected) {
      body.setLinvel(
        {
          x: correctedX,
          y: correctedY,
          z: correctedZ,
        },
        true,
      );
    }

    const angularVelocity = body.angvel();
    const angularSpeed = Math.hypot(
      angularVelocity.x,
      angularVelocity.y,
      angularVelocity.z,
    );
    const angularSpeedBefore = Math.hypot(
      this.angularVelocityBeforeSolve.x,
      this.angularVelocityBeforeSolve.y,
      this.angularVelocityBeforeSolve.z,
    );
    const allowedAngularSpeed = Math.min(
      MAX_POST_SOLVE_ANGULAR_SPEED,
      angularSpeedBefore + MAX_POST_SOLVE_ANGULAR_GAIN,
    );
    if (angularSpeed > allowedAngularSpeed && angularSpeed > 1e-6) {
      const scale = allowedAngularSpeed / angularSpeed;
      body.setAngvel(
        {
          x: angularVelocity.x * scale,
          y: angularVelocity.y * scale,
          z: angularVelocity.z * scale,
        },
        true,
      );
      return;
    }

    // Retain the lower yaw-specific soft limit for ordinary corner impacts.
    const yawAbs = Math.abs(angularVelocity.y);
    if (yawAbs > YAW_RATE_SOFT_LIMIT) {
      const excess =
        (yawAbs - YAW_RATE_SOFT_LIMIT) *
        Math.exp(-YAW_RATE_PULLDOWN_PER_S * dt);
      body.setAngvel(
        {
          x: angularVelocity.x,
          y: Math.sign(angularVelocity.y) * (YAW_RATE_SOFT_LIMIT + excess),
          z: angularVelocity.z,
        },
        true,
      );
    }
  }

  /**
   * Overdrive as a propellant: while the surge runs the rig is shoved along
   * its own heading whether or not the driver is on the throttle, so nitro
   * still digs you out when you are stalled against a wall of zombies or
   * coasting with your foot off the pedal.
   *
   * The shove is a centre-of-mass impulse flattened to the ground plane — off
   * the wheels entirely, so it works with the drive wheels stalled, and with
   * no vertical component to launch a nose-up chassis. Reverse points it
   * backwards, so the bottle always pushes the way the driver is asking to go.
   */
  private applyOverdriveThrust(
    dt: number,
    mass: number,
    reversing: boolean,
  ): void {
    if (this.overdriveTimer <= 0 || this.overdriveThrustAccel <= 0) return;
    const body = this.assembled.body;
    const forward = rotateByQuat(body.rotation(), { x: 0, y: 0, z: 1 });
    const horizontal = Math.hypot(forward.x, forward.z);
    if (horizontal < 1e-4) return;
    // Past the ceiling the clamp would only scrub the extra back off again;
    // stopping here keeps the impulse from fighting the speed guard.
    const velocity = body.linvel();
    if (Math.hypot(velocity.x, velocity.z) >= this.currentSpeedCeiling()) {
      return;
    }
    const direction = reversing ? -1 : 1;
    const impulse = mass * this.overdriveThrustAccel * dt * direction;
    body.applyImpulse(
      {
        x: (forward.x / horizontal) * impulse,
        y: 0,
        z: (forward.z / horizontal) * impulse,
      },
      true,
    );
  }

  private applyStabilityForces(
    dt: number,
    mass: number,
    steerInput: number,
  ): void {
    const body = this.assembled.body;
    const velocity = body.linvel();
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    const downforceAccel = Math.min(
      MAX_DOWNFORCE_ACCEL,
      BASE_DOWNFORCE_ACCEL +
        horizontalSpeed * horizontalSpeed * SPEED_DOWNFORCE_COEFFICIENT,
    );

    const massRatio = mass / VEHICLE_PERFORMANCE_REFERENCE_MASS_KG;
    const heavyBuildDrag =
      Math.max(0, massRatio - 1) *
      HEAVY_BUILD_DRAG_COEFFICIENT *
      horizontalSpeed;
    const aeroDrag =
      horizontalSpeed * horizontalSpeed * AERO_DRAG_COEFFICIENT;
    const dragDeltaVelocity = Math.min(
      horizontalSpeed,
      (heavyBuildDrag + aeroDrag) * dt,
    );

    this.stabilityImpulse.x =
      horizontalSpeed > 1e-6
        ? -(velocity.x / horizontalSpeed) * mass * dragDeltaVelocity
        : 0;
    this.stabilityImpulse.y = -mass * downforceAccel * dt;
    this.stabilityImpulse.z =
      horizontalSpeed > 1e-6
        ? -(velocity.z / horizontalSpeed) * mass * dragDeltaVelocity
        : 0;
    body.applyImpulse(this.stabilityImpulse, true);

    // Mild stability control removes chassis sideslip while at least two tires
    // are loaded. It relaxes during intentional turns and leaves mud and
    // airborne motion to the regular tire/rigid-body physics.
    if (this.lastWheelTelemetry.groundedCount < 2) return;
    const rotation = body.rotation();
    const up = rotateByQuat(rotation, { x: 0, y: 1, z: 0 });
    if (up.y < 0.55) return;
    const right = rotateByQuat(rotation, { x: 1, y: 0, z: 0 });
    const lateralSpeed =
      velocity.x * right.x + velocity.y * right.y + velocity.z * right.z;
    // Relax stability control while the player is intentionally cornering;
    // otherwise it counters the desired lateral motion and scrubs speed.
    const correctionRate =
      LATERAL_STABILITY_RATE_PER_S *
      (1 - Math.abs(steerInput) * 0.65);
    const lateralDeltaVelocity = clampNumber(
      -lateralSpeed * correctionRate * dt,
      -MAX_LATERAL_CORRECTION_MPS_PER_STEP,
      MAX_LATERAL_CORRECTION_MPS_PER_STEP,
    );
    this.stabilityImpulse.x = right.x * mass * lateralDeltaVelocity;
    this.stabilityImpulse.y = right.y * mass * lateralDeltaVelocity;
    this.stabilityImpulse.z = right.z * mass * lateralDeltaVelocity;
    body.applyImpulse(this.stabilityImpulse, true);

    // Turn bracing without suspension impulses: damp only chassis roll and
    // pitch while grounded, leaving yaw free for responsive steering.
    const angularVelocity = body.angvel();
    const angularDamping =
      GROUNDED_ROLL_PITCH_DAMPING_PER_S +
      Math.abs(steerInput) * TURN_ROLL_PITCH_DAMPING_BONUS_PER_S;
    const angularFactor = Math.exp(-angularDamping * dt);
    body.setAngvel(
      {
        x: angularVelocity.x * angularFactor,
        y: angularVelocity.y,
        z: angularVelocity.z * angularFactor,
      },
      true,
    );
  }

  onContactForce(colliderHandle: number, forceMagnitude: number): void {
    // The bubble blocks self-damage from impacts; the vehicle still crushes
    // zombies (that runs through ZombieSystem, not this path).
    if (this.invulnTimer > 0) return;
    applyImpactDamage(
      this.assembled,
      this.colliderToPart,
      colliderHandle,
      forceMagnitude,
    );
  }

  /** After event drain: resolve deaths/splits; returns new islands this step. */
  finishStep(): DetachedIsland[] {
    const events = resolveStructure(
      this.world,
      this.assembled,
      this.colliderToPart,
    );
    if (events.detachedIslands.length > 0) {
      this.islands.push(...events.detachedIslands);
    }
    if (events.destroyedParts.length > 0 || events.detachedIslands.length > 0) {
      // Losing fuel tanks shrinks capacity (and clamps current fuel).
      this.recomputeResources();
    }
    return events.detachedIslands;
  }

  private recomputeResources(): void {
    let fuelCap = 0;
    for (const [, p] of this.assembled.parts) {
      if (!p.alive || p.detached) continue;
      fuelCap += p.def.fuelCapacity ?? 0;
    }
    this.fuelCapacity = fuelCap;
    this.fuel = Math.min(this.fuel, fuelCap);
    this.updateTopSpeedCap();
  }

  /**
   * Top-speed ceiling scales with total engine power, so bolting on more
   * engines makes the vehicle genuinely faster. Bounded below by the base
   * ceiling and above by a solver-safe hard maximum.
   */
  private updateTopSpeedCap(): void {
    let enginePowerKw = 0;
    for (const [, p] of this.assembled.parts) {
      if (!p.alive || p.detached) continue;
      enginePowerKw += p.def.engine?.maxPowerKw ?? 0;
    }
    this.topSpeedCap = clampNumber(
      BASE_TOP_SPEED_MPS + TOP_SPEED_PER_KW * enginePowerKw,
      BASE_TOP_SPEED_MPS,
      HARD_MAX_SPEED_MPS,
    );
  }

  /**
   * Top up onboard fuel by a fraction of total capacity (refuel-crate pickups).
   * Returns the litres actually added, so the caller can decide whether the
   * pickup was useful (nothing added means the tank was already full and the
   * crate should be left in place).
   */
  refuel(fraction: number): number {
    if (fraction <= 0 || this.fuelCapacity <= 0) return 0;
    const before = this.fuel;
    this.fuel = Math.min(
      this.fuelCapacity,
      this.fuel + this.fuelCapacity * fraction,
    );
    return this.fuel - before;
  }

  /** Test/debug seam: set current onboard fuel directly (clamped to capacity). */
  debugSetFuel(litres: number): void {
    this.fuel = clampNumber(litres, 0, this.fuelCapacity);
  }

  wheels(): RuntimeWheel[] {
    return this.assembled.wheels;
  }

  weaponStates(): RuntimeWeapon[] {
    return this.weapons;
  }

  /** Reused hitscan results from the most recent preStep, without telemetry allocation. */
  shotsThisStep(): readonly TracerShot[] {
    return this.lastShots;
  }

  telemetry(): VehicleTelemetry {
    const v = this.assembled.body.linvel();
    let alive = 0;
    let detached = 0;
    for (const [, p] of this.assembled.parts) {
      if (p.alive && !p.detached) alive++;
      if (p.detached) detached++;
    }
    return {
      speedKmh: Math.hypot(v.x, v.y, v.z) * 3.6,
      rpm: this.lastRpm,
      gear: this.lastGear,
      fuel: this.fuel,
      fuelCapacity: this.fuelCapacity,
      groundedWheels: this.lastWheelTelemetry.groundedCount,
      totalWheels: this.assembled.wheels.filter((w) => !w.broken).length,
      overloadedWheels: this.lastWheelTelemetry.overloadedWheels,
      aliveParts: alive,
      detachedParts: detached,
      shotsThisStep: this.lastShots,
      totalShotsFired: this.weapons.reduce((sum, w) => sum + w.shotsFired, 0),
    };
  }

  /** Free everything this vehicle created in the world. */
  dispose(): void {
    for (const isle of this.islands) this.world.removeRigidBody(isle.body);
    this.world.removeRigidBody(this.assembled.body);
    this.islands = [];
  }
}
