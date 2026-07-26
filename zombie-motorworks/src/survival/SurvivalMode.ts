/**
 * Survival runtime: the editor blueprint vehicle, the graveyard world,
 * pooled zombie AI, wave pacing, HUD, and the existing fixed-step damage path.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { effectiveFreeze, effectiveShield } from '../core/abilities.ts';
import type { RunState } from '../core/economy.ts';
import { getPartDef } from '../core/parts.ts';
import { deriveConnections } from '../core/structural.ts';
import {
  MINE_SWEEPER_MINIMAP_LEVEL,
  mineSweeperRadius,
} from '../core/turretModules.ts';
import type { Vec3, VehicleBlueprint } from '../core/types.ts';
import type { RuntimePart } from '../runtime/assembler.ts';
import { buildPartMesh } from '../editor/meshes.ts';
import { GROUP_TERRAIN, lowestPointM } from '../runtime/assembler.ts';
import type { SurfaceKind } from '../runtime/surfaces.ts';
import {
  RuntimeVehicle,
  brakeInputWithAutoHold,
  type VehicleControls,
} from '../runtime/vehicle.ts';
import type { TracerShot } from '../runtime/weapons.ts';
import { wheelVisualCentre } from '../runtime/wheels.ts';
import { createToggle } from '../ui/system.ts';
import { ScopeCursor } from '../ui/ScopeCursor.ts';
import { FuelPickups } from './FuelPickups.ts';
import { AutoAim } from './AutoAim.ts';
import { FollowCamera } from './FollowCamera.ts';
import { GRAVEYARD_HALF_SIZE, Graveyard } from './Graveyard.ts';
import { Minimap } from './Minimap.ts';
import { WaveManager, zombieCompositionForWave } from './WaveManager.ts';
import {
  formatWaveComposition,
  threatWarningsForWave,
} from './waveBalance.ts';
import { ZombieSystem } from './zombies/ZombieSystem.ts';
import {
  BASE_ZOMBIE_STATS,
  LETHAL_IMPACT_SPEED,
  MIN_IMPACT_SPEED,
} from './zombies/zombieConfig.ts';
import type { ZombieKind } from './zombies/Zombie.ts';

const FIXED_DT = 1 / 60;
const TERRAIN_GROUPS = (GROUP_TERRAIN << 16) | 0xffff;
const GROUND_HALF_SIZE = GRAVEYARD_HALF_SIZE;
const COUNTDOWN_SECONDS = 3;
/** Radius of the Shield Generator bubble, generous enough to enclose most rigs. */
const SHIELD_BUBBLE_RADIUS_M = 3.4;
const TRACER_POOL_SIZE = 32;
const STUCK_PROMPT_SECONDS = 1.6;
const RECOVERY_COOLDOWN_SECONDS = 2.25;
const RECOVERY_SETTLE_SECONDS = 0.42;

export interface SurvivalCallbacks {
  profileMoney(): number;
  runEarnings(): number;
  onReward(amount: number): number;
  onExit(run: RunState): void;
  onWaveAdvance(
    run: RunState,
    survivingPartIds: readonly string[],
    partHp: Record<string, number>,
    kills: number,
  ): void;
  onBuildPhase(
    run: RunState,
    survivingPartIds: readonly string[],
    partHp: Record<string, number>,
    kills: number,
  ): void;
  /** Commit the next wave's start state as soon as a clear is resolved. */
  onWaveCheckpoint?(
    run: RunState,
    survivingPartIds: readonly string[],
    partHp: Record<string, number>,
    kills: number,
  ): void;
  onGameOver(run: RunState, pendingMoneyDiscarded: number): void;
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
  onSaveAndQuit(snapshot: {
    wave: number;
    kills: number;
  }): void;
}

export interface WaveClearPayload {
  clearedRun: RunState;
  nextRun: RunState;
  survivingPartIds: readonly string[];
  partHp: Record<string, number>;
  kills: number;
}

/** Shared payload for both choices offered after a cleared wave. */
export function createWaveClearPayload(
  clearedWave: number,
  survivingPartIds: readonly string[],
  partHp: Readonly<Record<string, number>>,
  kills: number,
): WaveClearPayload {
  return {
    clearedRun: { wave: clearedWave },
    nextRun: { wave: clearedWave + 1 },
    survivingPartIds: [...survivingPartIds],
    partHp: { ...partHp },
    kills,
  };
}

export type SurvivalPhase = 'countdown' | 'active' | 'cleared' | 'gameOver';

export interface SurvivalTelemetry {
  mode: 'survival';
  kills: number;
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

interface TracerVisual {
  line: THREE.Line;
  positionAttribute: THREE.BufferAttribute;
  ttl: number;
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
  waveValue: HTMLSpanElement;
  remainingValue: HTMLSpanElement;
  moneyValue: HTMLSpanElement;
  pendingMoneyValue: HTMLSpanElement;
  stuckPrompt: HTMLDivElement;
  countdownOverlay: HTMLDivElement;
  countdownValue: HTMLDivElement;
  victoryOverlay: HTMLDivElement;
  victorySubtitle: HTMLDivElement;
  victoryMoneyValue: HTMLElement;
  victoryRunMoneyValue: HTMLElement;
  victoryPendingMoneyValue: HTMLElement;
  victoryKillsValue: HTMLElement;
  victoryTimeValue: HTMLElement;
  victoryIntegrityValue: HTMLElement;
  victoryDamagedPartsValue: HTMLElement;
  victoryLostPartsValue: HTMLElement;
  victoryNextWaveValue: HTMLElement;
  victoryWarning: HTMLDivElement;
  settingsOverlay: HTMLDivElement;
  settingsButton: HTMLButtonElement;
  settingsEyebrow: HTMLSpanElement;
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
    }
  | {
      kind: 'gameOver';
      run: RunState;
      pendingMoneyDiscarded: number;
    };

type SurvivalRunState = RunState & { kills?: number };

export class SurvivalMode {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world: RAPIER.World;
  private readonly eventQueue: RAPIER.EventQueue;
  private readonly surfaceByCollider = new Map<number, SurfaceKind>();
  private readonly graveyard: Graveyard;
  private readonly vehicle: RuntimeVehicle;
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
  private readonly tracers: TracerVisual[] = [];
  private readonly tracerMaterial = new THREE.LineBasicMaterial({
    color: 0xffd76e,
  });
  private readonly flameTracerMaterial = new THREE.LineBasicMaterial({
    color: 0xff6b2b,
    transparent: true,
    opacity: 0.85,
  });
  private readonly pierceTracerMaterial = new THREE.LineBasicMaterial({
    color: 0xffd76e,
    transparent: true,
    opacity: 0.35,
  });
  private readonly wheelSteerQuaternion = new THREE.Quaternion();
  private readonly wheelSteerAxis = new THREE.Vector3(0, 1, 0);
  private readonly pointerNdc = new THREE.Vector2();
  private readonly aimRaycaster = new THREE.Raycaster();
  private readonly aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly aimPoint = new THREE.Vector3();
  private readonly shotDirection = new THREE.Vector3();
  private readonly stoppedVelocity = { x: 0, y: 0, z: 0 };
  private readonly minimapForward = new THREE.Vector3();
  private readonly ui: HTMLDivElement;
  private readonly minimap: Minimap;
  private readonly scopeCursor: ScopeCursor;
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
  private readonly waveValue: HTMLSpanElement;
  private readonly remainingValue: HTMLSpanElement;
  private readonly moneyValue: HTMLSpanElement;
  private readonly pendingMoneyValue: HTMLSpanElement;
  private readonly stuckPrompt: HTMLDivElement;
  private readonly countdownOverlay: HTMLDivElement;
  private readonly countdownValue: HTMLDivElement;
  private readonly victoryOverlay: HTMLDivElement;
  private readonly victorySubtitle: HTMLDivElement;
  private readonly victoryMoneyValue: HTMLElement;
  private readonly victoryRunMoneyValue: HTMLElement;
  private readonly victoryPendingMoneyValue: HTMLElement;
  private readonly victoryKillsValue: HTMLElement;
  private readonly victoryTimeValue: HTMLElement;
  private readonly victoryIntegrityValue: HTMLElement;
  private readonly victoryDamagedPartsValue: HTMLElement;
  private readonly victoryLostPartsValue: HTMLElement;
  private readonly victoryNextWaveValue: HTMLElement;
  private readonly victoryWarning: HTMLDivElement;
  private readonly settingsOverlay: HTMLDivElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly settingsEyebrow: HTMLSpanElement;
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
  private phoneAddictKills = 0;
  private currentWave = 1;
  private countdownRemaining = COUNTDOWN_SECONDS;
  private phase: SurvivalPhase = 'countdown';
  private pointerFiring = false;
  private disposed = false;
  private lastHudIntegrity = -1;
  private lastHudSpeed = -1;
  private lastHudWave = -1;
  private lastHudRemaining = -1;
  private lastHudMoney = -1;
  private lastHudPending = -1;
  private lastCountdownSecond = -1;
  private tracerCursor = 0;
  private pendingWaveKillReward = 0;
  private pendingWaveReward = 0;
  private waveStartKills = 0;
  private waveMoneyEarned = 0;
  private waveElapsedSeconds = 0;
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
    this.buildGround();
    this.graveyard = new Graveyard(this.scene, this.world);
    this.vehicle = this.spawnVehicle(bp);
    this.followCamera = new FollowCamera(
      this.camera,
      this.vehicle,
      this.graveyard.bounds,
    );
    const firstZombieVisualIndex = this.scene.children.length;
    this.zombies = new ZombieSystem(
      this.world,
      this.scene,
      this.graveyard.spawnPoints,
      this.vehicle,
      (reward, kind) => this.handleZombieKilled(reward, kind),
    );
    const zombieVisuals = this.scene.children.slice(firstZombieVisualIndex);
    this.zombieVisualRoot.name = 'zombie-system-visuals';
    this.zombieVisualRoot.add(...zombieVisuals);
    this.scene.add(this.zombieVisualRoot);
    this.autoAim = new AutoAim(this.vehicle, this.zombies, this.world);
    this.fuelPickups = new FuelPickups(
      this.scene,
      this.vehicle,
      this.graveyard.bounds,
    );
    this.waves = new WaveManager(this.zombies, {
      onRemainingChanged: () => {
        this.lastHudRemaining = -1;
      },
      onWaveComplete: (wave, reward) => this.onWaveComplete(wave, reward),
    });
    this.buildTracerPool();

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
    this.waveValue = builtUi.waveValue;
    this.remainingValue = builtUi.remainingValue;
    this.moneyValue = builtUi.moneyValue;
    this.pendingMoneyValue = builtUi.pendingMoneyValue;
    this.stuckPrompt = builtUi.stuckPrompt;
    this.countdownOverlay = builtUi.countdownOverlay;
    this.countdownValue = builtUi.countdownValue;
    this.victoryOverlay = builtUi.victoryOverlay;
    this.victorySubtitle = builtUi.victorySubtitle;
    this.victoryMoneyValue = builtUi.victoryMoneyValue;
    this.victoryRunMoneyValue = builtUi.victoryRunMoneyValue;
    this.victoryPendingMoneyValue = builtUi.victoryPendingMoneyValue;
    this.victoryKillsValue = builtUi.victoryKillsValue;
    this.victoryTimeValue = builtUi.victoryTimeValue;
    this.victoryIntegrityValue = builtUi.victoryIntegrityValue;
    this.victoryDamagedPartsValue = builtUi.victoryDamagedPartsValue;
    this.victoryLostPartsValue = builtUi.victoryLostPartsValue;
    this.victoryNextWaveValue = builtUi.victoryNextWaveValue;
    this.victoryWarning = builtUi.victoryWarning;
    this.settingsOverlay = builtUi.settingsOverlay;
    this.settingsButton = builtUi.settingsButton;
    this.settingsEyebrow = builtUi.settingsEyebrow;
    this.spawnCheatButton = builtUi.spawnCheatButton;
    this.settingsStatus = builtUi.settingsStatus;
    this.minimap = new Minimap(
      this.ui,
      this.graveyard.bounds,
      this.graveyard.minimapFeatures,
      {
        renderer: this.renderer,
        scene: this.scene,
        hide: [
          this.vehicleGroup,
          ...this.wheelMeshes.values(),
          this.zombieVisualRoot,
        ],
        ready: this.graveyard.whenReady(),
      },
    );
    this.scopeCursor = new ScopeCursor(this.ui, this.renderer.domElement);

    if (Number.isFinite(run.kills) && (run.kills ?? 0) >= 0) {
      this.kills = Math.floor(run.kills ?? 0);
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
  }

  private buildGround(): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(GROUND_HALF_SIZE, 0.5, GROUND_HALF_SIZE)
        .setFriction(0.9)
        .setCollisionGroups(TERRAIN_GROUPS),
      body,
    );
    this.surfaceByCollider.set(collider.handle, 'asphalt');
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

  private buildTracerPool(): void {
    for (let i = 0; i < TRACER_POOL_SIZE; i++) {
      const positionAttribute = new THREE.BufferAttribute(
        new Float32Array(6),
        3,
      );
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', positionAttribute);
      const line = new THREE.Line(geometry, this.tracerMaterial);
      line.frustumCulled = false;
      line.visible = false;
      this.scene.add(line);
      this.tracers.push({ line, positionAttribute, ttl: 0 });
    }
  }

  private buildUI(): SurvivalUi {
    const root = document.createElement('div');
    root.className = 'ui-layer survival-ui';
    this.container.appendChild(root);

    const waveHud = document.createElement('section');
    waveHud.className = 'panel survival-wave-hud';
    const waveBlock = document.createElement('div');
    const waveLabel = document.createElement('span');
    waveLabel.textContent = 'Wave';
    const waveValue = document.createElement('strong');
    waveBlock.append(waveLabel, waveValue);
    const divider = document.createElement('span');
    divider.className = 'survival-wave-hud__divider';
    const zombieBlock = document.createElement('div');
    const zombieLabel = document.createElement('span');
    zombieLabel.textContent = 'Zombies on Field';
    const remainingValue = document.createElement('strong');
    zombieBlock.append(zombieLabel, remainingValue);
    waveHud.append(waveBlock, divider, zombieBlock);
    root.appendChild(waveHud);

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
    hud.append(speedRow, health, fuel, ability, moneyRow, pendingMoneyRow);
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

    const victoryOverlay = overlayPanel();
    victoryOverlay.classList.add('survival-victory');
    victoryOverlay.style.display = 'none';
    const victoryTitle = document.createElement('div');
    victoryTitle.className = 'survival-victory__title';
    victoryTitle.textContent = 'VICTORY';
    const victorySubtitle = document.createElement('div');
    victorySubtitle.className = 'survival-victory__subtitle';
    const victoryStats = document.createElement('div');
    victoryStats.className = 'survival-victory__stats';
    const statRow = (label: string): HTMLElement => {
      const row = document.createElement('div');
      const rowLabel = document.createElement('span');
      rowLabel.textContent = label;
      const rowValue = document.createElement('strong');
      row.append(rowLabel, rowValue);
      victoryStats.appendChild(row);
      return rowValue;
    };
    const victoryMoneyValue = statRow('This Wave Banked');
    const victoryRunMoneyValue = statRow('Run Total Banked');
    const victoryPendingMoneyValue = statRow('Pending');
    const victoryKillsValue = statRow('Zombies Killed');
    const victoryTimeValue = statRow('Time');
    const victoryIntegrityValue = statRow('Vehicle Integrity');
    const victoryDamagedPartsValue = statRow('Damaged Parts');
    const victoryLostPartsValue = statRow('Parts Lost (base value)');
    victoryLostPartsValue.className = 'survival-victory__losses';
    const victoryNextWaveValue = statRow('Next Wave');
    victoryNextWaveValue.className = 'survival-victory__composition';
    const victoryWarning = document.createElement('div');
    victoryWarning.className = 'survival-victory__warning';
    victoryWarning.setAttribute('role', 'status');
    victoryWarning.hidden = true;
    const victoryActions = document.createElement('div');
    victoryActions.className = 'survival-victory__actions';
    const nextWaveButton = document.createElement('button');
    nextWaveButton.type = 'button';
    nextWaveButton.className = 'primary';
    nextWaveButton.textContent = 'Continue Now';
    nextWaveButton.addEventListener('click', this.onNextWave);
    const garageButton = document.createElement('button');
    garageButton.type = 'button';
    garageButton.textContent = 'Garage / Repair';
    garageButton.addEventListener('click', this.onGoToGarage);
    victoryActions.append(nextWaveButton, garageButton);
    victoryOverlay.append(
      victoryTitle,
      victorySubtitle,
      victoryStats,
      victoryWarning,
      victoryActions,
    );
    root.appendChild(victoryOverlay);

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
      waveValue,
      remainingValue,
      moneyValue,
      pendingMoneyValue,
      stuckPrompt,
      countdownOverlay,
      countdownValue,
      victoryOverlay,
      victorySubtitle,
      victoryMoneyValue,
      victoryRunMoneyValue,
      victoryPendingMoneyValue,
      victoryKillsValue,
      victoryTimeValue,
      victoryIntegrityValue,
      victoryDamagedPartsValue,
      victoryLostPartsValue,
      victoryNextWaveValue,
      victoryWarning,
      settingsOverlay,
      settingsButton,
      settingsEyebrow,
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
    this.lastHudRemaining = -1;
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
    this.callbacks.onResetWave(this.currentRunState());
  }

  private onSaveAndQuit(): void {
    if (this.disposed || this.phase === 'gameOver') return;
    this.discardPendingWaveRewards();
    this.callbacks.onSaveAndQuit({
      wave: this.currentWave,
      kills: this.kills,
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
    );
  };

  private readonly onGoToGarage = (): void => {
    if (this.disposed || this.phase !== 'cleared') return;
    const payload = this.clearedWavePayload();
    this.victoryOverlay.style.display = 'none';
    this.callbacks.onBuildPhase(
      payload.clearedRun,
      payload.survivingPartIds,
      payload.partHp,
      payload.kills,
    );
  };

  private clearedWavePayload(): WaveClearPayload {
    return createWaveClearPayload(
      this.currentWave,
      this.vehicle.survivingPartIds(),
      this.vehicle.partHpSnapshot(),
      this.kills,
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
  };

  private readonly onFireDown = (event: PointerEvent): void => {
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
      (colliderHandle) =>
        this.surfaceByCollider.get(colliderHandle) ?? 'asphalt',
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
      this.showTracer(shot);
      if (shot.hitZombieHandle === null) continue;
      this.shotDirection.set(
        shot.to.x - shot.from.x,
        shot.to.y - shot.from.y,
        shot.to.z - shot.from.z,
      );
      if (this.shotDirection.lengthSq() > 1e-8) this.shotDirection.normalize();
      const pierceContinues = applyZombieShot(
        this.zombies,
        shot,
        this.shotDirection,
      );
      if (pierceContinues && shot.pierceTo !== null) {
        this.showTracerSegment(
          shot.to,
          shot.pierceTo,
          this.pierceTracerMaterial,
          0.06,
        );
      }
    }

    this.attachNewIslands(this.vehicle.finishStep());
    this.queueCompletedStepTransition();
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
    this.currentWave = Math.max(
      1,
      Math.floor(Number.isFinite(wave) ? wave : 1),
    );
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
    this.victoryOverlay.style.display = 'none';
    this.countdownOverlay.style.display = 'block';
    this.mineWarningDistances = new WeakMap<object, number>();
    this.mineWarningPulsed = new WeakSet<object>();
    this.mineWarningPulseSeconds = 0;
    this.integrityFill.style.boxShadow = '';
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
  }

  private handleZombieKilled(
    reward: number,
    kind: ZombieKind,
  ): void {
    this.kills++;
    if (kind === 'phone-addict' && !this.debugProgressionSuppressed) {
      this.phoneAddictKills++;
      this.callbacks.onPhoneAddictKilled();
    }
    this.addPendingWaveKillReward(reward);
    this.waves.recordZombieKilled();
  }

  private onWaveComplete(wave: number, reward: number): void {
    if (this.phase === 'gameOver') return;
    this.currentWave = wave;
    // Resolve the completed physics step before paying the clear bonus. If the
    // final zombie and vehicle die together, destruction wins consistently and
    // the uncleared wave is neither counted nor rewarded.
    this.pendingWaveReward =
      Number.isSafeInteger(reward) && reward > 0 ? reward : 0;
    if (!this.debugProgressionSuppressed) this.callbacks.onWaveCleared(wave);
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

    this.victorySubtitle.textContent = `Wave ${this.currentWave} Cleared`;
    this.victoryMoneyValue.textContent = `$${this.waveMoneyEarned}`;
    this.victoryRunMoneyValue.textContent = `$${this.callbacks.runEarnings()}`;
    this.victoryPendingMoneyValue.textContent = '$0';
    this.victoryKillsValue.textContent = String(
      Math.max(0, this.kills - this.waveStartKills),
    );
    this.victoryTimeValue.textContent = formatDuration(this.waveElapsedSeconds);
    this.victoryIntegrityValue.textContent = `${Math.round(
      this.vehicle.integrityPct(),
    )}%`;
    this.victoryDamagedPartsValue.textContent = String(damagedPartCount);
    this.victoryLostPartsValue.textContent =
      lostParts.length > 0 ? lostParts.join(', ') : 'None';
    this.victoryNextWaveValue.textContent = formatWaveComposition(
      zombieCompositionForWave(nextWave),
    );
    this.victoryWarning.textContent = warnings.join(' ');
    this.victoryWarning.hidden = warnings.length === 0;
    this.victoryOverlay.style.display = 'block';
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
    this.victoryOverlay.style.display = 'none';
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
      );
    } else {
      this.callbacks.onGameOver(
        pending.run,
        pending.pendingMoneyDiscarded,
      );
    }
  }

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
    this.syncTracers(frameDt);
    this.syncMineWarningHud(frameDt);
    this.followCamera.update(frameDt);
    this.graveyard.follow(this.vehicleGroup);
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

  private syncHud(): void {
    const telemetry = this.vehicle.telemetry();
    const speed = Math.round(telemetry.speedKmh);
    if (this.currentWave !== this.lastHudWave) {
      this.lastHudWave = this.currentWave;
      this.waveValue.textContent = String(this.currentWave);
      this.syncSpeedGaugeThresholds();
      this.lastHudSpeed = -1;
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
    const zombiesOnField = this.zombies.getActiveCount();
    if (zombiesOnField !== this.lastHudRemaining) {
      this.lastHudRemaining = zombiesOnField;
      this.remainingValue.textContent = String(zombiesOnField);
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

  private syncTracers(frameDt: number): void {
    for (const tracer of this.tracers) {
      if (!tracer.line.visible) continue;
      tracer.ttl -= frameDt;
      if (tracer.ttl > 0) continue;
      tracer.line.visible = false;
      tracer.ttl = 0;
    }
  }

  private showTracer(shot: TracerShot): void {
    const flame = shot.damageType === 'aoe';
    this.showTracerSegment(
      shot.from,
      shot.to,
      flame ? this.flameTracerMaterial : this.tracerMaterial,
      flame ? 0.18 : 0.08,
    );
  }

  private showTracerSegment(
    from: Vec3,
    to: Vec3,
    material: THREE.LineBasicMaterial,
    ttl: number,
  ): void {
    const tracer = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % this.tracers.length;
    const positions = tracer.positionAttribute.array as Float32Array;
    positions[0] = from.x;
    positions[1] = from.y;
    positions[2] = from.z;
    positions[3] = to.x;
    positions[4] = to.y;
    positions[5] = to.z;
    tracer.positionAttribute.needsUpdate = true;
    tracer.line.material = material;
    tracer.ttl = ttl;
    tracer.line.visible = true;
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
    this.waves.reset();
    this.currentWave = Math.max(
      1,
      Math.floor(Number.isFinite(wave) ? wave : 1),
    );
    this.phase = 'active';
    this.pendingWaveKillReward = 0;
    this.pendingWaveReward = 0;
    this.pendingTransition = null;
    this.pointerFiring = false;
    this.keys.clear();
    this.countdownOverlay.style.display = 'none';
    this.victoryOverlay.style.display = 'none';
    this.resetWaveStats();
    this.waves.startWave(this.currentWave);
  }

  debugKillAllZombies(): void {
    if (this.disposed || this.phase !== 'active') return;
    this.debugProgressionSuppressed = true;
    try {
      const unspawnedKills = this.waves.prepareDebugKillAll();
      this.kills += unspawnedKills;
      this.addPendingWaveKillReward(
        unspawnedKills * BASE_ZOMBIE_STATS.reward,
      );
      this.zombies.forceKillAll();
      this.waves.fixedUpdate(0);
    } finally {
      this.debugProgressionSuppressed = false;
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
    this.fuelPickups.dispose();
    this.zombies.dispose();
    this.graveyard.dispose();
    this.vehicle.dispose();
    this.eventQueue.free();
    this.world.free();
    this.minimap.dispose();
    this.scopeCursor.dispose();
    this.ui.remove();
    disposeObject(this.scene);
    this.scene.clear();
    this.tracerMaterial.dispose();
    this.flameTracerMaterial.dispose();
    this.pierceTracerMaterial.dispose();
    this.wheelMeshes.clear();
    this.wheelSpin.clear();
    this.islandGroups.clear();
    this.surfaceByCollider.clear();
    this.tracers.length = 0;
  }
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
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
