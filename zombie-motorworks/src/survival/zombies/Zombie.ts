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
  smashPose as behemothSmashPose,
  SMASH_IMPACT as BEHEMOTH_SMASH_IMPACT,
  walkPose as behemothWalkPose,
} from '../../tools/behemothPose.ts';
import {
  shootPose as gunslingerShootPose,
  SHOT_R as GUNSLINGER_SHOT_PROGRESS,
  walkPose as gunslingerWalkPose,
} from '../../tools/gunslingerPose.ts';
import { runPose as kamikazeRunPose } from '../../tools/kamikazePose.ts';
import {
  castPose,
  walkPose as necromancerWalkPose,
} from '../../tools/necromancerPose.ts';
import {
  BONE_NAMES,
  type BoneName,
  type CharacterPose,
} from '../../tools/rigPose.ts';
import {
  BEHEMOTH_ATTACK_EXIT_MARGIN,
  BEHEMOTH_RING_COLOR,
  BEHEMOTH_SMASH_VFX_RADIUS,
  BEHEMOTH_VISUAL_HEIGHT,
  BEHEMOTH_WALK_CADENCE,
  DEATH_FEEDBACK_DURATION,
  DETOUR_BLEND,
  DETOUR_DURATION,
  GUNSLINGER_ATTACK_EXIT_MARGIN,
  GUNSLINGER_DRAW_SECONDS,
  GUNSLINGER_HIT_TOLERANCE,
  GUNSLINGER_LEAD_SECONDS,
  GUNSLINGER_LINE_LENGTH,
  GUNSLINGER_MUZZLE_HEIGHT,
  GUNSLINGER_SCOPE_ICON_SIZE,
  GUNSLINGER_SHOT_FLASH_SECONDS,
  GUNSLINGER_TELEGRAPH_OPACITY,
  GUNSLINGER_TELEGRAPH_SECONDS,
  GUNSLINGER_VISUAL_HEIGHT,
  GUNSLINGER_WALK_CADENCE,
  HIT_FLASH_DURATION,
  IMPACT_COOLDOWN_SECONDS,
  KAMIKAZE_BLINK_INTERVAL,
  KAMIKAZE_BLINK_OPACITY,
  KAMIKAZE_BLINK_RADIUS,
  KAMIKAZE_EXPLOSION_VFX_RADIUS,
  KAMIKAZE_RUN_CADENCE,
  KAMIKAZE_VISUAL_HEIGHT,
  KNOCKBACK_DURATION,
  KNOCKBACK_SPEED,
  LUNGE_DISTANCE,
  LUNGE_DURATION,
  NECROMANCER_CHANNEL_VFX_INTERVAL,
  NECROMANCER_SIGIL_OPACITY,
  NECROMANCER_SIGIL_OPEN_FRACTION,
  NECROMANCER_SIGIL_RADIUS,
  NECROMANCER_SIGIL_SPIN,
  NECROMANCER_SUMMON_COOLDOWN,
  NECROMANCER_VISUAL_HEIGHT,
  NECROMANCER_WALK_CADENCE,
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
/**
 * Resting self-lit level for a textured model. It is modulated by the model's
 * own `emissiveMap`, so it reads as the body's colours glowing rather than as
 * added light.
 */
const BASE_EMISSIVE = 0.25;
/**
 * A model with no texture — the rigged GLBs carry their paint in vertex
 * colours, which three.js applies to `color` but never to `emissive` — has
 * nothing to modulate the glow, so any base emissive lands as flat white on
 * top of the paint and washes the whole body out. Those models rest at black
 * and are lit by the scene alone.
 */
const UNTEXTURED_BASE_EMISSIVE = 0;
const HIT_FLASH_COLOR = new THREE.Color(0xffffff);
/** Turquoise glow applied to a frozen zombie's body while its freeze lasts. */
const ICE_FREEZE_COLOR = new THREE.Color(VFX_PALETTE.ice);
const ICE_FREEZE_EMISSIVE = 0.85;
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
/** Bind pose: every bone back at its rest rotation. */
const REST_POSE: CharacterPose = { bones: {}, rootLift: 0 };
/**
 * How much of a channel clip a channel actually plays. The cast clip winds up,
 * punches down at 0.65, then settles back to rest. A channel ends on that
 * downbeat, so the group arrives on the slam rather than a beat after it.
 */
const CHANNEL_CLIP_RELEASE = 0.65;
/** How fast the summoning sigil burns off once the channel ends, per second. */
const SIGIL_FADE_OUT_RATE = 2.6;
const BASE_VISUAL_SCALE = 1.85;
const BODY_TINTS = [0x4c6b3f, 0x5a7247, 0x3f5c48, 0x6b5a3f, 0x556b4c, 0x47614a];
const warnedVisualModels = new Set<string>();

export type ZombieLocalSfxEvent =
  'melee' | 'gunslinger' | 'kamikazeTick' | 'death';

/**
 * The model a kind wears, for every kind that does not use the numbered Zed
 * walker exports. `file` is relative to the zombie asset root, and takes the
 * pool index so a kind can spread itself across several exports.
 */
interface KindModel {
  readonly file: (index: number) => string;
  /** World height the model is fitted to, before the root's `baseScale`. */
  readonly height: number;
}

const KIND_MODELS: Partial<Record<ZombieKind, KindModel>> = {
  thrower: { file: () => 'zombie_city', height: THROWER_VISUAL_HEIGHT },
  'phone-addict': {
    file: (index) => `PhoneAddict-${index % 2 === 0 ? '0-Woman' : '1-Man'}`,
    height: PHONE_ADDICT_VISUAL_HEIGHT,
  },
  worker: { file: () => 'zombie_worker', height: WORKER_VISUAL_HEIGHT },
  gunslinger: {
    file: () => 'gunslinger.rigged.glb',
    height: GUNSLINGER_VISUAL_HEIGHT,
  },
  necromancer: {
    file: () => 'necromancer.rigged.glb',
    height: NECROMANCER_VISUAL_HEIGHT,
  },
  kamikaze: {
    file: () => 'kamikaze.rigged.glb',
    height: KAMIKAZE_VISUAL_HEIGHT,
  },
  behemoth: {
    file: () => 'behemoth.rigged.glb',
    height: BEHEMOTH_VISUAL_HEIGHT,
  },
};

/** The numbered Zed exports share one voxel grid, so they need no fitting. */
const ZED_MODEL_SCALE = 0.23;

/**
 * Pose curves for the rigged GLB kinds. Every rig in `glb-rigger` shares one
 * bone vocabulary, so a kind only has to name which curves drive it.
 */
interface RigClips {
  readonly walk: (
    time: number,
    options?: { readonly cadence?: number },
  ) => CharacterPose;
  /** One-shot clip driven by 0..1 channel progress, for kinds that channel. */
  readonly channel?: (progress: number) => CharacterPose;
  readonly cadence: number;
}

const RIG_CLIPS: Partial<Record<ZombieKind, RigClips>> = {
  gunslinger: {
    walk: gunslingerWalkPose,
    channel: gunslingerShootPose,
    cadence: GUNSLINGER_WALK_CADENCE,
  },
  necromancer: {
    walk: necromancerWalkPose,
    channel: castPose,
    cadence: NECROMANCER_WALK_CADENCE,
  },
  kamikaze: {
    walk: kamikazeRunPose,
    cadence: KAMIKAZE_RUN_CADENCE,
  },
  behemoth: {
    walk: behemothWalkPose,
    channel: behemothSmashPose,
    cadence: BEHEMOTH_WALK_CADENCE,
  },
};

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

/** Small scope reticle marking a gunslinger's locked impact point: a ring with four outward ticks. */
let scopeTexture: THREE.CanvasTexture | null = null;
function getScopeTexture(): THREE.CanvasTexture {
  if (scopeTexture) return scopeTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const radius = size * 0.3;
  ctx.strokeStyle = '#ff2a00';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, radius, 0, Math.PI * 2);
  ctx.stroke();
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(c + dx * radius, c + dy * radius);
    ctx.lineTo(
      c + dx * (radius + size * 0.14),
      c + dy * (radius + size * 0.14),
    );
    ctx.stroke();
  }
  scopeTexture = new THREE.CanvasTexture(canvas);
  return scopeTexture;
}

/** Violet halo under the necromancer, shown only while it is channelling. */
function getNecroGlowTexture(): THREE.CanvasTexture {
  return getGlowTexture(
    'rgba(230, 204, 255, 0.9)',
    'rgba(155, 77, 255, 0.45)',
    'rgba(44, 10, 82, 0)',
  );
}

/**
 * The two halves of the summoning sigil, drawn once and shared by every caster.
 * `outer` is the runic band that reads as a boundary; `inner` is the glyph
 * inside it. They live on separate planes so they can counter-rotate, which is
 * what makes a flat decal read as machinery turning rather than a sticker.
 */
const sigilTextures = new Map<'outer' | 'inner', THREE.CanvasTexture>();
function getNecroSigilTexture(part: 'outer' | 'inner'): THREE.CanvasTexture {
  const cached = sigilTextures.get(part);
  if (cached) return cached;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const centre = size / 2;
  // Additive blending eats the alpha channel, so the sigil is drawn as light
  // on black rather than as strokes on transparency.
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(180, 110, 255, 0.9)';

  if (part === 'outer') {
    ctx.strokeStyle = 'rgba(214, 176, 255, 0.95)';
    ctx.shadowBlur = 10;
    // Two concentric rails with the runic band between them.
    for (const radius of [0.95, 0.78]) {
      ctx.lineWidth = radius > 0.9 ? 3 : 5;
      ctx.beginPath();
      ctx.arc(centre, centre, centre * radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Runes: short radial ticks, every fourth one doubled and longer, so the
    // band has a readable rhythm as it turns.
    const runes = 24;
    for (let i = 0; i < runes; i++) {
      const angle = (i / runes) * Math.PI * 2;
      const major = i % 4 === 0;
      const inner = centre * (major ? 0.79 : 0.83);
      const outer = centre * (major ? 0.94 : 0.9);
      ctx.lineWidth = major ? 6 : 3;
      ctx.beginPath();
      ctx.moveTo(
        centre + Math.cos(angle) * inner,
        centre + Math.sin(angle) * inner,
      );
      ctx.lineTo(
        centre + Math.cos(angle) * outer,
        centre + Math.sin(angle) * outer,
      );
      ctx.stroke();
      if (!major) continue;
      // Crossbar on the major runes; enough shape to read as writing.
      const crossAngle = angle + Math.PI / 2;
      const mid = centre * 0.865;
      const arm = centre * 0.045;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(
        centre + Math.cos(angle) * mid - Math.cos(crossAngle) * arm,
        centre + Math.sin(angle) * mid - Math.sin(crossAngle) * arm,
      );
      ctx.lineTo(
        centre + Math.cos(angle) * mid + Math.cos(crossAngle) * arm,
        centre + Math.sin(angle) * mid + Math.sin(crossAngle) * arm,
      );
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = 'rgba(190, 140, 255, 0.9)';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(centre, centre, centre * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    // Interlocked triangles inscribed in that circle: the classic summoning
    // star, and the only part of the sigil that turns the other way.
    for (const offset of [0, Math.PI]) {
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const angle = offset + (i / 3) * Math.PI * 2 - Math.PI / 2;
        const x = centre + Math.cos(angle) * centre * 0.62;
        const y = centre + Math.sin(angle) * centre * 0.62;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    // Nodes on the star's points, the brightest thing in the whole figure.
    ctx.fillStyle = 'rgba(240, 220, 255, 0.95)';
    ctx.shadowBlur = 18;
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(
        centre + Math.cos(angle) * centre * 0.62,
        centre + Math.sin(angle) * centre * 0.62,
        centre * 0.035,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  sigilTextures.set(part, texture);
  return texture;
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
  /** Necromancer only: standing still while channelling a raise. */
  Summoning = 'Summoning',
  KnockedBack = 'KnockedBack',
  Dead = 'Dead',
}

export type ZombieKilledCallback = (reward: number, kind: ZombieKind) => void;

export type ZombieKind =
  | 'walker'
  | 'gunslinger'
  | 'necromancer'
  | 'thrower'
  | 'phone-addict'
  | 'worker'
  | 'kamikaze'
  | 'behemoth';

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

  state = ZombieState.Dead;
  active = false;
  /** Set by ZombieSystem; fired when a thrower's attack timer elapses. */
  onThrow: ((zombie: Zombie) => void) | null = null;
  /** Set by ZombieSystem; fired when a worker's mine-plant timer elapses. */
  onPlantMine: ((zombie: Zombie) => void) | null = null;
  /** Set by ZombieSystem; fired when a necromancer's channel completes. */
  onSummon: ((zombie: Zombie) => void) | null = null;
  /** Set by ZombieSystem; fired when a kamikaze detonates, alive or dying. */
  onExplode: ((zombie: Zombie) => void) | null = null;
  /** Set by ZombieSystem; fired the instant a behemoth's slam lands. */
  onSmash: ((zombie: Zombie) => void) | null = null;
  /** Presentation event routed by ZombieSystem without coupling AI to audio. */
  onSfx: ((event: ZombieLocalSfxEvent, zombie: Zombie) => void) | null = null;
  readonly kind: ZombieKind;

  private readonly visualRoot = new THREE.Group();
  private readonly fallbackMaterial: THREE.MeshLambertMaterial;
  private readonly loadedMaterials: THREE.MeshLambertMaterial[] = [];
  private readonly visualMaterials: THREE.MeshLambertMaterial[] = [];
  private readonly baseScale: number;
  /** Body tint this corpse's gibs are cut from, as an sRGB hex. */
  private readonly gibTintHex: number;
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
  /** Kamikaze only: chest-light warning blink, on for as long as it is running. */
  private blinkMesh: THREE.Mesh | null = null;
  private blinkMaterial: THREE.MeshBasicMaterial | null = null;
  /** Seconds into the current on/off half-cycle. */
  private blinkTimer = 0;
  /** Tracks the visual edge so the warning tick fires once per light pulse. */
  private blinkWasOn = false;
  /** Necromancer only: the summoning sigil, alive only during a channel. */
  private sigilGroup: THREE.Group | null = null;
  private readonly sigilLayers: {
    readonly layer: 'halo' | 'outer' | 'inner';
    readonly mesh: THREE.Mesh;
    readonly material: THREE.MeshBasicMaterial;
  }[] = [];
  /** Sigil rotation phase, rad; kept across a channel so it never snaps back. */
  private sigilSpin = 0;
  /** 0..1 presence of the sigil, so it scribes in and burns out rather than pops. */
  private sigilFade = 0;
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
  private appliedGlow: 'none' | 'flash' | 'frozen' | 'slowed' = 'none';
  private ringMesh: THREE.Mesh | null = null;
  private ringMaterial: THREE.MeshBasicMaterial | null = null;
  private ringPhase = 0;
  /**
   * Gunslinger only: a raw barrel-to-target segment marking the locked
   * predicted impact point, with a small scope icon at the far end. Both are
   * written once, when the point locks, and held — a genuinely static
   * telegraph, not a live-tracking beam. The same line stands in for the
   * shot itself, flashing bright rather than a travelling projectile.
   */
  private telegraphLine: THREE.Line | null = null;
  private telegraphMaterial: THREE.LineBasicMaterial | null = null;
  private readonly telegraphPositions = new Float32Array(6);
  private scopeSprite: THREE.Sprite | null = null;
  /** World point the current cycle's shot is locked onto. */
  private gunslingerAimX = 0;
  private gunslingerAimY = 0;
  private gunslingerAimZ = 0;
  /** True once this cycle has locked a point, so the lock only happens once. */
  private gunslingerAimLocked = false;
  /** True once this cycle's shot has fired, so it fires once. */
  private gunslingerShotFired = false;
  /** Seconds left in the shot's bright flash before the line hides again. */
  private gunslingerFlashTimer = 0;
  /** True once this cycle's slam has already landed, so it lands once. */
  private behemothSmashed = false;
  /** Scratch for the muzzle world position, read off the gun-arm bone. */
  private readonly muzzleScratch = { x: 0, y: 0, z: 0 };
  private readonly boneWorldScratch = new THREE.Vector3();
  private plantTimer = 0;
  /** Seconds left in the current raise channel; 0 when not channelling. */
  private summonTimer = 0;
  /** Seconds until this caster may channel again. */
  private summonCooldown = 0;
  /** Throttle for the rising motes emitted through a channel. */
  private channelVfxTimer = 0;

  private health = 0;
  /** Full health at spawn, so live re-tuning can preserve the damage fraction. */
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
  /** Seconds of remaining ice-fire slow; while >0 move speed scales by slowFactor. */
  private slowTimer = 0;
  private slowFactor = 1;
  private bobPhase = 0;
  /** Animatable bone nodes of a rigged GLB kind; empty for voxel kinds. */
  private readonly rigBones = new Map<BoneName, THREE.Object3D>();
  private readonly rigRestRotations = new Map<BoneName, THREE.Euler>();
  /** Seconds fed to the walk curves, advanced only while actually walking. */
  private rigWalkTime = 0;
  /** Pose curves for this zombie's model; null until a rigged one loads. */
  private rigClips: RigClips | null = null;
  /** Resting emissive for whichever model this zombie actually loaded. */
  private baseEmissive = BASE_EMISSIVE;
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
    if (this.kind === 'necromancer') {
      // Nothing marks this one while it walks — its height does that. The
      // ground only goes purple once it plants its feet to cast, so violet on
      // the floor always means a raise is happening right now. The sigil is a
      // soft halo with two counter-turning runic decals stacked on it.
      const sigilSize = (NECROMANCER_SIGIL_RADIUS * 2) / BASE_VISUAL_SCALE;
      this.sigilGroup = new THREE.Group();
      this.sigilGroup.visible = false;
      for (const layer of ['halo', 'outer', 'inner'] as const) {
        const material = new THREE.MeshBasicMaterial({
          map:
            layer === 'halo'
              ? getNecroGlowTexture()
              : getNecroSigilTexture(layer),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        // The halo bleeds past the runes so the light looks like it is coming
        // out of the ground rather than off a decal.
        const scale = layer === 'halo' ? 1.35 : layer === 'outer' ? 1 : 0.86;
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(sigilSize * scale, sigilSize * scale),
          material,
        );
        mesh.rotation.x = -Math.PI / 2;
        // Split the layers by a hair of height to keep them from z-fighting.
        mesh.position.y =
          layer === 'halo' ? 0 : layer === 'outer' ? 0.01 : 0.02;
        this.sigilLayers.push({ layer, mesh, material });
        this.sigilGroup.add(mesh);
      }
      this.root.add(this.sigilGroup);
    }
    if (
      this.kind === 'worker' ||
      this.kind === 'necromancer' ||
      this.kind === 'behemoth'
    ) {
      // Channel telegraph: a flat ring that repeatedly expands from a zombie
      // standing still to finish something — the worker arming a mine, the
      // necromancer calling a group up, the behemoth winding up a slam —
      // pulsing faster near completion. Each wears its own kind's colour, so
      // no two channels read alike.
      this.ringMaterial = new THREE.MeshBasicMaterial({
        color:
          this.kind === 'worker'
            ? 0xffb428
            : this.kind === 'behemoth'
              ? BEHEMOTH_RING_COLOR
              : VFX_PALETTE.necro,
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
    if (this.kind === 'kamikaze') {
      // A small chest-mounted light, so a bomber lost in a crowd of walkers
      // still reads as "about to go off" before it is on top of the vehicle.
      // Parented to visualRoot (not root) so it bobs and lunges with the body
      // like any other part of the model, rather than staying ground-pinned
      // the way the addict's floor glow does.
      this.blinkMaterial = new THREE.MeshBasicMaterial({
        color: VFX_PALETTE.kamikazeWarn,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.blinkMesh = new THREE.Mesh(
        new THREE.SphereGeometry(
          KAMIKAZE_BLINK_RADIUS / BASE_VISUAL_SCALE,
          10,
          8,
        ),
        this.blinkMaterial,
      );
      this.blinkMesh.position.y =
        -(ZOMBIE_HALF_HEIGHT + ZOMBIE_RADIUS) + KAMIKAZE_VISUAL_HEIGHT * 0.8;
      this.blinkMesh.visible = false;
      this.visualRoot.add(this.blinkMesh);
    }
    if (this.kind === 'gunslinger') {
      // World-space, not parented under root: its endpoints are written once
      // in world coordinates when the point locks, so there is nothing a
      // parent transform would buy here.
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(this.telegraphPositions, 3),
      );
      this.telegraphMaterial = new THREE.LineBasicMaterial({
        color: VFX_PALETTE.kamikazeWarn,
        transparent: true,
        opacity: GUNSLINGER_TELEGRAPH_OPACITY,
        depthWrite: false,
        // The line is meant to read as a fixed 25m marker, not a physical
        // object the terrain or the car body can slice into — without this,
        // whatever the line passes behind swallows part of it, so the same
        // 25m segment reads as a different length shot to shot depending on
        // what it happens to cross.
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
      this.telegraphLine = new THREE.Line(geometry, this.telegraphMaterial);
      this.telegraphLine.frustumCulled = false;
      this.telegraphLine.renderOrder = 1;
      this.telegraphLine.visible = false;
      this.scene.add(this.telegraphLine);

      this.scopeSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getScopeTexture(),
          transparent: true,
          depthWrite: false,
          depthTest: false,
        }),
      );
      this.scopeSprite.scale.setScalar(GUNSLINGER_SCOPE_ICON_SIZE);
      this.scopeSprite.renderOrder = 1;
      this.scopeSprite.visible = false;
      this.scene.add(this.scopeSprite);
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
    const base = devTuning.base;
    const stats = devTuning.types[this.kind];
    this.health = base.health * healthMultiplier * stats.healthMult;
    this.spawnHealth = this.health;
    this.moveSpeed = base.speed * speedMultiplier * stats.speedMult;
    this.attackDamage =
      base.attackDamage * attackDamageMultiplier * stats.damageMult;
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
    // A recycled caster arrives rested: it channels once it has closed to
    // range, not on whatever was left of its last cooldown.
    this.summonTimer = 0;
    this.summonCooldown = 0;
    this.channelVfxTimer = 0;
    // No caster is ever recycled still standing in half of its own circle.
    this.sigilFade = 0;
    if (this.sigilGroup) this.sigilGroup.visible = false;
    this.lungeTimer = 0;
    this.hitFlashTimer = 0;
    this.blinkTimer = 0;
    this.blinkWasOn = false;
    if (this.blinkMesh) this.blinkMesh.visible = false;
    this.freezeTimer = 0;
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
      material.emissive.setScalar(this.baseEmissive);
    this.detourSign = Math.random() < 0.5 ? -1 : 1;
    this.bobPhase = Math.random() * Math.PI * 2;
    // Offset the stride too, so a horde of rigged zombies never marches in step.
    this.rigWalkTime = Math.random() * 10;

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
    const stats = devTuning.types[this.kind];
    const fraction =
      this.spawnHealth > 0
        ? Math.max(0, Math.min(1, this.health / this.spawnHealth))
        : 1;
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
    this.health -= damage;
    this.state = ZombieState.KnockedBack;
    this.knockbackTimer = KNOCKBACK_DURATION;

    const length = Math.hypot(dirX, dirZ) || 1;
    const impulseMagnitude = this.body.mass() * KNOCKBACK_SPEED;
    this.impulseScratch.x = (dirX / length) * impulseMagnitude;
    this.impulseScratch.y = 0;
    this.impulseScratch.z = (dirZ / length) * impulseMagnitude;
    this.body.applyImpulse(this.impulseScratch, true);

    if (this.health > 0) return 'damaged';
    this.die();
    return 'killed';
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

    // Ticked below the freeze gate, so time spent iced over is not time spent
    // recharging a summon.
    if (this.summonCooldown > 0) {
      this.summonCooldown = Math.max(0, this.summonCooldown - dt);
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
      case ZombieState.Summoning:
        this.stepSummoning(dt);
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
    this.vfx?.freezeEncase(this.position.x, this.position.y, this.position.z);
  }

  /** True while an Ice Cannon freeze is holding this zombie. */
  get isFrozen(): boolean {
    return this.freezeTimer > 0;
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

    // Emissive and tint are written through every body material, so they are
    // only touched when the look actually changes. A walker crossing the
    // graveyard in its resting state — the overwhelming majority of the horde,
    // every frame — costs nothing here.
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
      const amount =
        this.baseEmissive + (this.hitFlashTimer / HIT_FLASH_DURATION) * 0.75;
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
        material.emissive.setScalar(this.baseEmissive);
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
    if (this.blinkMesh && this.blinkMaterial) {
      const running = this.state === ZombieState.Chasing && this.isAlive;
      this.blinkMesh.visible = running;
      if (running) {
        this.blinkTimer += dt;
        if (this.blinkTimer >= KAMIKAZE_BLINK_INTERVAL) {
          this.blinkTimer -= KAMIKAZE_BLINK_INTERVAL;
        }
        // A hard on/off snap rather than a smooth pulse — reads as a light
        // flashing, not something breathing.
        const on = this.blinkTimer < KAMIKAZE_BLINK_INTERVAL * 0.5;
        this.blinkMaterial.opacity = on ? KAMIKAZE_BLINK_OPACITY : 0;
        if (on && !this.blinkWasOn) this.onSfx?.('kamikazeTick', this);
        this.blinkWasOn = on;
      } else {
        this.blinkWasOn = false;
      }
    }
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
      case ZombieState.Summoning:
      case ZombieState.KnockedBack:
        this.root.scale.setScalar(this.baseScale);
        this.setOpacity(1);
        if (this.state === ZombieState.Chasing) {
          this.bobPhase += dt * WALK_BOB_FREQUENCY;
          this.visualRoot.position.y =
            Math.sin(this.bobPhase) * WALK_BOB_AMPLITUDE;
          // A rigged kind walks with its own legs; the bob above stays as the
          // weight shift under every zombie visual, rigged or voxel.
          if (this.rigClips) {
            this.rigWalkTime += dt;
            this.applyRigPose(
              this.rigClips.walk(this.rigWalkTime, {
                cadence: this.rigClips.cadence,
              }),
            );
          }
        } else {
          this.visualRoot.position.y = 0;
          if (this.rigClips) {
            // A channel is the one thing a rigged zombie does standing still.
            // Its clip is driven by how far through the channel it is, so the
            // arms rise on the same clock as the effect they cause — witch-
            // light for a summon, the draw-and-fire for a gunslinger's shot —
            // instead of on their own timer. Everything else holds the bind pose.
            const channel = this.rigClips.channel;
            if (channel && this.state === ZombieState.Summoning) {
              const progress = clamp(
                1 -
                  this.summonTimer /
                    Math.max(
                      1e-3,
                      devTuning.specialist.necromancerSummonSeconds,
                    ),
                0,
                1,
              );
              this.applyRigPose(channel(progress * CHANNEL_CLIP_RELEASE));
            } else if (
              channel &&
              this.state === ZombieState.Attacking &&
              this.kind === 'gunslinger'
            ) {
              this.applyRigPose(channel(this.gunslingerPoseProgress()));
            } else if (
              channel &&
              this.state === ZombieState.Attacking &&
              this.kind === 'behemoth'
            ) {
              this.applyRigPose(channel(this.behemothPoseProgress()));
            } else {
              this.applyRigPose(REST_POSE);
            }
          }
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
    if (this.frostGlowMesh) {
      // Same trick as the addict halo: pin the disc to the ground plane
      // regardless of what the root's animated scale is doing.
      const rootScale = this.root.scale.y || 1;
      this.frostGlowMesh.position.y = (0.05 - translation.y) / rootScale;
    }
    if (this.sigilGroup) this.updateSigil(dt, translation.y);
    if (this.ringMesh && this.ringMaterial) {
      const worker = this.state === ZombieState.Planting;
      // A behemoth keeps the ring lit only through its own wind-up — once
      // the slam has landed the Attacking state carries on into recovery,
      // which the ring has no business marking.
      const behemothWindingUp =
        this.kind === 'behemoth' &&
        this.state === ZombieState.Attacking &&
        !this.behemothSmashed;
      const channelling =
        (worker || this.state === ZombieState.Summoning || behemothWindingUp) &&
        this.isAlive;
      this.ringMesh.visible = channelling;
      if (channelling) {
        // Each pulse expands from the zombie and fades; pulses come faster as
        // the channel nears completion, whichever channel it is.
        const charge = clamp(
          worker
            ? 1 - this.plantTimer / devTuning.specialist.workerPlantSeconds
            : behemothWindingUp
              ? this.behemothPoseProgress() / BEHEMOTH_SMASH_IMPACT
              : 1 -
                this.summonTimer /
                  devTuning.specialist.necromancerSummonSeconds,
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
    if (this.telegraphLine && this.telegraphMaterial) {
      // Endpoints were written once, when the point locked (see
      // lockGunslingerAim) — this only ever toggles visibility and opacity,
      // which is what keeps the line genuinely static rather than tracking
      // anything live. The same line stands in for the shot itself: once
      // fired it just flashes at full brightness and fades, no separate mesh.
      if (this.gunslingerFlashTimer > 0) {
        this.gunslingerFlashTimer = Math.max(0, this.gunslingerFlashTimer - dt);
      }
      const flashing = this.gunslingerFlashTimer > 0 && this.isAlive;
      const telegraphing =
        this.state === ZombieState.Attacking &&
        this.gunslingerAimLocked &&
        !this.gunslingerShotFired &&
        this.isAlive;
      const visible = telegraphing || flashing;
      this.telegraphLine.visible = visible;
      if (this.scopeSprite) this.scopeSprite.visible = visible;
      if (flashing) {
        this.telegraphMaterial.opacity =
          this.gunslingerFlashTimer / GUNSLINGER_SHOT_FLASH_SECONDS;
      } else if (telegraphing) {
        this.telegraphMaterial.opacity = GUNSLINGER_TELEGRAPH_OPACITY;
      }
    }
  }

  /**
   * The summoning sigil, for the length of a channel and no longer. It scribes
   * itself open over the first fraction of the cast, turns faster and burns
   * brighter as the raise charges, then fades out just behind the group it
   * called — long enough for the burst to land inside its own circle.
   */
  private updateSigil(dt: number, translationY: number): void {
    if (!this.sigilGroup) return;
    const channelling = this.state === ZombieState.Summoning && this.isAlive;
    const charge = channelling
      ? clamp(
          1 - this.summonTimer / devTuning.specialist.necromancerSummonSeconds,
          0,
          1,
        )
      : 1;
    if (channelling) {
      this.sigilFade = clamp(charge / NECROMANCER_SIGIL_OPEN_FRACTION, 0, 1);
    } else {
      this.sigilFade = Math.max(0, this.sigilFade - dt * SIGIL_FADE_OUT_RATE);
    }

    this.sigilGroup.visible = this.sigilFade > 0.001;
    if (!this.sigilGroup.visible) return;

    // Turn accelerates with the charge, so the circle visibly winds up.
    this.sigilSpin += dt * NECROMANCER_SIGIL_SPIN * (1 + 2 * charge);
    const rootScale = this.root.scale.y || 1;
    // Breathing pulse that quickens alongside the expanding telegraph ring.
    const pulse =
      0.82 + 0.18 * Math.sin(this.sigilSpin * (4 + 6 * charge) + charge * 6);
    const open = this.sigilFade * this.sigilFade * (3 - 2 * this.sigilFade);
    this.sigilGroup.position.y = (0.045 - translationY) / rootScale;
    this.sigilGroup.scale.setScalar(
      ((0.4 + 0.6 * open) * BASE_VISUAL_SCALE) / rootScale,
    );

    for (const { layer, mesh, material } of this.sigilLayers) {
      // The halo is the diffuse light the runes sit in, so it stays softer and
      // does all its pulsing; the rune bands counter-turn over the top of it.
      if (layer === 'halo') {
        material.opacity =
          NECROMANCER_SIGIL_OPACITY * this.sigilFade * (0.4 + 0.35 * pulse);
        continue;
      }
      mesh.rotation.z =
        layer === 'outer' ? this.sigilSpin : this.sigilSpin * -1.4;
      material.opacity =
        NECROMANCER_SIGIL_OPACITY *
        this.sigilFade *
        (layer === 'inner' ? 0.7 + 0.3 * charge : 1) *
        (0.7 + 0.3 * pulse);
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
    if (this.telegraphLine) {
      this.scene.remove(this.telegraphLine);
      this.telegraphMaterial?.dispose();
      this.telegraphLine.geometry.dispose();
    }
    if (this.scopeSprite) {
      this.scene.remove(this.scopeSprite);
      (this.scopeSprite.material as THREE.SpriteMaterial).dispose();
    }
    if (this.blinkMesh) {
      this.blinkMaterial?.dispose();
      this.blinkMesh.geometry.dispose();
    }
    for (const { mesh, material } of this.sigilLayers) {
      material.dispose();
      mesh.geometry.dispose();
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
      if (
        this.kind === 'kamikaze' &&
        target.distance <= devTuning.specialist.kamikazeDetonateRange
      ) {
        // Closed to arm's length: go off right where it stands rather than
        // settling into the ordinary melee loop. die() carries the explosion
        // itself, so every way a kamikaze can die — this, a bullet, a ram —
        // detonates it exactly once through the same path.
        this.health = 0;
        this.die();
        return;
      }
      if (
        this.kind === 'necromancer' &&
        this.summonCooldown <= 0 &&
        target.distance <= devTuning.specialist.necromancerSummonRange
      ) {
        // In range and rested: plant its feet and call a group up. Like the
        // worker's channel this commits wherever the vehicle then goes, so the
        // player can always drive away from a raise they saw start.
        this.summonTimer = devTuning.specialist.necromancerSummonSeconds;
        this.ringPhase = 0;
        this.channelVfxTimer = 0;
        this.state = ZombieState.Summoning;
        this.zeroHorizontalVelocity();
        this.updateFacing(dx, dz);
        return;
      }
      // Kamikazes never melee: between detonate range and here they just keep
      // closing distance, so the gap above only shortens until they arm.
      if (this.kind !== 'kamikaze') {
        const attackRange =
          this.kind === 'thrower'
            ? devTuning.specialist.throwerAttackRange
            : this.kind === 'gunslinger'
              ? devTuning.specialist.gunslingerAttackRange
              : this.kind === 'behemoth'
                ? devTuning.specialist.behemothAttackRange
                : ZOMBIE_ATTACK_RANGE;
        if (target.distance <= attackRange) {
          this.state = ZombieState.Attacking;
          // Throwers wind up quickly on arrival instead of a full idle interval.
          this.attackTimer =
            this.kind === 'thrower'
              ? this.attackInterval * 0.5
              : this.attackInterval;
          this.gunslingerAimLocked = false;
          this.gunslingerShotFired = false;
          this.behemothSmashed = false;
          this.zeroHorizontalVelocity();
          return;
        }
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
    const speed =
      this.slowTimer > 0 ? this.moveSpeed * this.slowFactor : this.moveSpeed;
    this.velocityScratch.x = dirX * speed + separationX;
    this.velocityScratch.y = velocity.y;
    this.velocityScratch.z = dirZ * speed + separationZ;
    this.body.setLinvel(this.velocityScratch, true);
    this.updateFacing(this.velocityScratch.x, this.velocityScratch.z);
  }

  private stepAttacking(dt: number, vehicle: RuntimeVehicle): void {
    this.zeroHorizontalVelocity();
    const target = this.vehicleTarget;
    // Once a gunslinger is aiming down the sights (the point has locked) it
    // is committed the same way a necromancer or worker channel is: the shot
    // is going off wherever the vehicle ends up, range be damned, rather than
    // aborting because the vehicle happened to drive back out of range. A
    // behemoth is not: its wind-up only lands a hit on something still near
    // where it is standing, so a vehicle that puts real distance between
    // itself and the wind-up aborts the swing outright rather than merely
    // dodging the final ring.
    const committed = this.kind === 'gunslinger' && this.gunslingerAimLocked;
    if (!committed) {
      const exitRange =
        this.kind === 'thrower'
          ? devTuning.specialist.throwerAttackRange + THROWER_ATTACK_EXIT_MARGIN
          : this.kind === 'gunslinger'
            ? devTuning.specialist.gunslingerAttackRange +
              GUNSLINGER_ATTACK_EXIT_MARGIN
            : this.kind === 'behemoth'
              ? devTuning.specialist.behemothAttackRange +
                BEHEMOTH_ATTACK_EXIT_MARGIN
              : ZOMBIE_ATTACK_RANGE + ZOMBIE_ATTACK_EXIT_MARGIN;
      if (target.partId === null || target.distance > exitRange) {
        this.state = ZombieState.Chasing;
        return;
      }
    }

    if (this.kind === 'gunslinger' && committed) {
      // Facing locks with the shot rather than swivelling to keep tracking a
      // target that may already be out of range.
      this.updateFacing(
        this.gunslingerAimX - this.position.x,
        this.gunslingerAimZ - this.position.z,
      );
    } else {
      // A behemoth's own hit is centred on itself rather than a locked point
      // elsewhere, so it just keeps facing wherever the vehicle actually is.
      this.updateFacing(target.x - this.position.x, target.z - this.position.z);
    }
    this.attackTimer -= dt;
    if (this.kind === 'gunslinger') {
      // Three beats, timed off wall-clock seconds rather than a fraction of
      // the cycle, so tuning attackInterval can't smear the recoil beats into
      // slow motion: draw the guns up, hold that aim while the telegraph
      // locks and sits static, then let the round go and play the recoil.
      const elapsed = this.attackInterval - this.attackTimer;
      if (!this.gunslingerAimLocked && elapsed >= GUNSLINGER_DRAW_SECONDS) {
        this.lockGunslingerAim(vehicle);
      }
      if (!this.gunslingerShotFired && this.gunslingerAimLocked) {
        const posePosition = this.gunslingerPoseProgress();
        if (posePosition >= GUNSLINGER_SHOT_PROGRESS) {
          this.gunslingerShotFired = true;
          this.onSfx?.('gunslinger', this);
          this.fireGunslingerShot(vehicle);
        }
      }
      if (this.attackTimer <= 0) {
        this.attackTimer = this.attackInterval;
        this.gunslingerAimLocked = false;
        this.gunslingerShotFired = false;
      }
      return;
    }
    if (this.kind === 'behemoth') {
      // The slam lands the instant the pose crosses its own impact frame —
      // reading the clip's own exported boundary rather than a separately
      // hand-kept "seconds" threshold is what keeps the animation and the
      // area hit perfectly in sync (see fireGunslingerShot's shot for the
      // same idea). AOE math against vehicle parts lives in ZombieSystem,
      // which is the one holding the anchors to walk; this only owns the
      // effect and the callback that reaches over there.
      if (
        !this.behemothSmashed &&
        this.behemothPoseProgress() >= BEHEMOTH_SMASH_IMPACT
      ) {
        this.behemothSmashed = true;
        // A physical ground-pound, not a blast: chunky rubble and dust, no
        // bright flash or glow — see VfxSystem.groundSmash for why.
        this.vfx?.groundSmash(
          this.position.x,
          this.position.y,
          this.position.z,
          BEHEMOTH_SMASH_VFX_RADIUS,
        );
        this.onSmash?.(this);
      }
      if (this.attackTimer <= 0) {
        this.attackTimer = this.attackInterval;
        this.behemothSmashed = false;
      }
      return;
    }
    if (this.attackTimer <= 0) {
      this.attackTimer = this.attackInterval;
      if (this.kind === 'thrower') {
        this.onThrow?.(this);
      } else if (target.partId !== null) {
        // Always true here in practice — the top-of-function guard already
        // returned otherwise for every kind but gunslinger, which never
        // reaches this branch — but the guard is now conditional on
        // `committed`, so the type checker needs it spelled out again.
        this.onSfx?.('melee', this);
        vehicle.applyDirectDamage(target.partId, this.attackDamage);
      }
      this.lungeTimer = LUNGE_DURATION;
    }
  }

  /**
   * Pose progress for the behemoth's Attacking channel: unlike the
   * gunslinger's three hand-timed beats, `smashPose` already spends its own
   * fixed fractions on wind-up/release/settle, so the whole cycle maps
   * straight onto elapsed/attackInterval with nothing extra to keep in sync.
   */
  private behemothPoseProgress(): number {
    return clamp(
      (this.attackInterval - this.attackTimer) /
        Math.max(1e-3, this.attackInterval),
      0,
      1,
    );
  }

  /**
   * Pose progress for the gunslinger's Attacking channel, mapped through its
   * own three real-time phases rather than straight off attackTimer — draw
   * maps onto shootPose's own aim-up ramp (0..0.3), the telegraph hold freezes
   * it there, and firing/holstering (which also carries both of shootPose's
   * shot beats) spends whatever of the cycle is left after those two.
   */
  private gunslingerPoseProgress(): number {
    const elapsed = this.attackInterval - this.attackTimer;
    if (elapsed <= GUNSLINGER_DRAW_SECONDS) {
      return (elapsed / GUNSLINGER_DRAW_SECONDS) * 0.3;
    }
    const telegraphEnd = GUNSLINGER_DRAW_SECONDS + GUNSLINGER_TELEGRAPH_SECONDS;
    if (elapsed <= telegraphEnd) return 0.3;
    const recoverSeconds = Math.max(1e-3, this.attackInterval - telegraphEnd);
    const recoverProgress = clamp(
      (elapsed - telegraphEnd) / recoverSeconds,
      0,
      1,
    );
    return 0.3 + recoverProgress * 0.7;
  }

  /**
   * Lock this cycle's shot onto a predicted point rather than the vehicle's
   * current position: a straight lead off the vehicle's own velocity, over a
   * lead time shorter than the telegraph hold so the lock stays close to
   * where the vehicle actually is. The telegraph line itself is just a fixed
   * 25m ray from the muzzle through that point, with the scope icon parked
   * at its far end — everything is written once and held, since it's all
   * frozen the instant the point locks.
   */
  private lockGunslingerAim(vehicle: RuntimeVehicle): void {
    this.gunslingerAimLocked = true;
    const target = this.vehicleTarget;
    const bodyVelocity = vehicle.body.linvel();
    this.gunslingerAimX = target.x + bodyVelocity.x * GUNSLINGER_LEAD_SECONDS;
    this.gunslingerAimY = target.y;
    this.gunslingerAimZ = target.z + bodyVelocity.z * GUNSLINGER_LEAD_SECONDS;

    this.computeMuzzlePosition();
    const dx = this.gunslingerAimX - this.muzzleScratch.x;
    const dy = this.gunslingerAimY - this.muzzleScratch.y;
    const dz = this.gunslingerAimZ - this.muzzleScratch.z;
    const length = Math.hypot(dx, dy, dz) || 1e-3;
    const lineEndX =
      this.muzzleScratch.x + (dx / length) * GUNSLINGER_LINE_LENGTH;
    const lineEndY =
      this.muzzleScratch.y + (dy / length) * GUNSLINGER_LINE_LENGTH;
    const lineEndZ =
      this.muzzleScratch.z + (dz / length) * GUNSLINGER_LINE_LENGTH;
    this.telegraphPositions[0] = this.muzzleScratch.x;
    this.telegraphPositions[1] = this.muzzleScratch.y;
    this.telegraphPositions[2] = this.muzzleScratch.z;
    this.telegraphPositions[3] = lineEndX;
    this.telegraphPositions[4] = lineEndY;
    this.telegraphPositions[5] = lineEndZ;
    const position = this.telegraphLine?.geometry.getAttribute('position') as
      THREE.BufferAttribute | undefined;
    if (position) position.needsUpdate = true;
    this.telegraphMaterial?.color.setHex(VFX_PALETTE.kamikazeWarn);
    this.scopeSprite?.position.set(lineEndX, lineEndY, lineEndZ);
  }

  /**
   * Let the shot go. There is no travelling round: the same telegraph line
   * just flashes bright for a beat, and damage lands immediately if the
   * vehicle is still close enough to the point the telegraph locked onto —
   * a vehicle that moved off it is a clean dodge.
   */
  private fireGunslingerShot(vehicle: RuntimeVehicle): void {
    this.gunslingerFlashTimer = GUNSLINGER_SHOT_FLASH_SECONDS;
    this.telegraphMaterial?.color.setHex(VFX_PALETTE.sparkHot);
    if (this.telegraphMaterial) this.telegraphMaterial.opacity = 1;
    this.vfx?.muzzleFlash(
      {
        x: this.telegraphPositions[0],
        y: this.telegraphPositions[1],
        z: this.telegraphPositions[2],
      },
      {
        x: this.gunslingerAimX,
        y: this.gunslingerAimY,
        z: this.gunslingerAimZ,
      },
      'sniper-light',
    );
    const target = this.vehicleTarget;
    if (target.partId === null) return;
    const dx = target.x - this.gunslingerAimX;
    const dy = target.y - this.gunslingerAimY;
    const dz = target.z - this.gunslingerAimZ;
    if (
      dx * dx + dy * dy + dz * dz <=
      GUNSLINGER_HIT_TOLERANCE * GUNSLINGER_HIT_TOLERANCE
    ) {
      vehicle.applyDirectDamage(target.partId, this.attackDamage);
    }
  }

  /**
   * World position the round actually leaves from. The revolver is rigged
   * onto the right forearm (see gunslingerPose.ts), so that bone's own world
   * matrix is the real muzzle once the model has loaded; a fixed height
   * offset covers the capsule fallback and the brief window before it loads.
   */
  private computeMuzzlePosition(): void {
    const bone = this.rigBones.get('armR_fore');
    if (bone) {
      // Bone rotations were just written this frame (applyRigPose) but
      // matrixWorld only refreshes on the render traversal; walk the one
      // ancestor chain up to root now so the read reflects this frame, not
      // last frame's pose.
      bone.updateWorldMatrix(true, false);
      this.boneWorldScratch.setFromMatrixPosition(bone.matrixWorld);
      this.muzzleScratch.x = this.boneWorldScratch.x;
      this.muzzleScratch.y = this.boneWorldScratch.y;
      this.muzzleScratch.z = this.boneWorldScratch.z;
      return;
    }
    const translation = this.body.translation();
    this.muzzleScratch.x = translation.x;
    this.muzzleScratch.y = translation.y + GUNSLINGER_MUZZLE_HEIGHT;
    this.muzzleScratch.z = translation.z;
  }

  /**
   * Stand still calling the dead up. Witch-light rises off the caster for the
   * whole channel and builds as the raise charges, and the group only arrives
   * if it is allowed to finish — kill it mid-channel and nothing is raised.
   */
  private stepSummoning(dt: number): void {
    this.zeroHorizontalVelocity();
    this.channelVfxTimer -= dt;
    if (this.channelVfxTimer <= 0) {
      this.channelVfxTimer = NECROMANCER_CHANNEL_VFX_INTERVAL;
      this.vfx?.necroticChannel(
        this.position.x,
        this.position.y - ZOMBIE_HALF_HEIGHT,
        this.position.z,
        clamp(
          1 - this.summonTimer / devTuning.specialist.necromancerSummonSeconds,
          0,
          1,
        ),
      );
    }
    this.summonTimer -= dt;
    if (this.summonTimer > 0) return;
    this.summonTimer = 0;
    this.onSummon?.(this);
    this.summonCooldown = NECROMANCER_SUMMON_COOLDOWN;
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
    this.onSfx?.('death', this);
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
    if (this.kind === 'kamikaze') {
      // The gib burst above still plays — this is on top of it, not instead —
      // so every kamikaze death reads as a body blowing apart, whichever way
      // it died. Vehicle-part damage needs the vehicle anchors ZombieSystem
      // holds, so that side of the blast is left to the onExplode callback;
      // this only owns the effect itself.
      this.vfx?.explosion(
        this.position.x,
        this.position.y,
        this.position.z,
        KAMIKAZE_EXPLOSION_VFX_RADIUS,
      );
      this.onExplode?.(this);
    }
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
      this.frostShellFade *
      (1 + Math.sin(this.frostShellFade * Math.PI) * 0.14);
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
      const shard = new THREE.ConeGeometry(
        baseRadius * size,
        length,
        4,
      ).translate(0, length / 2, 0);

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
    this.vfx?.frostShatter(this.position.x, this.position.y, this.position.z);
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
    const kindModel = KIND_MODELS[this.kind];
    const url = `${ZOMBIE_ASSET_ROOT}/${kindModel ? kindModel.file(this.index) : `Zed_${(this.index % 6) + 1}`}`;
    void instantiateVoxelAsset(url, true)
      .then((model) => {
        if (this.disposed) {
          disposeModelMaterials(model);
          return;
        }
        if (kindModel) {
          // These models' voxel grids differ from the Zed exports; scale by
          // bounds to match the walkers' world height.
          const bounds = new THREE.Box3().setFromObject(model);
          const height = Math.max(1e-3, bounds.max.y - bounds.min.y);
          model.scale.setScalar(kindModel.height / height);
        } else {
          model.scale.setScalar(ZED_MODEL_SCALE);
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
            // An untextured model has no emissiveMap to tint the glow, so it
            // rests at black instead of wearing a flat white wash.
            this.baseEmissive = material.map
              ? BASE_EMISSIVE
              : UNTEXTURED_BASE_EMISSIVE;
            material.emissive.setScalar(this.baseEmissive);
            material.needsUpdate = true;
            this.loadedMaterials.push(material);
          }
        });
        this.visualRoot.clear();
        this.visualRoot.add(model);
        // clear() also drops the kamikaze blink sphere added in the
        // constructor, since it too is parented under visualRoot.
        if (this.blinkMesh) this.visualRoot.add(this.blinkMesh);
        this.bindRigBones(model);
        this.visualMaterials.length = 0;
        this.visualMaterials.push(...this.loadedMaterials);
        const opacity = this.visualOpacity;
        this.visualOpacity = -1;
        this.setOpacity(opacity);
      })
      .catch((error: unknown) => {
        if (warnedVisualModels.has(url)) return;
        warnedVisualModels.add(url);
        console.warn(
          `Zombie model "${url}" unavailable; using capsule fallback.`,
          error,
        );
      });
  }

  /**
   * Cache a rigged model's bone nodes and their bind rotations, so a pose can
   * be written as a delta off the bind pose the way the preview page does. An
   * unrigged voxel model has none of these names in it, which is what leaves
   * `rigClips` null and every pose call skipped.
   */
  private bindRigBones(model: THREE.Object3D): void {
    this.rigBones.clear();
    this.rigRestRotations.clear();
    for (const name of BONE_NAMES) {
      const node = model.getObjectByName(name);
      if (!node) continue;
      this.rigBones.set(name, node);
      this.rigRestRotations.set(name, node.rotation.clone());
    }
    this.rigClips =
      this.rigBones.size > 0 ? (RIG_CLIPS[this.kind] ?? null) : null;
  }

  /** Write one pose onto the cached bones; a no-op for unrigged kinds. */
  private applyRigPose(pose: CharacterPose): void {
    for (const [name, node] of this.rigBones) {
      const rest = this.rigRestRotations.get(name)!;
      const delta = pose.bones[name];
      node.rotation.set(
        rest.x + (delta?.rx ?? 0),
        rest.y + (delta?.ry ?? 0),
        rest.z + (delta?.rz ?? 0),
      );
    }
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
