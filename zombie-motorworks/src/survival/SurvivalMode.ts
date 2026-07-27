/**
 * Survival runtime: the editor blueprint vehicle, the graveyard world,
 * pooled zombie AI, wave pacing, HUD, and the existing fixed-step damage path.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { effectiveFreeze, effectiveShield } from '../core/abilities.ts';
import { evaluateWaveBadges, type WaveResultStats } from '../core/badges.ts';
import {
  combineEnvironments,
  hazardEnvironment,
  hazardIntensity,
  type BiomeHazardSpec,
  type EnvironmentModifiers,
} from '../core/biomes.ts';
import { repairPlan } from '../core/economy.ts';
import type { RunState } from '../core/economy.ts';
import {
  leaderboardRows,
  type LeaderboardRow,
  type RunOutcome,
} from '../core/leaderboard.ts';
import { getPartDef } from '../core/parts.ts';
import { addScore, killScore, waveClearScore } from '../core/score.ts';
import { deriveConnections } from '../core/structural.ts';
import {
  MINE_SWEEPER_MINIMAP_LEVEL,
  mineSweeperRadius,
} from '../core/turretModules.ts';
import type { Vec3, VehicleBlueprint } from '../core/types.ts';
import { buildWaveTimeline, type WaveTimeline } from '../core/waveTimeline.ts';
import { randomSeed } from '../core/rng.ts';
import { badgeStore } from '../app/badgeStore.ts';
import { isSfxMuted, playSfx, setSfxMuted, unlockAudio } from '../app/sfx.ts';
import type { RuntimePart } from '../runtime/assembler.ts';
import { buildPartMesh } from '../editor/meshes.ts';
import { lowestPointM } from '../runtime/assembler.ts';
import {
  RuntimeVehicle,
  brakeInputWithAutoHold,
  type VehicleControls,
} from '../runtime/vehicle.ts';
import type { TracerShot } from '../runtime/weapons.ts';
import { wheelVisualCentre } from '../runtime/wheels.ts';
import { createToggle } from '../ui/system.ts';
import { ScopeCursor } from '../ui/ScopeCursor.ts';
import { VfxSystem } from '../vfx/VfxSystem.ts';
import { WarningHud } from './WarningHud.ts';
import { DamageNumbersOverlay } from './DamageNumbers.ts';
import { TracerRenderer, tracerStyleForWeapon } from './Tracers.ts';
import {
  activeVehicleWarnings,
  HULL_CRITICAL_PCT,
  type VehicleWarning,
} from './vehicleWarnings.ts';
import { impactKindForShot, muzzleStyleForShot } from '../vfx/shotVfx.ts';
import { FuelPickups } from './FuelPickups.ts';
import { AutoAim } from './AutoAim.ts';
import { FollowCamera } from './FollowCamera.ts';
import type { Arena } from './arena/Arena.ts';
import { ArenaBuilder } from './arena/ArenaBuilder.ts';
import { DEFAULT_BIOME_ID, getBiome } from './arena/recipes/index.ts';
import { Minimap } from './Minimap.ts';
import {
  WaveManager,
  attackDamageMultiplierForWave,
  healthMultiplierForWave,
  speedMultiplierForWave,
  zombieCompositionForWave,
  zombieCountForWave,
} from './WaveManager.ts';
import {
  formatWaveComposition,
  newThreatsForWave,
  threatWarningsForWave,
} from './waveBalance.ts';
import {
  WaveClearCard,
  type WaveClearCardView,
  type WaveClearRepairOffer,
} from './WaveClearCard.ts';
import { WaveTimelineHud } from './WaveTimelineHud.ts';
import { ZombieSystem } from './zombies/ZombieSystem.ts';
import { isDevMode } from './devtuning/devMode.ts';
import { devTuning, subscribeTuning } from './devtuning/DevTuning.ts';
import { DevTunerPanel } from './devtuning/DevTunerPanel.ts';
import {
  BASE_ZOMBIE_STATS,
  LETHAL_IMPACT_SPEED,
  MIN_IMPACT_SPEED,
  ZOMBIE_HALF_HEIGHT,
  ZOMBIE_RADIUS,
} from './zombies/zombieConfig.ts';
import type { ZombieKind } from './zombies/Zombie.ts';

const FIXED_DT = 1 / 60;
const COUNTDOWN_SECONDS = 3;
// These are shared immutable options, not per-shot literals: the firing loop
// runs at physics rate and the tracer pool must stay allocation-free.
const TRACER_OPTIONS = [
  undefined,
  { faded: true },
  { emp: true },
  { faded: true, emp: true },
  { piercing: true },
  { faded: true, piercing: true },
  { emp: true, piercing: true },
  { faded: true, emp: true, piercing: true },
  { secondary: true },
  { faded: true, secondary: true },
  { emp: true, secondary: true },
  { faded: true, emp: true, secondary: true },
  { piercing: true, secondary: true },
  { faded: true, piercing: true, secondary: true },
  { emp: true, piercing: true, secondary: true },
  { faded: true, emp: true, piercing: true, secondary: true },
] as const;
/** Radius of the Shield Generator bubble, generous enough to enclose most rigs. */
const SHIELD_BUBBLE_RADIUS_M = 3.4;
const STUCK_PROMPT_SECONDS = 1.6;
const RECOVERY_COOLDOWN_SECONDS = 2.25;
const RECOVERY_SETTLE_SECONDS = 0.42;
/** How often the alert stack is re-derived from vehicle state. */
const WARNING_REFRESH_INTERVAL_SECONDS = 0.25;
/** Distance at which a blast stops shaking the camera at all, m. */
const CAMERA_SHAKE_FALLOFF_M = 26;

export interface SurvivalCallbacks {
  profileMoney(): number;
  runEarnings(): number;
  /**
   * Charge `cost` for a full repair bought from the wave-clear card and
   * re-base the run checkpoint as undamaged. Returns false when the wallet
   * cannot cover it.
   */
  onRepairAll(cost: number): boolean;
  onReward(amount: number): number;
  onExit(run: RunState): void;
  onWaveAdvance(
    run: RunState,
    survivingPartIds: readonly string[],
    partHp: Record<string, number>,
    kills: number,
    score: number,
  ): void;
  onBuildPhase(
    run: RunState,
    survivingPartIds: readonly string[],
    partHp: Record<string, number>,
    kills: number,
    score: number,
  ): void;
  /** Commit the next wave's start state as soon as a clear is resolved. */
  onWaveCheckpoint?(
    run: RunState,
    survivingPartIds: readonly string[],
    partHp: Record<string, number>,
    kills: number,
    score: number,
  ): void;
  /**
   * The run is over. App records the score, wipes the garage back to a fresh
   * start, and returns where this run placed so the overlay can show it.
   * The mode stays alive until `onGameOverContinue`.
   */
  onGameOver(
    run: RunState,
    pendingMoneyDiscarded: number,
    score: number,
    kills: number,
  ): RunOutcome;
  /** Dismiss the game-over overlay and open the freshly reset garage. */
  onGameOverContinue(): void;
  onResetWave(run: RunState): void;
  onCheatInfiniteMoney(): void;
  /** Lifetime progression: a Phone Addict died, which unlocks the EMP module. */
  onPhoneAddictKilled(): void;
  /** Lifetime progression: `wave` was fully cleared. */
  onWaveCleared(wave: number): void;
  /**
   * Persist the run so the player can close the tab and pick it up later.
   * Mid-wave zombie state is not restorable, so App persists its wave-start
   * checkpoint rather than this live vehicle state.
   */
  onSaveAndQuit(snapshot: { wave: number; kills: number; score: number }): void;
}

export interface WaveClearPayload {
  clearedRun: RunState;
  nextRun: RunState;
  survivingPartIds: readonly string[];
  partHp: Record<string, number>;
  kills: number;
  score: number;
}

/** Shared payload for both choices offered after a cleared wave. */
export function createWaveClearPayload(
  clearedWave: number,
  survivingPartIds: readonly string[],
  partHp: Readonly<Record<string, number>>,
  kills: number,
  score: number,
): WaveClearPayload {
  return {
    clearedRun: { wave: clearedWave },
    nextRun: { wave: clearedWave + 1 },
    survivingPartIds: [...survivingPartIds],
    partHp: { ...partHp },
    kills,
    score,
  };
}

export type SurvivalPhase = 'countdown' | 'active' | 'cleared' | 'gameOver';

export interface SurvivalTelemetry {
  mode: 'survival';
  kills: number;
  /** Arcade run score, as shown on the HUD and submitted at game over. */
  score: number;
  phoneAddictKills: number;
  wave: number;
  zombiesAlive: number;
  money: number;
  runMoney: number;
  phase: SurvivalPhase;
  partHp: Record<string, number>;
  integrityPct: number;
  vehiclePos: [number, number, number];
  /** Debug-only: body rotation quaternion (collision/upright diagnostics). */
  rotation: [number, number, number, number];
  /** Debug-only: body angular velocity, rad/s (collision spin diagnostics). */
  angvel: [number, number, number];
  /** Debug-only: follow camera world position (camera bugs/regressions). */
  cameraPos: [number, number, number];
  /** Debug-only: wheels currently loaded on the ground (collision diagnostics). */
  groundedWheels: number;
  weapons: {
    partId: string;
    aimMode: 'auto' | 'manual';
    shotsFired: number;
  }[];
  wheels: {
    partId: string;
    worldCentre: [number, number, number];
  }[];
}

type ZombieShotTarget = Pick<
  ZombieSystem,
  'hitZombieHandle' | 'isShieldedTarget' | 'slowZombieHandle'
>;

/** Apply one hit chain and report whether its secondary tracer may continue. */
export function applyZombieShot(
  zombies: ZombieShotTarget,
  shot: TracerShot,
  direction: Vec3,
): boolean {
  if (shot.hitZombieHandle === null) return false;
  const canSlow = shot.slowFactor > 0 && shot.slowDurationSeconds > 0;
  const primaryWasShielded = zombies.isShieldedTarget(shot.hitZombieHandle);
  const primaryResult = zombies.hitZombieHandle(
    shot.hitZombieHandle,
    shot.damage,
    direction,
    shot.damageType,
    shot.empLevel,
  );
  // Ice fire slows the struck zombie whenever the hit lands and is not fully
  // absorbed by a shield (a kill just slows nothing that is left alive).
  if (canSlow && !primaryWasShielded && primaryResult !== 'miss') {
    zombies.slowZombieHandle(
      shot.hitZombieHandle,
      shot.slowFactor,
      shot.slowDurationSeconds,
    );
  }
  if (primaryWasShielded || primaryResult === 'miss') return false;
  if (shot.pierceZombieHandle === null || shot.pierceDamage <= 0) return true;
  zombies.hitZombieHandle(
    shot.pierceZombieHandle,
    shot.pierceDamage,
    direction,
    shot.damageType,
    shot.empLevel,
  );
  if (canSlow) {
    zombies.slowZombieHandle(
      shot.pierceZombieHandle,
      shot.slowFactor,
      shot.slowDurationSeconds,
    );
  }
  return true;
}

function tracerOptionsForShot(
  shot: TracerShot,
  faded: boolean,
  secondary = false,
) {
  return TRACER_OPTIONS[
    (faded ? 1 : 0) |
      (shot.empLevel > 0 ? 2 : 0) |
      (shot.piercingLevel > 0 ? 4 : 0) |
      (secondary ? 8 : 0)
  ];
}

interface SurvivalUi {
  root: HTMLDivElement;
  speedValue: HTMLSpanElement;
  speedTrack: HTMLDivElement;
  speedSafeLabel: HTMLSpanElement;
  speedDamageLabel: HTMLSpanElement;
  speedKillLabel: HTMLSpanElement;
  integrityValue: HTMLSpanElement;
  integrityFill: HTMLSpanElement;
  fuelValue: HTMLSpanElement;
  fuelFill: HTMLSpanElement;
  abilityRoot: HTMLDivElement;
  abilityLabel: HTMLSpanElement;
  abilityFill: HTMLSpanElement;
  abilityValue: HTMLDivElement;
  waveTimeline: WaveTimelineHud;
  scoreValue: HTMLSpanElement;
  moneyValue: HTMLSpanElement;
  pendingMoneyValue: HTMLSpanElement;
  stuckPrompt: HTMLDivElement;
  countdownOverlay: HTMLDivElement;
  countdownValue: HTMLDivElement;
  waveClearCard: WaveClearCard;
  gameOverOverlay: HTMLDivElement;
  gameOverBest: HTMLDivElement;
  gameOverScore: HTMLDivElement;
  gameOverWaveValue: HTMLElement;
  gameOverKillsValue: HTMLElement;
  gameOverBoard: HTMLDivElement;
  settingsOverlay: HTMLDivElement;
  settingsButton: HTMLButtonElement;
  settingsEyebrow: HTMLSpanElement;
  settingsSoundButton: HTMLButtonElement;
  spawnCheatButton: HTMLButtonElement;
  settingsStatus: HTMLDivElement;
}

type PendingTransition =
  | {
      kind: 'buildPhase';
      run: RunState;
      survivingPartIds: string[];
      partHp: Record<string, number>;
      kills: number;
      score: number;
    }
  | {
      kind: 'gameOver';
      run: RunState;
      pendingMoneyDiscarded: number;
    };

type SurvivalRunState = RunState & { kills?: number; score?: number };

export class SurvivalMode {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world: RAPIER.World;
  private readonly eventQueue: RAPIER.EventQueue;
  private readonly arena: Arena;
  private readonly biomeDrive: EnvironmentModifiers;
  private readonly biomeHazard: BiomeHazardSpec;
  private biomeEnvironment: EnvironmentModifiers;
  private biomeEnvironmentWave = -1;
  private readonly vehicle: RuntimeVehicle;
  /** Pooled voxel particle layers shared by every effect in this mode. */
  private readonly vfx: VfxSystem;
  private readonly zombies: ZombieSystem;
  private readonly autoAim: AutoAim;
  private readonly fuelPickups: FuelPickups;
  private readonly waves: WaveManager;
  private readonly followCamera: FollowCamera;
  private readonly vehicleGroup = new THREE.Group();
  private readonly zombieVisualRoot = new THREE.Group();
  private readonly wheelMeshes = new Map<string, THREE.Group>();
  private readonly wheelSpin = new Map<string, number>();
  private readonly islandGroups = new Map<number, THREE.Group>();
  private readonly keys = new Set<string>();
  private readonly controls: VehicleControls = {
    throttle: 0,
    brake: 0,
    steer: 0,
    fire: false,
    aimYawWorld: 0,
  };
  private readonly tracerRenderer: TracerRenderer;
  private readonly wheelSteerQuaternion = new THREE.Quaternion();
  private readonly wheelSteerAxis = new THREE.Vector3(0, 1, 0);
  private readonly pointerNdc = new THREE.Vector2();
  private readonly aimRaycaster = new THREE.Raycaster();
  /**
   * Cursor unprojection plane. Sat at zombie centre height rather than on the
   * ground: manual turrets now shoot at this exact point, and the player aims
   * at a zombie's body, not at the patch of dirt behind its feet.
   */
  private readonly aimPlane = new THREE.Plane(
    new THREE.Vector3(0, 1, 0),
    -(ZOMBIE_HALF_HEIGHT + ZOMBIE_RADIUS),
  );
  private readonly aimPoint = new THREE.Vector3();
  private readonly shotDirection = new THREE.Vector3();
  private readonly stoppedVelocity = { x: 0, y: 0, z: 0 };
  private readonly minimapForward = new THREE.Vector3();
  private readonly ui: HTMLDivElement;
  private readonly minimap: Minimap;
  private readonly scopeCursor: ScopeCursor;
  /** Damage vignette plus the stacked red/amber alert chips. */
  private readonly warningHud: WarningHud;
  /** Pooled, decorative hit totals anchored where zombies were damaged. */
  private readonly damageNumbers: DamageNumbersOverlay;
  /**
   * Sum of live attached part health at the end of the previous fixed step.
   * Diffing it is how the HUD learns the vehicle was hurt, whatever the
   * source — zombie bites, thrown debris, mines, or a bad collision.
   */
  private lastLiveHealth = -1;
  private warningRefreshSeconds = 0;
  private lastWarnings: VehicleWarning[] = [];
  private readonly speedValue: HTMLSpanElement;
  private readonly speedTrack: HTMLDivElement;
  private readonly speedSafeLabel: HTMLSpanElement;
  private readonly speedDamageLabel: HTMLSpanElement;
  private readonly speedKillLabel: HTMLSpanElement;
  private readonly integrityValue: HTMLSpanElement;
  private readonly integrityFill: HTMLSpanElement;
  private readonly fuelValue: HTMLSpanElement;
  private readonly fuelFill: HTMLSpanElement;
  private lastHudFuel = -1;
  private readonly abilityRoot: HTMLDivElement;
  private readonly abilityLabel: HTMLSpanElement;
  private readonly abilityFill: HTMLSpanElement;
  private readonly abilityValue: HTMLDivElement;
  /** Translucent blue bubble shown while the Shield Generator is active. */
  private shieldBubble: THREE.Mesh | null = null;
  private shieldBubbleMaterial: THREE.MeshBasicMaterial | null = null;
  private shieldBubblePhase = 0;
  private readonly waveTimelineHud: WaveTimelineHud;
  private waveTimeline: WaveTimeline | null = null;
  private readonly scoreValue: HTMLSpanElement;
  private readonly moneyValue: HTMLSpanElement;
  private readonly pendingMoneyValue: HTMLSpanElement;
  private readonly stuckPrompt: HTMLDivElement;
  private readonly countdownOverlay: HTMLDivElement;
  private readonly countdownValue: HTMLDivElement;
  private readonly waveClearCard: WaveClearCard;
  private readonly gameOverOverlay: HTMLDivElement;
  private readonly gameOverBest: HTMLDivElement;
  private readonly gameOverScore: HTMLDivElement;
  private readonly gameOverWaveValue: HTMLElement;
  private readonly gameOverKillsValue: HTMLElement;
  private readonly gameOverBoard: HTMLDivElement;
  private readonly settingsOverlay: HTMLDivElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly settingsEyebrow: HTMLSpanElement;
  private readonly settingsSoundButton: HTMLButtonElement;
  private readonly spawnCheatButton: HTMLButtonElement;
  private readonly settingsStatus: HTMLDivElement;

  private accumulator = 0;
  private lastTime = performance.now();
  private debugPaused = false;
  private settingsOpen = false;
  private speedScaleMaxKmh = 120;
  private ramDamageThresholdKmh = MIN_IMPACT_SPEED * 3.6;
  private ramKillThresholdKmh = LETHAL_IMPACT_SPEED * 3.6;
  private kills = 0;
  /** Arcade score for the whole run. Never spent, never rolled back. */
  private runScore = 0;
  private phoneAddictKills = 0;
  private currentWave = 1;
  private countdownRemaining = COUNTDOWN_SECONDS;
  private phase: SurvivalPhase = 'countdown';
  private pointerFiring = false;
  private disposed = false;
  private lastHudIntegrity = -1;
  private lastHudSpeed = -1;
  private lastHudWave = -1;
  private lastHudScore = -1;
  private lastHudMoney = -1;
  private lastHudPending = -1;
  private lastCountdownSecond = -1;
  private pendingWaveKillReward = 0;
  private pendingWaveReward = 0;
  private waveStartKills = 0;
  private waveMoneyEarned = 0;
  private waveElapsedSeconds = 0;
  private waveStartIntegrityPct = 100;
  private cleanWaveStreak = 0;
  private pendingTransition: PendingTransition | null = null;
  private stuckSeconds = 0;
  private currentMineSweeperLevel = 0;
  private mineWarningPulseSeconds = 0;
  private recoveryCooldown = 0;
  private recoverySettleSeconds = 0;
  private recoveryRequested = false;
  private abilityRequested = false;
  private abilityCooldown = 0;
  private lastHudAbilityCooldown = -1;
  private lastHudAbilityName = '';
  private debugProgressionSuppressed = false;
  private audioUnlocked = false;
  private devPanel: DevTunerPanel | null = null;
  private tuningUnsubscribe: (() => void) | null = null;
  private readonly recoveryImpulse = { x: 0, y: 0, z: 0 };
  private readonly recoveryTranslation = { x: 0, y: 0, z: 0 };
  private readonly recoveryVelocity = { x: 0, y: 0, z: 0 };
  private readonly recoveryAngularVelocity = { x: 0, y: 0, z: 0 };
  private readonly recoveryForward = new THREE.Vector3();
  private readonly recoveryQuaternion = new THREE.Quaternion();
  private readonly recoveryTargetQuaternion = new THREE.Quaternion();
  private mineWarningDistances = new WeakMap<object, number>();
  private mineWarningPulsed = new WeakSet<object>();

  private readonly keydown = (event: KeyboardEvent): void => {
    this.unlockAudioFromInput();
    if (event.key === 'Escape' && this.phase !== 'gameOver') {
      this.setSettingsOpen(!this.settingsOpen);
      event.preventDefault();
      return;
    }
    if (this.settingsOpen) {
      event.preventDefault();
      return;
    }
    if (this.phase === 'gameOver') return;
    const key = event.key.toLowerCase();
    if (key === 'j') {
      if (!event.repeat) this.recoveryRequested = true;
      event.preventDefault();
      return;
    }
    if (key === 'q') {
      if (!event.repeat) this.abilityRequested = true;
      event.preventDefault();
      return;
    }
    this.keys.add(key);
  };

  private readonly keyup = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private readonly blur = (): void => {
    this.keys.clear();
    this.pointerFiring = false;
    this.controls.fire = false;
  };

  constructor(
    private readonly container: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    bp: VehicleBlueprint,
    run: SurvivalRunState,
    private readonly callbacks: SurvivalCallbacks,
  ) {
    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      320,
    );
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.eventQueue = new RAPIER.EventQueue(true);
    const biome = getBiome(run.biomeId ?? DEFAULT_BIOME_ID);
    this.biomeDrive = biome.drive;
    this.biomeHazard = biome.hazard;
    this.biomeEnvironment = biome.drive;
    this.arena = new ArenaBuilder(
      this.scene,
      this.world,
      biome,
      run.seed ?? randomSeed(),
    );
    this.vehicle = this.spawnVehicle(bp);
    this.followCamera = new FollowCamera(
      this.camera,
      this.vehicle,
      this.arena.bounds,
    );
    // Added before the zombie visuals are captured below, so the two VFX
    // layers stay parented to the scene rather than to the zombie root.
    this.vfx = new VfxSystem(this.scene);
    const firstZombieVisualIndex = this.scene.children.length;
    this.zombies = new ZombieSystem(
      this.world,
      this.scene,
      this.arena.spawnPoints,
      this.vehicle,
      (reward, kind) => this.handleZombieKilled(reward, kind),
      this.vfx,
    );
    const zombieVisuals = this.scene.children.slice(firstZombieVisualIndex);
    this.zombieVisualRoot.name = 'zombie-system-visuals';
    this.zombieVisualRoot.add(...zombieVisuals);
    this.scene.add(this.zombieVisualRoot);
    this.autoAim = new AutoAim(this.vehicle, this.zombies, this.world);
    this.fuelPickups = new FuelPickups(
      this.scene,
      this.vehicle,
      this.arena.bounds,
    );
    this.waves = new WaveManager(this.zombies, {
      onRemainingChanged: () => undefined,
      onWaveComplete: (wave, reward) => this.onWaveComplete(wave, reward),
    });
    this.tracerRenderer = new TracerRenderer(this.scene);

    const builtUi = this.buildUI();
    this.ui = builtUi.root;
    this.speedValue = builtUi.speedValue;
    this.speedTrack = builtUi.speedTrack;
    this.speedSafeLabel = builtUi.speedSafeLabel;
    this.speedDamageLabel = builtUi.speedDamageLabel;
    this.speedKillLabel = builtUi.speedKillLabel;
    this.integrityValue = builtUi.integrityValue;
    this.integrityFill = builtUi.integrityFill;
    this.fuelValue = builtUi.fuelValue;
    this.fuelFill = builtUi.fuelFill;
    this.abilityRoot = builtUi.abilityRoot;
    this.abilityLabel = builtUi.abilityLabel;
    this.abilityFill = builtUi.abilityFill;
    this.abilityValue = builtUi.abilityValue;
    this.waveTimelineHud = builtUi.waveTimeline;
    this.scoreValue = builtUi.scoreValue;
    this.moneyValue = builtUi.moneyValue;
    this.pendingMoneyValue = builtUi.pendingMoneyValue;
    this.stuckPrompt = builtUi.stuckPrompt;
    this.countdownOverlay = builtUi.countdownOverlay;
    this.countdownValue = builtUi.countdownValue;
    this.waveClearCard = builtUi.waveClearCard;
    this.gameOverOverlay = builtUi.gameOverOverlay;
    this.gameOverBest = builtUi.gameOverBest;
    this.gameOverScore = builtUi.gameOverScore;
    this.gameOverWaveValue = builtUi.gameOverWaveValue;
    this.gameOverKillsValue = builtUi.gameOverKillsValue;
    this.gameOverBoard = builtUi.gameOverBoard;
    this.settingsOverlay = builtUi.settingsOverlay;
    this.settingsButton = builtUi.settingsButton;
    this.settingsEyebrow = builtUi.settingsEyebrow;
    this.settingsSoundButton = builtUi.settingsSoundButton;
    this.spawnCheatButton = builtUi.spawnCheatButton;
    this.settingsStatus = builtUi.settingsStatus;
    this.minimap = new Minimap(
      this.ui,
      this.arena.bounds,
      this.arena.minimapFeatures,
      {
        renderer: this.renderer,
        scene: this.scene,
        hide: [
          this.vehicleGroup,
          ...this.wheelMeshes.values(),
          this.zombieVisualRoot,
        ],
        ready: this.arena.whenReady(),
      },
    );
    this.scopeCursor = new ScopeCursor(this.ui, this.renderer.domElement);
    this.warningHud = new WarningHud(this.ui);
    this.damageNumbers = new DamageNumbersOverlay(this.ui);
    this.zombies.setDamageListener((report) => {
      this.damageNumbers.add(
        report.targetKey,
        report.amount,
        report.x,
        report.y,
        report.z,
        report.killed,
      );
    });

    if (Number.isFinite(run.kills) && (run.kills ?? 0) >= 0) {
      this.kills = Math.floor(run.kills ?? 0);
    }
    this.waveStartKills = this.kills;
    this.cleanWaveStreak = 0;
    if (Number.isFinite(run.score) && (run.score ?? 0) >= 0) {
      this.runScore = Math.floor(run.score ?? 0);
    }

    // A resumed run begins from App's committed wave-start damage.
    if (run.partHp) {
      this.attachNewIslands(this.vehicle.applyPartHpSnapshot(run.partHp));
    }

    this.beginCountdown(run.wave);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.blur);
    window.addEventListener('pointerup', this.onFireUp);
    window.addEventListener('pointercancel', this.onFireUp);
    this.renderer.domElement.addEventListener('pointermove', this.onAim);
    this.renderer.domElement.addEventListener('pointerdown', this.onFireDown);

    if (isDevMode()) this.mountDevTuner();
  }

  /** Build the dev tuner panel and keep living zombies in sync with edits. */
  private mountDevTuner(): void {
    this.devPanel = new DevTunerPanel(this.ui, {
      currentWave: () => this.currentWave,
      aliveCount: () => this.zombies.getActiveCount(),
      applyLiveTuning: () => this.applyLiveTuning(),
      restartWave: () => this.debugStartWave(this.currentWave),
      skipToWave: (wave) => this.debugStartWave(wave),
      spawnOneOfEach: () => this.onSpawnEveryZombie(),
      killAllZombies: () => this.debugKillAllZombies(),
      grantInfiniteMoney: () => this.callbacks.onCheatInfiniteMoney(),
    });
    this.tuningUnsubscribe = subscribeTuning(() => this.applyLiveTuning());
  }

  /**
   * Push a live tuning edit onto the running wave: refresh the wave multipliers
   * from the (possibly edited) curves, then re-stat every living zombie. God
   * mode / time scale are read each frame, so they need no work here.
   */
  private applyLiveTuning(): void {
    if (this.disposed) return;
    const wave = this.currentWave;
    this.zombies.setWaveMultipliers(
      healthMultiplierForWave(wave),
      speedMultiplierForWave(wave),
      attackDamageMultiplierForWave(wave),
    );
    this.zombies.reapplyTuningToAlive();
  }

  private spawnVehicle(bp: VehicleBlueprint): RuntimeVehicle {
    const clone = JSON.parse(JSON.stringify(bp)) as VehicleBlueprint;
    const connections = deriveConnections(clone, getPartDef);
    const spawnY = -lowestPointM(clone, getPartDef) + 0.32;
    const vehicle = new RuntimeVehicle(
      this.world,
      clone,
      getPartDef,
      connections,
      {
        translation: { x: 0, y: spawnY, z: 0 },
      },
    );

    for (const [id, part] of vehicle.assembled.parts) {
      const mesh = buildPartMesh(part.def, part.placed);
      if (part.def.wheel) {
        const spin = mesh.getObjectByName('wheel-spin');
        if (spin) spin.userData.baseQuat = spin.quaternion.clone();
        // The part group is moved to the wheel's suspension-travelled centre
        // every frame, so its children must sit on the group origin. A tread
        // has a static belt alongside its spinning rollers, so zero them all
        // rather than just the spin group.
        for (const child of mesh.children) child.position.set(0, 0, 0);
        this.wheelMeshes.set(id, mesh);
        this.wheelSpin.set(id, 0);
        this.scene.add(mesh);
      } else {
        mesh.name = `part:${id}`;
        this.vehicleGroup.add(mesh);
      }
    }
    this.scene.add(this.vehicleGroup);
    return vehicle;
  }

  private buildUI(): SurvivalUi {
    const root = document.createElement('div');
    root.className = 'ui-layer survival-ui';
    this.container.appendChild(root);

    const waveTimeline = new WaveTimelineHud();
    root.appendChild(waveTimeline.root);

    const hud = document.createElement('div');
    hud.className = 'panel survival-driver-hud';
    const speedRow = document.createElement('div');
    speedRow.className = 'survival-speed';
    const speedHeader = document.createElement('div');
    speedHeader.className = 'survival-speed__header';
    const speedLabel = document.createElement('span');
    speedLabel.textContent = 'Speed';
    const speedReadout = document.createElement('div');
    speedReadout.className = 'survival-speed__readout';
    const speedValue = document.createElement('span');
    speedValue.textContent = '0';
    const speedUnit = document.createElement('small');
    speedUnit.textContent = 'KM/H';
    speedReadout.append(speedValue, speedUnit);
    speedHeader.append(speedLabel, speedReadout);

    const speedGauge = document.createElement('div');
    speedGauge.className = 'survival-speed__gauge';
    const speedTrack = document.createElement('div');
    speedTrack.className = 'survival-speed__track';
    speedTrack.setAttribute('role', 'meter');
    speedTrack.setAttribute('aria-label', 'Ram damage speed');
    speedTrack.setAttribute('aria-valuemin', '0');
    const safeTier = document.createElement('span');
    safeTier.className = 'survival-speed__tier survival-speed__tier--safe';
    const damageTier = document.createElement('span');
    damageTier.className = 'survival-speed__tier survival-speed__tier--damage';
    const killTier = document.createElement('span');
    killTier.className = 'survival-speed__tier survival-speed__tier--kill';
    const speedMarker = document.createElement('span');
    speedMarker.className = 'survival-speed__marker';
    speedMarker.setAttribute('aria-hidden', 'true');
    speedTrack.append(safeTier, damageTier, killTier, speedMarker);
    const speedLegend = document.createElement('div');
    speedLegend.className = 'survival-speed__legend';
    const speedSafeLabel = document.createElement('span');
    const speedDamageLabel = document.createElement('span');
    const speedKillLabel = document.createElement('span');
    speedLegend.append(speedSafeLabel, speedDamageLabel, speedKillLabel);
    speedGauge.append(speedTrack, speedLegend);
    speedRow.append(speedHeader, speedGauge);
    const health = document.createElement('div');
    health.className = 'survival-health';
    const healthHeader = document.createElement('div');
    const healthLabel = document.createElement('span');
    healthLabel.textContent = 'Vehicle Health';
    const integrityValue = document.createElement('span');
    healthHeader.append(healthLabel, integrityValue);
    const healthTrack = document.createElement('div');
    healthTrack.className = 'survival-health__track';
    healthTrack.setAttribute('role', 'progressbar');
    healthTrack.setAttribute('aria-label', 'Vehicle health');
    healthTrack.setAttribute('aria-valuemin', '0');
    healthTrack.setAttribute('aria-valuemax', '100');
    const integrityFill = document.createElement('span');
    integrityFill.className = 'survival-health__fill';
    healthTrack.appendChild(integrityFill);
    health.append(healthHeader, healthTrack);
    // Onboard fuel gauge — the resource the player manages, refilled by driving
    // into refuel crates (see FuelPickups).
    const fuel = document.createElement('div');
    fuel.className = 'survival-fuel';
    const fuelHeader = document.createElement('div');
    const fuelLabel = document.createElement('span');
    fuelLabel.textContent = 'Fuel';
    const fuelValue = document.createElement('span');
    fuelHeader.append(fuelLabel, fuelValue);
    const fuelTrack = document.createElement('div');
    fuelTrack.className = 'survival-fuel__track';
    fuelTrack.setAttribute('role', 'progressbar');
    fuelTrack.setAttribute('aria-label', 'Fuel');
    fuelTrack.setAttribute('aria-valuemin', '0');
    fuelTrack.setAttribute('aria-valuemax', '100');
    const fuelFill = document.createElement('span');
    fuelFill.className = 'survival-fuel__fill';
    fuelTrack.appendChild(fuelFill);
    fuel.append(fuelHeader, fuelTrack);
    // Ability chip — hidden until an ability part is equipped. Shows the active
    // ability's name, the Q keybind, and the cooldown. The label is updated at
    // runtime to whichever ability the player bound to Q in the garage.
    const ability = document.createElement('div');
    ability.className = 'survival-ability';
    ability.hidden = true;
    const abilityHeader = document.createElement('div');
    const abilityLabel = document.createElement('span');
    abilityLabel.textContent = 'Ability';
    const abilityKey = document.createElement('span');
    abilityKey.className = 'survival-ability__key';
    abilityKey.textContent = 'Q';
    abilityHeader.append(abilityLabel, abilityKey);
    const abilityTrack = document.createElement('div');
    abilityTrack.className = 'survival-ability__track';
    const abilityFill = document.createElement('span');
    abilityFill.className = 'survival-ability__fill';
    abilityTrack.appendChild(abilityFill);
    const abilityValue = document.createElement('div');
    abilityValue.className = 'survival-ability__status';
    abilityValue.textContent = 'Ready';
    ability.append(abilityHeader, abilityTrack, abilityValue);
    const moneyRow = document.createElement('div');
    moneyRow.className = 'survival-earned';
    const moneyLabel = document.createElement('span');
    moneyLabel.textContent = 'Money Earned';
    const moneyValue = document.createElement('span');
    moneyRow.append(moneyLabel, moneyValue);
    const pendingMoneyRow = document.createElement('div');
    pendingMoneyRow.className = 'survival-earned';
    const pendingMoneyLabel = document.createElement('span');
    pendingMoneyLabel.textContent = 'Pending';
    const pendingMoneyValue = document.createElement('span');
    pendingMoneyRow.append(pendingMoneyLabel, pendingMoneyValue);
    const scoreRow = document.createElement('div');
    scoreRow.className = 'survival-earned survival-score';
    const scoreLabel = document.createElement('span');
    scoreLabel.textContent = 'Score';
    const scoreValue = document.createElement('span');
    scoreRow.append(scoreLabel, scoreValue);
    hud.append(
      speedRow,
      health,
      fuel,
      ability,
      scoreRow,
      moneyRow,
      pendingMoneyRow,
    );
    root.appendChild(hud);

    const stuckPrompt = document.createElement('div');
    stuckPrompt.className = 'panel survival-stuck-prompt';
    stuckPrompt.setAttribute('role', 'status');
    const stuckIcon = document.createElement('span');
    stuckIcon.className = 'survival-stuck-prompt__icon';
    stuckIcon.setAttribute('aria-hidden', 'true');
    const stuckCopy = document.createElement('div');
    const stuckTitle = document.createElement('strong');
    stuckTitle.textContent = 'Vehicle Stuck';
    const stuckAction = document.createElement('span');
    stuckAction.textContent = 'Press J to Jump';
    stuckCopy.append(stuckTitle, stuckAction);
    stuckPrompt.append(stuckIcon, stuckCopy);
    root.appendChild(stuckPrompt);

    const countdownOverlay = overlayPanel();
    countdownOverlay.style.pointerEvents = 'none';
    const countdownLabel = document.createElement('div');
    countdownLabel.textContent = 'WAVE STARTING';
    countdownLabel.style.cssText =
      'font-size:15px;font-weight:800;letter-spacing:.12em;color:#ffb44d';
    const countdownValue = document.createElement('div');
    countdownValue.style.cssText =
      'font-size:54px;font-weight:900;line-height:1.1';
    countdownOverlay.append(countdownLabel, countdownValue);
    root.appendChild(countdownOverlay);

    const waveClearCard = new WaveClearCard({
      onContinue: this.onNextWave,
      onGarage: this.onGoToGarage,
      onRepairAndContinue: this.onRepairAndContinue,
    });
    root.appendChild(waveClearCard.root);

    const gameOverOverlay = overlayPanel();
    gameOverOverlay.classList.add('survival-gameover');
    gameOverOverlay.style.display = 'none';
    gameOverOverlay.setAttribute('role', 'dialog');
    gameOverOverlay.setAttribute('aria-modal', 'true');
    gameOverOverlay.setAttribute('aria-labelledby', 'survival-gameover-title');
    const gameOverTitle = document.createElement('h2');
    gameOverTitle.id = 'survival-gameover-title';
    gameOverTitle.textContent = 'Run Over';
    const gameOverBest = document.createElement('div');
    gameOverBest.className = 'survival-gameover__best';
    gameOverBest.textContent = 'New Best!';
    gameOverBest.hidden = true;
    const gameOverScore = document.createElement('div');
    gameOverScore.className = 'survival-gameover__score';
    const gameOverScoreLabel = document.createElement('div');
    gameOverScoreLabel.className = 'survival-gameover__score-label';
    gameOverScoreLabel.textContent = 'Final Score';
    const gameOverStats = document.createElement('div');
    gameOverStats.className = 'survival-gameover__stats';
    const gameOverStatRow = (label: string): HTMLElement => {
      const row = document.createElement('div');
      const rowLabel = document.createElement('span');
      rowLabel.textContent = label;
      const rowValue = document.createElement('strong');
      row.append(rowLabel, rowValue);
      gameOverStats.appendChild(row);
      return rowValue;
    };
    const gameOverWaveValue = gameOverStatRow('Wave Reached');
    const gameOverKillsValue = gameOverStatRow('Zombies Killed');
    const gameOverBoard = document.createElement('div');
    gameOverBoard.className = 'survival-gameover__board';
    const gameOverReset = document.createElement('p');
    gameOverReset.className = 'survival-gameover__reset';
    gameOverReset.textContent =
      'Your rig, cash and upgrades are gone. Parts you unlocked stay unlocked — build again and go further.';
    const gameOverActions = document.createElement('div');
    gameOverActions.className = 'survival-gameover__actions';
    const gameOverButton = document.createElement('button');
    gameOverButton.type = 'button';
    gameOverButton.className = 'primary';
    gameOverButton.textContent = 'Back to Garage';
    gameOverButton.addEventListener('click', this.onGameOverContinue);
    gameOverActions.appendChild(gameOverButton);
    gameOverOverlay.append(
      gameOverTitle,
      gameOverBest,
      gameOverScoreLabel,
      gameOverScore,
      gameOverStats,
      gameOverBoard,
      gameOverReset,
      gameOverActions,
    );
    root.appendChild(gameOverOverlay);

    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.className =
      'ui-button ui-button--medium survival-settings-button';
    settingsButton.textContent = 'Settings';
    settingsButton.setAttribute('aria-haspopup', 'dialog');
    settingsButton.addEventListener('click', () => this.setSettingsOpen(true));
    root.appendChild(settingsButton);

    const settingsOverlay = document.createElement('div');
    settingsOverlay.className = 'survival-settings-overlay';
    settingsOverlay.hidden = true;
    settingsOverlay.setAttribute('role', 'dialog');
    settingsOverlay.setAttribute('aria-modal', 'true');
    settingsOverlay.setAttribute('aria-label', 'Wave settings');
    const settingsPanel = document.createElement('section');
    settingsPanel.className = 'panel survival-settings';
    const settingsHeader = document.createElement('header');
    const settingsHeading = document.createElement('div');
    const settingsEyebrow = document.createElement('span');
    settingsEyebrow.textContent = `Wave ${this.currentWave}`;
    const settingsTitle = document.createElement('h2');
    settingsTitle.textContent = 'Settings';
    settingsHeading.append(settingsEyebrow, settingsTitle);
    const closeSettingsButton = document.createElement('button');
    closeSettingsButton.type = 'button';
    closeSettingsButton.className = 'ui-button ui-button--small';
    closeSettingsButton.textContent = 'Close';
    closeSettingsButton.addEventListener('click', () =>
      this.setSettingsOpen(false),
    );
    settingsHeader.append(settingsHeading, closeSettingsButton);

    const soundOn = !isSfxMuted();
    const settingsSoundButton = document.createElement('button');
    settingsSoundButton.type = 'button';
    settingsSoundButton.className =
      'ui-button ui-button--medium survival-settings__cheat-toggle survival-settings__sound';
    settingsSoundButton.textContent = `Sound: ${soundOn ? 'On' : 'Off'}`;
    settingsSoundButton.setAttribute('aria-pressed', String(soundOn));
    settingsSoundButton.addEventListener('click', this.onSoundToggle);

    const cheatsToggle = createToggle('Enable Cheats');
    cheatsToggle.classList.add('survival-settings__cheat-toggle');
    const cheatsInput = cheatsToggle.querySelector('input');
    const cheatActions = document.createElement('div');
    cheatActions.className = 'survival-settings__cheats';
    cheatActions.hidden = true;
    const spawnCheatButton = document.createElement('button');
    spawnCheatButton.type = 'button';
    spawnCheatButton.className = 'ui-button ui-button--medium';
    spawnCheatButton.textContent = 'Spawn 1 of Every Zombie';
    spawnCheatButton.addEventListener('click', this.onSpawnEveryZombie);
    const infiniteMoneyButton = document.createElement('button');
    infiniteMoneyButton.type = 'button';
    infiniteMoneyButton.className = 'ui-button ui-button--medium';
    infiniteMoneyButton.textContent = 'Give Infinite Money';
    infiniteMoneyButton.addEventListener('click', this.onInfiniteMoney);
    cheatActions.append(spawnCheatButton, infiniteMoneyButton);
    cheatsInput?.addEventListener('change', () => {
      cheatActions.hidden = !cheatsInput.checked;
      this.settingsStatus.textContent = cheatsInput.checked
        ? 'Cheats enabled for this run.'
        : '';
    });

    const resetSection = document.createElement('div');
    resetSection.className = 'survival-settings__reset';
    const resetCopy = document.createElement('div');
    const resetTitle = document.createElement('strong');
    resetTitle.textContent = 'Reset Wave';
    const resetDescription = document.createElement('span');
    resetDescription.textContent =
      "Restart this wave with your vehicle restored. This wave's pending rewards are discarded.";
    resetCopy.append(resetTitle, resetDescription);
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'ui-button ui-button--danger ui-button--medium';
    resetButton.textContent = 'Reset Wave';
    resetButton.addEventListener('click', () => this.onResetWave());
    resetSection.append(resetCopy, resetButton);

    const saveSection = document.createElement('div');
    saveSection.className = 'survival-settings__reset';
    const saveCopy = document.createElement('div');
    const saveTitle = document.createElement('strong');
    saveTitle.textContent = 'Save & Quit';
    const saveDescription = document.createElement('span');
    saveDescription.textContent =
      'Bank your progress and return to the title screen. This wave restarts when you resume.';
    saveCopy.append(saveTitle, saveDescription);
    const saveQuitButton = document.createElement('button');
    saveQuitButton.type = 'button';
    saveQuitButton.className = 'ui-button ui-button--medium';
    saveQuitButton.textContent = 'Save & Quit';
    saveQuitButton.addEventListener('click', () => this.onSaveAndQuit());
    saveSection.append(saveCopy, saveQuitButton);

    const settingsStatus = document.createElement('div');
    settingsStatus.className = 'survival-settings__status';
    settingsStatus.setAttribute('role', 'status');
    settingsPanel.append(
      settingsHeader,
      settingsSoundButton,
      cheatsToggle,
      cheatActions,
      resetSection,
      saveSection,
      settingsStatus,
    );
    settingsOverlay.appendChild(settingsPanel);
    settingsOverlay.addEventListener('pointerdown', (event) => {
      if (event.target === settingsOverlay) this.setSettingsOpen(false);
    });
    root.appendChild(settingsOverlay);

    return {
      root,
      speedValue,
      speedTrack,
      speedSafeLabel,
      speedDamageLabel,
      speedKillLabel,
      integrityValue,
      integrityFill,
      fuelValue,
      fuelFill,
      abilityRoot: ability,
      abilityLabel,
      abilityFill,
      abilityValue,
      waveTimeline,
      scoreValue,
      moneyValue,
      pendingMoneyValue,
      stuckPrompt,
      countdownOverlay,
      countdownValue,
      waveClearCard,
      gameOverOverlay,
      gameOverBest,
      gameOverScore,
      gameOverWaveValue,
      gameOverKillsValue,
      gameOverBoard,
      settingsOverlay,
      settingsButton,
      settingsEyebrow,
      settingsSoundButton,
      spawnCheatButton,
      settingsStatus,
    };
  }

  private setSettingsOpen(open: boolean): void {
    if (this.disposed || this.phase === 'gameOver') return;
    this.settingsOpen = open;
    this.settingsOverlay.hidden = !open;
    this.settingsEyebrow.textContent = `Wave ${this.currentWave}`;
    this.settingsButton.setAttribute('aria-expanded', String(open));
    this.spawnCheatButton.disabled = this.phase !== 'active';
    this.keys.clear();
    this.pointerFiring = false;
    this.controls.fire = false;
    this.accumulator = 0;
    this.lastTime = performance.now();
  }

  private unlockAudioFromInput(): void {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    unlockAudio();
  }

  private readonly onSoundToggle = (): void => {
    if (this.disposed) return;
    this.unlockAudioFromInput();
    const muted = !isSfxMuted();
    setSfxMuted(muted);
    const soundOn = !muted;
    this.settingsSoundButton.textContent = `Sound: ${soundOn ? 'On' : 'Off'}`;
    this.settingsSoundButton.setAttribute('aria-pressed', String(soundOn));
    if (soundOn) playSfx('uiClick');
  };

  private readonly onSpawnEveryZombie = (): void => {
    if (this.disposed || this.phase !== 'active') return;
    const spawned = this.waves.spawnBonusHorde([
      'walker',
      'thrower',
      'worker',
      'phone-addict',
    ]);
    this.settingsStatus.textContent =
      spawned === 4
        ? 'Spawned a Walker, Ranged, Worker, and Phone User.'
        : `Spawned ${spawned} of 4 zombies — clear some room and try again.`;
  };

  private readonly onInfiniteMoney = (): void => {
    if (this.disposed) return;
    this.callbacks.onCheatInfiniteMoney();
    this.lastHudMoney = -1;
    this.settingsStatus.textContent = 'Money set to the maximum safe amount.';
  };

  private onResetWave(): void {
    if (this.disposed) return;
    this.discardPendingWaveRewards();
    this.damageNumbers?.clear();
    this.callbacks.onResetWave(this.currentRunState());
  }

  private onSaveAndQuit(): void {
    if (this.disposed || this.phase === 'gameOver') return;
    this.discardPendingWaveRewards();
    this.callbacks.onSaveAndQuit({
      wave: this.currentWave,
      kills: this.kills,
      score: this.runScore,
    });
  }

  private readonly onNextWave = (): void => {
    if (this.disposed || this.phase !== 'cleared') return;
    const payload = this.clearedWavePayload();
    this.beginCountdown(payload.nextRun.wave);
    this.callbacks.onWaveAdvance(
      payload.nextRun,
      payload.survivingPartIds,
      payload.partHp,
      payload.kills,
      payload.score,
    );
  };

  /**
   * Priced from the live vehicle rather than the checkpoint: "Continue Now"
   * carries the live rig straight into the next wave, so that is what the
   * player is actually paying to fix.
   */
  private repairQuote(): WaveClearRepairOffer | null {
    const items = [...this.vehicle.assembled.parts]
      .filter(([, part]) => part.alive && !part.detached)
      .map(([id, part]) => ({
        id,
        baseCost: getPartDef(part.placed.defId).cost,
        currentHp: Math.max(0, part.health),
        maxHp: part.def.health,
      }));
    const plan = repairPlan(items);
    if (plan.totalCost <= 0) return null;
    return {
      cost: plan.totalCost,
      affordable: this.callbacks.profileMoney() >= plan.totalCost,
    };
  }

  private readonly onRepairAndContinue = (): void => {
    if (this.disposed || this.phase !== 'cleared') return;
    const quote = this.repairQuote();
    if (quote === null || !quote.affordable) return;
    // Charge first: if the wallet says no, nothing is healed.
    if (!this.callbacks.onRepairAll(quote.cost)) return;
    this.repairLiveVehicle();
    this.onNextWave();
  };

  private repairLiveVehicle(): void {
    for (const [, part] of this.vehicle.assembled.parts) {
      if (!part.alive || part.detached) continue;
      part.health = part.def.health;
    }
    // Structural joints wear down alongside the parts they hold. Leaving them
    // damaged would let a "fully repaired" rig shed parts on the next impact.
    for (const connection of this.vehicle.assembled.connections) {
      if (connection.health > 0) connection.health = 1;
    }
  }

  private readonly onGoToGarage = (): void => {
    if (this.disposed || this.phase !== 'cleared') return;
    const payload = this.clearedWavePayload();
    this.waveClearCard.hide();
    this.callbacks.onBuildPhase(
      payload.clearedRun,
      payload.survivingPartIds,
      payload.partHp,
      payload.kills,
      payload.score,
    );
  };

  private clearedWavePayload(): WaveClearPayload {
    return createWaveClearPayload(
      this.currentWave,
      this.vehicle.survivingPartIds(),
      this.vehicle.partHpSnapshot(),
      this.kills,
      this.runScore,
    );
  }

  private readonly onAim = (event: PointerEvent): void => {
    if (this.phase !== 'active' || this.settingsOpen) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.aimRaycaster.setFromCamera(this.pointerNdc, this.camera);
    if (!this.aimRaycaster.ray.intersectPlane(this.aimPlane, this.aimPoint))
      return;
    const position = this.vehicle.body.translation();
    this.controls.aimYawWorld = Math.atan2(
      this.aimPoint.x - position.x,
      this.aimPoint.z - position.z,
    );
    // Manual turrets fire at this point, so the barrel and the shot agree.
    this.controls.aimPoint = this.aimPoint;
  };

  private readonly onFireDown = (event: PointerEvent): void => {
    this.unlockAudioFromInput();
    if (this.phase === 'active' && !this.settingsOpen && event.button === 0)
      this.pointerFiring = true;
  };

  private readonly onFireUp = (): void => {
    this.pointerFiring = false;
  };

  update(dtMs?: number): void {
    if (this.disposed) return;
    const now = performance.now();
    let frameDt =
      dtMs === undefined ? (now - this.lastTime) / 1000 : dtMs / 1000;
    this.lastTime = now;
    if (this.settingsOpen) {
      this.syncView(0);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.debugPaused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    frameDt = Math.min(Math.max(frameDt, 0), 0.1);
    if (this.devPanel) {
      // God mode and time scale are read live so they need no per-edit wiring.
      this.vehicle.invulnerable = devTuning.cheats.godMode;
      this.waves.setSpawnPaused(devTuning.cheats.freezeSpawns);
      frameDt *= Math.max(0, devTuning.cheats.timeScale);
      this.devPanel.refreshReadout();
    }
    this.accumulator += frameDt;

    while (this.accumulator >= FIXED_DT) {
      this.accumulator -= FIXED_DT;
      this.stepFixed();
      if (this.pendingTransition !== null) break;
    }
    this.syncView(frameDt);
    this.renderer.render(this.scene, this.camera);
    this.flushPendingTransition();
  }

  private stepFixed(): void {
    if (this.phase === 'countdown') {
      this.countdownRemaining -= FIXED_DT;
      if (this.countdownRemaining <= 0) this.startCurrentWave();
    } else if (this.phase === 'active') {
      this.stepPhysics();
    }
  }

  private stepPhysics(): void {
    this.waveElapsedSeconds += FIXED_DT;
    this.updateControls();
    this.updateRecoveryAssist(FIXED_DT);
    this.updateAbility();
    this.controls.weaponAim = this.autoAim.step();
    const mineSweeper = this.resolveLiveMineSweeper();
    this.currentMineSweeperLevel =
      mineSweeper === null ? 0 : (mineSweeper.placed.config.level ?? 1);
    const mineRevealRadius = mineSweeperRadius(
      mineSweeper === null ? 0 : (mineSweeper.placed.config.level ?? 1),
    );
    this.zombies.setCurrentWave(this.currentWave);
    this.zombies.setMineRevealRadius(mineRevealRadius);
    this.vehicle.preStep(
      FIXED_DT,
      this.controls,
      (colliderHandle) => this.arena.surfaceOf(colliderHandle),
      this.biomeEnvironment,
    );

    this.fuelPickups.step(FIXED_DT);
    this.waves.fixedUpdate(FIXED_DT);
    this.zombies.step(FIXED_DT);
    this.updateMineWarningPulse(mineRevealRadius);

    this.world.step(this.eventQueue);
    this.vehicle.postStepStability(FIXED_DT);
    this.eventQueue.drainContactForceEvents((event) => {
      const force = event.totalForceMagnitude();
      this.vehicle.onContactForce(event.collider1(), force);
      this.vehicle.onContactForce(event.collider2(), force);
    });

    const shots = this.vehicle.shotsThisStep();
    for (const shot of shots) {
      const missed = shot.hitZombieHandle === null && !shot.hitSurface;
      this.showTracer(shot, missed);
      this.shotDirection.set(
        shot.to.x - shot.from.x,
        shot.to.y - shot.from.y,
        shot.to.z - shot.from.z,
      );
      if (this.shotDirection.lengthSq() > 1e-8) this.shotDirection.normalize();
      this.emitShotVfx(shot);
      this.detonateShell(shot);
      if (shot.hitZombieHandle === null) continue;
      this.scopeCursor.flashHit('hit');
      playSfx('hitTick');
      const pierceContinues = applyZombieShot(
        this.zombies,
        shot,
        this.shotDirection,
      );
      if (pierceContinues && shot.pierceTo !== null) {
        this.tracerRenderer.spawn(
          shot.to,
          shot.pierceTo,
          tracerStyleForWeapon(shot.weaponDefId),
          tracerOptionsForShot(shot, false, true),
        );
      }
    }

    this.attachNewIslands(this.vehicle.finishStep());
    this.trackDamageTaken();
    this.queueCompletedStepTransition();
  }

  /**
   * Explosive shells (Heavy Cannon): damage everything around the point of
   * impact, then play the blast and kick the camera. The zombie the shell hit
   * directly is excluded — `applyZombieShot` already charges it full damage,
   * and the splash is what the *rest* of the crowd takes.
   *
   * A miss still detonates: shells that land in dirt are the whole point of an
   * area weapon, and rewarding a near miss is what makes it feel heavy.
   */
  private detonateShell(shot: TracerShot): void {
    if (shot.splashRadiusM <= 0 || shot.splashDamage <= 0) return;
    this.zombies.explodeAt(
      shot.to.x,
      shot.to.y,
      shot.to.z,
      shot.splashRadiusM,
      shot.splashDamage,
      shot.hitZombieHandle,
    );
    this.vfx.shellBurst(shot.to.x, shot.to.y, shot.to.z, shot.splashRadiusM);
    this.shakeCameraAt(shot.to.x, shot.to.z, 0.9);
  }

  /**
   * Kick the camera for a blast at a world point, falling off with distance so
   * a shell across the graveyard registers without rattling the screen.
   */
  private shakeCameraAt(x: number, z: number, strength: number): void {
    const position = this.vehicle.body.translation();
    const distance = Math.hypot(x - position.x, z - position.z);
    const falloff = Math.max(0, 1 - distance / CAMERA_SHAKE_FALLOFF_M);
    if (falloff <= 0) return;
    this.followCamera.addShake(strength * falloff * falloff);
  }

  /**
   * Total health of every part still attached and alive. Losing a part drops
   * this by whatever health it had left, which is exactly the "that hurt"
   * signal the vignette wants.
   */
  private liveVehicleHealth(): number {
    let total = 0;
    for (const part of this.vehicle.assembled.parts.values()) {
      if (!part.alive || part.detached) continue;
      total += Math.max(0, part.health);
    }
    return total;
  }

  /** Feed this step's health loss to the damage vignette. */
  private trackDamageTaken(): void {
    const health = this.liveVehicleHealth();
    if (this.lastLiveHealth >= 0 && health < this.lastLiveHealth) {
      this.warningHud.reportDamage(this.lastLiveHealth - health);
    }
    this.lastLiveHealth = health;
  }

  private updateRecoveryAssist(dt: number): void {
    this.recoveryCooldown = Math.max(0, this.recoveryCooldown - dt);
    this.recoverySettleSeconds = Math.max(0, this.recoverySettleSeconds - dt);
    const telemetry = this.vehicle.telemetry();
    const rotation = this.vehicle.body.rotation();
    const upright = 1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z);
    const tryingToMove =
      this.controls.throttle > 0 || (this.controls.reverse ?? 0) > 0;
    const stalled =
      tryingToMove && telemetry.speedKmh < 3 && telemetry.groundedWheels > 0;
    const tipped = upright < 0.35;
    if (stalled || tipped) this.stuckSeconds += dt;
    else this.stuckSeconds = Math.max(0, this.stuckSeconds - dt * 2);

    const canRecover =
      this.stuckSeconds >= STUCK_PROMPT_SECONDS && this.recoveryCooldown <= 0;
    this.stuckPrompt.classList.toggle('is-visible', canRecover);
    if (this.recoverySettleSeconds > 0) this.applyRecoveryControlLock();
    if (!this.recoveryRequested) return;
    this.recoveryRequested = false;
    if (!canRecover) return;
    this.performRecoveryJump();
  }

  private performRecoveryJump(): void {
    const body = this.vehicle.body;
    this.vehicle.resetRecoveryState();
    const mass = Math.max(1, body.mass());
    const rotation = body.rotation();
    this.recoveryQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

    // Preserve the car's heading while rotating most of the way back toward
    // world-up. The jump finishes the reset physically instead of adding spin
    // to whatever roll/pitch momentum the crash left behind.
    this.recoveryForward.set(0, 0, 1).applyQuaternion(this.recoveryQuaternion);
    this.recoveryForward.y = 0;
    if (this.recoveryForward.lengthSq() < 1e-5) {
      this.recoveryForward.set(0, 0, 1);
    } else {
      this.recoveryForward.normalize();
    }
    this.recoveryTargetQuaternion.setFromAxisAngle(
      this.wheelSteerAxis,
      Math.atan2(this.recoveryForward.x, this.recoveryForward.z),
    );
    this.recoveryQuaternion.slerp(this.recoveryTargetQuaternion, 0.9);
    const translation = body.translation();
    this.recoveryTranslation.x = translation.x;
    this.recoveryTranslation.y = translation.y + 0.75;
    this.recoveryTranslation.z = translation.z;
    body.setTranslation(this.recoveryTranslation, true);
    body.setRotation(
      {
        x: this.recoveryQuaternion.x,
        y: this.recoveryQuaternion.y,
        z: this.recoveryQuaternion.z,
        w: this.recoveryQuaternion.w,
      },
      true,
    );

    this.recoveryVelocity.x = 0;
    this.recoveryVelocity.y = 0;
    this.recoveryVelocity.z = 0;
    body.setLinvel(this.recoveryVelocity, true);
    this.recoveryAngularVelocity.x = 0;
    this.recoveryAngularVelocity.y = 0;
    this.recoveryAngularVelocity.z = 0;
    body.setAngvel(this.recoveryAngularVelocity, true);

    this.recoveryImpulse.x = 0;
    this.recoveryImpulse.y = mass * 5.25;
    this.recoveryImpulse.z = 0;
    body.applyImpulse(this.recoveryImpulse, true);
    this.recoverySettleSeconds = RECOVERY_SETTLE_SECONDS;
    this.applyRecoveryControlLock();
    this.stuckSeconds = 0;
    this.recoveryCooldown = RECOVERY_COOLDOWN_SECONDS;
    this.stuckPrompt.classList.remove('is-visible');
  }

  private applyRecoveryControlLock(): void {
    this.controls.throttle = 0;
    this.controls.reverse = 0;
    this.controls.brake = 1;
    this.controls.steer = 0;
  }

  private updateControls(): void {
    if (this.phase !== 'active') {
      this.controls.throttle = 0;
      this.controls.reverse = 0;
      this.controls.brake = 1;
      this.controls.steer = 0;
      this.controls.fire = false;
      return;
    }

    const forward = this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0;
    const reverse = this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0;
    // S brakes while rolling forward, reverses once (near-)stopped.
    const forwardSpeed = this.vehicle.forwardSpeed();
    const movingForward = forwardSpeed > 0.6;
    this.controls.throttle = forward;
    this.controls.reverse = reverse && !forward && !movingForward ? 1 : 0;
    this.controls.brake = this.keys.has(' ')
      ? 1
      : reverse && movingForward
        ? 1
        : 0;
    this.controls.brake = brakeInputWithAutoHold(this.controls, forwardSpeed);
    this.controls.steer =
      (this.keys.has('a') || this.keys.has('arrowleft') ? -1 : 0) +
      (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0);
    this.controls.fire = this.keys.has('f') || this.pointerFiring;
  }

  private attachNewIslands(
    islands: ReturnType<RuntimeVehicle['finishStep']>,
  ): void {
    for (const island of islands) {
      const group = new THREE.Group();
      const position = island.body.translation();
      const rotation = island.body.rotation();
      group.position.set(position.x, position.y, position.z);
      group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      this.scene.add(group);
      group.updateMatrixWorld(true);
      for (const partId of island.partIds) {
        const mesh = this.vehicleGroup.getObjectByName(`part:${partId}`);
        if (mesh) {
          this.vehicleGroup.remove(mesh);
          group.add(mesh);
        }
        const wheelMesh = this.wheelMeshes.get(partId);
        if (wheelMesh) {
          this.wheelMeshes.delete(partId);
          this.wheelSpin.delete(partId);
          group.attach(wheelMesh);
        }
      }
      this.islandGroups.set(island.body.handle, group);
    }
  }

  private beginCountdown(wave: number): void {
    this.setCurrentWave(wave);
    this.phase = 'countdown';
    this.countdownRemaining = COUNTDOWN_SECONDS;
    this.lastCountdownSecond = -1;
    this.pointerFiring = false;
    this.pendingWaveKillReward = 0;
    this.pendingWaveReward = 0;
    this.keys.clear();
    this.stuckSeconds = 0;
    this.recoverySettleSeconds = 0;
    this.recoveryRequested = false;
    this.stuckPrompt.classList.remove('is-visible');
    this.waveClearCard.hide();
    this.damageNumbers?.clear();
    this.countdownOverlay.style.display = 'block';
    this.mineWarningDistances = new WeakMap<object, number>();
    this.mineWarningPulsed = new WeakSet<object>();
    this.mineWarningPulseSeconds = 0;
    this.integrityFill.style.boxShadow = '';
  }

  private setCurrentWave(wave: number): void {
    const nextWave = Math.max(1, Math.floor(Number.isFinite(wave) ? wave : 1));
    if (
      this.currentWave === nextWave &&
      this.biomeEnvironmentWave === nextWave
    ) {
      return;
    }

    this.currentWave = nextWave;
    const intensity = hazardIntensity(this.biomeHazard, nextWave);
    this.biomeEnvironment = combineEnvironments(
      this.biomeDrive,
      hazardEnvironment(this.biomeHazard, intensity),
    );
    this.arena.setHazardFog(intensity);
    this.biomeEnvironmentWave = nextWave;
  }

  private startCurrentWave(): void {
    this.phase = 'active';
    this.countdownOverlay.style.display = 'none';
    this.resetWaveStats();
    this.waves.startWave(this.currentWave);
  }

  private resetWaveStats(): void {
    this.waveStartKills = this.kills;
    this.waveMoneyEarned = 0;
    this.waveElapsedSeconds = 0;
    this.waveStartIntegrityPct = this.vehicle.integrityPct();
    // A fresh wave starts on clean ground rather than inheriting the last
    // wave's airborne gibs and settled splats.
    this.vfx.reset();
    this.tracerRenderer.reset();
    // Re-baseline damage tracking: carried-over wave damage is not a new hit.
    this.lastLiveHealth = -1;
    this.warningRefreshSeconds = 0;
  }

  private handleZombieKilled(reward: number, kind: ZombieKind): void {
    this.kills++;
    if (!this.debugProgressionSuppressed) {
      this.scopeCursor?.flashHit('kill');
      playSfx('killThud');
      this.runScore = addScore(
        this.runScore,
        killScore(kind, this.currentWave),
      );
    }
    if (kind === 'phone-addict' && !this.debugProgressionSuppressed) {
      this.phoneAddictKills++;
      this.callbacks.onPhoneAddictKilled();
    }
    this.addPendingWaveKillReward(reward);
    this.waves.recordZombieKilled();
  }

  private onWaveComplete(wave: number, reward: number): void {
    if (this.phase === 'gameOver') return;
    if (wave !== this.currentWave) this.setCurrentWave(wave);
    // Resolve the completed physics step before paying the clear bonus. If the
    // final zombie and vehicle die together, destruction wins consistently and
    // the uncleared wave is neither counted nor rewarded.
    this.pendingWaveReward =
      Number.isSafeInteger(reward) && reward > 0 ? reward : 0;
    if (!this.debugProgressionSuppressed) {
      this.runScore = addScore(this.runScore, waveClearScore(wave));
      this.callbacks.onWaveCleared(wave);
    }
    this.zombies.clearLandmines();
    this.phase = 'cleared';
    this.pointerFiring = false;
    this.keys.clear();
    this.countdownOverlay.style.display = 'none';
    this.stuckPrompt.classList.remove('is-visible');
  }

  private addPendingWaveKillReward(amount: number): void {
    if (
      this.phase !== 'active' ||
      !Number.isSafeInteger(amount) ||
      amount <= 0
    ) {
      return;
    }
    const next = this.pendingWaveKillReward + amount;
    if (Number.isSafeInteger(next)) this.pendingWaveKillReward = next;
  }

  private pendingWaveTotal(): number {
    const total = this.pendingWaveKillReward + this.pendingWaveReward;
    return Number.isSafeInteger(total) && total > 0 ? total : 0;
  }

  private discardPendingWaveRewards(): void {
    this.pendingWaveKillReward = 0;
    this.pendingWaveReward = 0;
    this.lastHudPending = -1;
  }

  private bankPendingWaveRewards(): void {
    const total = this.pendingWaveTotal();
    if (total <= 0) {
      this.discardPendingWaveRewards();
      return;
    }
    this.discardPendingWaveRewards();
    this.waveMoneyEarned = 0;
    const credited = this.callbacks.onReward(total);
    if (Number.isSafeInteger(credited) && credited > 0) {
      this.waveMoneyEarned = credited;
    }
  }

  private currentRunState(): RunState {
    return { wave: this.currentWave };
  }

  private queueCompletedStepTransition(): void {
    if (this.pendingTransition !== null) return;
    if (this.vehicle.isDestroyed()) {
      const pendingMoneyDiscarded = this.pendingWaveTotal();
      this.discardPendingWaveRewards();
      this.queueGameOver(pendingMoneyDiscarded);
    } else if (this.phase === 'cleared') {
      this.bankPendingWaveRewards();
      if (this.callbacks.onWaveCheckpoint) {
        const payload = this.clearedWavePayload();
        this.callbacks.onWaveCheckpoint(
          payload.nextRun,
          payload.survivingPartIds,
          payload.partHp,
          payload.kills,
          payload.score,
        );
      }
      this.stopVehicleMotion();
      this.showVictory();
    }
  }

  private showVictory(): void {
    const survivingPartIds = new Set(this.vehicle.survivingPartIds());
    const damagedPartCount = [...this.vehicle.assembled.parts].filter(
      ([partId, part]) =>
        survivingPartIds.has(partId) &&
        part.alive &&
        !part.detached &&
        part.health < part.def.health,
    ).length;
    const lostParts = [...this.vehicle.assembled.parts]
      .filter(([partId]) => !survivingPartIds.has(partId))
      .map(([, part]) => {
        const def = getPartDef(part.placed.defId);
        return `${def.name} ($${def.cost})`;
      });
    const nextWave = this.currentWave + 1;
    const warnings = threatWarningsForWave(nextWave);
    const killsThisWave = Math.max(0, this.kills - this.waveStartKills);
    const integrityPct = this.vehicle.integrityPct();
    this.cleanWaveStreak =
      lostParts.length === 0 ? this.cleanWaveStreak + 1 : 0;

    const bestSecondsForWave = badgeStore.bestTimeForWave(this.currentWave);
    if (!this.debugProgressionSuppressed) {
      badgeStore.recordWaveTime(this.currentWave, this.waveElapsedSeconds);
    }
    const stats: WaveResultStats = {
      wave: this.currentWave,
      killsThisWave,
      elapsedSeconds: this.waveElapsedSeconds,
      moneyEarned: this.waveMoneyEarned,
      integrityPct,
      startIntegrityPct: this.waveStartIntegrityPct,
      partsLost: lostParts.length,
      damagedParts: damagedPartCount,
      bestSecondsForWave,
      cleanWaveStreak: this.cleanWaveStreak,
    };
    const earned = evaluateWaveBadges(stats);
    const newBadgeIds = this.debugProgressionSuppressed
      ? []
      : badgeStore.record(earned.map((badge) => badge.id)).newlyEarned;
    const view: WaveClearCardView = {
      wave: this.currentWave,
      moneyEarned: this.waveMoneyEarned,
      runMoneyTotal: this.callbacks.runEarnings(),
      kills: killsThisWave,
      elapsedSeconds: this.waveElapsedSeconds,
      integrityPct,
      nextWaveComposition: formatWaveComposition(
        zombieCompositionForWave(nextWave),
      ),
      warnings,
      badges: earned,
      newBadgeIds,
      repair: this.repairQuote(),
    };
    this.waveClearCard.show(view);
  }

  private queueGameOver(pendingMoneyDiscarded = 0): void {
    if (this.pendingTransition !== null || this.phase === 'gameOver') return;
    this.phase = 'gameOver';
    this.controls.throttle = 0;
    this.controls.brake = 1;
    this.controls.steer = 0;
    this.controls.fire = false;
    this.pointerFiring = false;
    this.keys.clear();
    this.countdownOverlay.style.display = 'none';
    this.waveClearCard.hide();
    this.stuckPrompt.classList.remove('is-visible');
    this.stopVehicleMotion();
    this.pendingTransition = {
      kind: 'gameOver',
      run: this.currentRunState(),
      pendingMoneyDiscarded,
    };
  }

  private flushPendingTransition(): void {
    const pending = this.pendingTransition;
    if (pending === null) return;
    this.pendingTransition = null;
    if (pending.kind === 'buildPhase') {
      this.callbacks.onBuildPhase(
        pending.run,
        pending.survivingPartIds,
        pending.partHp,
        pending.kills,
        pending.score,
      );
    } else {
      // The run is recorded and the garage wiped now, but the mode stays alive
      // so the player can read the result before the reset garage appears.
      this.showGameOver(
        this.callbacks.onGameOver(
          pending.run,
          pending.pendingMoneyDiscarded,
          this.runScore,
          this.kills,
        ),
      );
    }
  }

  /** Present the finished run and its leaderboard placing. */
  private showGameOver(outcome: RunOutcome): void {
    this.gameOverScore.textContent = outcome.score.toLocaleString();
    this.gameOverBest.hidden = !outcome.isPersonalBest;
    this.gameOverWaveValue.textContent = outcome.wave.toLocaleString();
    this.gameOverKillsValue.textContent = outcome.kills.toLocaleString();
    this.gameOverBoard.replaceChildren(
      buildLeaderboardTable(leaderboardRows(outcome.entries, outcome.rank)),
    );
    this.gameOverOverlay.style.display = 'block';
  }

  private readonly onGameOverContinue = (): void => {
    if (this.disposed) return;
    this.gameOverOverlay.style.display = 'none';
    this.callbacks.onGameOverContinue();
  };

  private stopVehicleMotion(): void {
    this.vehicle.body.setLinvel(this.stoppedVelocity, false);
    this.vehicle.body.setAngvel(this.stoppedVelocity, false);
    this.vehicle.body.resetForces(false);
    this.vehicle.body.resetTorques(false);
    for (const island of this.vehicle.islands) {
      island.body.setLinvel(this.stoppedVelocity, false);
      island.body.setAngvel(this.stoppedVelocity, false);
      island.body.resetForces(false);
      island.body.resetTorques(false);
    }
    for (const wheel of this.vehicle.wheels()) wheel.omega = 0;
  }

  private syncView(frameDt: number): void {
    const position = this.vehicle.body.translation();
    const rotation = this.vehicle.body.rotation();
    this.vehicleGroup.position.set(position.x, position.y, position.z);
    this.vehicleGroup.quaternion.set(
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
    );

    for (const [id, part] of this.vehicle.assembled.parts) {
      if (part.alive) continue;
      const mesh = this.vehicleGroup.getObjectByName(`part:${id}`);
      if (mesh) mesh.visible = false;
      const wheelMesh = this.wheelMeshes.get(id);
      if (wheelMesh) wheelMesh.visible = false;
    }

    for (const wheel of this.vehicle.wheels()) {
      const mesh = this.wheelMeshes.get(wheel.partId);
      if (!mesh || wheel.broken) continue;
      const centre = wheelVisualCentre(this.vehicle.body, wheel);
      mesh.position.set(centre.x, centre.y, centre.z);
      mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      const visualSpin =
        (this.wheelSpin.get(wheel.partId) ?? 0) + wheel.omega * frameDt;
      this.wheelSpin.set(wheel.partId, visualSpin);
      const spin = mesh.getObjectByName('wheel-spin');
      const baseQuaternion = spin?.userData.baseQuat as
        THREE.Quaternion | undefined;
      if (spin && baseQuaternion) {
        this.wheelSteerQuaternion.setFromAxisAngle(
          this.wheelSteerAxis,
          -wheel.steerAngle,
        );
        spin.quaternion
          .copy(this.wheelSteerQuaternion)
          .multiply(baseQuaternion);
        spin.rotateY(visualSpin);
      }
    }

    for (const [handle, group] of this.islandGroups) {
      const body = this.world.getRigidBody(handle);
      if (!body) continue;
      const islandPosition = body.translation();
      const islandRotation = body.rotation();
      group.position.set(islandPosition.x, islandPosition.y, islandPosition.z);
      group.quaternion.set(
        islandRotation.x,
        islandRotation.y,
        islandRotation.z,
        islandRotation.w,
      );
    }

    this.zombies.updateVisuals(frameDt);
    this.fuelPickups.updateVisuals(frameDt);
    this.syncShieldBubble(frameDt);
    this.tracerRenderer.update(frameDt, this.camera);
    // Camera-relative LOD, so a firefight across the graveyard costs less than
    // the same firefight under the player's nose.
    this.vfx.setViewpoint(this.camera.position);
    this.vfx.update(frameDt);
    this.warningHud.update(frameDt);
    this.syncWarnings(frameDt);
    this.syncMineWarningHud(frameDt);
    this.followCamera.update(frameDt);
    this.damageNumbers.update(frameDt, this.camera);
    this.arena.follow(this.vehicleGroup);
    this.syncHud();
    // Vehicles face local +Z, so the heading the arrow should point along is the
    // yaw of the rotated forward axis. The minimap throttles its own redraws.
    this.minimapForward
      .set(0, 0, 1)
      .applyQuaternion(this.vehicleGroup.quaternion);
    this.minimap.update(
      position.x,
      position.z,
      Math.atan2(this.minimapForward.x, this.minimapForward.z),
      this.zombies.getAliveTargets(),
      this.currentMineSweeperLevel >= MINE_SWEEPER_MINIMAP_LEVEL
        ? this.zombies.activeMines()
        : undefined,
      this.fuelPickups.activeCrates(),
    );
  }

  private resolveLiveMineSweeper(): RuntimePart | null {
    for (const part of this.vehicle.assembled.parts.values()) {
      if (part.placed.defId !== 'mine-sweeper') continue;
      if (!this.isAttachedAlivePart(part)) continue;
      return part;
    }
    return null;
  }

  /**
   * The single ability part bound to Q. Among attached-alive parts with an
   * ability, prefer the one the player flagged in the garage
   * (config.activeAbility); otherwise fall back to the first one found.
   */
  private resolveActiveAbilityPart(): RuntimePart | null {
    let fallback: RuntimePart | null = null;
    for (const part of this.vehicle.assembled.parts.values()) {
      if (part.def.ability === undefined) continue;
      if (!this.isAttachedAlivePart(part)) continue;
      if (part.placed.config.activeAbility === true) return part;
      fallback ??= part;
    }
    return fallback;
  }

  /** Tick the ability cooldown and, on a Q press, discharge the active ability. */
  private updateAbility(): void {
    if (this.abilityCooldown > 0) {
      this.abilityCooldown = Math.max(0, this.abilityCooldown - FIXED_DT);
    }
    const requested = this.abilityRequested;
    this.abilityRequested = false;
    const part = this.resolveActiveAbilityPart();
    const ability = part?.def.ability;
    if (!requested || ability === undefined || this.abilityCooldown > 0) return;

    const level = part?.placed.config.level ?? 1;
    if (ability.kind === 'freeze') {
      const freeze = effectiveFreeze(ability, level);
      const pos = this.vehicle.body.translation();
      this.zombies.freezeNearest(
        { x: pos.x, z: pos.z },
        freeze.targets,
        freeze.rangeM,
        freeze.durationSeconds,
      );
      this.abilityCooldown = freeze.cooldownSeconds;
    } else {
      const shield = effectiveShield(ability, level);
      this.vehicle.grantInvulnerability(shield.durationSeconds);
      this.abilityCooldown = shield.cooldownSeconds;
    }
  }

  private isAttachedAlivePart(part: RuntimePart): boolean {
    return part.alive && !part.detached && part.health > 0;
  }

  private updateMineWarningPulse(revealRadiusM: number): void {
    if (
      this.phase !== 'active' ||
      this.currentMineSweeperLevel < 3 ||
      revealRadiusM <= 0
    ) {
      return;
    }

    const position = this.vehicle.body.translation();
    const radiusSq = revealRadiusM * revealRadiusM;
    const mines = this.zombies.activeMines();
    for (let index = 0; index < mines.length; index += 1) {
      const mine = mines[index];
      if (mine.state !== 'armed' || !mine.revealed) continue;
      const dx = mine.x - position.x;
      const dz = mine.z - position.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq > radiusSq) continue;

      const previousDistance = this.mineWarningDistances.get(mine);
      const distance = Math.sqrt(distanceSq);
      this.mineWarningDistances.set(mine, distance);
      if (
        previousDistance === undefined ||
        distance >= previousDistance - 0.08 ||
        this.mineWarningPulsed.has(mine)
      ) {
        continue;
      }

      this.mineWarningPulsed.add(mine);
      this.mineWarningPulseSeconds = 0.18;
      return;
    }
  }

  private syncMineWarningHud(frameDt: number): void {
    if (this.mineWarningPulseSeconds <= 0) return;
    this.mineWarningPulseSeconds = Math.max(
      0,
      this.mineWarningPulseSeconds - frameDt,
    );
    const intensity = this.mineWarningPulseSeconds / 0.18;
    this.integrityFill.style.boxShadow =
      intensity > 0
        ? `0 0 ${Math.round(14 * intensity)}px rgba(255, 174, 61, 0.85)`
        : '';
  }

  /** Show the active-ability chip with its cooldown only while one is equipped. */
  private syncAbilityHud(): void {
    const part = this.resolveActiveAbilityPart();
    const ability = part?.def.ability;
    if (ability === undefined || part === null) {
      if (!this.abilityRoot.hidden) this.abilityRoot.hidden = true;
      this.lastHudAbilityCooldown = -1;
      this.lastHudAbilityName = '';
      return;
    }
    if (this.abilityRoot.hidden) this.abilityRoot.hidden = false;
    if (part.def.name !== this.lastHudAbilityName) {
      this.lastHudAbilityName = part.def.name;
      this.abilityLabel.textContent = part.def.name;
    }

    const remaining = Math.ceil(this.abilityCooldown);
    if (remaining === this.lastHudAbilityCooldown) return;
    this.lastHudAbilityCooldown = remaining;
    const ready = this.abilityCooldown <= 0;
    const pct = ready
      ? 100
      : 100 * (1 - this.abilityCooldown / ability.cooldownSeconds);
    this.abilityValue.textContent = ready ? 'Ready — press Q' : `${remaining}s`;
    this.abilityFill.style.width = `${pct}%`;
    this.abilityRoot.classList.toggle('is-ready', ready);
  }

  /**
   * Show a bright blue bubble around the vehicle while the Shield Generator's
   * invulnerability is active. The mesh is a child of the vehicle group, so it
   * follows the chassis automatically; opacity pulses gently for a live feel.
   */
  private syncShieldBubble(frameDt: number): void {
    const active = this.vehicle.isInvulnerable;
    if (!active) {
      if (this.shieldBubble && this.shieldBubble.visible) {
        this.shieldBubble.visible = false;
      }
      return;
    }
    if (this.shieldBubble === null) {
      const material = new THREE.MeshBasicMaterial({
        color: 0x33aaff,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(SHIELD_BUBBLE_RADIUS_M, 24, 16),
        material,
      );
      mesh.name = 'shield-bubble';
      this.vehicleGroup.add(mesh);
      this.shieldBubble = mesh;
      this.shieldBubbleMaterial = material;
    }
    this.shieldBubble.visible = true;
    this.shieldBubblePhase += frameDt * 4;
    if (this.shieldBubbleMaterial) {
      this.shieldBubbleMaterial.opacity =
        0.24 + 0.1 * (0.5 + 0.5 * Math.sin(this.shieldBubblePhase));
    }
  }

  /**
   * Re-evaluate the alert stack a few times a second. The inputs move slowly
   * compared with the frame rate, and the evaluation walks every part and
   * wheel, so there is nothing to gain from doing it per frame.
   */
  private syncWarnings(frameDt: number): void {
    this.warningRefreshSeconds -= frameDt;
    if (this.warningRefreshSeconds > 0) return;
    this.warningRefreshSeconds = WARNING_REFRESH_INTERVAL_SECONDS;

    if (this.phase !== 'active') {
      if (this.lastWarnings.length > 0) {
        this.lastWarnings = [];
        this.warningHud.setWarnings(this.lastWarnings);
      }
      this.warningHud.setCritical(false);
      return;
    }

    const telemetry = this.vehicle.telemetry();
    const integrityPct = this.vehicle.integrityPct();
    const wheels = this.vehicle.wheels().map((wheel) => {
      const part = this.vehicle.assembled.parts.get(wheel.partId);
      const maxHealth = part?.def.health ?? 0;
      return {
        healthFraction:
          part === undefined || maxHealth <= 0
            ? 0
            : Math.max(0, part.health) / maxHealth,
        broken: wheel.broken || part === undefined || !part.alive,
      };
    });

    let weaponCount = 0;
    let liveWeaponCount = 0;
    let liveEngineCount = 0;
    for (const part of this.vehicle.assembled.parts.values()) {
      const live = this.isAttachedAlivePart(part);
      if (part.def.weapon !== undefined || part.def.melee !== undefined) {
        weaponCount++;
        if (live) liveWeaponCount++;
      }
      if (part.def.engine !== undefined && live) liveEngineCount++;
    }

    this.lastWarnings = activeVehicleWarnings({
      integrityPct,
      wheels,
      fuel: telemetry.fuel,
      fuelCapacity: telemetry.fuelCapacity,
      liveEngineCount,
      weaponCount,
      liveWeaponCount,
    });
    this.warningHud.setWarnings(this.lastWarnings);
    this.warningHud.setCritical(integrityPct <= HULL_CRITICAL_PCT);
  }

  private syncHud(): void {
    const telemetry = this.vehicle.telemetry();
    const speed = Math.round(telemetry.speedKmh);
    if (this.currentWave !== this.lastHudWave) {
      this.lastHudWave = this.currentWave;
      this.syncSpeedGaugeThresholds();
      this.lastHudSpeed = -1;
    }
    const killedThisWave = Math.max(0, this.kills - this.waveStartKills);
    const totalThisWave = zombieCountForWave(this.currentWave);
    if (
      this.waveTimeline === null ||
      this.waveTimeline.currentWave !== this.currentWave ||
      this.waveTimeline.killedThisWave !== killedThisWave ||
      this.waveTimeline.totalThisWave !== totalThisWave
    ) {
      this.waveTimeline = buildWaveTimeline({
        currentWave: this.currentWave,
        killedThisWave,
        totalThisWave,
        threatsForWave: newThreatsForWave,
      });
      this.waveTimelineHud.update(this.waveTimeline);
    }
    if (speed !== this.lastHudSpeed) {
      this.lastHudSpeed = speed;
      this.speedValue.textContent = String(speed);
      this.syncSpeedGauge(speed);
    }
    const integrity = Math.round(this.vehicle.integrityPct());
    if (integrity !== this.lastHudIntegrity) {
      this.lastHudIntegrity = integrity;
      this.integrityValue.textContent = `${integrity}%`;
      this.integrityFill.style.width = `${integrity}%`;
      this.integrityFill.parentElement?.setAttribute(
        'aria-valuenow',
        String(integrity),
      );
      this.integrityFill.classList.toggle('is-critical', integrity <= 30);
    }
    const fuelLitres = Math.ceil(telemetry.fuel);
    if (fuelLitres !== this.lastHudFuel) {
      this.lastHudFuel = fuelLitres;
      const cap = Math.round(telemetry.fuelCapacity);
      const pct =
        telemetry.fuelCapacity > 0
          ? (telemetry.fuel / telemetry.fuelCapacity) * 100
          : 0;
      this.fuelValue.textContent = `${fuelLitres} / ${cap} L`;
      this.fuelFill.style.width = `${pct}%`;
      this.fuelFill.parentElement?.setAttribute(
        'aria-valuenow',
        String(Math.round(pct)),
      );
      this.fuelFill.classList.toggle('is-low', pct <= 25);
      this.fuelFill.classList.toggle('is-empty', telemetry.fuel <= 0);
    }
    this.syncAbilityHud();
    if (this.runScore !== this.lastHudScore) {
      this.lastHudScore = this.runScore;
      this.scoreValue.textContent = this.runScore.toLocaleString();
    }
    const money = this.callbacks.runEarnings();
    if (money !== this.lastHudMoney) {
      this.lastHudMoney = money;
      this.moneyValue.textContent = `$${money}`;
    }
    const pendingMoney =
      this.phase === 'active' || this.phase === 'cleared'
        ? this.pendingWaveTotal()
        : 0;
    if (pendingMoney !== this.lastHudPending) {
      this.lastHudPending = pendingMoney;
      this.pendingMoneyValue.textContent = `+$${pendingMoney}`;
    }
    if (this.phase === 'countdown') {
      const second = Math.max(1, Math.ceil(this.countdownRemaining));
      if (second !== this.lastCountdownSecond) {
        this.lastCountdownSecond = second;
        this.countdownValue.textContent = String(second);
      }
    }
  }

  private syncSpeedGaugeThresholds(): void {
    this.ramDamageThresholdKmh = MIN_IMPACT_SPEED * 3.6;
    this.ramKillThresholdKmh = LETHAL_IMPACT_SPEED * 3.6;
    this.speedScaleMaxKmh = 120;

    const safeWidth =
      (this.ramDamageThresholdKmh / this.speedScaleMaxKmh) * 100;
    const damageWidth =
      ((this.ramKillThresholdKmh - this.ramDamageThresholdKmh) /
        this.speedScaleMaxKmh) *
      100;
    this.speedTrack.style.setProperty('--speed-safe-width', `${safeWidth}%`);
    this.speedTrack.style.setProperty(
      '--speed-damage-width',
      `${damageWidth}%`,
    );
    this.speedTrack.setAttribute(
      'aria-valuemax',
      String(this.speedScaleMaxKmh),
    );

    const damageAt = Math.round(this.ramDamageThresholdKmh);
    const killAt = Math.ceil(this.ramKillThresholdKmh);
    this.speedSafeLabel.textContent = `Safe <${damageAt}`;
    this.speedDamageLabel.textContent = `Damage ${damageAt}–${killAt - 1}`;
    this.speedKillLabel.textContent = `Kill ${killAt}+`;
  }

  private syncSpeedGauge(speedKmh: number): void {
    const markerPosition =
      (Math.min(Math.max(speedKmh, 0), this.speedScaleMaxKmh) /
        this.speedScaleMaxKmh) *
      100;
    this.speedTrack.style.setProperty(
      '--speed-marker-position',
      `${markerPosition}%`,
    );
    this.speedTrack.setAttribute('aria-valuenow', String(speedKmh));
    this.speedTrack.dataset.zone =
      speedKmh >= this.ramKillThresholdKmh
        ? 'kill'
        : speedKmh >= this.ramDamageThresholdKmh
          ? 'damage'
          : 'safe';
  }

  /**
   * Gun feedback for one fired ray: the muzzle event, the body of the shot for
   * flame cones, and whatever the round terminated against. `shotDirection`
   * must already hold the normalised travel direction for this shot.
   */
  private emitShotVfx(shot: TracerShot): void {
    this.vfx.muzzleFlash(shot.from, shot.to, muzzleStyleForShot(shot));
    if (shot.damageType === 'aoe') this.vfx.flameJet(shot.from, shot.to);

    const shielded =
      shot.hitZombieHandle !== null &&
      this.zombies.isShieldedTarget(shot.hitZombieHandle);
    const impact = impactKindForShot(shot, shielded);
    if (impact === null) return;
    this.vfx.bulletImpact(
      shot.to.x,
      shot.to.y,
      shot.to.z,
      this.shotDirection.x,
      this.shotDirection.y,
      this.shotDirection.z,
      impact,
    );
  }

  private showTracer(shot: TracerShot, faded: boolean): void {
    // The flamethrower draws its own cone of fire in the VFX layer; a tracer
    // line on top of it just reads as a stray orange wire.
    if (shot.damageType === 'aoe') return;
    this.tracerRenderer.spawn(
      shot.from,
      shot.to,
      tracerStyleForWeapon(shot.weaponDefId),
      tracerOptionsForShot(shot, faded),
    );
  }

  /** Debug seam control injection, matching ChamberMode's key-backed path. */
  debugSetSimPaused(paused: boolean): void {
    this.debugPaused = paused;
    this.accumulator = 0;
    this.lastTime = performance.now();
  }

  debugStepSim(steps: number): void {
    if (this.disposed) return;
    const count = Math.max(0, Math.floor(Number.isFinite(steps) ? steps : 0));
    let stepped = 0;
    for (; stepped < count; stepped++) {
      this.stepFixed();
      if (this.pendingTransition !== null) {
        stepped++;
        break;
      }
    }
    this.syncView(stepped * FIXED_DT);
    this.renderer.render(this.scene, this.camera);
    this.flushPendingTransition();
  }

  debugSetControls(controls: Partial<VehicleControls>): void {
    Object.assign(this.controls, controls);
    if (controls.throttle !== undefined && controls.throttle > 0)
      this.keys.add('w');
    if (controls.throttle === 0) this.keys.delete('w');
    if (controls.steer !== undefined) {
      this.keys.delete('a');
      this.keys.delete('d');
      if (controls.steer < 0) this.keys.add('a');
      if (controls.steer > 0) this.keys.add('d');
    }
    if (controls.brake !== undefined) {
      if (controls.brake > 0) this.keys.add(' ');
      else this.keys.delete(' ');
    }
    if (controls.fire !== undefined) {
      if (controls.fire) this.keys.add('f');
      else this.keys.delete('f');
    }
    if (controls.reverse !== undefined) {
      if (controls.reverse > 0) this.keys.add('s');
      else this.keys.delete('s');
    }
  }

  debugStartWave(wave: number): void {
    if (this.disposed || this.phase === 'gameOver') return;
    this.zombies.reset();
    this.damageNumbers?.clear();
    this.waves.reset();
    this.setCurrentWave(wave);
    this.phase = 'active';
    this.pendingWaveKillReward = 0;
    this.pendingWaveReward = 0;
    this.pendingTransition = null;
    this.pointerFiring = false;
    this.keys.clear();
    this.countdownOverlay.style.display = 'none';
    this.waveClearCard.hide();
    this.resetWaveStats();
    this.waves.startWave(this.currentWave);
  }

  debugKillAllZombies(): void {
    if (this.disposed || this.phase !== 'active') return;
    this.debugProgressionSuppressed = true;
    try {
      const unspawnedKills = this.waves.prepareDebugKillAll();
      this.kills += unspawnedKills;
      this.addPendingWaveKillReward(unspawnedKills * BASE_ZOMBIE_STATS.reward);
      this.zombies.forceKillAll();
      this.waves.fixedUpdate(0);
      this.attachNewIslands(this.vehicle.finishStep());
      this.queueCompletedStepTransition();
      this.syncView(0);
      this.renderer.render(this.scene, this.camera);
      this.flushPendingTransition();
    } finally {
      this.debugProgressionSuppressed = false;
    }
  }

  /**
   * Chip every part down to `fraction` of its maximum so tests can reach a
   * damaged-but-alive rig. Destruction is already covered by
   * `debugDestroyVehicle`; this exists for the repair flow, which only has
   * anything to offer while the vehicle is hurt but still driving.
   */
  debugDamageVehicle(fraction = 0.5): void {
    if (this.disposed || this.pendingTransition !== null) return;
    const keep = Math.min(0.95, Math.max(0.05, fraction));
    for (const [, part] of this.vehicle.assembled.parts) {
      if (!part.alive || part.detached) continue;
      part.health = Math.max(1, Math.round(part.def.health * keep));
    }
    this.syncView(0);
    this.renderer.render(this.scene, this.camera);
  }

  /** Destroy the rig outright so tests can reach the game-over screen. */
  debugDestroyVehicle(): void {
    if (this.disposed || this.pendingTransition !== null) return;
    if (this.phase === 'countdown') this.startCurrentWave();
    if (this.phase !== 'active') return;
    for (const partId of Object.keys(this.vehicle.partHpSnapshot())) {
      this.vehicle.applyDirectDamage(partId, Number.MAX_SAFE_INTEGER);
    }
    this.attachNewIslands(this.vehicle.finishStep());
    this.queueCompletedStepTransition();
    this.syncView(0);
    this.renderer.render(this.scene, this.camera);
    this.flushPendingTransition();
  }

  debugForceWaveComplete(): void {
    if (this.disposed || this.pendingTransition !== null) return;
    if (this.phase === 'countdown') this.startCurrentWave();
    this.debugKillAllZombies();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  debugTelemetry(): SurvivalTelemetry {
    const position = this.vehicle.body.translation();
    const rotation = this.vehicle.body.rotation();
    const angvel = this.vehicle.body.angvel();
    return {
      mode: 'survival',
      kills: this.kills,
      score: this.runScore,
      phoneAddictKills: this.phoneAddictKills,
      wave: this.currentWave,
      zombiesAlive: this.zombies.getActiveCount(),
      money: this.callbacks.profileMoney(),
      runMoney: this.callbacks.runEarnings(),
      phase: this.phase,
      partHp: this.vehicle.partHpSnapshot(),
      integrityPct: this.vehicle.integrityPct(),
      vehiclePos: [position.x, position.y, position.z],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      angvel: [angvel.x, angvel.y, angvel.z],
      cameraPos: [
        this.camera.position.x,
        this.camera.position.y,
        this.camera.position.z,
      ],
      groundedWheels: this.vehicle.telemetry().groundedWheels,
      weapons: this.vehicle.weaponStates().map((weapon) => ({
        partId: weapon.partId,
        aimMode: weapon.def.aimMode,
        shotsFired: weapon.shotsFired,
      })),
      wheels: this.vehicle
        .wheels()
        .filter((wheel) => !wheel.broken)
        .map((wheel) => {
          const centre = wheelVisualCentre(this.vehicle.body, wheel);
          return {
            partId: wheel.partId,
            worldCentre: [centre.x, centre.y, centre.z] as [
              number,
              number,
              number,
            ],
          };
        }),
    };
  }

  debugZombiePositions(): [number, number, number][] {
    return this.zombies.debugAlivePositions();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tuningUnsubscribe?.();
    this.tuningUnsubscribe = null;
    this.devPanel?.dispose();
    this.devPanel = null;
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.blur);
    window.removeEventListener('pointerup', this.onFireUp);
    window.removeEventListener('pointercancel', this.onFireUp);
    this.renderer.domElement.removeEventListener('pointermove', this.onAim);
    this.renderer.domElement.removeEventListener(
      'pointerdown',
      this.onFireDown,
    );
    this.settingsSoundButton.removeEventListener('click', this.onSoundToggle);
    this.fuelPickups.dispose();
    this.zombies.setDamageListener(null);
    this.damageNumbers.dispose();
    this.zombies.dispose();
    this.vfx.dispose();
    this.arena.dispose();
    this.vehicle.dispose();
    this.eventQueue.free();
    this.world.free();
    this.minimap.dispose();
    this.scopeCursor.dispose();
    this.warningHud.dispose();
    this.waveTimelineHud.dispose();
    this.waveClearCard.dispose();
    this.ui.remove();
    this.tracerRenderer.dispose();
    disposeObject(this.scene);
    this.scene.clear();
    this.wheelMeshes.clear();
    this.wheelSpin.clear();
    this.islandGroups.clear();
  }
}

/** Ranked board as a table; the current run's row is marked for styling. */
function buildLeaderboardTable(rows: readonly LeaderboardRow[]): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'leaderboard';
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'leaderboard__empty';
    empty.textContent = 'No runs recorded yet.';
    wrapper.appendChild(empty);
    return wrapper;
  }

  const table = document.createElement('table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['#', 'Score', 'Wave', 'Kills']) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    headRow.appendChild(cell);
  }
  head.appendChild(headRow);

  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    if (row.isCurrentRun) tr.className = 'is-current-run';
    const rank = document.createElement('th');
    rank.scope = 'row';
    rank.textContent = String(row.rank);
    tr.appendChild(rank);
    for (const value of [row.score, row.wave, row.kills]) {
      const cell = document.createElement('td');
      cell.textContent = value.toLocaleString();
      tr.appendChild(cell);
    }
    body.appendChild(tr);
  }

  table.append(head, body);
  wrapper.appendChild(table);
  return wrapper;
}

function overlayPanel(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.className = 'panel';
  overlay.style.cssText =
    'position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);' +
    'min-width:290px;padding:24px;text-align:center;z-index:20';
  return overlay;
}

function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line))
      return;
    const renderable = object as THREE.Mesh | THREE.Line;
    geometries.add(renderable.geometry);
    if (Array.isArray(renderable.material)) {
      for (const material of renderable.material) materials.add(material);
    } else {
      materials.add(renderable.material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}
