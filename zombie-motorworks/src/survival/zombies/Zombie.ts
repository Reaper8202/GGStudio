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
import {
  mergePoses,
  restPose as alchemistRestPose,
  throwPose as alchemistThrowPose,
  throwRecoverPose as alchemistRecoverPose,
  walkPose as alchemistWalkPose,
} from '../../tools/alchemistPose.ts';
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
  BOSS_HAMMER_COLOR,
  BOSS_HAMMER_HEAD,
  BOSS_HAMMER_RAISED_ANGLE,
  BOSS_HAMMER_SHAFT,
  BOSS_HAMMER_SHAFT_COLOR,
  BOSS_VIAL_PROP,
  BOSS_VIAL_PROP_COLOR,
  BOSS_VIAL_RAISED_ANGLE,
  BOSS_RING_COLOR,
  BOSS_RING_MIN_FRACTION,
  BOSS_RING_OPACITY,
  DEFAULT_BOSS_ASSET,
  type BossDefinition,
  type BossEncounter,
  type BossPoseSet,
  type BossVialAttack,
  type EliteBossSpec,
} from './bossConfig.ts';
import {
  ALCHEMIST_WALK_CADENCE,
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
  GAS_TRAIL_EMIT_DISTANCE_M,
  GUNSLINGER_TELEGRAPH_SECONDS,
  GUNSLINGER_VISUAL_HEIGHT,
  GUNSLINGER_WALK_CADENCE,
  HIT_FLASH_DURATION,
  ICE_TRAIL_EMIT_DISTANCE_M,
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
  VIAL_ATTACK_EXIT_MARGIN,
  WORKER_VISUAL_HEIGHT,
  ZAMBONI_COLOR_DARKEN,
  ZAMBONI_VISUAL_HEIGHT,
  ZAMBONI_WAYPOINT_ARRIVAL_M,
  ZOMBIE_ATTACK_EXIT_MARGIN,
  ZOMBIE_ATTACK_RANGE,
  ZOMBIE_HALF_HEIGHT,
  ZOMBIE_RADIUS,
} from './zombieConfig.ts';
import { devTuning } from '../devtuning/DevTuning.ts';

const ZOMBIE_GROUPS =
  (GROUP_ZOMBIE << 16) | (GROUP_TERRAIN | GROUP_VEHICLE | GROUP_ZOMBIE);
export const ZOMBIE_ASSET_ROOT = `${import.meta.env.BASE_URL}assets/zombies`;
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
  zamboni: { file: () => 'zamboni.glb', height: ZAMBONI_VISUAL_HEIGHT },
};

/** The numbered Zed exports share one voxel grid, so they need no fitting. */
const ZED_MODEL_SCALE = 0.23;

/** Reused by the boss height fit, which runs on spawn rather than per frame. */
const BOSS_FIT_SCRATCH = new THREE.Vector3();

/**
 * Which model file a zombie shows, relative to the zombie asset root.
 *
 * Pure and exported purely so the boss case can be tested. A boss pool slot is
 * built before the wave decides which boss fills it, so it preloads
 * `DEFAULT_BOSS_ASSET` and must switch to the definition's own `assetName` once
 * it has one. That indirection has been quietly flattened to a hard-coded
 * placeholder once already, and nothing failed — the wave-10 boss just silently
 * went back to being a scaled-up walker. `unit/zombie-models.test.ts` is the
 * guard.
 */
export function modelFileFor(
  kind: ZombieKind,
  index: number,
  bossDef: BossDefinition | null,
): string {
  if (kind === 'boss') return bossDef?.assetName ?? DEFAULT_BOSS_ASSET;
  const kindModel = KIND_MODELS[kind];
  return kindModel ? kindModel.file(index) : `Zed_${(index % 6) + 1}`;
}

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
  /**
   * Pose held while standing still with nothing else to play. Omitted by every
   * rig whose bind pose already IS its resting pose, which is all of them bar
   * the alchemist — that model was authored in a T-pose, so leaving its bones
   * at bind leaves both arms stuck straight out sideways.
   */
  readonly rest?: () => CharacterPose;
  /**
   * Follow-through played over the walk for `recoverSeconds` after a channel
   * releases, so the clip does not cut from mid-swing straight back to a walk
   * cycle. Upper body only; the walk keeps the legs.
   */
  readonly recover?: (progress: number) => CharacterPose;
  readonly recoverSeconds?: number;
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

/**
 * Pose curves for a classic boss, which `RIG_CLIPS` cannot cover: every boss
 * shares the one `'boss'` kind, so there is nothing per-boss to key on. The
 * definition names its `poseSet` instead, and a boss that names none renders
 * its model unanimated the way a boss with an unrigged placeholder always has.
 */
const BOSS_RIG_CLIPS: Record<BossPoseSet, RigClips> = {
  alchemist: {
    walk: alchemistWalkPose,
    // Driven by wind-up progress rather than by the attack cycle, so the vial
    // leaves the hand on the frame the arm reaches full extension — see
    // `bossWindupProgress`.
    channel: alchemistThrowPose,
    rest: alchemistRestPose,
    recover: alchemistRecoverPose,
    // Comfortably shorter than the 3.2 s throw interval, so the follow-through
    // has always finished before the next wind-up starts.
    recoverSeconds: 0.45,
    cadence: ALCHEMIST_WALK_CADENCE,
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
  /** Boss only: prop raised, telegraph running, the attack not yet released. */
  WindingUp = 'WindingUp',
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
  | 'behemoth'
  | 'zamboni'
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
  /** Set by ZombieSystem; fired when a slam boss's hammer wind-up completes. */
  onBossSlam: ((zombie: Zombie) => void) | null = null;
  /** Set by ZombieSystem; fired when a vial boss's wind-up completes. */
  onBossVials: ((zombie: Zombie) => void) | null = null;
  /** Set by ZombieSystem; fired when a necromancer's channel completes. */
  onSummon: ((zombie: Zombie) => void) | null = null;
  /** Set by ZombieSystem; fired when a kamikaze detonates, alive or dying. */
  onExplode: ((zombie: Zombie) => void) | null = null;
  /** Set by ZombieSystem; fired the instant a behemoth's slam lands. */
  onSmash: ((zombie: Zombie) => void) | null = null;
  /** Presentation event routed by ZombieSystem without coupling AI to audio. */
  onSfx: ((event: ZombieLocalSfxEvent, zombie: Zombie) => void) | null = null;
  /**
   * Set by ZombieSystem; fired every `ICE_TRAIL_EMIT_DISTANCE_M` a zamboni
   * moves, with its previous emission point, so the callback can lay one
   * connected segment from there to its current position.
   */
  onLayIce: ((zombie: Zombie, fromX: number, fromZ: number) => void) | null =
    null;
  /**
   * Set by ZombieSystem; fired every `GAS_TRAIL_EMIT_DISTANCE_M` the vial boss
   * moves, with its previous emission point, so the callback can lay one
   * connected gas segment from there to its current position. Same shape as
   * `onLayIce`.
   */
  onGasTrail: ((zombie: Zombie, fromX: number, fromZ: number) => void) | null =
    null;
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
  /**
   * Boss slots only: which `assetName` the slot is currently showing. A boss
   * pool slot is built before the wave picks which boss fills it, so it
   * preloads `DEFAULT_BOSS_ASSET`; this is what lets `applyBossBody` notice on
   * spawn that the boss actually wants a different model and reload. Without
   * it the slot keeps the placeholder for its whole life and every boss looks
   * like a scaled-up walker.
   */
  private loadedBossAssetName: string | null = null;
  /**
   * Boss slots only: the same primitive capsule every zombie starts with,
   * kept alive (and re-parented after the model loads) instead of being
   * discarded, so a `bodyVisual: 'capsule'` boss can show it permanently in
   * place of the voxel placeholder. Null for every non-boss pool slot.
   */
  private capsuleBodyMesh: THREE.Mesh | null = null;
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
  private appliedGlow: 'none' | 'flash' | 'frozen' | 'charmed' | 'slowed' =
    'none';
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
  /** Zamboni only: current patrol destination, world metres. */
  private patrolTargetX = 0;
  private patrolTargetZ = 0;
  /** Zamboni only: where its ice trail last emitted a segment from. */
  private iceTrailLastX = 0;
  private iceTrailLastZ = 0;
  /** Vial boss only: where its gas trail last emitted a segment from. */
  private gasTrailLastX = 0;
  private gasTrailLastZ = 0;
  private hammerPivot: THREE.Group | null = null;
  private vialArmPivot: THREE.Group | null = null;
  /** Live definition while a classic boss is active; null for every other zombie. */
  private bossDef: BossDefinition | null = null;
  /**
   * Set only on the one ordinary-kind spawn tagged as this wave's elite boss.
   * Every part of its behaviour still runs as an ordinary zombie of its kind —
   * this only adds a health/reward boost and a label for the HUD.
   */
  private eliteBoss: EliteBossSpec | null = null;
  private windupTimer = 0;
  /** Seconds left in the current raise channel; 0 when not channelling. */
  private summonTimer = 0;
  /** Seconds until this caster may channel again. */
  private summonCooldown = 0;
  /** Throttle for the rising motes emitted through a channel. */
  private channelVfxTimer = 0;

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
  /** Animatable bone nodes of a rigged GLB kind; empty for voxel kinds. */
  private readonly rigBones = new Map<BoneName, THREE.Object3D>();
  private readonly rigRestRotations = new Map<BoneName, THREE.Euler>();
  /** Seconds fed to the walk curves, advanced only while actually walking. */
  private rigWalkTime = 0;
  /** Pose curves for this zombie's model; null until a rigged one loads. */
  private rigClips: RigClips | null = null;
  /**
   * Seconds left of the follow-through after a boss releases its attack, while
   * `RigClips.recover` plays over the walk. Counts down in `updateVisuals`, so
   * it stops with the rest of the animation when the game is paused.
   */
  private rigRecoverTimer = 0;
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
    /** Zamboni only: candidate patrol destinations. Reuses the arena's spawn ring. */
    private readonly patrolPoints: readonly Vector3Like[] = [],
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
    // Only a boss slot ever needs this mesh back after the model loads (see
    // loadVoxelVisual and applyBossVisualSizing); every other kind lets clear()
    // discard it the way it always has.
    if (this.kind === 'boss') this.capsuleBodyMesh = fallback;
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
      this.kind === 'behemoth' ||
      this.kind === 'boss'
    ) {
      // Channel telegraph, shared by four mechanics: the worker arming a mine
      // and the necromancer calling a group up both pulse it repeatedly while
      // they stand still, the behemoth winds one up per slam, and a slam boss
      // expands it once per swing to mark exactly where the hammer is about to
      // land. Each wears its own kind's colour, so no two channels read alike.
      this.ringMaterial = new THREE.MeshBasicMaterial({
        color:
          this.kind === 'worker'
            ? 0xffb428
            : this.kind === 'necromancer'
              ? VFX_PALETTE.necro
              : this.kind === 'behemoth'
                ? BEHEMOTH_RING_COLOR
                : BOSS_RING_COLOR,
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
    // Both boss props are built up front: the pool slot exists long before the
    // wave picks which boss fills it. applyBossVisualSizing shows only the right
    // one, so an idle slot costs two hidden groups and nothing else.
    if (this.kind === 'boss') {
      this.buildHammer();
      this.buildVialArm();
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
    // Charmed zombies fight for the player, so they drop out of every
    // enemy-facing system: weapons, freeze/zap AoE, vehicle contacts, and the
    // charm sweep itself all key off isTargetable.
    return (
      this.isAlive &&
      this.state !== ZombieState.Spawning &&
      this.charmTimer <= 0
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

  /**
   * Identity for the HUD/telemetry, for either a classic boss or an elite one —
   * null for every zombie that isn't currently tagged as the wave's boss.
   */
  get bossLabel(): { id: string; name: string } | null {
    if (this.bossDef) return { id: this.bossDef.id, name: this.bossDef.name };
    if (this.eliteBoss) return { id: this.eliteBoss.id, name: this.eliteBoss.name };
    return null;
  }

  /** Wave-scaled damage one boss slam deals to each part inside its radius. */
  get slamDamage(): number {
    return this.bossDef ? this.attackDamage : 0;
  }

  /**
   * This boss's vial attack, or null for a slam boss and every ordinary zombie.
   * Narrowing once here keeps the `attack.kind` check out of the AI hot path.
   */
  private get vialAttack(): BossVialAttack | null {
    const attack = this.bossDef?.attack;
    return attack !== undefined && attack.kind === 'vial' ? attack : null;
  }

  /**
   * True once a phased boss has dropped to its second-phase health fraction. Only
   * a vial boss has phases today; everything else is always false.
   */
  get isEnraged(): boolean {
    const vial = this.vialAttack;
    if (vial === null || this.spawnHealth <= 0) return false;
    return this.health / this.spawnHealth <= vial.phaseTwoHealthFraction;
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
    // The shared boss slot is still showing whatever it last loaded — the
    // DEFAULT_BOSS_ASSET placeholder on a fresh slot, or the previous boss's
    // model on a recycled one. Only a `bodyVisual: 'model'` boss whose
    // `assetName` actually differs needs its model swapped out.
    if (
      def.bodyVisual === 'model' &&
      this.loadedBossAssetName !== def.assetName
    ) {
      this.loadVoxelVisual();
    }
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

    const slam = def.attack.kind === 'slam';
    // Both props are built for every boss pool slot, because the kind is known
    // before the definition is. Only the one this boss actually swings is shown.
    // Both props hang off a fixed shoulder point on the pool slot, not off a
    // bone, so they only make sense on a boss with no model to animate. A
    // `bodyVisual: 'model'` boss swings its own rigged arm instead (see
    // BOSS_RIG_CLIPS), and leaving the prop on would park a floating capsule
    // beside a boss already miming the throw.
    const showProps = def.bodyVisual === 'capsule';
    if (this.hammerPivot) {
      // Shoulder height, out to the side and slightly forward. The hammer is
      // authored for a 4.2 m boss and scales with any other.
      this.hammerPivot.position.set(
        def.visualHeightM * 0.28,
        groundOffset + def.visualHeightM * 0.72,
        def.visualHeightM * 0.18,
      );
      this.hammerPivot.scale.setScalar(def.visualHeightM / 4.2);
      this.hammerPivot.visible = slam && showProps;
    }
    if (this.vialArmPivot) {
      // Held further out and higher than the hammer, on a gaunt boss's long arm.
      this.vialArmPivot.position.set(
        def.visualHeightM * 0.17,
        groundOffset + def.visualHeightM * 0.78,
        def.visualHeightM * 0.1,
      );
      this.vialArmPivot.scale.setScalar(def.visualHeightM / 5.5);
      this.vialArmPivot.visible = !slam && showProps;
    }

    const widthScale = def.visualWidthScale ?? 1;
    // A capsule-body boss never shows the shared voxel placeholder, even once
    // it has loaded — primitive geometry is the point of it being built from a
    // capsule and vials rather than a reskinned walker. A model-body boss shows
    // the capsule only until its own model finishes loading, the same fallback
    // every other zombie kind uses in the meantime.
    const primitiveBody = def.bodyVisual === 'capsule';
    if (this.loadedModel) this.loadedModel.visible = !primitiveBody;
    if (!primitiveBody && this.loadedModel) {
      const bounds = new THREE.Box3().setFromObject(this.loadedModel);
      const height = Math.max(1e-3, bounds.max.y - bounds.min.y);
      // setFromObject measures through EVERY ancestor transform, not just the
      // model's own, so the divisor has to be the model's world scale. Using
      // its local scale here was a real bug: this runs from the async load
      // callback, which lands part-way through the spawn ramp, where
      // `updateVisuals` has left `root.scale` somewhere in lerp(0.05, 1). The
      // measured height came back shrunk by that factor and the fit was
      // inflated by its reciprocal — up to 20x if the model arrived on the
      // first frame — and nothing re-fitted afterwards, so the boss simply
      // stayed huge for the rest of the fight.
      const current =
        this.loadedModel.getWorldScale(BOSS_FIT_SCRATCH).y || 1;
      const fit = (def.visualHeightM / height) * current;
      // Non-uniform on purpose: the height fit alone would make a tall boss read
      // as a scaled-up walker. Squashing width is what makes it look gaunt.
      this.loadedModel.scale.set(fit * widthScale, fit, fit * widthScale);
      this.loadedModel.position.y = groundOffset;
      for (const material of this.loadedMaterials) {
        material.color.setHex(def.tint);
        material.needsUpdate = true;
      }
      if (this.capsuleBodyMesh) this.capsuleBodyMesh.visible = false;
      return;
    }

    // Capsule body: either the definition wants one permanently, or the model
    // has not finished loading yet. Stretched to the boss's height; width is
    // approximate for a model-body boss since the model replaces it on load.
    const fallbackHeight = (ZOMBIE_HALF_HEIGHT + ZOMBIE_RADIUS) * 2;
    if (this.capsuleBodyMesh) {
      const fit = def.visualHeightM / fallbackHeight;
      this.capsuleBodyMesh.scale.set(fit * widthScale, fit, fit * widthScale);
      this.capsuleBodyMesh.position.y = groundOffset + def.visualHeightM / 2;
      this.capsuleBodyMesh.visible = true;
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

  /**
   * Placeholder held vial: a primitive capsule on a shoulder pivot, built in
   * world metres like the hammer. It rests raised and levels out toward the
   * vehicle as the wind-up completes, so the release reads as a throw rather
   * than a swing.
   */
  private buildVialArm(): void {
    const pivot = new THREE.Group();
    const vial = new THREE.Mesh(
      new THREE.CapsuleGeometry(
        BOSS_VIAL_PROP.radius,
        BOSS_VIAL_PROP.length,
        3,
        6,
      ),
      new THREE.MeshLambertMaterial({
        color: BOSS_VIAL_PROP_COLOR,
        emissive: 0x2c5a12,
        flatShading: true,
      }),
    );
    vial.position.y = -BOSS_VIAL_PROP.length / 2;
    vial.castShadow = true;
    pivot.add(vial);
    this.vialArmPivot = pivot;
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
    boss: BossEncounter | null = null,
  ): void {
    if (this.disposed) return;
    this.active = true;
    this.state = ZombieState.Spawning;
    const base = devTuning.base;
    // A classic boss takes every stat from its definition rather than the
    // dev-tuner per-kind row; the wave multipliers still apply so a wave-20
    // boss is meaningfully tougher than a wave-5 one. Base speed is still the
    // tuner's, so the boss's speedMultiplier stays relative to the horde it
    // replaces. An elite boss is the opposite: it is an ordinary kind, so it
    // takes the normal per-kind row and only stacks a health multiplier and a
    // reward override on top — everything else about it, including its
    // animation and attack, is indistinguishable from an ordinary one.
    this.bossDef = this.kind === 'boss' && boss?.style === 'classic' ? boss.definition : null;
    this.eliteBoss = boss?.style === 'elite' && this.kind === boss.elite.kind ? boss.elite : null;
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
      this.health =
        base.health *
        healthMultiplier *
        stats.healthMult *
        (this.eliteBoss?.healthMultiplier ?? 1);
      this.moveSpeed = base.speed * speedMultiplier * stats.speedMult;
      this.attackDamage =
        base.attackDamage * attackDamageMultiplier * stats.damageMult;
      this.attackInterval = stats.attackInterval;
      this.reward = this.eliteBoss?.reward ?? stats.reward;
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
    this.iceTrailLastX = position.x;
    this.iceTrailLastZ = position.z;
    this.gasTrailLastX = position.x;
    this.gasTrailLastZ = position.z;
    if (this.kind === 'zamboni') this.pickPatrolTarget();
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
    // A recycled boss never arrives still finishing the last one's throw.
    this.rigRecoverTimer = 0;
    this.hitFlashTimer = 0;
    this.blinkTimer = 0;
    this.blinkWasOn = false;
    if (this.blinkMesh) this.blinkMesh.visible = false;
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
      material.emissive.setScalar(this.baseEmissive);
    this.detourSign = Math.random() < 0.5 ? -1 : 1;
    this.bobPhase = Math.random() * Math.PI * 2;
    // Offset the stride too, so a horde of rigged zombies never marches in step.
    this.rigWalkTime = Math.random() * 10;

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
    const newFull =
      base.health *
      healthMultiplier *
      stats.healthMult *
      (this.eliteBoss?.healthMultiplier ?? 1);
    this.spawnHealth = newFull;
    this.health = Math.max(1e-3, newFull * fraction);
    this.moveSpeed = base.speed * speedMultiplier * stats.speedMult;
    this.attackDamage =
      base.attackDamage * attackDamageMultiplier * stats.damageMult;
    this.attackInterval = stats.attackInterval;
    this.reward = this.eliteBoss?.reward ?? stats.reward;
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
      case ZombieState.WindingUp:
        this.stepWindingUp(dt);
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
    this.rigRecoverTimer = Math.max(0, this.rigRecoverTimer - dt);
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
      case ZombieState.WindingUp:
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
            const walk = this.rigClips.walk(this.rigWalkTime, {
              cadence: this.rigClips.cadence,
            });
            // A boss that just released a throw is already walking again, so
            // the follow-through plays over the walk rather than instead of it:
            // the arms finish the throw while the legs carry it away.
            const recover = this.rigClips.recover;
            const recoverSeconds = this.rigClips.recoverSeconds ?? 0;
            this.applyRigPose(
              recover && this.rigRecoverTimer > 0 && recoverSeconds > 0
                ? mergePoses(
                    walk,
                    recover(1 - this.rigRecoverTimer / recoverSeconds),
                  )
                : walk,
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
            } else if (
              channel &&
              this.state === ZombieState.WindingUp &&
              this.bossDef
            ) {
              // A boss telegraphs during WindingUp, not during Attacking —
              // Attacking is only the cooldown it stands through. Driving the
              // clip off the wind-up is what lands the release on the frame
              // `stepWindingUp` actually throws the vial.
              this.applyRigPose(channel(this.bossWindupProgress()));
            } else {
              this.applyRigPose(this.rigClips.rest?.() ?? REST_POSE);
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
    if (this.vialArmPivot && this.bossDef) {
      // Inverse of the hammer: the vial sits raised at rest and levels out to
      // aim as the wind-up completes, snapping back up over the lunge. The rig
      // sees the arm come down to throw just before the vial leaves.
      const windup = this.bossDef.attack.windupSeconds;
      if (this.state === ZombieState.WindingUp && windup > 0) {
        const aim = clamp(1 - this.windupTimer / windup, 0, 1);
        this.vialArmPivot.rotation.x = BOSS_VIAL_RAISED_ANGLE * (1 - aim);
      } else if (this.lungeTimer > 0) {
        const recover = 1 - this.lungeTimer / LUNGE_DURATION;
        this.vialArmPivot.rotation.x = BOSS_VIAL_RAISED_ANGLE * recover;
      } else {
        this.vialArmPivot.rotation.x = BOSS_VIAL_RAISED_ANGLE;
      }
    }
    if (this.frostGlowMesh) {
      // Same trick as the addict halo: pin the disc to the ground plane
      // regardless of what the root's animated scale is doing.
      const rootScale = this.root.scale.y || 1;
      this.frostGlowMesh.position.y = (0.05 - translation.y) / rootScale;
    }

    if (this.sigilGroup) this.updateSigil(dt, translation.y);
    if (
      this.ringMesh &&
      this.ringMaterial &&
      this.bossDef?.attack.kind === 'slam'
    ) {
      // One ring per swing, expanding to the exact slam radius so the player can
      // read where the hammer will land and drive out of it. Only a slam gets a
      // ring: a vial's puddle appears wherever the throw lands, not at the
      // boss's own feet, so a ring drawn here would point at the wrong ground.
      const winding = this.state === ZombieState.WindingUp && this.isAlive;
      this.ringMesh.visible = winding;
      if (winding) {
        const windup = this.bossDef.attack.windupSeconds;
        const charge =
          windup > 0 ? clamp(1 - this.windupTimer / windup, 0, 1) : 1;
        const rootScale = this.root.scale.y || 1;
        const radius =
          this.bossDef.attack.radiusM *
          (BOSS_RING_MIN_FRACTION + (1 - BOSS_RING_MIN_FRACTION) * charge);
        this.ringMesh.scale.setScalar(radius / rootScale);
        this.ringMesh.position.y = (0.1 - translation.y) / rootScale;
        this.ringMaterial.opacity = BOSS_RING_OPACITY * (0.4 + 0.6 * charge);
      }
    } else if (this.ringMesh && this.ringMaterial) {
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
    if (this.hammerPivot) {
      for (const child of this.hammerPivot.children) {
        if (!(child instanceof THREE.Mesh)) continue;
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
      this.hammerPivot.clear();
      this.hammerPivot = null;
    }
    if (this.vialArmPivot) {
      for (const child of this.vialArmPivot.children) {
        if (!(child instanceof THREE.Mesh)) continue;
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
      this.vialArmPivot.clear();
      this.vialArmPivot = null;
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
    if (this.kind === 'zamboni') {
      this.stepRoaming(dt, separationX, separationZ);
      return;
    }
    if (this.kind === 'boss') {
      // Runs regardless of which movement branch follows below (approach,
      // retreat, or the switch into Attacking) — the trail only cares that
      // the boss moved, not why.
      const traveledX = this.position.x - this.gasTrailLastX;
      const traveledZ = this.position.z - this.gasTrailLastZ;
      if (Math.hypot(traveledX, traveledZ) >= GAS_TRAIL_EMIT_DISTANCE_M) {
        this.onGasTrail?.(this, this.gasTrailLastX, this.gasTrailLastZ);
        this.gasTrailLastX = this.position.x;
        this.gasTrailLastZ = this.position.z;
      }
    }
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
    } else if (this.vialAttack !== null) {
      // A vial boss refuses to be fought at close range: inside its disengage
      // ring it backs away until it is past retreatRangeM, then throws again.
      // Its speed is still below a walker's, so this buys distance, not escape.
      const vial = this.vialAttack;
      if (this.retreating) {
        if (target.distance >= vial.retreatRangeM) {
          this.retreating = false;
        } else {
          away = -1;
        }
      } else if (target.distance <= vial.disengageRangeM) {
        this.retreating = true;
        away = -1;
      } else if (target.distance <= vial.rangeM) {
        // Deliberately does NOT reset attackTimer. A kiting boss crosses this
        // line constantly — every time the rig drifts in or out of its 14 m
        // hold — and re-arming the full interval on each crossing meant the
        // countdown almost never ran out, so it stood there and never threw.
        // stepWindingUp is what re-arms it, once a throw has actually gone off.
        this.state = ZombieState.Attacking;
        this.zeroHorizontalVelocity();
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
        const attackRange = this.bossDef
          ? this.bossDef.attack.rangeM
          : this.kind === 'thrower'
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
    this.resolveMovement(
      dt,
      targetDirX,
      targetDirZ,
      separationX,
      separationZ,
      away < 0 && this.vialAttack !== null ? { x: dx, z: dz } : null,
    );
  }

  /**
   * Zamboni only: ignore the vehicle entirely and walk between patrol
   * waypoints (the arena's spawn ring), laying a connected ice trail segment
   * every `ICE_TRAIL_EMIT_DISTANCE_M` it moves. Shares obstacle-probe/detour/
   * stuck handling with the ordinary chase via `resolveMovement`, so it
   * detours around the same obstacles a chasing zombie would.
   */
  private stepRoaming(
    dt: number,
    separationX: number,
    separationZ: number,
  ): void {
    const traveledX = this.position.x - this.iceTrailLastX;
    const traveledZ = this.position.z - this.iceTrailLastZ;
    if (Math.hypot(traveledX, traveledZ) >= ICE_TRAIL_EMIT_DISTANCE_M) {
      this.onLayIce?.(this, this.iceTrailLastX, this.iceTrailLastZ);
      this.iceTrailLastX = this.position.x;
      this.iceTrailLastZ = this.position.z;
    }

    const dx = this.patrolTargetX - this.position.x;
    const dz = this.patrolTargetZ - this.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < ZAMBONI_WAYPOINT_ARRIVAL_M) {
      this.pickPatrolTarget();
      return;
    }
    if (distance < 1e-4) {
      this.zeroHorizontalVelocity();
      return;
    }
    this.resolveMovement(
      dt,
      dx / distance,
      dz / distance,
      separationX,
      separationZ,
    );
  }

  /** Zamboni only: pick a new random patrol destination from the arena's spawn ring. */
  private pickPatrolTarget(): void {
    if (this.patrolPoints.length === 0) return;
    const point =
      this.patrolPoints[Math.floor(Math.random() * this.patrolPoints.length)];
    this.patrolTargetX = point.x;
    this.patrolTargetZ = point.z;
  }

  /**
   * Steer toward a unit direction, running it through the shared
   * obstacle-probe/detour/stuck handling every kind's locomotion uses,
   * whatever picked that direction — a chase target or a patrol waypoint.
   */
  private resolveMovement(
    dt: number,
    targetDirX: number,
    targetDirZ: number,
    separationX: number,
    separationZ: number,
    /**
     * Facing override toward the vehicle while backpedalling, so a retreating
     * vial boss reads as giving ground under fire rather than fleeing.
     */
    retreatFacing: { x: number; z: number } | null = null,
  ): void {
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
    if (retreatFacing) {
      this.updateFacing(retreatFacing.x, retreatFacing.z);
    } else {
      this.updateFacing(this.velocityScratch.x, this.velocityScratch.z);
    }
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
    // dodging the final ring. A boss is likewise interruptible, at its own
    // definition's reach rather than the shared melee one.
    const committed = this.kind === 'gunslinger' && this.gunslingerAimLocked;
    if (!committed) {
      // A vial boss gets a deliberately fat margin. Its cooldown only counts
      // down inside Attacking, so bouncing back to Chasing on a small overshoot
      // discarded the progress it had made and the throw kept being deferred —
      // a rig that simply kept driving could stall it almost indefinitely.
      // Overshooting its hold range now just means the vial is lobbed at wherever
      // the vehicle got to; only genuinely breaking away puts it back to chasing.
      const exitRange = this.bossDef
        ? this.bossDef.attack.rangeM +
          (this.vialAttack !== null
            ? VIAL_ATTACK_EXIT_MARGIN
            : ZOMBIE_ATTACK_EXIT_MARGIN)
        : this.kind === 'thrower'
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
    // A vial boss also abandons the throw when the rig closes on it, handing
    // back to stepChasing so the retreat starts immediately instead of after the
    // throw it was already lining up.
    const vial = this.vialAttack;
    if (vial !== null && target.distance <= vial.disengageRangeM) {
      this.retreating = true;
      this.state = ZombieState.Chasing;
      return;
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
      if (this.bossDef) {
        // Commit to the attack: the boss stops here and telegraphs, and the
        // damage is resolved when the wind-up completes, not now. Both attack
        // kinds telegraph; only the payload at the end differs.
        this.windupTimer = this.bossDef.attack.windupSeconds;
        this.ringPhase = 0;
        this.state = ZombieState.WindingUp;
        return;
      }
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
   * Boss wind-up. The boss holds still with its prop raised, tracking the vehicle
   * so the attack faces it — a slam also expands its ground ring here. The attack
   * fires once the timer elapses; because a slam's damage is applied at that
   * moment, driving out of the ring during the wind-up avoids it entirely, and a
   * vial is only aimed at the moment it is thrown.
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
    if (this.vialAttack !== null) {
      this.onBossVials?.(this);
    } else {
      this.onBossSlam?.(this);
    }
    // The pose was at full extension on this exact frame; hand it to the
    // follow-through so the arm finishes its arc over the walk that follows,
    // instead of cutting from mid-throw straight into a walk cycle.
    this.rigRecoverTimer = this.rigClips?.recoverSeconds ?? 0;
    this.lungeTimer = LUNGE_DURATION;
    this.attackTimer = this.attackInterval;
    this.state = ZombieState.Chasing;
  }

  /**
   * Pose progress across a boss's wind-up, 0 at the moment it commits and 1 on
   * the frame `stepWindingUp` fires the attack. Reading the same timer the
   * attack itself resolves on is what keeps the release and the projectile on
   * one clock rather than two hand-matched durations.
   */
  private bossWindupProgress(): number {
    const windup = this.bossDef?.attack.windupSeconds ?? 0;
    if (windup <= 0) return 1;
    return clamp(1 - this.windupTimer / windup, 0, 1);
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
    if (this.kind === 'zamboni') {
      // A single static mesh has no bodyparts to gib — it crumbles into a
      // small scatter of inert machine debris instead of gore.
      this.vfx?.zamboniCrumble(
        this.position.x,
        this.position.y,
        this.position.z,
      );
    } else {
      // Burst into this corpse's own voxels; specialists are bigger, so they
      // throw a correspondingly bigger cloud.
      this.vfx?.zombieGib(
        this.position.x,
        this.position.y,
        this.position.z,
        this.gibTintHex,
        this.kind === 'walker' ? 1 : 1.25,
      );
    }
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
    // A boss stays out of KIND_MODELS on purpose: that table fits a model to one
    // fixed height per kind, while a boss's height comes from its live
    // BossDefinition, so applyBossVisualSizing owns the fitting instead.
    const boss = this.kind === 'boss';
    // Pool construction preloads DEFAULT_BOSS_ASSET before any BossDefinition
    // is known; once a boss with its own asset actually spawns into this shared
    // slot, applyBossBody calls this again with bossDef set and the real model
    // takes over.
    const file = modelFileFor(this.kind, this.index, this.bossDef);
    const url = `${ZOMBIE_ASSET_ROOT}/${file}`;
    void instantiateVoxelAsset(url, true)
      .then((model) => {
        if (this.disposed) {
          disposeModelMaterials(model);
          return;
        }
        if (boss) {
          // Only a starting point: applyBossVisualSizing re-fits by bounds and
          // divides whatever scale is here back out, so it works for a Zed
          // placeholder and a bounds-fit boss asset alike. Height and ground
          // offset depend on the definition, which is not known until the wave
          // starts, so that call is what actually sizes this.
          model.scale.setScalar(ZED_MODEL_SCALE);
        } else if (kindModel) {
          // These models' voxel grids differ from the Zed exports; scale by
          // bounds to match the walkers' world height.
          const bounds = new THREE.Box3().setFromObject(model);
          const height = Math.max(1e-3, bounds.max.y - bounds.min.y);
          model.scale.setScalar(kindModel.height / height);
          if (this.kind === 'zamboni') {
            // The source model's nose-to-tail axis isn't authored along
            // local +Z the way every rigged/posed kind is (that's what
            // `updateFacing` steers), so a vehicle whose footprint is longer
            // in X than Z is lying sideways — square it up.
            const widthX = bounds.max.x - bounds.min.x;
            const depthZ = bounds.max.z - bounds.min.z;
            if (widthX > depthZ) model.rotation.y = Math.PI / 2;
          }
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
            // The source paint reads noticeably lighter than the rest of the
            // horde; darken the base colour that multiplies the vertex tint.
            if (this.kind === 'zamboni') {
              material.color.multiplyScalar(ZAMBONI_COLOR_DARKEN);
            }
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
        const previousModel = this.loadedModel;
        this.visualRoot.clear();
        this.visualRoot.add(model);
        this.loadedModel = model;
        if (boss) this.loadedBossAssetName = file;
        // A reload swapped a shared boss slot from one asset to another;
        // clear() only detached the old model, it never freed its GPU
        // resources, so that is on us once nothing still references it.
        if (previousModel && previousModel !== model) {
          disposeModelMaterials(previousModel);
        }
        // clear() detached everything else parented under visualRoot: a boss's
        // props, its capsule body (for a `bodyVisual: 'capsule'` boss, which
        // never actually shows this model), and the kamikaze's blink sphere all
        // live there for the pool slot's whole lifetime, so put them back.
        if (this.hammerPivot) this.visualRoot.add(this.hammerPivot);
        if (this.vialArmPivot) this.visualRoot.add(this.vialArmPivot);
        if (this.capsuleBodyMesh) this.visualRoot.add(this.capsuleBodyMesh);
        if (this.blinkMesh) this.visualRoot.add(this.blinkMesh);
        this.bindRigBones(model);
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
    // A boss's clips come from its definition, not its kind: every classic boss
    // shares the one `'boss'` kind, so `RIG_CLIPS` has nothing to key on.
    this.rigClips =
      this.rigBones.size === 0
        ? null
        : this.bossDef
          ? this.bossDef.poseSet
            ? BOSS_RIG_CLIPS[this.bossDef.poseSet]
            : null
          : (RIG_CLIPS[this.kind] ?? null);
    // A T-pose rig is wrong-looking in bind, so put it into its rest pose
    // immediately rather than leaving one frame of splayed arms up between the
    // model arriving and the first updateVisuals.
    if (this.rigClips?.rest) this.applyRigPose(this.rigClips.rest());
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
