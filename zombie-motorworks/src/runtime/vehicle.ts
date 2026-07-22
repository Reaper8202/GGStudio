/**
 * RuntimeVehicle: owns the assembled body plus engine/fuel/ammo/power state,
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
import { createWeapon, stepWeapons } from './weapons.ts';
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

/** One weapon's magazine, for the ammo HUD. */
export interface WeaponAmmoTelemetry {
  partId: string;
  label: string;
  ammo: number;
  capacity: number;
}

export interface VehicleTelemetry {
  speedKmh: number;
  rpm: number;
  gear: number;
  fuel: number;
  fuelCapacity: number;
  /** Rounds left across every attached weapon. */
  ammo: number;
  /** Magazine size across every attached weapon. */
  ammoCapacity: number;
  /** Per-weapon magazines, attached and alive only. */
  weaponAmmo: WeaponAmmoTelemetry[];
  power: number;
  groundedWheels: number;
  totalWheels: number;
  overloadedWheels: string[];
  aliveParts: number;
  detachedParts: number;
  shotsThisStep: TracerShot[];
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

const POWER_RECHARGE_PER_S = 15;

// Skid steer (tank treads). At full lock the inner belt drops to
// (1 - SKID_STEER_BIAS) of its share and the outer belt takes the rest, so a
// tracked rig pivots on the spot at a standstill and arcs under power. Above
// 1 the inner belt would counter-rotate, which pivots harder than a heavy
// tracked rig should manage.
const SKID_STEER_BIAS = 0.9;
// Torque each belt gets purely from steering, so a tracked rig can pivot with
// the throttle shut instead of needing to roll first.
const SKID_PIVOT_TORQUE = 1800; // N·m

/**
 * Rewrite drive torque for tread-style wheels so steering input turns into a
 * left/right speed difference. Angled-hub wheels are left untouched, so a rig
 * mixing treads and wheels gets both behaviours at once.
 *
 * Positive steer turns toward -x (matching steerTargets), so the left belt is
 * the one that slows down.
 */
function applySkidSteer(
  drivenWheels: RuntimeWheel[],
  driveTorques: Map<string, number>,
  steer: number,
): void {
  if (Math.abs(steer) < 1e-3) return;
  for (const w of drivenWheels) {
    if (!w.wheelDef.skidSteer || w.broken) continue;
    const side = Math.sign(w.anchorLocal.x - MIRROR_PLANE_X_M);
    if (side === 0) continue; // Centreline belt has no side to favour.
    const base = driveTorques.get(w.partId) ?? 0;
    const biased =
      base * (1 + side * steer * SKID_STEER_BIAS) +
      side * steer * SKID_PIVOT_TORQUE;
    const limit = w.wheelDef.driveTorqueLimit;
    driveTorques.set(w.partId, Math.max(-limit, Math.min(limit, biased)));
  }
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
const MAX_POST_SOLVE_SPEED_MPS = 38;
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
  private power = 0;
  private powerCapacity = 0;
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
      this.powerCapacity += part.def.batteryCapacity ?? 0;
    }
    this.fuel = this.fuelCapacity;
    this.power = this.powerCapacity;
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

  /** Dev-tuner god mode: when true, all incoming part damage is ignored. */
  invulnerable = false;

  applyDirectDamage(partId: string, amount: number): void {
    if (this.invulnerable) return;
    damagePart(this.assembled, partId, amount);
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

  /** Root loss or loss of every attached control provider ends the run. */
  isDestroyed(): boolean {
    const root = this.assembled.parts.get(this.assembled.rootPartId);
    if (!root || !root.alive || root.detached) return true;
    return !this.hasControl(this.attachedAliveIds());
  }

  private attachedAliveIds(): Set<string> {
    const out = new Set<string>();
    for (const [id, p] of this.assembled.parts)
      if (p.alive && !p.detached) out.add(id);
    return out;
  }

  private hasControl(attached: Set<string>): boolean {
    for (const id of attached) {
      if (this.assembled.parts.get(id)!.def.providesControl) return true;
    }
    return false;
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
    const controllable = this.hasControl(attached);
    const forwardSpeed = this.forwardSpeed();
    const throttle = controllable ? controls.throttle : 0;
    const brake = controllable
      ? brakeInputWithAutoHold(controls, forwardSpeed)
      : 0;
    const steer = controllable ? controls.steer : 0;
    const reverseInput =
      controllable && throttle <= 0 ? (controls.reverse ?? 0) : 0;
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

    const torques = distributeTorque(
      totalTorque,
      drivenWheels.map((w) => w.wheelDef.driveTorqueLimit),
    );
    const driveTorques = new Map<string, number>();
    drivenWheels.forEach((w, i) => driveTorques.set(w.partId, torques[i]));
    if (liveEngines.length > 0) {
      applySkidSteer(drivenWheels, driveTorques, steer);
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

    // Battery recharges while an engine runs.
    if (liveEngines.length > 0)
      this.power = Math.min(
        this.powerCapacity,
        this.power + POWER_RECHARGE_PER_S * dt,
      );

    const weaponResult = stepWeapons(
      this.world,
      this.assembled,
      this.weapons,
      attached,
      {
        fire: controllable && controls.fire,
        aimYawWorld: controls.aimYawWorld,
        weaponAim: controls.weaponAim,
      },
      this.power,
      dt,
    );
    this.power -= weaponResult.powerUsed;
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
      MAX_POST_SOLVE_SPEED_MPS,
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
      MAX_POST_SOLVE_SPEED_MPS,
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
      // Losing tanks/ammo/batteries shrinks capacity (and clamps stock).
      this.recomputeResources();
    }
    return events.detachedIslands;
  }

  private recomputeResources(): void {
    let fuelCap = 0;
    let powerCap = 0;
    for (const [, p] of this.assembled.parts) {
      if (!p.alive || p.detached) continue;
      fuelCap += p.def.fuelCapacity ?? 0;
      powerCap += p.def.batteryCapacity ?? 0;
    }
    this.fuelCapacity = fuelCap;
    this.fuel = Math.min(this.fuel, fuelCap);
    this.powerCapacity = powerCap;
    this.power = Math.min(this.power, powerCap);
    // Ammo needs no clamping: a magazine dies with the weapon that holds it.
  }

  /** Magazines of every weapon still attached and alive. */
  private liveWeaponAmmo(): WeaponAmmoTelemetry[] {
    const out: WeaponAmmoTelemetry[] = [];
    for (const wpn of this.weapons) {
      const part = this.assembled.parts.get(wpn.partId);
      if (!part || !part.alive || part.detached) continue;
      if (wpn.ammoCapacity <= 0) continue; // Melee mounts carry no rounds.
      out.push({
        partId: wpn.partId,
        label: wpn.label,
        ammo: wpn.ammo,
        capacity: wpn.ammoCapacity,
      });
    }
    return out;
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
    const weaponAmmo = this.liveWeaponAmmo();
    return {
      speedKmh: Math.hypot(v.x, v.y, v.z) * 3.6,
      rpm: this.lastRpm,
      gear: this.lastGear,
      fuel: this.fuel,
      fuelCapacity: this.fuelCapacity,
      ammo: weaponAmmo.reduce((sum, w) => sum + w.ammo, 0),
      ammoCapacity: weaponAmmo.reduce((sum, w) => sum + w.capacity, 0),
      weaponAmmo,
      power: this.power,
      groundedWheels: this.lastWheelTelemetry.groundedCount,
      totalWheels: this.assembled.wheels.filter((w) => !w.broken).length,
      overloadedWheels: this.lastWheelTelemetry.overloadedWheels,
      aliveParts: alive,
      detachedParts: detached,
      shotsThisStep: this.lastShots,
    };
  }

  /** Free everything this vehicle created in the world. */
  dispose(): void {
    for (const isle of this.islands) this.world.removeRigidBody(isle.body);
    this.world.removeRigidBody(this.assembled.body);
    this.islands = [];
  }
}
