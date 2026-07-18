import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  GROUP_TERRAIN,
  GROUP_VEHICLE,
  GROUP_ZOMBIE,
} from '../../runtime/assembler.ts';
import type { RuntimeVehicle } from '../../runtime/vehicle.ts';
import { instantiateVoxelAsset } from '../VoxelAssetLoader.ts';
import {
  BASE_ZOMBIE_STATS,
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
  THROWER_ATTACK_EXIT_MARGIN,
  THROWER_ATTACK_INTERVAL,
  THROWER_ATTACK_RANGE,
  THROWER_HEALTH_MULTIPLIER,
  THROWER_POOL_STRIDE,
  THROWER_REWARD,
  THROWER_SPEED_MULTIPLIER,
  THROWER_VISUAL_HEIGHT,
  WALK_BOB_AMPLITUDE,
  WALK_BOB_FREQUENCY,
  ZOMBIE_ATTACK_EXIT_MARGIN,
  ZOMBIE_ATTACK_RANGE,
  ZOMBIE_HALF_HEIGHT,
  ZOMBIE_RADIUS,
} from './zombieConfig.ts';

const ZOMBIE_GROUPS =
  (GROUP_ZOMBIE << 16) | (GROUP_TERRAIN | GROUP_VEHICLE | GROUP_ZOMBIE);
const ZOMBIE_ASSET_ROOT = `${import.meta.env.BASE_URL}assets/zombies`;
const OBSTACLE_FILTER_GROUPS = (GROUP_ZOMBIE << 16) | GROUP_TERRAIN;
const BASE_EMISSIVE = 0.25;
const HIT_FLASH_COLOR = new THREE.Color(0xffffff);
const BASE_VISUAL_SCALE = 1.85;
const BODY_TINTS = [0x4c6b3f, 0x5a7247, 0x3f5c48, 0x6b5a3f, 0x556b4c, 0x47614a];
const warnedVisualVariants = new Set<number>();

export interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Reused target storage, filled by ZombieSystem once per fixed step. */
export interface NearestVehiclePart {
  partId: string | null;
  x: number;
  y: number;
  z: number;
  distance: number;
}

export enum ZombieState {
  Spawning = 'Spawning',
  Chasing = 'Chasing',
  Attacking = 'Attacking',
  KnockedBack = 'KnockedBack',
  Dead = 'Dead',
}

export type ZombieKilledCallback = (reward: number, zombie: Zombie) => void;

export type ZombieKind = 'walker' | 'thrower';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** One persistent pooled zombie body, collider, visual, and AI state machine. */
export class Zombie {
  readonly root = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly vehicleTarget: NearestVehiclePart = {
    partId: null,
    x: 0,
    y: 0,
    z: 0,
    distance: Infinity,
  };

  state = ZombieState.Dead;
  active = false;
  /** Set by ZombieSystem; fired when a thrower's attack timer elapses. */
  onThrow: ((zombie: Zombie) => void) | null = null;
  readonly kind: ZombieKind;

  private readonly visualRoot = new THREE.Group();
  private readonly fallbackMaterial: THREE.MeshLambertMaterial;
  private readonly loadedMaterials: THREE.MeshLambertMaterial[] = [];
  private readonly visualMaterials: THREE.MeshLambertMaterial[] = [];
  private readonly baseScale: number;
  private readonly rayOrigin = { x: 0, y: 0, z: 0 };
  private readonly rayDirection = { x: 0, y: 0, z: 0 };
  private readonly ray: RAPIER.Ray;
  private readonly velocityScratch = { x: 0, y: 0, z: 0 };
  private readonly impulseScratch = { x: 0, y: 0, z: 0 };
  private readonly translationScratch = { x: 0, y: 0, z: 0 };

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
  private visualOpacity = 1;
  private disposed = false;

  constructor(
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    readonly index: number,
    fallbackGeometry: THREE.CapsuleGeometry,
    private readonly onKilled: ZombieKilledCallback,
  ) {
    this.kind =
      index % THROWER_POOL_STRIDE === THROWER_POOL_STRIDE - 1
        ? 'thrower'
        : 'walker';
    this.baseScale =
      BASE_VISUAL_SCALE + (Math.random() - 0.5) * SCALE_VARIATION;
    const tint = new THREE.Color(
      BODY_TINTS[index % BODY_TINTS.length],
    ).offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
    this.fallbackMaterial = new THREE.MeshLambertMaterial({
      color: tint,
      emissive: new THREE.Color().setScalar(BASE_EMISSIVE),
      flatShading: true,
      transparent: true,
    });
    this.visualMaterials.push(this.fallbackMaterial);

    const fallback = new THREE.Mesh(fallbackGeometry, this.fallbackMaterial);
    fallback.scale.setScalar(1 / BASE_VISUAL_SCALE);
    fallback.castShadow = true;
    fallback.receiveShadow = true;
    this.visualRoot.add(fallback);
    this.root.add(this.visualRoot);
    this.root.visible = false;
    this.scene.add(this.root);

    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, -50 - index, 0)
        .lockRotations()
        .setLinearDamping(1.2)
        .setCanSleep(false)
        .setCcdEnabled(false),
    );
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(ZOMBIE_HALF_HEIGHT, ZOMBIE_RADIUS)
        .setDensity(6)
        .setFriction(0)
        .setRestitution(0)
        .setCollisionGroups(ZOMBIE_GROUPS)
        .setEnabled(false),
      this.body,
    );

    this.ray = new RAPIER.Ray(this.rayOrigin, this.rayDirection);
    this.loadVoxelVisual();
  }

  get isAlive(): boolean {
    return this.active && this.state !== ZombieState.Dead;
  }

  get isTargetable(): boolean {
    return this.isAlive && this.state !== ZombieState.Spawning;
  }

  /** Apply a weapon hit. Returns true only when this hit kills the zombie. */
  takeDamage(amount: number, direction?: Vector3Like): boolean {
    if (!this.isTargetable || amount <= 0) return false;

    this.health -= amount;
    this.hitFlashTimer = HIT_FLASH_DURATION;
    if (direction && (direction.x !== 0 || direction.z !== 0)) {
      const length = Math.hypot(direction.x, direction.z) || 1;
      const velocity = this.body.linvel();
      this.velocityScratch.x = velocity.x + (direction.x / length) * 1.5;
      this.velocityScratch.y = velocity.y;
      this.velocityScratch.z = velocity.z + (direction.z / length) * 1.5;
      this.body.setLinvel(this.velocityScratch, true);
    }

    if (this.health > 0) return false;
    this.die();
    return true;
  }

  spawn(
    position: Vector3Like,
    healthMultiplier: number,
    speedMultiplier: number,
  ): void {
    if (this.disposed) return;
    this.active = true;
    this.state = ZombieState.Spawning;
    const thrower = this.kind === 'thrower';
    this.health =
      BASE_ZOMBIE_STATS.health *
      healthMultiplier *
      (thrower ? THROWER_HEALTH_MULTIPLIER : 1);
    this.moveSpeed =
      BASE_ZOMBIE_STATS.speed *
      speedMultiplier *
      (thrower ? THROWER_SPEED_MULTIPLIER : 1);
    this.attackDamage = BASE_ZOMBIE_STATS.attackDamage;
    this.attackInterval = thrower
      ? THROWER_ATTACK_INTERVAL
      : BASE_ZOMBIE_STATS.attackInterval;
    this.reward = thrower ? THROWER_REWARD : BASE_ZOMBIE_STATS.reward;

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
    this.translationScratch.x = position.x;
    this.translationScratch.y = y;
    this.translationScratch.z = position.z;
    this.body.setTranslation(this.translationScratch, true);
    this.velocityScratch.x = 0;
    this.velocityScratch.y = 0;
    this.velocityScratch.z = 0;
    this.body.setLinvel(this.velocityScratch, true);
    this.body.setAngvel(this.velocityScratch, true);
    this.collider.setEnabled(true);

    this.position.set(position.x, y, position.z);
    this.root.position.copy(this.position);
    this.root.rotation.set(0, Math.random() * Math.PI * 2, 0);
    this.root.scale.setScalar(0.05);
    this.visualRoot.position.set(0, 0, 0);
    this.root.visible = true;
    this.setOpacity(0.15);
  }

  /** Apply speed-scaled vehicle damage and a real Rapier knockback impulse. */
  applyVehicleImpact(damage: number, dirX: number, dirZ: number): boolean {
    if (!this.isTargetable || damage <= 0 || this.impactCooldown > 0)
      return false;

    this.impactCooldown = IMPACT_COOLDOWN_SECONDS;
    this.health -= damage;
    this.state = ZombieState.KnockedBack;
    this.knockbackTimer = KNOCKBACK_DURATION;

    const length = Math.hypot(dirX, dirZ) || 1;
    const impulseMagnitude = this.body.mass() * KNOCKBACK_SPEED;
    this.impulseScratch.x = (dirX / length) * impulseMagnitude;
    this.impulseScratch.y = 0;
    this.impulseScratch.z = (dirZ / length) * impulseMagnitude;
    this.body.applyImpulse(this.impulseScratch, true);

    if (this.health > 0) return false;
    this.die();
    return true;
  }

  fixedUpdate(
    dt: number,
    vehicle: RuntimeVehicle,
    separationX: number,
    separationZ: number,
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
        this.stepChasing(dt, separationX, separationZ);
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

  freeze(): void {
    if (!this.active) return;
    this.zeroHorizontalVelocity();
    this.syncPositionFromBody();
  }

  teleportTo(position: Vector3Like): void {
    if (!this.isAlive) return;
    const y = ZOMBIE_HALF_HEIGHT + ZOMBIE_RADIUS;
    this.translationScratch.x = position.x;
    this.translationScratch.y = y;
    this.translationScratch.z = position.z;
    this.body.setTranslation(this.translationScratch, true);
    this.velocityScratch.x = 0;
    this.velocityScratch.y = 0;
    this.velocityScratch.z = 0;
    this.body.setLinvel(this.velocityScratch, true);
    this.position.set(position.x, y, position.z);
    this.root.position.copy(this.position);
    this.state = ZombieState.Chasing;
    this.detourTimer = 0;
    this.stuckTimer = 0;
    this.knockbackTimer = 0;
  }

  /** Debug-only kill that deliberately bypasses spawning invulnerability. */
  forceKill(): boolean {
    if (!this.isAlive) return false;
    this.health = 0;
    this.die();
    return true;
  }

  forceReturnToPool(): void {
    if (this.disposed) return;
    this.active = false;
    this.state = ZombieState.Dead;
    this.root.visible = false;
    this.collider.setEnabled(false);
    this.deathTimer = 0;
    this.impactCooldown = 0;
    this.parkBody();
  }

  updateVisuals(dt: number): void {
    if (!this.active) return;

    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
      const amount =
        BASE_EMISSIVE + (this.hitFlashTimer / HIT_FLASH_DURATION) * 0.75;
      for (const material of this.visualMaterials) {
        material.emissive.copy(HIT_FLASH_COLOR).multiplyScalar(amount);
      }
    } else {
      for (const material of this.visualMaterials)
        material.emissive.setScalar(BASE_EMISSIVE);
    }

    this.lungeTimer = Math.max(0, this.lungeTimer - dt);
    switch (this.state) {
      case ZombieState.Spawning: {
        const progress = clamp(1 - this.spawnTimer / SPAWN_RISE_DURATION, 0, 1);
        this.root.scale.setScalar(
          THREE.MathUtils.lerp(0.05, this.baseScale, progress),
        );
        this.setOpacity(THREE.MathUtils.lerp(0.15, 1, progress));
        this.visualRoot.position.set(0, 0, 0);
        break;
      }
      case ZombieState.Chasing:
      case ZombieState.Attacking:
      case ZombieState.KnockedBack:
        this.root.scale.setScalar(this.baseScale);
        this.setOpacity(1);
        if (this.state === ZombieState.Chasing) {
          this.bobPhase += dt * WALK_BOB_FREQUENCY;
          this.visualRoot.position.y =
            Math.sin(this.bobPhase) * WALK_BOB_AMPLITUDE;
        } else {
          this.visualRoot.position.y = 0;
        }
        this.visualRoot.position.x = 0;
        this.visualRoot.position.z =
          this.lungeTimer > 0
            ? -Math.sin((this.lungeTimer / LUNGE_DURATION) * Math.PI) *
              LUNGE_DISTANCE
            : 0;
        break;
      case ZombieState.Dead: {
        this.deathTimer = Math.max(0, this.deathTimer - dt);
        const remaining = this.deathTimer / DEATH_FEEDBACK_DURATION;
        this.root.scale.setScalar(Math.max(this.baseScale * remaining, 0.001));
        this.root.rotation.x = (1 - remaining) * (Math.PI / 2) * 0.7;
        if (this.deathTimer <= 0) this.returnToPool();
        break;
      }
    }

    const translation = this.body.translation();
    this.root.position.set(translation.x, translation.y, translation.z);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.root);
    this.world.removeRigidBody(this.body);
    this.fallbackMaterial.dispose();
    for (const material of this.loadedMaterials) material.dispose();
    this.loadedMaterials.length = 0;
    this.visualMaterials.length = 0;
    this.visualRoot.clear();
    this.root.clear();
  }

  private stepChasing(
    dt: number,
    separationX: number,
    separationZ: number,
  ): void {
    const target = this.vehicleTarget;
    if (target.partId === null) {
      this.zeroHorizontalVelocity();
      return;
    }

    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const horizontalDistance = Math.hypot(dx, dz);
    const attackRange =
      this.kind === 'thrower' ? THROWER_ATTACK_RANGE : ZOMBIE_ATTACK_RANGE;
    if (target.distance <= attackRange) {
      this.state = ZombieState.Attacking;
      // Throwers wind up quickly on arrival instead of a full idle interval.
      this.attackTimer =
        this.kind === 'thrower'
          ? this.attackInterval * 0.5
          : this.attackInterval;
      this.zeroHorizontalVelocity();
      return;
    }
    if (horizontalDistance < 1e-4) {
      this.zeroHorizontalVelocity();
      return;
    }

    const targetDirX = dx / horizontalDistance;
    const targetDirZ = dz / horizontalDistance;
    let dirX = targetDirX;
    let dirZ = targetDirZ;
    const blocked = this.probeBlocked(dirX, dirZ);
    const speedAlongDirection = this.currentSpeedAlong(dirX, dirZ);
    if (blocked) {
      this.detourTimer = DETOUR_DURATION;
    } else if (speedAlongDirection < STUCK_SPEED_THRESHOLD) {
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
      dirX = targetDirX - targetDirZ * this.detourSign * DETOUR_BLEND;
      dirZ = targetDirZ + targetDirX * this.detourSign * DETOUR_BLEND;
      const detourLength = Math.hypot(dirX, dirZ) || 1;
      dirX /= detourLength;
      dirZ /= detourLength;
    }

    const velocity = this.body.linvel();
    this.velocityScratch.x = dirX * this.moveSpeed + separationX;
    this.velocityScratch.y = velocity.y;
    this.velocityScratch.z = dirZ * this.moveSpeed + separationZ;
    this.body.setLinvel(this.velocityScratch, true);
    this.updateFacing(this.velocityScratch.x, this.velocityScratch.z);
  }

  private stepAttacking(dt: number, vehicle: RuntimeVehicle): void {
    this.zeroHorizontalVelocity();
    const target = this.vehicleTarget;
    const exitRange =
      this.kind === 'thrower'
        ? THROWER_ATTACK_RANGE + THROWER_ATTACK_EXIT_MARGIN
        : ZOMBIE_ATTACK_RANGE + ZOMBIE_ATTACK_EXIT_MARGIN;
    if (target.partId === null || target.distance > exitRange) {
      this.state = ZombieState.Chasing;
      return;
    }

    this.updateFacing(target.x - this.position.x, target.z - this.position.z);
    this.attackTimer -= dt;
    if (this.attackTimer <= 0) {
      this.attackTimer = this.attackInterval;
      if (this.kind === 'thrower') {
        this.onThrow?.(this);
      } else {
        vehicle.applyDirectDamage(target.partId, this.attackDamage);
      }
      this.lungeTimer = LUNGE_DURATION;
    }
  }

  private probeBlocked(dirX: number, dirZ: number): boolean {
    const translation = this.body.translation();
    this.rayOrigin.x = translation.x;
    this.rayOrigin.y = OBSTACLE_PROBE_HEIGHT;
    this.rayOrigin.z = translation.z;
    this.rayDirection.x = dirX;
    this.rayDirection.y = 0;
    this.rayDirection.z = dirZ;
    this.ray.origin = this.rayOrigin;
    this.ray.dir = this.rayDirection;
    return (
      this.world.castRay(
        this.ray,
        OBSTACLE_PROBE_DISTANCE,
        true,
        undefined,
        OBSTACLE_FILTER_GROUPS,
        this.collider,
      ) !== null
    );
  }

  private currentSpeedAlong(dirX: number, dirZ: number): number {
    const velocity = this.body.linvel();
    return velocity.x * dirX + velocity.z * dirZ;
  }

  private zeroHorizontalVelocity(): void {
    const velocity = this.body.linvel();
    if (velocity.x === 0 && velocity.z === 0) return;
    this.velocityScratch.x = 0;
    this.velocityScratch.y = velocity.y;
    this.velocityScratch.z = 0;
    this.body.setLinvel(this.velocityScratch, true);
  }

  private syncPositionFromBody(): void {
    const translation = this.body.translation();
    this.position.set(translation.x, translation.y, translation.z);
  }

  private updateFacing(dirX: number, dirZ: number): void {
    if (dirX !== 0 || dirZ !== 0) this.root.rotation.y = Math.atan2(dirX, dirZ);
  }

  private die(): void {
    if (this.state === ZombieState.Dead) return;
    this.state = ZombieState.Dead;
    this.deathTimer = DEATH_FEEDBACK_DURATION;
    const velocity = this.body.linvel();
    this.velocityScratch.x = 0;
    this.velocityScratch.y = velocity.y;
    this.velocityScratch.z = 0;
    this.body.setLinvel(this.velocityScratch, true);
    this.collider.setEnabled(false);
    this.onKilled(this.reward, this);
  }

  private returnToPool(): void {
    this.active = false;
    this.root.visible = false;
    this.collider.setEnabled(false);
    this.parkBody();
  }

  private parkBody(): void {
    this.translationScratch.x = 0;
    this.translationScratch.y = -50 - this.index;
    this.translationScratch.z = 0;
    this.body.setTranslation(this.translationScratch, false);
    this.velocityScratch.x = 0;
    this.velocityScratch.y = 0;
    this.velocityScratch.z = 0;
    this.body.setLinvel(this.velocityScratch, false);
    this.body.setAngvel(this.velocityScratch, false);
  }

  private setOpacity(opacity: number): void {
    if (Math.abs(opacity - this.visualOpacity) < 1e-4) return;
    this.visualOpacity = opacity;
    for (const material of this.visualMaterials) {
      material.transparent = true;
      material.opacity = opacity;
    }
  }

  private loadVoxelVisual(): void {
    const thrower = this.kind === 'thrower';
    const variant = thrower ? 0 : (this.index % 6) + 1;
    const url = thrower
      ? `${ZOMBIE_ASSET_ROOT}/zombie_city`
      : `${ZOMBIE_ASSET_ROOT}/Zed_${variant}`;
    void instantiateVoxelAsset(url, true)
      .then((model) => {
        if (this.disposed) {
          disposeModelMaterials(model);
          return;
        }
        if (thrower) {
          // The thrower model's voxel grid differs from the Zed exports;
          // scale by bounds to match the walkers' world height.
          const bounds = new THREE.Box3().setFromObject(model);
          const height = Math.max(1e-3, bounds.max.y - bounds.min.y);
          model.scale.setScalar(THROWER_VISUAL_HEIGHT / height);
        } else {
          model.scale.setScalar(0.23);
        }
        model.position.y = -(ZOMBIE_HALF_HEIGHT + ZOMBIE_RADIUS);
        this.loadedMaterials.length = 0;
        model.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];
          for (const material of materials) {
            if (!(material instanceof THREE.MeshLambertMaterial)) continue;
            material.emissiveMap = material.map;
            material.emissive.setScalar(BASE_EMISSIVE);
            material.needsUpdate = true;
            this.loadedMaterials.push(material);
          }
        });
        this.visualRoot.clear();
        this.visualRoot.add(model);
        this.visualMaterials.length = 0;
        this.visualMaterials.push(...this.loadedMaterials);
        const opacity = this.visualOpacity;
        this.visualOpacity = -1;
        this.setOpacity(opacity);
      })
      .catch((error: unknown) => {
        if (warnedVisualVariants.has(variant)) return;
        warnedVisualVariants.add(variant);
        console.warn(
          `Zombie voxel variant ${variant} unavailable; using capsule fallback.`,
          error,
        );
      });
  }
}

function disposeModelMaterials(model: THREE.Object3D): void {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) material.dispose();
  });
}
