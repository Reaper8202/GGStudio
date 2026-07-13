/**
 * Arcade vehicle controller: driving physics, health, swarm slowdown,
 * environment-impact damage, and stuck/overturn auto-recovery.
 *
 * Driving model summary (see fixedUpdate/applyDrivingForces):
 *  - Input is a world-space XZ direction + 0..1 magnitude (from InputManager).
 *  - The chassis rigid body has pitch/roll LOCKED at creation (see
 *    VehicleFactory) — only yaw rotates. This is the "strong upright
 *    stability" mechanism: flipping is physically impossible, so the vehicle
 *    can always be driven up the ramp without risk of tipping over.
 *  - Steering is a proportional yaw-rate controller: the signed angle from
 *    current forward to desired direction is computed via atan2(cross.y,
 *    dot), and angvel.y is set to close that gap within one fixedUpdate,
 *    clamped to a max turn rate that is reduced at high speed
 *    (highSpeedSteeringMultiplier).
 *  - If the desired direction is more than ~120 degrees from forward, the
 *    vehicle reverses (reverseAcceleration/maximumReverseSpeed) instead of
 *    turning all the way around. If input opposes current motion (e.g.
 *    pressing forward while still moving backward), a braking force is
 *    applied instead of accelerating, until motion nearly stops.
 *  - With no input, rollingResistance coasts the vehicle to a stop.
 *  - Every fixedUpdate, a `lateralGrip` fraction of sideways (non-forward)
 *    velocity is cancelled — enough to prevent instant sideways movement /
 *    ice-skating, while leaving a brief, mild drift through sharp turns.
 *  - Forward-speed is clamped to tuning.maximumForwardSpeed/ReverseSpeed,
 *    scaled by ctx.state.modifiers.enginePowerMultiplier and the temporary
 *    swarm-slowdown multiplier (never mutating the tuning object itself).
 */
import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type {
  DamageSource,
  GameContext,
  GameSystem,
  VehicleApi,
  VehicleBlueprint,
  VehicleTuning,
  WorldApi,
} from "../types";
import type { InputSource, VehicleInput } from "../input/InputManager";
import { buildVehicle, type VehicleBuild } from "./VehicleFactory";
import {
  IMPACT_COOLDOWN_SECONDS,
  IMPACT_DAMAGE_MIN_SPEED,
  OVERTURNED_RECOVERY_SECONDS,
  STUCK_RECOVERY_SECONDS,
  SWARMED_THRESHOLD,
} from "../config/vehicleTuning";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const INPUT_EPSILON = 0.02;
const REVERSE_ANGLE_THRESHOLD = (120 * Math.PI) / 180;
const BRAKE_ENGAGE_SPEED = 0.4;
const STUCK_SPEED_THRESHOLD = 0.35;
const STUCK_INPUT_THRESHOLD = 0.15;
const RECOVERY_POP_HEIGHT = 0.4;
const RECOVERY_POP_VELOCITY = 2.5;
const FLASH_DURATION = 0.18;
const IMPACT_SHAKE_REFERENCE = 16;
const WHEEL_STEER_VISUAL_SCALE = 0.35;
const MAX_WHEEL_STEER_ANGLE = 0.5;
const FLASH_COLOR = new THREE.Color(0xff2222);
const LOCAL_FORWARD = new THREE.Vector3(0, 0, -1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class Vehicle implements VehicleApi, GameSystem {
  readonly root: THREE.Object3D;
  readonly body: RAPIER.RigidBody;
  readonly turretMount: THREE.Object3D;

  private readonly ctx: GameContext;
  private readonly tuning: VehicleTuning;
  private readonly input: InputSource;
  private readonly build: VehicleBuild;

  private readonly baseMaxHealth: number;
  private lastMaxHealthBonus: number;
  private _health: number;
  private _maxHealth: number;
  private _isDestroyed = false;
  private drivingEnabled = true;

  private readonly _position = new THREE.Vector3();
  private readonly _velocity = new THREE.Vector3();
  private readonly _forward = new THREE.Vector3();

  private readonly _scratchQuat = new THREE.Quaternion();
  private readonly _scratchCross = new THREE.Vector3();
  private readonly _scratchForce = new THREE.Vector3();

  private swarmContacts = 0;
  private swarmSlowdown = 0;
  private lastEmittedContacts = -1;
  private lastEmittedSlowdown = -1;

  private readonly prevVelocity = new THREE.Vector3();
  private impactCooldown = 0;

  private overturnedTimer = 0;
  private stuckTimer = 0;

  private flashTimer = 0;
  private readonly chassisEmissiveOriginal: THREE.Color[] = [];
  /** One-shot: re-emit healthChanged on the first tick so systems that
   *  subscribed after our constructor still get the initial value. */
  private initialHealthEmitted = false;

  constructor(
    ctx: GameContext,
    world: WorldApi,
    blueprint: VehicleBlueprint,
    tuning: VehicleTuning,
    input: InputSource
  ) {
    this.ctx = ctx;
    this.tuning = tuning;
    this.input = input;

    const spawnXZ = {
      x: (world.bounds.minX + world.bounds.maxX) / 2,
      z: (world.bounds.minZ + world.bounds.maxZ) / 2,
    };
    this.build = buildVehicle(ctx, blueprint, spawnXZ, 0);
    this.root = this.build.root;
    this.body = this.build.body;
    this.turretMount = this.build.turretMount;

    this.baseMaxHealth = blueprint.components.reduce((sum, c) => sum + c.health, 0);
    this.lastMaxHealthBonus = ctx.state.modifiers.maxHealthBonus;
    this._maxHealth = this.baseMaxHealth + this.lastMaxHealthBonus;
    this._health = this._maxHealth;

    for (const mesh of this.build.chassisMeshes) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      this.chassisEmissiveOriginal.push(material.emissive.clone());
    }

    this.syncFromBody();
    this.prevVelocity.copy(this._velocity);

    ctx.events.on("ui:resetVehicle", () => this.performRecoveryPop());

    // Initial emit so the HUD health bar starts at the real max health
    // instead of a placeholder (maxHealth already includes the current
    // modifiers.maxHealthBonus computed above).
    ctx.events.emit("vehicle:healthChanged", {
      health: this._health,
      maxHealth: this._maxHealth,
    });
  }

  // ---------------------------------------------------------------------
  // VehicleApi
  // ---------------------------------------------------------------------

  get position(): THREE.Vector3 {
    return this._position;
  }

  get velocity(): THREE.Vector3 {
    return this._velocity;
  }

  get forward(): THREE.Vector3 {
    return this._forward;
  }

  get speed(): number {
    return this._velocity.length();
  }

  get health(): number {
    return this._health;
  }

  get maxHealth(): number {
    return this._maxHealth;
  }

  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  applyDamage(amount: number, source: DamageSource): void {
    if (this._isDestroyed || amount <= 0) return;
    const resistance = clamp01(this.ctx.state.modifiers.damageResistance);
    const effective = amount * (1 - resistance);
    if (effective <= 0) return;

    this._health = Math.max(0, this._health - effective);
    this.flashTimer = FLASH_DURATION;

    this.ctx.events.emit("vehicle:damaged", {
      amount: effective,
      health: this._health,
      maxHealth: this._maxHealth,
      source,
    });
    this.ctx.events.emit("vehicle:healthChanged", {
      health: this._health,
      maxHealth: this._maxHealth,
    });

    if (this._health <= 0 && !this._isDestroyed) {
      this._isDestroyed = true;
      this.drivingEnabled = false;
      this.ctx.events.emit("vehicle:destroyed", {});
    }
  }

  setSwarmContacts(contacts: number): void {
    this.swarmContacts = Math.max(0, contacts);
  }

  setDrivingEnabled(enabled: boolean): void {
    this.drivingEnabled = enabled;
  }

  reset(): void {
    const spawn = this.build.spawnPosition;
    this._scratchQuat.setFromAxisAngle(WORLD_UP, this.build.spawnYaw);

    this.body.setTranslation({ x: spawn.x, y: spawn.y, z: spawn.z }, true);
    this.body.setRotation(
      {
        x: this._scratchQuat.x,
        y: this._scratchQuat.y,
        z: this._scratchQuat.z,
        w: this._scratchQuat.w,
      },
      true
    );
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

    this.lastMaxHealthBonus = this.ctx.state.modifiers.maxHealthBonus;
    this._maxHealth = this.baseMaxHealth + this.lastMaxHealthBonus;
    this._health = this._maxHealth;
    this._isDestroyed = false;
    this.drivingEnabled = true;

    this.swarmContacts = 0;
    this.swarmSlowdown = 0;
    if (this.lastEmittedContacts !== 0 || this.lastEmittedSlowdown !== 0) {
      this.lastEmittedContacts = 0;
      this.lastEmittedSlowdown = 0;
      this.ctx.events.emit("swarm:changed", { contacts: 0, slowdown: 0, swarmed: false });
    }

    this.impactCooldown = 0;
    this.overturnedTimer = 0;
    this.stuckTimer = 0;
    this.flashTimer = 0;
    for (let i = 0; i < this.build.chassisMeshes.length; i++) {
      const material = this.build.chassisMeshes[i].material as THREE.MeshStandardMaterial;
      material.emissive.copy(this.chassisEmissiveOriginal[i]);
    }

    this.syncFromBody();
    this.prevVelocity.copy(this._velocity);

    this.ctx.events.emit("vehicle:healthChanged", {
      health: this._health,
      maxHealth: this._maxHealth,
    });
  }

  // ---------------------------------------------------------------------
  // GameSystem
  // ---------------------------------------------------------------------

  fixedUpdate(dt: number): void {
    if (dt <= 0) return;
    if (!this.initialHealthEmitted) {
      this.initialHealthEmitted = true;
      this.ctx.events.emit("vehicle:healthChanged", {
        health: this._health,
        maxHealth: this._maxHealth,
      });
    }
    this.syncFromBody();
    this.updateSwarm();
    this.updateHealthBonus();
    this.updateImpactDetection(dt);

    const inputState = this.input.getInput();
    this.updateRecovery(dt, inputState);
    this.applyDrivingForces(dt, inputState);
  }

  update(dt: number): void {
    this.syncFromBody();
    this.updateVisual(dt);
    this.updateFlash(dt);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private syncFromBody(): void {
    const t = this.body.translation();
    this._position.set(t.x, t.y, t.z);

    const v = this.body.linvel();
    this._velocity.set(v.x, v.y, v.z);

    const r = this.body.rotation();
    this._scratchQuat.set(r.x, r.y, r.z, r.w);
    this._forward.copy(LOCAL_FORWARD).applyQuaternion(this._scratchQuat);
    this._forward.y = 0;
    if (this._forward.lengthSq() > 1e-8) {
      this._forward.normalize();
    } else {
      this._forward.copy(LOCAL_FORWARD);
    }
  }

  private updateSwarm(): void {
    const modifiers = this.ctx.state.modifiers;
    const rawSlowdown =
      this.swarmContacts * this.tuning.zombieDragPerContact * modifiers.contactPenaltyMultiplier;
    const slowdown = clamp(rawSlowdown, 0, this.tuning.maximumZombieDrag);
    const swarmed = slowdown >= SWARMED_THRESHOLD * this.tuning.maximumZombieDrag;

    this.swarmSlowdown = slowdown;
    if (
      Math.abs(slowdown - this.lastEmittedSlowdown) > 1e-4 ||
      this.swarmContacts !== this.lastEmittedContacts
    ) {
      this.lastEmittedSlowdown = slowdown;
      this.lastEmittedContacts = this.swarmContacts;
      this.ctx.events.emit("swarm:changed", { contacts: this.swarmContacts, slowdown, swarmed });
    }
  }

  private updateHealthBonus(): void {
    const bonus = this.ctx.state.modifiers.maxHealthBonus;
    if (bonus === this.lastMaxHealthBonus) return;

    if (bonus > this.lastMaxHealthBonus) {
      const delta = bonus - this.lastMaxHealthBonus;
      this._health = Math.min(this._health + delta, this.baseMaxHealth + bonus);
    } else {
      this._health = Math.min(this._health, this.baseMaxHealth + bonus);
    }
    this.lastMaxHealthBonus = bonus;
    this._maxHealth = this.baseMaxHealth + bonus;
    this.ctx.events.emit("vehicle:healthChanged", {
      health: this._health,
      maxHealth: this._maxHealth,
    });
  }

  private updateImpactDetection(dt: number): void {
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);

    const deltaV = this._velocity.distanceTo(this.prevVelocity);
    if (!this._isDestroyed && this.impactCooldown <= 0 && deltaV > IMPACT_DAMAGE_MIN_SPEED) {
      const excess = deltaV - IMPACT_DAMAGE_MIN_SPEED;
      const damage = excess * this.tuning.collisionDamageMultiplier;
      this.applyDamage(damage, "collision");
      this.ctx.events.emit("impact:major", {
        intensity: clamp01(deltaV / IMPACT_SHAKE_REFERENCE),
      });
      this.impactCooldown = IMPACT_COOLDOWN_SECONDS;
    }

    this.prevVelocity.copy(this._velocity);
  }

  private updateRecovery(dt: number, inputState: VehicleInput): void {
    if (this._isDestroyed) {
      this.overturnedTimer = 0;
      this.stuckTimer = 0;
      return;
    }

    // Defensive: rotation is pitch/roll-locked in VehicleFactory so this
    // should never actually trip, but it keeps the API contract honest if
    // that ever changes.
    const r = this.body.rotation();
    this._scratchQuat.set(r.x, r.y, r.z, r.w);
    const up = this._scratchCross.set(0, 1, 0).applyQuaternion(this._scratchQuat);
    if (up.y < 0.3) {
      this.overturnedTimer += dt;
      if (this.overturnedTimer >= OVERTURNED_RECOVERY_SECONDS) {
        this.performRecoveryPop();
        this.overturnedTimer = 0;
      }
    } else {
      this.overturnedTimer = 0;
    }

    const nearlyStopped = this.speed < STUCK_SPEED_THRESHOLD;
    if (this.drivingEnabled && inputState.magnitude > STUCK_INPUT_THRESHOLD && nearlyStopped) {
      this.stuckTimer += dt;
      if (this.stuckTimer >= STUCK_RECOVERY_SECONDS) {
        this.performRecoveryPop();
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }
  }

  private performRecoveryPop(): void {
    const t = this.body.translation();
    this.body.setTranslation({ x: t.x, y: t.y + RECOVERY_POP_HEIGHT, z: t.z }, true);
    this.body.setLinvel({ x: 0, y: RECOVERY_POP_VELOCITY, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  private applyDrivingForces(dt: number, inputState: VehicleInput): void {
    const modifiers = this.ctx.state.modifiers;
    const swarmMultiplier = clamp01(1 - this.swarmSlowdown);
    const engineMultiplier = Math.max(0, modifiers.enginePowerMultiplier);

    const effectiveMaxForward =
      this.tuning.maximumForwardSpeed * engineMultiplier * swarmMultiplier;
    const effectiveMaxReverse =
      this.tuning.maximumReverseSpeed * engineMultiplier * swarmMultiplier;
    const effectiveAccel = this.tuning.acceleration * engineMultiplier * swarmMultiplier;
    const effectiveReverseAccel =
      this.tuning.reverseAcceleration * engineMultiplier * swarmMultiplier;
    const effectiveSteerRate = this.tuning.steeringStrength * swarmMultiplier;

    const mass = Math.max(this.body.mass(), 1);
    const driving = this.drivingEnabled && !this._isDestroyed;
    const magnitude = driving ? inputState.magnitude : 0;
    const direction = inputState.direction;

    const forward = this._forward;
    const velocity = this._velocity;
    const forwardSpeed = velocity.x * forward.x + velocity.z * forward.z;

    if (magnitude > INPUT_EPSILON) {
      const dot = clamp(forward.x * direction.x + forward.z * direction.z, -1, 1);
      this._scratchCross.copy(forward).cross(direction);
      const angleDiff = Math.atan2(this._scratchCross.y, dot);
      const angle = Math.acos(dot);
      const reversing = angle > REVERSE_ANGLE_THRESHOLD;

      // Steering: proportional yaw-rate controller, reduced at speed.
      const speedFactor = clamp01(
        Math.abs(forwardSpeed) / Math.max(this.tuning.maximumForwardSpeed, 0.001)
      );
      const steerRate = effectiveSteerRate * lerp(1, this.tuning.highSpeedSteeringMultiplier, speedFactor);
      const desiredYawRate =
        Math.sign(angleDiff) * Math.min(Math.abs(angleDiff) / Math.max(dt, 1e-4), steerRate);
      const angvel = this.body.angvel();
      this.body.setAngvel({ x: angvel.x, y: desiredYawRate, z: angvel.z }, true);

      // Forward/reverse acceleration, or braking if input opposes motion.
      // One-shot impulses (NOT addForce: Rapier user forces are persistent
      // and would accumulate across steps unless resetForces is called).
      const desiredSign = reversing ? -1 : 1;
      if (desiredSign * forwardSpeed < -BRAKE_ENGAGE_SPEED) {
        // Impulse magnitude clamped so braking never overshoots past zero.
        const brakeImpulseMag =
          Math.min(this.tuning.brakingForce * dt, Math.abs(forwardSpeed)) * mass;
        const brakeSign = -Math.sign(forwardSpeed);
        this._scratchForce.set(
          forward.x * brakeSign * brakeImpulseMag,
          0,
          forward.z * brakeSign * brakeImpulseMag
        );
        this.body.applyImpulse(this._scratchForce, true);
      } else {
        const accelRate = reversing ? effectiveReverseAccel : effectiveAccel;
        const impulseMag = accelRate * dt * mass * magnitude;
        this._scratchForce.set(
          forward.x * desiredSign * impulseMag,
          0,
          forward.z * desiredSign * impulseMag
        );
        this.body.applyImpulse(this._scratchForce, true);
      }
    } else {
      // No input: coast down via rolling resistance (impulse clamped so it
      // never reverses the direction of motion).
      const planarSpeed = Math.hypot(velocity.x, velocity.z);
      if (planarSpeed > 0.05) {
        const decelImpulseMag =
          Math.min(this.tuning.rollingResistance * dt, planarSpeed) * mass;
        const invSpeed = decelImpulseMag / planarSpeed;
        this._scratchForce.set(-velocity.x * invSpeed, 0, -velocity.z * invSpeed);
        this.body.applyImpulse(this._scratchForce, true);
      }
    }

    // Lateral slip + top-speed clamp. Impulses above already updated the
    // body's linvel, so RE-READ it here — clamping the stale pre-impulse
    // velocity would let speed creep past the cap by a*dt every step.
    const postImpulseVel = this.body.linvel();
    const rightX = forward.z;
    const rightZ = -forward.x;
    let vx = postImpulseVel.x;
    const vy = postImpulseVel.y;
    let vz = postImpulseVel.z;

    const lateralVel = vx * rightX + vz * rightZ;
    if (Math.abs(lateralVel) > 1e-4) {
      const removal = lateralVel * this.tuning.lateralGrip;
      vx -= rightX * removal;
      vz -= rightZ * removal;
    }

    const fwdComp = vx * forward.x + vz * forward.z;
    if (fwdComp > effectiveMaxForward) {
      const excess = fwdComp - effectiveMaxForward;
      vx -= forward.x * excess;
      vz -= forward.z * excess;
    } else if (fwdComp < -effectiveMaxReverse) {
      const excess = fwdComp + effectiveMaxReverse;
      vx -= forward.x * excess;
      vz -= forward.z * excess;
    }

    this.body.setLinvel({ x: vx, y: vy, z: vz }, true);
  }

  private updateVisual(dt: number): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.root.position.set(t.x, t.y, t.z);
    this.root.quaternion.set(r.x, r.y, r.z, r.w);

    const planarSpeed = Math.hypot(this._velocity.x, this._velocity.z);
    const movingForward = this._velocity.dot(this._forward) >= 0;
    const angvel = this.body.angvel();
    const steerAngle = clamp(
      angvel.y * WHEEL_STEER_VISUAL_SCALE,
      -MAX_WHEEL_STEER_ANGLE,
      MAX_WHEEL_STEER_ANGLE
    );

    for (const wheel of this.build.wheels) {
      const spinDelta =
        (planarSpeed / Math.max(wheel.radius, 0.05)) * (movingForward ? 1 : -1) * dt;
      wheel.mesh.rotation.x += spinDelta;
      if (wheel.isFront) {
        wheel.mesh.rotation.y = steerAngle;
      }
    }
  }

  private updateFlash(dt: number): void {
    if (this.flashTimer <= 0) return;
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    const t = this.flashTimer / FLASH_DURATION;
    for (let i = 0; i < this.build.chassisMeshes.length; i++) {
      const material = this.build.chassisMeshes[i].material as THREE.MeshStandardMaterial;
      material.emissive.copy(this.chassisEmissiveOriginal[i]).lerp(FLASH_COLOR, t);
    }
  }
}
