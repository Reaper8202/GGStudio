/**
 * One pooled zombie: a low-poly humanoid mesh (body + head + stub arms)
 * driven by a single dynamic Rapier capsule body with rotations locked
 * upright. State machine: Spawning -> Chasing -> Attacking / KnockedBack ->
 * Dead -> (pooled again).
 *
 * Movement: the capsule is moved by directly setting linear velocity on the
 * ground plane each fixedUpdate (gravity's Y velocity is preserved, never
 * overwritten) — see class docs on `ZombieSystem` for why (no contact
 * events; physical collision response with static geometry/vehicle/other
 * zombies still happens automatically via Rapier's solver every step).
 *
 * Visual facing/rotation is tracked independently of the physics body
 * (which never rotates) by writing directly to `root.rotation.y` — cheap
 * and avoids needing to sync a locked physics rotation back out.
 */
import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { GameContext, VehicleApi, WorldApi, ZombieTarget } from "../types";
import { ZombieState } from "../types";
import { CollisionGroups, Group, interactionGroups } from "../types/collision";
import type { EffectsSystem } from "../effects/EffectsSystem";
import {
  BASE_ZOMBIE_STATS as BASE_STATS,
  DEATH_FEEDBACK_DURATION,
  DETOUR_BLEND,
  DETOUR_DURATION,
  HIT_FLASH_DURATION,
  IMPACT_COOLDOWN_SECONDS,
  KNOCKBACK_DURATION,
  KNOCKBACK_SPEED,
  LUNGE_DISTANCE,
  LUNGE_DURATION,
  OBSTACLE_PROBE_DISTANCE,
  OBSTACLE_PROBE_HEIGHT,
  SCALE_VARIATION,
  SPAWN_RISE_DURATION,
  STUCK_SPEED_THRESHOLD,
  STUCK_TIME_THRESHOLD,
  WALK_BOB_AMPLITUDE,
  WALK_BOB_FREQUENCY,
  ZOMBIE_ATTACK_EXIT_MARGIN,
  ZOMBIE_ATTACK_RANGE,
  ZOMBIE_HALF_HEIGHT,
  ZOMBIE_RADIUS,
} from "../config/zombieConfig";

/** Ray-cast filter: only the world's static geometry blocks a chase path. */
const OBSTACLE_FILTER_GROUPS = interactionGroups(Group.Zombie, Group.Static);

const BODY_SIZE = { width: 0.5, height: 0.75, depth: 0.3 };
const HEAD_SIZE = 0.32;
const ARM_SIZE = { width: 0.14, height: 0.5, depth: 0.14 };
const BODY_LOCAL_Y = -0.05;
const HEAD_LOCAL_Y = BODY_LOCAL_Y + BODY_SIZE.height / 2 + HEAD_SIZE / 2;
const ARM_LOCAL_Y = BODY_LOCAL_Y + 0.05;

const BODY_TINTS = [0x4c6b3f, 0x5a7247, 0x3f5c48, 0x6b5a3f, 0x556b4c, 0x47614a];
const HEAD_TINT = 0x8a9a7a;
const HIT_FLASH_COLOR = new THREE.Color(0xffffff);

const bodyGeometry = new THREE.BoxGeometry(BODY_SIZE.width, BODY_SIZE.height, BODY_SIZE.depth);
const headGeometry = new THREE.BoxGeometry(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE);
const armGeometry = new THREE.BoxGeometry(ARM_SIZE.width, ARM_SIZE.height, ARM_SIZE.depth);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class Zombie implements ZombieTarget {
  readonly index: number;
  readonly root: THREE.Group;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  readonly position = new THREE.Vector3();
  state: ZombieState = ZombieState.Dead;
  active = false;

  private readonly ctx: GameContext;
  private readonly effects: EffectsSystem;

  private readonly bodyMesh: THREE.Mesh;
  private readonly headMesh: THREE.Mesh;
  private readonly bodyMaterial: THREE.MeshLambertMaterial;
  private readonly headMaterial: THREE.MeshLambertMaterial;
  private readonly bodyTint: THREE.Color;
  private readonly headTint: THREE.Color;
  private readonly baseScale: number;

  private health = 0;
  private moveSpeed = 0;
  private attackDamage = 0;
  private attackInterval = 0;
  private reward = 0;

  private spawnTimer = 0;
  private attackTimer = 0;
  private deathTimer = 0;
  private knockbackTimer = 0;
  private impactCooldown = 0;
  private detourTimer = 0;
  private detourSign: 1 | -1 = 1;
  private stuckTimer = 0;
  private lungeTimer = 0;
  private hitFlashTimer = 0;
  private bobPhase = 0;

  private readonly scratchToVehicle = new THREE.Vector3();
  private readonly scratchRayOrigin: RAPIER.Vector;
  private readonly scratchRayDir: RAPIER.Vector;
  private readonly scratchRay: RAPIER.Ray;

  constructor(ctx: GameContext, effects: EffectsSystem, index: number) {
    this.ctx = ctx;
    this.effects = effects;
    this.index = index;

    this.baseScale = 1 + (Math.random() - 0.5) * SCALE_VARIATION;

    this.bodyTint = new THREE.Color(BODY_TINTS[index % BODY_TINTS.length]).offsetHSL(
      0,
      0,
      (Math.random() - 0.5) * 0.08
    );
    this.headTint = new THREE.Color(HEAD_TINT).offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);

    this.bodyMaterial = new THREE.MeshLambertMaterial({
      color: this.bodyTint,
      flatShading: true,
      transparent: true,
    });
    this.headMaterial = new THREE.MeshLambertMaterial({
      color: this.headTint,
      flatShading: true,
      transparent: true,
    });
    const armMaterial = this.bodyMaterial;

    this.root = new THREE.Group();
    this.root.visible = false;

    this.bodyMesh = new THREE.Mesh(bodyGeometry, this.bodyMaterial);
    this.bodyMesh.position.y = BODY_LOCAL_Y;
    this.root.add(this.bodyMesh);

    this.headMesh = new THREE.Mesh(headGeometry, this.headMaterial);
    this.headMesh.position.y = HEAD_LOCAL_Y;
    this.root.add(this.headMesh);

    const armLeft = new THREE.Mesh(armGeometry, armMaterial);
    armLeft.position.set(-(BODY_SIZE.width / 2 + ARM_SIZE.width / 2), ARM_LOCAL_Y, 0);
    this.root.add(armLeft);

    const armRight = new THREE.Mesh(armGeometry, armMaterial);
    armRight.position.set(BODY_SIZE.width / 2 + ARM_SIZE.width / 2, ARM_LOCAL_Y, 0);
    this.root.add(armRight);

    ctx.scene.add(this.root);

    const bodyDesc = ctx.rapier.RigidBodyDesc.dynamic()
      .setTranslation(0, -50 - index, 0)
      .lockRotations()
      .setLinearDamping(1.2)
      // Never allowed to sleep: movement is velocity-driven every fixed
      // step, and a slept body silently ignoring those writes would freeze
      // the zombie in place permanently (and stall the wave).
      .setCanSleep(false)
      .setCcdEnabled(false);
    this.body = ctx.physics.createRigidBody(bodyDesc);

    const colliderDesc = ctx.rapier.ColliderDesc.capsule(ZOMBIE_HALF_HEIGHT, ZOMBIE_RADIUS)
      .setDensity(6)
      // Frictionless on purpose: chase steering re-sets a velocity INTO a
      // blocking wall every step, producing a large solver normal impulse
      // whose friction can fully cancel the tangential slide component —
      // pinning the zombie flat against the wall with zero net movement
      // (observed against the 0.8-tall SE ramp barriers). With zero
      // friction it always slides along obstacles instead.
      .setFriction(0)
      .setRestitution(0)
      .setCollisionGroups(CollisionGroups.zombie)
      .setEnabled(false);
    this.collider = ctx.physics.createCollider(colliderDesc, this.body);

    this.scratchRayOrigin = { x: 0, y: 0, z: 0 };
    this.scratchRayDir = { x: 0, y: 0, z: 0 };
    this.scratchRay = new ctx.rapier.Ray(this.scratchRayOrigin, this.scratchRayDir);
  }

  // ---------------------------------------------------------------------
  // ZombieTarget
  // ---------------------------------------------------------------------

  get isAlive(): boolean {
    return this.active && this.state !== ZombieState.Dead;
  }

  takeDamage(amount: number, direction?: THREE.Vector3): void {
    if (!this.active || this.state === ZombieState.Dead || this.state === ZombieState.Spawning) {
      return;
    }
    if (amount <= 0) return;
    this.health -= amount;
    this.hitFlashTimer = HIT_FLASH_DURATION;

    if (direction && (direction.x !== 0 || direction.z !== 0)) {
      const lv = this.body.linvel();
      const nx = direction.x;
      const nz = direction.z;
      const len = Math.hypot(nx, nz) || 1;
      const nudge = 1.5;
      this.body.setLinvel(
        { x: lv.x + (nx / len) * nudge, y: lv.y, z: lv.z + (nz / len) * nudge },
        true
      );
    }

    if (this.health <= 0) this.die();
  }

  // ---------------------------------------------------------------------
  // Lifecycle (driven by ZombieSystem)
  // ---------------------------------------------------------------------

  spawn(position: THREE.Vector3, healthMultiplier: number, speedMultiplier: number): void {
    this.active = true;
    this.state = ZombieState.Spawning;

    this.health = BASE_STATS.health * healthMultiplier;
    this.moveSpeed = BASE_STATS.speed * speedMultiplier;
    this.attackDamage = BASE_STATS.attackDamage;
    this.attackInterval = BASE_STATS.attackInterval;
    this.reward = BASE_STATS.reward;

    this.spawnTimer = SPAWN_RISE_DURATION;
    this.attackTimer = 0;
    this.deathTimer = 0;
    this.knockbackTimer = 0;
    this.impactCooldown = 0;
    this.detourTimer = 0;
    this.stuckTimer = 0;
    this.lungeTimer = 0;
    this.hitFlashTimer = 0;
    this.detourSign = Math.random() < 0.5 ? -1 : 1;
    this.bobPhase = Math.random() * Math.PI * 2;

    const y = ZOMBIE_HALF_HEIGHT + ZOMBIE_RADIUS;
    this.body.setTranslation({ x: position.x, y, z: position.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.collider.setEnabled(true);

    this.position.set(position.x, y, position.z);
    this.root.position.set(position.x, y, position.z);
    this.root.rotation.y = Math.random() * Math.PI * 2;
    this.root.visible = true;
    this.root.scale.setScalar(0.05);
    this.setOpacity(0.15);
  }

  /** Vehicle-side impact: speed-scaled damage + knockback away from the hit
   *  direction. No-op while spawning, dead, or on cooldown. */
  applyVehicleImpact(damage: number, dirX: number, dirZ: number): void {
    if (!this.active || this.state === ZombieState.Dead || this.state === ZombieState.Spawning) {
      return;
    }
    if (this.impactCooldown > 0) return;

    this.impactCooldown = IMPACT_COOLDOWN_SECONDS;
    this.health -= damage;
    this.state = ZombieState.KnockedBack;
    this.knockbackTimer = KNOCKBACK_DURATION;

    const lv = this.body.linvel();
    this.body.setLinvel({ x: dirX * KNOCKBACK_SPEED, y: lv.y, z: dirZ * KNOCKBACK_SPEED }, true);

    if (this.health <= 0) this.die();
  }

  private die(): void {
    this.state = ZombieState.Dead;
    this.deathTimer = DEATH_FEEDBACK_DURATION;

    const lv = this.body.linvel();
    this.body.setLinvel({ x: 0, y: lv.y, z: 0 }, true);
    // Stop interacting physically while the death animation plays (avoids
    // the vehicle/other zombies bumping a falling corpse).
    this.collider.setEnabled(false);

    this.ctx.events.emit("zombie:killed", {
      reward: this.reward,
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
    });
    this.ctx.events.emit("audio:play", { sound: "kill" });
    this.effects.spawnDeathPuff(this.position);
  }

  /** Failsafe relocation for a permanently geometry-trapped zombie (driven
   *  by `ZombieSystem`'s no-progress watchdog): moves the body to a fresh
   *  spawn point, KEEPING current health/stats, and clears the steering
   *  timers so it resumes a clean chase from the new position. */
  teleportTo(position: THREE.Vector3): void {
    if (!this.active || this.state === ZombieState.Dead) return;

    const y = ZOMBIE_HALF_HEIGHT + ZOMBIE_RADIUS;
    this.body.setTranslation({ x: position.x, y, z: position.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.position.set(position.x, y, position.z);
    this.root.position.set(position.x, y, position.z);

    this.state = ZombieState.Chasing;
    this.detourTimer = 0;
    this.stuckTimer = 0;
    this.knockbackTimer = 0;
  }

  /** Instant, animation-free return to pool (used by `ZombieSystem.reset`). */
  forceReturnToPool(): void {
    this.active = false;
    this.state = ZombieState.Dead;
    this.root.visible = false;
    this.collider.setEnabled(false);
    this.deathTimer = 0;
    this.impactCooldown = 0;
    const lv = this.body.linvel();
    this.body.setLinvel({ x: 0, y: lv.y, z: 0 }, true);
  }

  private returnToPool(): void {
    this.active = false;
    this.root.visible = false;
    this.collider.setEnabled(false);
  }

  // ---------------------------------------------------------------------
  // Physics-rate update (state machine, movement, attacks)
  // ---------------------------------------------------------------------

  fixedUpdate(
    dt: number,
    vehicle: VehicleApi,
    _world: WorldApi,
    separationX: number,
    separationZ: number
  ): void {
    if (!this.active) return;
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);

    switch (this.state) {
      case ZombieState.Spawning:
        this.spawnTimer -= dt;
        this.zeroHorizontalVelocity();
        if (this.spawnTimer <= 0) this.state = ZombieState.Chasing;
        break;
      case ZombieState.Chasing:
        this.stepChasing(dt, vehicle, separationX, separationZ);
        break;
      case ZombieState.Attacking:
        this.stepAttacking(dt, vehicle);
        break;
      case ZombieState.KnockedBack:
        this.knockbackTimer -= dt;
        if (this.knockbackTimer <= 0) this.state = ZombieState.Chasing;
        break;
      case ZombieState.Dead:
        this.zeroHorizontalVelocity();
        break;
    }

    this.syncPositionFromBody();
  }

  /** Called instead of `fixedUpdate` while the phase is not WaveActive:
   *  fully freezes movement/attacks without advancing any AI timers. */
  freeze(): void {
    if (!this.active) return;
    this.zeroHorizontalVelocity();
    this.syncPositionFromBody();
  }

  private stepChasing(
    dt: number,
    vehicle: VehicleApi,
    separationX: number,
    separationZ: number
  ): void {
    const toVehicle = this.scratchToVehicle.set(
      vehicle.position.x - this.position.x,
      0,
      vehicle.position.z - this.position.z
    );
    const dist = toVehicle.length();

    if (dist <= ZOMBIE_ATTACK_RANGE) {
      this.state = ZombieState.Attacking;
      this.attackTimer = this.attackInterval;
      this.zeroHorizontalVelocity();
      return;
    }

    toVehicle.multiplyScalar(1 / Math.max(dist, 1e-4));
    let dirX = toVehicle.x;
    let dirZ = toVehicle.z;

    const blocked = this.probeBlocked(dirX, dirZ);
    const speedAlongDir = this.currentSpeedAlong(dirX, dirZ);
    if (blocked) {
      this.detourTimer = DETOUR_DURATION;
    } else if (speedAlongDir < STUCK_SPEED_THRESHOLD) {
      this.stuckTimer += dt;
      if (this.stuckTimer > STUCK_TIME_THRESHOLD) {
        this.detourTimer = DETOUR_DURATION;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }

    if (this.detourTimer > 0) {
      this.detourTimer -= dt;
      const lateralX = -toVehicle.z * this.detourSign;
      const lateralZ = toVehicle.x * this.detourSign;
      dirX = toVehicle.x + lateralX * DETOUR_BLEND;
      dirZ = toVehicle.z + lateralZ * DETOUR_BLEND;
      const len = Math.hypot(dirX, dirZ) || 1;
      dirX /= len;
      dirZ /= len;
    }

    const vx = dirX * this.moveSpeed + separationX;
    const vz = dirZ * this.moveSpeed + separationZ;
    const lv = this.body.linvel();
    this.body.setLinvel({ x: vx, y: lv.y, z: vz }, true);

    this.updateFacing(vx, vz);
  }

  private stepAttacking(dt: number, vehicle: VehicleApi): void {
    this.zeroHorizontalVelocity();

    const dx = vehicle.position.x - this.position.x;
    const dz = vehicle.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist > ZOMBIE_ATTACK_RANGE + ZOMBIE_ATTACK_EXIT_MARGIN) {
      this.state = ZombieState.Chasing;
      return;
    }

    this.updateFacing(dx, dz);

    this.attackTimer -= dt;
    if (this.attackTimer <= 0) {
      this.attackTimer = this.attackInterval;
      vehicle.applyDamage(this.attackDamage, "zombie");
      this.lungeTimer = LUNGE_DURATION;
    }
  }

  /** Cheap forward probe against static geometry only. Cast at knee height
   *  (`OBSTACLE_PROBE_HEIGHT`), NOT capsule-center height, so low barriers
   *  the capsule still collides with are detected — see zombieConfig. */
  private probeBlocked(dirX: number, dirZ: number): boolean {
    const t = this.body.translation();
    this.scratchRayOrigin.x = t.x;
    this.scratchRayOrigin.y = OBSTACLE_PROBE_HEIGHT;
    this.scratchRayOrigin.z = t.z;
    this.scratchRayDir.x = dirX;
    this.scratchRayDir.y = 0;
    this.scratchRayDir.z = dirZ;
    this.scratchRay.origin = this.scratchRayOrigin;
    this.scratchRay.dir = this.scratchRayDir;

    const hit = this.ctx.physics.castRay(
      this.scratchRay,
      OBSTACLE_PROBE_DISTANCE,
      true,
      undefined,
      OBSTACLE_FILTER_GROUPS,
      this.collider
    );
    return hit !== null;
  }

  private currentSpeedAlong(dirX: number, dirZ: number): number {
    const lv = this.body.linvel();
    return lv.x * dirX + lv.z * dirZ;
  }

  private zeroHorizontalVelocity(): void {
    const lv = this.body.linvel();
    if (lv.x !== 0 || lv.z !== 0) this.body.setLinvel({ x: 0, y: lv.y, z: 0 }, true);
  }

  private updateFacing(dirX: number, dirZ: number): void {
    if (dirX === 0 && dirZ === 0) return;
    this.root.rotation.y = Math.atan2(dirX, dirZ);
  }

  private syncPositionFromBody(): void {
    const t = this.body.translation();
    this.position.set(t.x, t.y, t.z);
  }

  private setOpacity(opacity: number): void {
    this.bodyMaterial.opacity = opacity;
    this.headMaterial.opacity = opacity;
  }

  // ---------------------------------------------------------------------
  // Render-rate update (visuals + pool return; runs regardless of phase so
  // death animations/spawn fades always finish cleanly)
  // ---------------------------------------------------------------------

  update(dt: number): void {
    if (!this.active) return;

    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
      const t = this.hitFlashTimer / HIT_FLASH_DURATION;
      this.bodyMaterial.emissive.copy(HIT_FLASH_COLOR).multiplyScalar(t * 0.6);
      this.headMaterial.emissive.copy(HIT_FLASH_COLOR).multiplyScalar(t * 0.6);
    } else if (this.bodyMaterial.emissive.r !== 0 || this.bodyMaterial.emissive.g !== 0) {
      this.bodyMaterial.emissive.setScalar(0);
      this.headMaterial.emissive.setScalar(0);
    }
    if (this.lungeTimer > 0) this.lungeTimer = Math.max(0, this.lungeTimer - dt);

    switch (this.state) {
      case ZombieState.Spawning: {
        const t = clamp(1 - this.spawnTimer / SPAWN_RISE_DURATION, 0, 1);
        this.root.scale.setScalar(THREE.MathUtils.lerp(0.05, this.baseScale, t));
        this.setOpacity(THREE.MathUtils.lerp(0.15, 1, t));
        this.bodyMesh.position.y = BODY_LOCAL_Y;
        break;
      }
      case ZombieState.Chasing:
      case ZombieState.Attacking:
      case ZombieState.KnockedBack: {
        this.root.scale.setScalar(this.baseScale);
        this.setOpacity(1);
        if (this.state === ZombieState.Chasing) {
          this.bobPhase += dt * WALK_BOB_FREQUENCY;
          this.bodyMesh.position.y = BODY_LOCAL_Y + Math.sin(this.bobPhase) * WALK_BOB_AMPLITUDE;
        } else {
          this.bodyMesh.position.y = BODY_LOCAL_Y;
        }
        if (this.lungeTimer > 0) {
          const p = this.lungeTimer / LUNGE_DURATION;
          this.bodyMesh.position.z = -Math.sin(p * Math.PI) * LUNGE_DISTANCE;
        } else {
          this.bodyMesh.position.z = 0;
        }
        break;
      }
      case ZombieState.Dead: {
        this.deathTimer = Math.max(0, this.deathTimer - dt);
        const t = this.deathTimer / DEATH_FEEDBACK_DURATION;
        this.root.scale.setScalar(Math.max(this.baseScale * t, 0.001));
        this.root.rotation.x = (1 - t) * (Math.PI / 2) * 0.7;
        if (this.deathTimer <= 0) this.returnToPool();
        break;
      }
    }

    const t = this.body.translation();
    this.root.position.set(t.x, t.y, t.z);
  }
}
