import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  GROUP_TERRAIN,
  GROUP_VEHICLE,
  GROUP_ZOMBIE,
} from '../../runtime/assembler.ts';
import type { RuntimeVehicle } from '../../runtime/vehicle.ts';
import type { VfxSystem } from '../../vfx/VfxSystem.ts';
import { VFX_PALETTE } from '../../vfx/vfxConfig.ts';
import { instantiateVoxelAsset } from '../VoxelAssetLoader.ts';
import {
  BOSS_HAMMER_COLOR,
  BOSS_HAMMER_HEAD,
  BOSS_HAMMER_RAISED_ANGLE,
  BOSS_HAMMER_SHAFT,
  BOSS_HAMMER_SHAFT_COLOR,
  BOSS_RING_COLOR,
  BOSS_RING_MIN_FRACTION,
  BOSS_RING_OPACITY,
  DEFAULT_BOSS_ASSET,
  type BossDefinition,
} from './bossConfig.ts';
import {
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
  PHONE_ADDICT_VISUAL_HEIGHT,
  SCALE_VARIATION,
  SHIELD_FLASH_DURATION,
  SHIELD_FLASH_MAX_OPACITY,
  SHIELD_RADIUS,
  SPAWN_RISE_DURATION,
  STUCK_SPEED_THRESHOLD,
  STUCK_TIME_THRESHOLD,
  THROWER_ATTACK_EXIT_MARGIN,
  THROWER_VISUAL_HEIGHT,
  WALK_BOB_AMPLITUDE,
  WALK_BOB_FREQUENCY,
  WORKER_RETREAT_RANGE,
  WORKER_RING_MAX_RADIUS,
  WORKER_RING_MAX_RATE,
  WORKER_RING_MIN_RATE,
  WORKER_RING_OPACITY,
  WORKER_VISUAL_HEIGHT,
  ZOMBIE_ATTACK_EXIT_MARGIN,
  ZOMBIE_ATTACK_RANGE,
  ZOMBIE_HALF_HEIGHT,
  ZOMBIE_RADIUS,
} from './zombieConfig.ts';
import { devTuning } from '../devtuning/DevTuning.ts';

const ZOMBIE_GROUPS =
  (GROUP_ZOMBIE << 16) | (GROUP_TERRAIN | GROUP_VEHICLE | GROUP_ZOMBIE);
const ZOMBIE_ASSET_ROOT = `${import.meta.env.BASE_URL}assets/zombies`;
const OBSTACLE_FILTER_GROUPS = (GROUP_ZOMBIE << 16) | GROUP_TERRAIN;
const BASE_EMISSIVE = 0.25;
const HIT_FLASH_COLOR = new THREE.Color(0xffffff);
/** Turquoise glow applied to a frozen zombie's body while its freeze lasts. */
const ICE_FREEZE_COLOR = new THREE.Color(VFX_PALETTE.ice);
const ICE_FREEZE_EMISSIVE = 0.85;
/** Purple glow applied to a mind-controlled zombie fighting on your side. */
const CHARM_COLOR = new THREE.Color(0xc060ff);
const CHARM_EMISSIVE = 0.7;
/** Charmed zombies hit enemy zombies harder than they'd claw at the vehicle. */
const CHARM_ATTACK_MULTIPLIER = 2.5;
/**
 * How far a body's own tint is dragged toward the ice colour. A freeze turns
 * the zombie into ice outright; a slow only frosts it over, so the two states
 * stay tellable apart in a crowd.
 */
const ICE_FREEZE_TINT = 0.72;
const ICE_SLOW_TINT = 0.3;
/** Ice block encasing a frozen zombie, in world metres. */
const ICE_SHELL_RADIUS = 0.86;
const ICE_SHELL_OPACITY = 0.52;
/** Turquoise floor halo under the block, so a freeze reads from any angle. */
const ICE_SHELL_GLOW_RADIUS = 1.15;
const ICE_SHELL_GLOW_OPACITY = 0.6;
/** Seconds the block takes to close in, and to fall away again. */
const ICE_SHELL_FADE = 0.12;
/**
 * Shards driven into a zombie the cold has hold of. Merged into a single mesh
 * at build time and toggled with one `visible` flag — one draw call, no
 * particles, no per-frame work, so a whole horde can wear them for nothing.
 */
const ICE_SHARD_COUNT = 7;
const ICE_SHARD_LENGTH = 0.32;
const ICE_SHARD_RADIUS = 0.07;
/** Per-shard size spread, so no two spikes on a body match. */
const ICE_SHARD_SIZE_VARIATION = 0.5;
/** Shades each shard is cut from, pale rime through to deep glacier. */
const ICE_SHARD_SHADES = [
  VFX_PALETTE.frost,
  0xa7f0e8,
  VFX_PALETTE.ice,
  0x1f8a91,
] as const;
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

/** Turquoise halo under a zombie held in Ice Cannon freeze. */
function getFrostGlowTexture(): THREE.CanvasTexture {
  return getGlowTexture(
    'rgba(217, 255, 249, 0.95)',
    'rgba(64, 224, 208, 0.5)',
    'rgba(15, 95, 107, 0)',
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
  /** Boss only: hammer raised, telegraph ring expanding, slam not yet landed. */
  WindingUp = 'WindingUp',
  KnockedBack = 'KnockedBack',
  Dead = 'Dead',
}

export type ZombieKilledCallback = (reward: number, kind: ZombieKind) => void;

export type ZombieKind =
  | 'walker'
  | 'thrower'
  | 'phone-addict'
  | 'worker'
  | 'boss';

/**
 * Outcome of a vehicle contact. `ignored` covers a zombie that is untargetable
 * or still inside its impact cooldown, so presentation can skip its effect
 * instead of spraying gore on every fixed step of a sustained contact.
 */
export type VehicleImpactResult = 'ignored' | 'damaged' | 'killed';

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
  /**
   * Nearest enemy zombie to attack while mind-controlled; filled by ZombieSystem
   * once per fixed step. `zombie` is null when no enemy is in play.
   */
  readonly charmTarget: {
    zombie: Zombie | null;
    x: number;
    z: number;
    distance: number;
  } = { zombie: null, x: 0, z: 0, distance: Infinity };

  state = ZombieState.Dead;
  active = false;
  /** Set by ZombieSystem; fired when a thrower's attack timer elapses. */
  onThrow: ((zombie: Zombie) => void) | null = null;
  /** Set by ZombieSystem; fired when a worker's mine-plant timer elapses. */
  onPlantMine: ((zombie: Zombie) => void) | null = null;
  /** Set by ZombieSystem; fired when a boss's hammer wind-up completes. */
  onBossSlam: ((zombie: Zombie) => void) | null = null;
  readonly kind: ZombieKind;

  private readonly visualRoot = new THREE.Group();
  private readonly fallbackMaterial: THREE.MeshLambertMaterial;
  private readonly loadedMaterials: THREE.MeshLambertMaterial[] = [];
  private readonly visualMaterials: THREE.MeshLambertMaterial[] = [];
  /** Mutable because a boss resizes itself from its definition on spawn. */
  private baseScale: number;
  /** Body tint this corpse's gibs are cut from, as an sRGB hex. */
  private readonly gibTintHex: number;
  private readonly rayOrigin = { x: 0, y: 0, z: 0 };
  private readonly rayDirection = { x: 0, y: 0, z: 0 };
  private readonly ray: RAPIER.Ray;
  private readonly velocityScratch = { x: 0, y: 0, z: 0 };
  private readonly impulseScratch = { x: 0, y: 0, z: 0 };
  private readonly translationScratch = { x: 0, y: 0, z: 0 };

  /** The loaded voxel model, kept so a boss can resize it once it knows its definition. */
  private loadedModel: THREE.Object3D | null = null;
  private shieldMesh: THREE.Mesh | null = null;
  private shieldMaterial: THREE.MeshBasicMaterial | null = null;
  private shieldTimer = 0;
  private glowMesh: THREE.Mesh | null = null;
  /** Ice block and floor halo, built the first time this zombie is frozen. */
  private frostShellMesh: THREE.Mesh | null = null;
  private frostShellMaterial: THREE.MeshLambertMaterial | null = null;
  private frostGlowMesh: THREE.Mesh | null = null;
  private frostGlowMaterial: THREE.MeshBasicMaterial | null = null;
  /** 0..1 grow-in of the block, so freezing and thawing are not hard pops. */
  private frostShellFade = 0;
  /** Shards stuck in the body, shown for as long as the cold holds. */
  private frostShardMesh: THREE.Mesh | null = null;
  private frostShardMaterial: THREE.MeshLambertMaterial | null = null;
  /** True while the body tint is shifted to ice, so the reset runs once. */
  private frostTinted = false;
  /** Body tint strength currently written into the materials (0 = stock). */
  private appliedTint = 0;
  /** Emissive look currently written into the materials. */
  private appliedGlow: 'none' | 'flash' | 'frozen' | 'charmed' | 'slowed' =
    'none';
  private ringMesh: THREE.Mesh | null = null;
  private ringMaterial: THREE.MeshBasicMaterial | null = null;
  private ringPhase = 0;
  private plantTimer = 0;
  private hammerPivot: THREE.Group | null = null;
  /** Live definition while a boss is active; null for every ordinary zombie. */
  private bossDef: BossDefinition | null = null;
  private windupTimer = 0;

  private health = 0;
  /**
   * Full health at spawn, so live re-tuning can preserve the damage fraction and
   * the boss health bar has a denominator.
   */
  private spawnHealth = 0;
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
  /** Seconds of remaining Ice Cannon freeze; while >0 the zombie can't act. */
  private freezeTimer = 0;
  /** Seconds of remaining Mind Control charm; while >0 the zombie fights for you. */
  private charmTimer = 0;
  /** Seconds of remaining ice-fire slow; while >0 move speed scales by slowFactor. */
  private slowTimer = 0;
  private slowFactor = 1;
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
    /** Optional so headless tests can pool zombies without a scene budget. */
    private readonly vfx: VfxSystem | null = null,
  ) {
    this.kind = kind;
    this.baseScale =
      BASE_VISUAL_SCALE + (Math.random() - 0.5) * SCALE_VARIATION;
    const tint = new THREE.Color(
      BODY_TINTS[index % BODY_TINTS.length],
    ).offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
    this.gibTintHex = tint.getHex();
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
    if (this.kind === 'worker' || this.kind === 'boss') {
      // Telegraph ring, shared by two mechanics: the worker's mine-arming
      // channel pulses it repeatedly, while a boss expands it once per swing to
      // mark exactly where the hammer is about to land.
      this.ringMaterial = new THREE.MeshBasicMaterial({
        color: this.kind === 'boss' ? BOSS_RING_COLOR : 0xffb428,
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
    if (this.kind === 'boss') this.buildHammer();
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
    // Charmed zombies fight for the player, so they drop out of every
    // enemy-facing system: weapons, freeze/zap AoE, vehicle contacts, and the
    // charm sweep itself all key off isTargetable.
    return (
      this.isAlive && this.state !== ZombieState.Spawning && this.charmTimer <= 0
    );
  }

  /** Current hit points, for target-priority weapons that seek the toughest foe. */
  get currentHealth(): number {
    return this.health;
  }

  /** Hit points this zombie spawned with, for the boss health bar. */
  get maxHealth(): number {
    return this.spawnHealth;
  }

  /** The live boss definition, or null for every ordinary zombie. */
  get bossDefinition(): BossDefinition | null {
    return this.bossDef;
  }

  /** Wave-scaled damage one boss slam deals to each part inside its radius. */
  get slamDamage(): number {
    return this.bossDef ? this.attackDamage : 0;
  }

  /** A projectile bounced off this zombie's shield: flash the bubble. */
  flashShield(): void {
    if (!this.isTargetable) return;
    this.shieldTimer = SHIELD_FLASH_DURATION;
  }

  /**
   * Height of the capsule's centre above the ground — where the body sits so the
   * collider rests exactly on the terrain. Bosses use their own capsule size.
   */
  private standHeight(): number {
    return this.bossDef
      ? this.bossDef.colliderHalfHeightM + this.bossDef.colliderRadiusM
      : ZOMBIE_HALF_HEIGHT + ZOMBIE_RADIUS;
  }

  /**
   * Resize the pooled capsule and visual to this boss. The pool slot is created
   * at walker size because the definition is not known until the wave starts,
   * so both are applied here on spawn. Density is unchanged, so mass grows with
   * the capsule and the boss shrugs off contacts a walker would be shoved by.
   */
  private applyBossBody(def: BossDefinition): void {
    this.collider.setRadius(def.colliderRadiusM);
    this.collider.setHalfHeight(def.colliderHalfHeightM);
    // Local units are world metres for a boss, so the model offset, telegraph
    // ring, and hammer can all be authored directly in metres.
    this.baseScale = 1;
    this.applyBossVisualSizing();
  }

  /**
   * Size the boss model to `visualHeightM` and drop it so its feet meet the
   * ground. Safe to call before the async model load resolves; `loadVoxelVisual`
   * calls it again once the model arrives.
   */
  private applyBossVisualSizing(): void {
    const def = this.bossDef;
    if (!def) return;
    const groundOffset = -this.standHeight();

    if (this.hammerPivot) {
      // Shoulder height, out to the side and slightly forward. The hammer is
      // authored for a 4.2 m boss and scales with any other.
      this.hammerPivot.position.set(
        def.visualHeightM * 0.28,
        groundOffset + def.visualHeightM * 0.72,
        def.visualHeightM * 0.18,
      );
      this.hammerPivot.scale.setScalar(def.visualHeightM / 4.2);
    }

    if (this.loadedModel) {
      const bounds = new THREE.Box3().setFromObject(this.loadedModel);
      const height = Math.max(1e-3, bounds.max.y - bounds.min.y);
      // setFromObject already includes the model's current scale, so divide it
      // back out to get the factor that lands on the target height.
      const current = this.loadedModel.scale.y || 1;
      this.loadedModel.scale.setScalar((def.visualHeightM / height) * current);
      this.loadedModel.position.y = groundOffset;
      for (const material of this.loadedMaterials) {
        material.color.setHex(def.tint);
        material.needsUpdate = true;
      }
      return;
    }

    // Capsule fallback until (or instead of) a model: stretch it to the boss's
    // height. Width is approximate — the model replaces it on load.
    const fallbackHeight = (ZOMBIE_HALF_HEIGHT + ZOMBIE_RADIUS) * 2;
    const fallback = this.visualRoot.children[0];
    if (fallback) {
      fallback.scale.setScalar(def.visualHeightM / fallbackHeight);
      fallback.position.y = groundOffset + def.visualHeightM / 2;
    }
    this.fallbackMaterial.color.setHex(def.tint);
  }

  /**
   * Placeholder hammer: a box shaft and head on a pivot at the boss's shoulder,
   * built in world metres because a boss renders at unit root scale. The pivot
   * rotates up during the wind-up and snaps down when the slam lands.
   */
  private buildHammer(): void {
    const pivot = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(
        BOSS_HAMMER_SHAFT.radius * 2,
        BOSS_HAMMER_SHAFT.length,
        BOSS_HAMMER_SHAFT.radius * 2,
      ),
      new THREE.MeshLambertMaterial({
        color: BOSS_HAMMER_SHAFT_COLOR,
        flatShading: true,
      }),
    );
    shaft.position.y = -BOSS_HAMMER_SHAFT.length / 2;
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(
        BOSS_HAMMER_HEAD.width,
        BOSS_HAMMER_HEAD.height,
        BOSS_HAMMER_HEAD.depth,
      ),
      new THREE.MeshLambertMaterial({
        color: BOSS_HAMMER_COLOR,
        flatShading: true,
      }),
    );
    head.position.y = -BOSS_HAMMER_SHAFT.length;
    shaft.castShadow = true;
    head.castShadow = true;
    pivot.add(shaft, head);
    this.hammerPivot = pivot;
    this.visualRoot.add(pivot);
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
    boss: BossDefinition | null = null,
  ): void {
    if (this.disposed) return;
    this.active = true;
    this.state = ZombieState.Spawning;
    const base = devTuning.base;
    // A boss takes every stat from its definition rather than the dev-tuner
    // per-kind row; the wave multipliers still apply so a wave-20 boss is
    // meaningfully tougher than a wave-5 one. Base speed is still the tuner's,
    // so the boss's speedMultiplier stays relative to the horde it replaces.
    this.bossDef = this.kind === 'boss' ? boss : null;
    if (this.bossDef) {
      this.health = this.bossDef.baseHealth * healthMultiplier;
      this.moveSpeed =
        base.speed * speedMultiplier * this.bossDef.speedMultiplier;
      this.attackDamage = this.bossDef.attack.damage * attackDamageMultiplier;
      this.attackInterval = this.bossDef.attack.intervalSeconds;
      this.reward = this.bossDef.reward;
      this.applyBossBody(this.bossDef);
    } else {
      const stats = devTuning.types[this.kind];
      this.health = base.health * healthMultiplier * stats.healthMult;
      this.moveSpeed = base.speed * speedMultiplier * stats.speedMult;
      this.attackDamage =
        base.attackDamage * attackDamageMultiplier * stats.damageMult;
      this.attackInterval = stats.attackInterval;
      this.reward = stats.reward;
    }
    this.spawnHealth = this.health;
    this.windupTimer = 0;
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
    this.freezeTimer = 0;
    this.charmTimer = 0;
    this.charmTarget.zombie = null;
    this.charmTarget.distance = Infinity;
    this.slowTimer = 0;
    this.slowFactor = 1;
    // A recycled zombie must never come back out of the pool still iced over.
    this.frostShellFade = 0;
    if (this.frostShardMesh) this.frostShardMesh.visible = false;
    if (this.frostShellMesh) this.frostShellMesh.visible = false;
    if (this.frostGlowMesh) this.frostGlowMesh.visible = false;
    if (this.frostTinted) this.applyFrostTint(0);
    // A recycled zombie starts from the resting look, so the next visual
    // frame writes whatever it needs rather than trusting a stale cache.
    this.appliedGlow = 'none';
    for (const material of this.visualMaterials)
      material.emissive.setScalar(BASE_EMISSIVE);
    this.detourSign = Math.random() < 0.5 ? -1 : 1;
    this.bobPhase = Math.random() * Math.PI * 2;

    const y = this.standHeight();
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

  /**
   * Dev-tuner live re-apply for a zombie that is already on the field. Recomputes
   * stats from the current tuning and the supplied wave multipliers, preserving
   * the zombie's remaining-health fraction so a live edit never revives or
   * one-shots it. No-op for dead/inactive zombies.
   */
  reapplyStats(
    healthMultiplier: number,
    speedMultiplier: number,
    attackDamageMultiplier: number,
  ): void {
    if (!this.isAlive) return;
    const base = devTuning.base;
    const fraction =
      this.spawnHealth > 0
        ? Math.max(0, Math.min(1, this.health / this.spawnHealth))
        : 1;
    // A live boss re-derives from its own definition, never from the per-kind
    // tuner row — the inert `boss` row would otherwise crush it to walker
    // health mid-fight. Wave multipliers still apply, so the tuner's wave
    // curves remain useful during a boss encounter.
    if (this.bossDef) {
      const newFull = this.bossDef.baseHealth * healthMultiplier;
      this.spawnHealth = newFull;
      this.health = Math.max(1e-3, newFull * fraction);
      this.moveSpeed =
        base.speed * speedMultiplier * this.bossDef.speedMultiplier;
      this.attackDamage = this.bossDef.attack.damage * attackDamageMultiplier;
      this.attackInterval = this.bossDef.attack.intervalSeconds;
      this.reward = this.bossDef.reward;
      return;
    }
    const stats = devTuning.types[this.kind];
    const newFull = base.health * healthMultiplier * stats.healthMult;
    this.spawnHealth = newFull;
    this.health = Math.max(1e-3, newFull * fraction);
    this.moveSpeed = base.speed * speedMultiplier * stats.speedMult;
    this.attackDamage =
      base.attackDamage * attackDamageMultiplier * stats.damageMult;
    this.attackInterval = stats.attackInterval;
    this.reward = stats.reward;
  }

  /** Apply speed-scaled vehicle damage and a real Rapier knockback impulse. */
  applyVehicleImpact(
    damage: number,
    dirX: number,
    dirZ: number,
  ): VehicleImpactResult {
    if (!this.isTargetable || damage <= 0 || this.impactCooldown > 0)
      return 'ignored';

    this.impactCooldown = IMPACT_COOLDOWN_SECONDS;
    // A boss caps ram damage, so the lethal-speed one-shot that flattens an
    // ordinary zombie only chips it, and it barely rocks on its feet.
    this.health -= this.bossDef
      ? Math.min(damage, this.bossDef.impactDamageCap)
      : damage;
    this.state = ZombieState.KnockedBack;
    this.knockbackTimer = KNOCKBACK_DURATION;

    const length = Math.hypot(dirX, dirZ) || 1;
    const impulseMagnitude =
      this.body.mass() * KNOCKBACK_SPEED * this.knockbackScale();
    this.impulseScratch.x = (dirX / length) * impulseMagnitude;
    this.impulseScratch.y = 0;
    this.impulseScratch.z = (dirZ / length) * impulseMagnitude;
    this.body.applyImpulse(this.impulseScratch, true);

    if (this.health > 0) return 'damaged';
    this.die();
    return 'killed';
  }

  /**
   * Thumper Q shockwave: shove this zombie radially outward at `speed` m/s. Deals
   * no damage — it only interrupts the zombie and flings it away, briefly forcing
   * it into the KnockedBack state. Charmed/dead/spawning zombies are skipped. A
   * zombie sitting exactly on the origin gets an arbitrary outward push so it is
   * never left in place.
   */
  applyKnockback(dirX: number, dirZ: number, speed: number): void {
    if (!this.isTargetable || speed <= 0) return;

    let length = Math.hypot(dirX, dirZ);
    if (length < 1e-3) {
      dirX = 1;
      dirZ = 0;
      length = 1;
    }

    this.state = ZombieState.KnockedBack;
    this.knockbackTimer = KNOCKBACK_DURATION;

    const impulseMagnitude = this.body.mass() * speed * this.knockbackScale();
    this.impulseScratch.x = (dirX / length) * impulseMagnitude;
    this.impulseScratch.y = 0;
    this.impulseScratch.z = (dirZ / length) * impulseMagnitude;
    this.body.applyImpulse(this.impulseScratch, true);
  }

  /** Bosses resist being flung; every other zombie takes the full impulse. */
  private knockbackScale(): number {
    return this.bossDef ? this.bossDef.knockbackResistance : 1;
  }

  /**
   * Ridden on a bulldozer blade: carried at the blade's velocity, and held in
   * the knockback state so the zombie can neither chase nor bite while the
   * blade has it. The caller refreshes this every step it keeps hold, so the
   * hold lapses on its own once the zombie rolls off.
   *
   * A frozen zombie is left alone — the ice owns it until it thaws.
   */
  holdOnPlow(velocityX: number, velocityZ: number, holdSeconds: number): void {
    if (!this.isTargetable || this.freezeTimer > 0) return;
    this.state = ZombieState.KnockedBack;
    this.knockbackTimer = Math.max(this.knockbackTimer, holdSeconds);
    // Vertical velocity is the physics engine's business: overwriting it would
    // hold the load off the ground while the blade is climbing a kerb.
    this.velocityScratch.x = velocityX;
    this.velocityScratch.y = this.body.linvel().y;
    this.velocityScratch.z = velocityZ;
    this.body.setLinvel(this.velocityScratch, true);
  }

  /**
   * Contact damage from a blade that is carrying this zombie rather than
   * throwing it clear: no knockback, because being flung is exactly what the
   * blade is preventing. Paced by the same impact cooldown as a ram.
   */
  applyPlowScrape(damage: number): VehicleImpactResult {
    if (!this.isTargetable || damage <= 0 || this.impactCooldown > 0)
      return 'ignored';

    this.impactCooldown = IMPACT_COOLDOWN_SECONDS;
    this.health -= damage;
    this.hitFlashTimer = HIT_FLASH_DURATION;
    if (this.health > 0) return 'damaged';
    this.die();
    return 'killed';
  }

  /**
   * The blade drove its load into something solid. Deliberately ignores the
   * impact cooldown: the slam is one discrete event, not a contact tick, and it
   * must land on every body in the pile the moment it happens. Survivors are
   * thrown up and out of the way rather than merely shoved.
   */
  applyPlowCrush(
    damage: number,
    dirX: number,
    dirZ: number,
  ): VehicleImpactResult {
    if (!this.isTargetable || damage <= 0) return 'ignored';

    this.impactCooldown = IMPACT_COOLDOWN_SECONDS;
    this.health -= damage;
    this.hitFlashTimer = HIT_FLASH_DURATION;
    this.state = ZombieState.KnockedBack;
    this.knockbackTimer = KNOCKBACK_DURATION;

    const length = Math.hypot(dirX, dirZ) || 1;
    const impulseMagnitude = this.body.mass() * KNOCKBACK_SPEED;
    this.impulseScratch.x = (dirX / length) * impulseMagnitude;
    this.impulseScratch.y = impulseMagnitude * 0.5;
    this.impulseScratch.z = (dirZ / length) * impulseMagnitude;
    this.body.applyImpulse(this.impulseScratch, true);

    if (this.health > 0) return 'damaged';
    this.die();
    return 'killed';
  }

  fixedUpdate(
    dt: number,
    vehicle: RuntimeVehicle,
    separationX: number,
    separationZ: number,
  ): void {
    if (!this.active) return;
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    if (this.slowTimer > 0) {
      this.slowTimer = Math.max(0, this.slowTimer - dt);
      if (this.slowTimer === 0) this.slowFactor = 1;
    }

    // Mind Control Beam: while charmed, hunt enemy zombies instead of the
    // vehicle. When the timer runs out the control wears off and the zombie
    // turns hostile again, falling through to its normal AI below.
    if (this.charmTimer > 0 && this.state !== ZombieState.Dead) {
      this.charmTimer = Math.max(0, this.charmTimer - dt);
      if (this.charmTimer > 0) {
        this.stepCharmed(dt);
        this.syncPositionFromBody();
        return;
      }
      this.state = ZombieState.Chasing;
      this.attackTimer = 0;
    }

    // Ice Cannon freeze: hold the zombie in place until the freeze expires.
    // Dead zombies still run their death animation; everything else is halted.
    if (this.freezeTimer > 0 && this.state !== ZombieState.Dead) {
      this.freezeTimer = Math.max(0, this.freezeTimer - dt);
      this.zeroHorizontalVelocity();
      this.syncPositionFromBody();
      // Thawing out is the moment the zombie becomes dangerous again, so it
      // gets its own sound-and-fury rather than a silent fade.
      if (this.freezeTimer === 0) this.emitFrostShatter();
      return;
    }

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
      case ZombieState.WindingUp:
        this.stepWindingUp(dt);
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

  /**
   * Ice Cannon flash-freeze: halt the zombie for `seconds`. Only affects a live,
   * targetable zombie; re-freezing extends to the longer remaining time.
   */
  applyFreeze(seconds: number): void {
    if (!this.isTargetable || seconds <= 0) return;
    const wasFrozen = this.freezeTimer > 0;
    this.freezeTimer = Math.max(this.freezeTimer, seconds);
    // Only the moment of capture plays the encasing burst; topping a freeze up
    // mid-wave would otherwise re-fire it on every ability press.
    if (wasFrozen) return;
    this.vfx?.freezeEncase(
      this.position.x,
      this.position.y,
      this.position.z,
    );
  }

  /** True while an Ice Cannon freeze is holding this zombie. */
  get isFrozen(): boolean {
    return this.freezeTimer > 0;
  }

  /**
   * Mind Control Beam: turn this zombie to the player's side for `seconds`. Only
   * affects a live, non-spawning zombie; re-charming extends to the longer time.
   */
  applyCharm(seconds: number): void {
    if (seconds <= 0 || !this.isAlive || this.state === ZombieState.Spawning)
      return;
    this.charmTimer = Math.max(this.charmTimer, seconds);
    this.charmTarget.zombie = null;
    this.charmTarget.distance = Infinity;
    this.state = ZombieState.Chasing;
    this.attackTimer = 0;
  }

  /** True while a Mind Control charm has this zombie fighting for the player. */
  get isCharmed(): boolean {
    return this.charmTimer > 0;
  }

  /**
   * Ice Cannon normal fire: slow the zombie to `factor` of its speed for
   * `seconds`. Only affects a live, targetable zombie; a stronger (lower
   * factor) or longer slow overrides a weaker one, and the timer extends.
   */
  applySlow(factor: number, seconds: number): void {
    if (!this.isTargetable || seconds <= 0) return;
    const clampedFactor = Math.max(0, Math.min(1, factor));
    this.slowFactor =
      this.slowTimer > 0
        ? Math.min(this.slowFactor, clampedFactor)
        : clampedFactor;
    this.slowTimer = Math.max(this.slowTimer, seconds);
  }

  /** True while an ice-fire slow is dragging this zombie down. */
  get isSlowed(): boolean {
    return this.slowTimer > 0;
  }

  teleportTo(position: Vector3Like): void {
    if (!this.isAlive) return;
    const y = this.standHeight();
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

    // Emissive and tint are written through every body material, so they are
    // only touched when the look actually changes. A walker crossing the
    // graveyard in its resting state — the overwhelming majority of the horde,
    // every frame — costs nothing here.
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
      const amount =
        BASE_EMISSIVE + (this.hitFlashTimer / HIT_FLASH_DURATION) * 0.75;
      for (const material of this.visualMaterials) {
        material.emissive.copy(HIT_FLASH_COLOR).multiplyScalar(amount);
      }
      // The flash fades continuously, so the next frame must rewrite whatever
      // state follows it.
      this.appliedGlow = 'flash';
    } else if (this.freezeTimer > 0) {
      // Icy blue glow while frozen (a hit-flash briefly overrides it above).
      if (this.appliedGlow !== 'frozen') {
        this.appliedGlow = 'frozen';
        for (const material of this.visualMaterials)
          material.emissive
            .copy(ICE_FREEZE_COLOR)
            .multiplyScalar(ICE_FREEZE_EMISSIVE);
      }
    } else if (this.charmTimer > 0) {
      // Purple glow while mind-controlled and fighting on your side.
      if (this.appliedGlow !== 'charmed') {
        this.appliedGlow = 'charmed';
        for (const material of this.visualMaterials)
          material.emissive.copy(CHARM_COLOR).multiplyScalar(CHARM_EMISSIVE);
      }
    } else if (this.slowTimer > 0) {
      // Fainter icy glow while merely slowed by ice fire.
      if (this.appliedGlow !== 'slowed') {
        this.appliedGlow = 'slowed';
        for (const material of this.visualMaterials)
          material.emissive
            .copy(ICE_FREEZE_COLOR)
            .multiplyScalar(ICE_FREEZE_EMISSIVE * 0.4);
      }
    } else if (this.appliedGlow !== 'none') {
      this.appliedGlow = 'none';
      for (const material of this.visualMaterials)
        material.emissive.setScalar(BASE_EMISSIVE);
    }

    // Emissive alone washes out against the graveyard's own lights, so the
    // body tint moves too: frozen zombies go turquoise, slowed ones frost over.
    const frozen = this.freezeTimer > 0 && this.isAlive;
    const slowed = !frozen && this.slowTimer > 0 && this.isAlive;
    const tint = frozen ? ICE_FREEZE_TINT : slowed ? ICE_SLOW_TINT : 0;
    if (tint !== this.appliedTint) this.applyFrostTint(tint);
    this.updateFrostShell(dt, frozen);
    this.updateFrostShards(frozen || slowed);

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
      case ZombieState.WindingUp:
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
    if (this.hammerPivot && this.bossDef) {
      // Raise through the wind-up, then snap down over the lunge so the swing
      // reads as connecting with the ground at the moment the slam lands.
      const windup = this.bossDef.attack.windupSeconds;
      let swing = 0;
      if (this.state === ZombieState.WindingUp && windup > 0) {
        swing = clamp(1 - this.windupTimer / windup, 0, 1);
        this.hammerPivot.rotation.x = BOSS_HAMMER_RAISED_ANGLE * swing;
      } else if (this.lungeTimer > 0) {
        swing = this.lungeTimer / LUNGE_DURATION;
        this.hammerPivot.rotation.x = BOSS_HAMMER_RAISED_ANGLE * swing;
      } else {
        this.hammerPivot.rotation.x = 0;
      }
    }
    if (this.frostGlowMesh) {
      // Same trick as the addict halo: pin the disc to the ground plane
      // regardless of what the root's animated scale is doing.
      const rootScale = this.root.scale.y || 1;
      this.frostGlowMesh.position.y = (0.05 - translation.y) / rootScale;
    }

    if (this.ringMesh && this.ringMaterial && this.bossDef) {
      // One ring per swing, expanding to the exact slam radius so the player can
      // read where the hammer will land and drive out of it.
      const winding = this.state === ZombieState.WindingUp && this.isAlive;
      this.ringMesh.visible = winding;
      if (winding) {
        const windup = this.bossDef.attack.windupSeconds;
        const charge = windup > 0 ? clamp(1 - this.windupTimer / windup, 0, 1) : 1;
        const rootScale = this.root.scale.y || 1;
        const radius =
          this.bossDef.attack.radiusM *
          (BOSS_RING_MIN_FRACTION + (1 - BOSS_RING_MIN_FRACTION) * charge);
        this.ringMesh.scale.setScalar(radius / rootScale);
        this.ringMesh.position.y = (0.1 - translation.y) / rootScale;
        this.ringMaterial.opacity = BOSS_RING_OPACITY * (0.4 + 0.6 * charge);
      }
    } else if (this.ringMesh && this.ringMaterial) {
      const planting = this.state === ZombieState.Planting && this.isAlive;
      this.ringMesh.visible = planting;
      if (planting) {
        // Each pulse expands from the worker and fades; pulses come faster as
        // the arming channel nears completion.
        const charge = clamp(
          1 - this.plantTimer / devTuning.specialist.workerPlantSeconds,
          0,
          1,
        );
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
    if (this.hammerPivot) {
      for (const child of this.hammerPivot.children) {
        if (!(child instanceof THREE.Mesh)) continue;
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
      this.hammerPivot.clear();
      this.hammerPivot = null;
    }
    if (this.frostShellMesh) {
      this.frostShellMaterial?.dispose();
      this.frostShellMesh.geometry.dispose();
    }
    if (this.frostGlowMesh) {
      this.frostGlowMaterial?.dispose();
      this.frostGlowMesh.geometry.dispose();
    }
    // One merged geometry and one material back the whole shard set.
    this.frostShardMesh?.geometry.dispose();
    this.frostShardMaterial?.dispose();
    for (const material of this.loadedMaterials) material.dispose();
    this.loadedMaterials.length = 0;
    this.visualMaterials.length = 0;
    this.visualRoot.clear();
    this.root.clear();
  }

  /**
   * Mind Control behaviour: chase and melee the nearest enemy zombie
   * (`charmTarget`, supplied by ZombieSystem) instead of the vehicle. One-way —
   * enemies ignore charmed allies, so this only ever deals damage outward. The
   * `state` is kept as Chasing/Attacking purely so the walk/lunge visuals read
   * correctly.
   */
  private stepCharmed(dt: number): void {
    const target = this.charmTarget;
    if (target.zombie === null || !target.zombie.isTargetable) {
      // Nothing left to fight right now: hold position.
      this.state = ZombieState.Chasing;
      this.zeroHorizontalVelocity();
      return;
    }

    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= ZOMBIE_ATTACK_RANGE) {
      this.state = ZombieState.Attacking;
      this.zeroHorizontalVelocity();
      this.updateFacing(dx, dz);
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        this.attackTimer = this.attackInterval;
        const length = distance || 1;
        target.zombie.takeDamage(this.attackDamage * CHARM_ATTACK_MULTIPLIER, {
          x: dx / length,
          y: 0,
          z: dz / length,
        });
        this.lungeTimer = LUNGE_DURATION;
      }
      return;
    }

    this.state = ZombieState.Chasing;
    if (distance < 1e-4) {
      this.zeroHorizontalVelocity();
      return;
    }
    const speed =
      this.slowTimer > 0 ? this.moveSpeed * this.slowFactor : this.moveSpeed;
    const velocity = this.body.linvel();
    this.velocityScratch.x = (dx / distance) * speed;
    this.velocityScratch.y = velocity.y;
    this.velocityScratch.z = (dz / distance) * speed;
    this.body.setLinvel(this.velocityScratch, true);
    this.updateFacing(this.velocityScratch.x, this.velocityScratch.z);
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
      } else if (target.distance <= devTuning.specialist.workerPlantRange) {
        // In range: commit to the arming channel wherever the vehicle goes.
        this.plantTimer = devTuning.specialist.workerPlantSeconds;
        this.ringPhase = 0;
        this.state = ZombieState.Planting;
        this.zeroHorizontalVelocity();
        this.updateFacing(dx, dz);
        return;
      }
    } else {
      const attackRange = this.bossDef
        ? this.bossDef.attack.rangeM
        : this.kind === 'thrower'
          ? devTuning.specialist.throwerAttackRange
          : ZOMBIE_ATTACK_RANGE;
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
    const speed = this.slowTimer > 0 ? this.moveSpeed * this.slowFactor : this.moveSpeed;
    this.velocityScratch.x = dirX * speed + separationX;
    this.velocityScratch.y = velocity.y;
    this.velocityScratch.z = dirZ * speed + separationZ;
    this.body.setLinvel(this.velocityScratch, true);
    this.updateFacing(this.velocityScratch.x, this.velocityScratch.z);
  }

  private stepAttacking(dt: number, vehicle: RuntimeVehicle): void {
    this.zeroHorizontalVelocity();
    const target = this.vehicleTarget;
    const exitRange = this.bossDef
      ? this.bossDef.attack.rangeM + ZOMBIE_ATTACK_EXIT_MARGIN
      : this.kind === 'thrower'
        ? devTuning.specialist.throwerAttackRange + THROWER_ATTACK_EXIT_MARGIN
        : ZOMBIE_ATTACK_RANGE + ZOMBIE_ATTACK_EXIT_MARGIN;
    if (target.partId === null || target.distance > exitRange) {
      this.state = ZombieState.Chasing;
      return;
    }

    this.updateFacing(target.x - this.position.x, target.z - this.position.z);
    this.attackTimer -= dt;
    if (this.attackTimer <= 0) {
      if (this.bossDef) {
        // Commit to the swing: the boss stops here and telegraphs, and the
        // damage is resolved when the hammer lands, not now.
        this.windupTimer = this.bossDef.attack.windupSeconds;
        this.ringPhase = 0;
        this.state = ZombieState.WindingUp;
        return;
      }
      this.attackTimer = this.attackInterval;
      if (this.kind === 'thrower') {
        this.onThrow?.(this);
      } else {
        vehicle.applyDirectDamage(target.partId, this.attackDamage);
      }
      this.lungeTimer = LUNGE_DURATION;
    }
  }

  /**
   * Boss wind-up. The boss holds still with the hammer raised and the ground
   * ring expanding, tracking the vehicle so the swing faces it. The slam fires
   * once the timer elapses; because damage is applied at that moment, driving
   * out of the ring during the wind-up avoids the hit entirely.
   */
  private stepWindingUp(dt: number): void {
    this.zeroHorizontalVelocity();
    const target = this.vehicleTarget;
    if (target.partId !== null) {
      this.updateFacing(target.x - this.position.x, target.z - this.position.z);
    }
    this.windupTimer -= dt;
    if (this.windupTimer > 0) return;

    this.windupTimer = 0;
    this.onBossSlam?.(this);
    this.lungeTimer = LUNGE_DURATION;
    this.attackTimer = this.attackInterval;
    this.state = ZombieState.Chasing;
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
    // Killed inside the ice: the block goes with the corpse, not after it.
    if (this.freezeTimer > 0) {
      this.freezeTimer = 0;
      this.emitFrostShatter();
    }
    // Burst into this corpse's own voxels; specialists are bigger, so they
    // throw a correspondingly bigger cloud.
    this.vfx?.zombieGib(
      this.position.x,
      this.position.y,
      this.position.z,
      this.gibTintHex,
      this.kind === 'walker' ? 1 : 1.25,
    );
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

  /**
   * Drag every body material `strength` of the way from its own tint to the
   * ice colour, remembering each material's original tint the first time it is
   * touched. Passing 0 puts the body back exactly as it was.
   */
  private applyFrostTint(strength: number): void {
    for (const material of this.visualMaterials) {
      const base = (material.userData.baseColor ??=
        material.color.clone()) as THREE.Color;
      material.color.copy(base).lerp(ICE_FREEZE_COLOR, strength);
    }
    this.frostTinted = strength > 0;
    this.appliedTint = strength;
  }

  /**
   * Close the ice block in around a frozen zombie and drop it away on the
   * thaw. Built on first use: a run that never fires the Ice Cannon never pays
   * for a shell per pooled zombie.
   */
  private updateFrostShell(dt: number, frozen: boolean): void {
    if (frozen && this.frostShellMesh === null) this.createFrostShell();
    const mesh = this.frostShellMesh;
    if (mesh === null || this.frostShellMaterial === null) return;

    const step = dt / ICE_SHELL_FADE;
    this.frostShellFade = clamp(
      this.frostShellFade + (frozen ? step : -step),
      0,
      1,
    );
    const visible = this.frostShellFade > 0;
    mesh.visible = visible;
    if (this.frostGlowMesh) this.frostGlowMesh.visible = visible;
    if (!visible) return;

    // Overshoot mid-fade so the block snaps shut rather than swelling.
    const grow =
      this.frostShellFade * (1 + Math.sin(this.frostShellFade * Math.PI) * 0.14);
    mesh.scale.set(grow, grow * 1.18, grow);
    mesh.rotation.y += dt * 0.5;
    this.frostShellMaterial.opacity = ICE_SHELL_OPACITY * this.frostShellFade;
    if (this.frostGlowMaterial) {
      this.frostGlowMaterial.opacity =
        ICE_SHELL_GLOW_OPACITY * this.frostShellFade;
    }
  }

  /** Show the stuck shards while the cold holds, hide them the moment it lets go. */
  private updateFrostShards(iced: boolean): void {
    if (iced && this.frostShardMesh === null) this.createFrostShards();
    if (this.frostShardMesh) this.frostShardMesh.visible = iced;
  }

  /**
   * Drive spikes out through the body at scattered angles, heights, sizes and
   * shades, then bake the lot into one mesh. Everything random happens here,
   * once: from then on the shards cost a single visibility flag a frame and a
   * single draw call, and no two zombies wear the same set.
   */
  private createFrostShards(): void {
    const baseLength = ICE_SHARD_LENGTH / BASE_VISUAL_SCALE;
    const baseRadius = ICE_SHARD_RADIUS / BASE_VISUAL_SCALE;
    const bodyRadius = ZOMBIE_RADIUS / BASE_VISUAL_SCALE;
    const spread = ZOMBIE_HALF_HEIGHT / BASE_VISUAL_SCALE;
    const matrix = new THREE.Matrix4();
    const offset = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const unitScale = new THREE.Vector3(1, 1, 1);
    const direction = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const shade = new THREE.Color();
    const shards: THREE.BufferGeometry[] = [];

    for (let i = 0; i < ICE_SHARD_COUNT; i++) {
      // Walk the ring unevenly so the spikes never settle into a neat collar.
      const angle = ((i + Math.random() * 0.9) / ICE_SHARD_COUNT) * Math.PI * 2;
      const size = 1 + (Math.random() - 0.5) * ICE_SHARD_SIZE_VARIATION;
      const length = baseLength * size;
      // Cone axis is +Y, so shift the base to the origin and let the rotation
      // aim it; the tip then lands outside the body, not inside it.
      const shard = new THREE.ConeGeometry(baseRadius * size, length, 4).translate(
        0,
        length / 2,
        0,
      );

      // Sunk somewhere in the outer half of the body, so each spike reads as
      // driven in rather than glued on, and tilted up the way ice grows.
      const sink = 0.35 + Math.random() * 0.35;
      offset.set(
        Math.cos(angle) * bodyRadius * sink,
        (Math.random() - 0.5) * 2 * spread,
        Math.sin(angle) * bodyRadius * sink,
      );
      direction
        .set(Math.cos(angle), 0.2 + Math.random() * 0.85, Math.sin(angle))
        .normalize();
      rotation.setFromUnitVectors(up, direction);
      shard.applyMatrix4(matrix.compose(offset, rotation, unitScale));

      shade.setHex(
        ICE_SHARD_SHADES[Math.floor(Math.random() * ICE_SHARD_SHADES.length)],
      );
      const vertices = shard.attributes.position.count;
      const colors = new Float32Array(vertices * 3);
      for (let v = 0; v < vertices; v++) {
        colors[v * 3] = shade.r;
        colors[v * 3 + 1] = shade.g;
        colors[v * 3 + 2] = shade.b;
      }
      shard.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      shards.push(shard);
    }

    // One mesh for the set: the shade lives in the vertices, so the variety
    // costs nothing at draw time.
    const merged = mergeGeometries(shards, false);
    for (const shard of shards) shard.dispose();
    this.frostShardMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      emissive: ICE_FREEZE_COLOR.clone().multiplyScalar(0.3),
      flatShading: true,
    });
    this.frostShardMesh = new THREE.Mesh(merged, this.frostShardMaterial);
    this.frostShardMesh.visible = false;
    this.root.add(this.frostShardMesh);
  }

  private createFrostShell(): void {
    this.frostShellMaterial = new THREE.MeshLambertMaterial({
      color: ICE_FREEZE_COLOR,
      emissive: ICE_FREEZE_COLOR.clone().multiplyScalar(0.5),
      flatShading: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    // Local units are the root's, which carries the shared visual scale.
    this.frostShellMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(ICE_SHELL_RADIUS / BASE_VISUAL_SCALE, 0),
      this.frostShellMaterial,
    );
    this.frostShellMesh.rotation.set(0.3, Math.random() * Math.PI, 0.18);
    this.frostShellMesh.visible = false;
    this.root.add(this.frostShellMesh);

    const glowSize = (ICE_SHELL_GLOW_RADIUS * 2) / BASE_VISUAL_SCALE;
    this.frostGlowMaterial = new THREE.MeshBasicMaterial({
      map: getFrostGlowTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.frostGlowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(glowSize, glowSize),
      this.frostGlowMaterial,
    );
    this.frostGlowMesh.rotation.x = -Math.PI / 2;
    this.frostGlowMesh.visible = false;
    this.root.add(this.frostGlowMesh);
  }

  /** Break the block: called when the freeze runs out or its host dies in it. */
  private emitFrostShatter(): void {
    this.vfx?.frostShatter(
      this.position.x,
      this.position.y,
      this.position.z,
    );
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
    const boss = this.kind === 'boss';
    const variant = thrower
      ? 0
      : addict
        ? 90 + (this.index % 2)
        : worker
          ? 80
          : boss
            ? 70
            : (this.index % 6) + 1;
    const url = thrower
      ? `${ZOMBIE_ASSET_ROOT}/zombie_city`
      : addict
        ? `${ZOMBIE_ASSET_ROOT}/PhoneAddict-${this.index % 2 === 0 ? '0-Woman' : '1-Man'}`
        : worker
          ? `${ZOMBIE_ASSET_ROOT}/zombie_worker`
          : boss
            ? `${ZOMBIE_ASSET_ROOT}/${DEFAULT_BOSS_ASSET}`
            : `${ZOMBIE_ASSET_ROOT}/Zed_${variant}`;
    void instantiateVoxelAsset(url, true)
      .then((model) => {
        if (this.disposed) {
          disposeModelMaterials(model);
          return;
        }
        if (boss) {
          // Height and ground offset depend on the definition, which is not
          // known until the wave starts; applyBossVisualSizing handles both and
          // is called again from applyBossBody on spawn.
          model.scale.setScalar(0.23);
        } else if (thrower || addict || worker) {
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
        this.loadedModel = model;
        // clear() detached the hammer along with the capsule fallback; a boss
        // carries it for its whole lifetime, so put it back.
        if (this.hammerPivot) this.visualRoot.add(this.hammerPivot);
        this.visualMaterials.length = 0;
        this.visualMaterials.push(...this.loadedMaterials);
        // A live boss was spawned before its model finished loading; resize and
        // tint the new model to its definition now.
        if (this.bossDef) this.applyBossVisualSizing();
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
