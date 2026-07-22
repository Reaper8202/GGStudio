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
  PHONE_ADDICT_GLOW_OPACITY,
  PHONE_ADDICT_GLOW_RADIUS,
  PHONE_ADDICT_HEALTH_MULTIPLIER,
  PHONE_ADDICT_REWARD,
  PHONE_ADDICT_SPEED_MULTIPLIER,
  PHONE_ADDICT_VISUAL_HEIGHT,
  SCALE_VARIATION,
  SHIELD_FLASH_DURATION,
  SHIELD_FLASH_MAX_OPACITY,
  SHIELD_RADIUS,
  SPAWN_RISE_DURATION,
  STUCK_SPEED_THRESHOLD,
  STUCK_TIME_THRESHOLD,
  THROWER_ATTACK_EXIT_MARGIN,
  THROWER_ATTACK_INTERVAL,
  THROWER_ATTACK_RANGE,
  THROWER_HEALTH_MULTIPLIER,
  THROWER_REWARD,
  THROWER_SPEED_MULTIPLIER,
  THROWER_VISUAL_HEIGHT,
  WALK_BOB_AMPLITUDE,
  WALK_BOB_FREQUENCY,
  WORKER_HEALTH_MULTIPLIER,
  WORKER_PLANT_RANGE,
  WORKER_PLANT_SECONDS,
  WORKER_RETREAT_RANGE,
  WORKER_RING_MAX_RADIUS,
  WORKER_RING_MAX_RATE,
  WORKER_RING_MIN_RATE,
  WORKER_RING_OPACITY,
  WORKER_REWARD,
  WORKER_SPEED_MULTIPLIER,
  WORKER_VISUAL_HEIGHT,
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

/** Shared soft radial gradients for kind-marking ground glows, cached per palette. */
const glowTextures = new Map<string, THREE.CanvasTexture>();
function getGlowTexture(
  inner: string,
  mid: string,
  outer: string,
): THREE.CanvasTexture {
  const key = `${inner}|${mid}|${outer}`;
  const cached = glowTextures.get(key);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.55, mid);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  glowTextures.set(key, texture);
  return texture;
}

/** Red halo for the shielded phone addict. */
function getAddictGlowTexture(): THREE.CanvasTexture {
  return getGlowTexture(
    'rgba(255, 10, 10, 0.95)',
    'rgba(215, 0, 0, 0.45)',
    'rgba(140, 0, 0, 0)',
  );
}

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
  /** Worker only: standing still while arming the next landmine. */
  Planting = 'Planting',
  KnockedBack = 'KnockedBack',
  Dead = 'Dead',
}

export type ZombieKilledCallback = (reward: number, kind: ZombieKind) => void;

export type ZombieKind = 'walker' | 'thrower' | 'phone-addict' | 'worker';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Per-kind stat multipliers over BASE_ZOMBIE_STATS, plus flat rewards. */
const KIND_STATS: Record<
  ZombieKind,
  {
    readonly health: number;
    readonly speed: number;
    readonly reward: number;
    readonly attackInterval: number;
  }
> = {
  walker: {
    health: 1,
    speed: 1,
    reward: BASE_ZOMBIE_STATS.reward,
    attackInterval: BASE_ZOMBIE_STATS.attackInterval,
  },
  thrower: {
    health: THROWER_HEALTH_MULTIPLIER,
    speed: THROWER_SPEED_MULTIPLIER,
    reward: THROWER_REWARD,
    attackInterval: THROWER_ATTACK_INTERVAL,
  },
  'phone-addict': {
    health: PHONE_ADDICT_HEALTH_MULTIPLIER,
    speed: PHONE_ADDICT_SPEED_MULTIPLIER,
    reward: PHONE_ADDICT_REWARD,
    attackInterval: BASE_ZOMBIE_STATS.attackInterval,
  },
  // Workers never attack; the interval is inert but kept sane.
  worker: {
    health: WORKER_HEALTH_MULTIPLIER,
    speed: WORKER_SPEED_MULTIPLIER,
    reward: WORKER_REWARD,
    attackInterval: BASE_ZOMBIE_STATS.attackInterval,
  },
};

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
  /** Set by ZombieSystem; fired when a worker's mine-plant timer elapses. */
  onPlantMine: ((zombie: Zombie) => void) | null = null;
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

  private shieldMesh: THREE.Mesh | null = null;
  private shieldMaterial: THREE.MeshBasicMaterial | null = null;
  private shieldTimer = 0;
  private glowMesh: THREE.Mesh | null = null;
  private ringMesh: THREE.Mesh | null = null;
  private ringMaterial: THREE.MeshBasicMaterial | null = null;
  private ringPhase = 0;
  private plantTimer = 0;

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
  /** Worker only: backing off after a plant until it may arm again. */
  private retreating = false;
  private lungeTimer = 0;
  private hitFlashTimer = 0;
  private bobPhase = 0;
  private visualOpacity = 1;
  private disposed = false;

  constructor(
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    readonly index: number,
    kind: ZombieKind,
    fallbackGeometry: THREE.CapsuleGeometry,
    private readonly onKilled: ZombieKilledCallback,
  ) {
    this.kind = kind;
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
    if (this.kind === 'phone-addict') {
      // Cyan bubble flash distinguishes the shield response from the red
      // always-on ground marker for this zombie kind.
      this.shieldMaterial = new THREE.MeshBasicMaterial({
        color: 0x35d7ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      this.shieldMesh = new THREE.Mesh(
        new THREE.SphereGeometry(SHIELD_RADIUS / BASE_VISUAL_SCALE, 20, 14),
        this.shieldMaterial,
      );
      this.shieldMesh.visible = false;
      this.root.add(this.shieldMesh);

      // Always-on red glow disc at the feet, marking the shielded zombie.
      const glowSize = (PHONE_ADDICT_GLOW_RADIUS * 2) / BASE_VISUAL_SCALE;
      this.glowMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(glowSize, glowSize),
        new THREE.MeshBasicMaterial({
          map: getAddictGlowTexture(),
          transparent: true,
          opacity: PHONE_ADDICT_GLOW_OPACITY,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      this.glowMesh.rotation.x = -Math.PI / 2;
      // World height is pinned just above the ground each visual update;
      // the root's animated scale would otherwise bury a fixed local offset.
      this.root.add(this.glowMesh);
    }
    if (this.kind === 'worker') {
      // Arming telegraph: a flat ring that repeatedly expands from the worker
      // while a mine is being planted, pulsing faster near completion.
      this.ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xffb428,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.ringMesh = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1, 32),
        this.ringMaterial,
      );
      this.ringMesh.rotation.x = -Math.PI / 2;
      this.ringMesh.visible = false;
      this.root.add(this.ringMesh);
    }
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

  /** Current hit points, for target-priority weapons that seek the toughest foe. */
  get currentHealth(): number {
    return this.health;
  }

  /** A projectile bounced off this zombie's shield: flash the bubble. */
  flashShield(): void {
    if (!this.isTargetable) return;
    this.shieldTimer = SHIELD_FLASH_DURATION;
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
    attackDamageMultiplier: number,
  ): void {
    if (this.disposed) return;
    this.active = true;
    this.state = ZombieState.Spawning;
    const stats = KIND_STATS[this.kind];
    this.health = BASE_ZOMBIE_STATS.health * healthMultiplier * stats.health;
    this.moveSpeed = BASE_ZOMBIE_STATS.speed * speedMultiplier * stats.speed;
    this.attackDamage = BASE_ZOMBIE_STATS.attackDamage * attackDamageMultiplier;
    this.attackInterval = stats.attackInterval;
    this.reward = stats.reward;
    this.shieldTimer = 0;
    if (this.shieldMesh) this.shieldMesh.visible = false;

    this.spawnTimer = SPAWN_RISE_DURATION;
    this.attackTimer = 0;
    this.deathTimer = 0;
    this.knockbackTimer = 0;
    this.impactCooldown = 0;
    this.detourTimer = 0;
    this.stuckTimer = 0;
    this.retreating = false;
    this.plantTimer = 0;
    this.ringPhase = 0;
    if (this.ringMesh) this.ringMesh.visible = false;
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
      case ZombieState.Planting:
        this.stepPlanting(dt);
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

    if (this.shieldMesh && this.shieldMaterial) {
      this.shieldTimer = Math.max(0, this.shieldTimer - dt);
      const shieldVisible = this.shieldTimer > 0 && this.isAlive;
      this.shieldMesh.visible = shieldVisible;
      if (shieldVisible) {
        this.shieldMaterial.opacity =
          SHIELD_FLASH_MAX_OPACITY * (this.shieldTimer / SHIELD_FLASH_DURATION);
      }
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
      case ZombieState.Planting:
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
    if (this.glowMesh) {
      this.glowMesh.visible = this.isAlive;
      // Counter the root's animated scale so the disc hugs the ground plane.
      const rootScale = this.root.scale.y || 1;
      this.glowMesh.position.y = (0.06 - translation.y) / rootScale;
    }
    if (this.ringMesh && this.ringMaterial) {
      const planting = this.state === ZombieState.Planting && this.isAlive;
      this.ringMesh.visible = planting;
      if (planting) {
        // Each pulse expands from the worker and fades; pulses come faster as
        // the arming channel nears completion.
        const charge = clamp(1 - this.plantTimer / WORKER_PLANT_SECONDS, 0, 1);
        const rate =
          WORKER_RING_MIN_RATE +
          (WORKER_RING_MAX_RATE - WORKER_RING_MIN_RATE) * charge;
        this.ringPhase = (this.ringPhase + dt * rate) % 1;
        const rootScale = this.root.scale.y || 1;
        this.ringMesh.scale.setScalar(
          (WORKER_RING_MAX_RADIUS * Math.max(0.15, this.ringPhase)) / rootScale,
        );
        this.ringMesh.position.y = (0.1 - translation.y) / rootScale;
        this.ringMaterial.opacity = WORKER_RING_OPACITY * (1 - this.ringPhase);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.root);
    this.world.removeRigidBody(this.body);
    this.fallbackMaterial.dispose();
    this.shieldMaterial?.dispose();
    this.shieldMesh?.geometry.dispose();
    if (this.glowMesh) {
      (this.glowMesh.material as THREE.Material).dispose();
      this.glowMesh.geometry.dispose();
    }
    if (this.ringMesh) {
      this.ringMaterial?.dispose();
      this.ringMesh.geometry.dispose();
    }
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
    const worker = this.kind === 'worker';
    let away = 1;
    if (worker) {
      if (this.retreating) {
        // Back off after a plant; only past retreat range may it arm again.
        if (target.distance >= WORKER_RETREAT_RANGE) {
          this.retreating = false;
        } else {
          away = -1;
        }
      } else if (target.distance <= WORKER_PLANT_RANGE) {
        // In range: commit to the arming channel wherever the vehicle goes.
        this.plantTimer = WORKER_PLANT_SECONDS;
        this.ringPhase = 0;
        this.state = ZombieState.Planting;
        this.zeroHorizontalVelocity();
        this.updateFacing(dx, dz);
        return;
      }
    } else {
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
    }
    if (horizontalDistance < 1e-4) {
      this.zeroHorizontalVelocity();
      return;
    }

    const targetDirX = (away * dx) / horizontalDistance;
    const targetDirZ = (away * dz) / horizontalDistance;
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

  /** Stand still arming the mine; it drops only if the channel completes. */
  private stepPlanting(dt: number): void {
    this.zeroHorizontalVelocity();
    this.plantTimer -= dt;
    if (this.plantTimer > 0) return;
    this.onPlantMine?.(this);
    this.retreating = true;
    this.state = ZombieState.Chasing;
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
    this.onKilled(this.reward, this.kind);
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
    const addict = this.kind === 'phone-addict';
    const worker = this.kind === 'worker';
    const variant = thrower
      ? 0
      : addict
        ? 90 + (this.index % 2)
        : worker
          ? 80
          : (this.index % 6) + 1;
    const url = thrower
      ? `${ZOMBIE_ASSET_ROOT}/zombie_city`
      : addict
        ? `${ZOMBIE_ASSET_ROOT}/PhoneAddict-${this.index % 2 === 0 ? '0-Woman' : '1-Man'}`
        : worker
          ? `${ZOMBIE_ASSET_ROOT}/zombie_worker`
          : `${ZOMBIE_ASSET_ROOT}/Zed_${variant}`;
    void instantiateVoxelAsset(url, true)
      .then((model) => {
        if (this.disposed) {
          disposeModelMaterials(model);
          return;
        }
        if (thrower || addict || worker) {
          // These models' voxel grids differ from the Zed exports; scale by
          // bounds to match the walkers' world height.
          const bounds = new THREE.Box3().setFromObject(model);
          const height = Math.max(1e-3, bounds.max.y - bounds.min.y);
          model.scale.setScalar(
            (thrower
              ? THROWER_VISUAL_HEIGHT
              : addict
                ? PHONE_ADDICT_VISUAL_HEIGHT
                : WORKER_VISUAL_HEIGHT) / height,
          );
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
