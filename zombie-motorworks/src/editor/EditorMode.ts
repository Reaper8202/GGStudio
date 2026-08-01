/**
 * 3D vehicle editor: orbit/ortho cameras, layer slicing, ghost placement,
 * selection, symmetry, overlays, reversible commands, and autosave.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type {
  PartConfig,
  PartDefinition,
  PlacedPart,
  Vec3i,
  VehicleBlueprint,
} from '../core/types.ts';
import { CELL_SIZE, GRID_MAX, GRID_MIN } from '../core/types.ts';
import { PART_CATALOG, getPartDef } from '../core/parts.ts';
import { buildOccupancy, getPart, nextPartId } from '../core/blueprint.ts';
import { canPlacePart, validateBlueprint } from '../core/placement.ts';
import { cellCentreM } from '../core/mass.ts';
import { deriveConnections } from '../core/structural.ts';
import { analyzeVehicle } from '../core/analysis.ts';
import {
  CommandHistory,
  batchCommand,
  mirrorCommand,
  placeCommand,
  removeCommand,
  replaceBlueprintCommand,
  rotateCommand,
  updateConfigCommand,
  type EditorCommand,
} from '../core/commands.ts';
import { serializeBlueprint } from '../core/serialize.ts';
import { createEmptyBlueprint } from '../core/blueprint.ts';
import {
  composeOrientations,
  mirrorCellX,
  orientationFromSteps,
  rotateVec,
} from '../core/grid.ts';
import { buildPartMesh } from './meshes.ts';
import { ARMOUR_FACE_AXIS } from './parts/armourPlate.ts';
import { Overlays, defaultToggles, type OverlayToggles } from './overlays.ts';
import {
  buildEditorUI,
  type AbilityLoadoutSlotView,
  type AbilitySlotStatus,
  type EditorUI,
  type NewGarageDisposalSummary,
  type RunSummary,
} from './ui.ts';
import { TutorialOverlay } from './TutorialOverlay.ts';
import {
  garageTourActionAllowed,
  garageTourSnapshot,
  nextStarterTutorialAction,
  SIMPLE_PART_IDS,
  starterTutorialPlacementAllowed,
  tutorialBodySpecsForBuild,
  tutorialStepsForBuild,
  type GarageTourStep,
  type TutorialPartSpec,
} from '../core/tutorial.ts';
import { getEffectiveDef } from '../core/upgrades.ts';
import {
  abilityMeta,
  ABILITY_SLOT_KEYS,
  abilityUnlocked,
  abilityUnlockLevel,
  BENCHED_ABILITY_SLOT,
  MAX_ABILITY_SLOTS,
  resolveAbilityLoadout,
  type AbilityCandidate,
} from '../core/abilities.ts';
import { deriveAutomaticWheelLayout } from '../core/wheelLayout.ts';
import {
  buildStarterRig,
  DEFAULT_BUILD_ID,
  type BuildId,
} from '../core/builds.ts';
import {
  canAfford,
  nextUpgrade,
  partInvestment,
  partRepairCost,
  placeCost,
  repairPlan,
  scaledHpOnUpgrade,
  sellRefund,
  storeOffer,
  unlockCost,
  unlockInvestment,
  type RunState,
} from '../core/economy.ts';
import { DEFAULT_MONEY, type PlayerProfile } from '../core/profile.ts';
import { resolveHotbar, withHotbarSlot } from '../core/hotbar.ts';
import { threatWarningsForWave } from '../survival/waveBalance.ts';
import {
  decodeShareCode,
  encodeShareCode,
  lockedDefIdsFor,
  ShareCodeError,
} from '../core/shareCode.ts';
import {
  buildShareLink,
  extractShareCode,
  sharedSlotName,
} from './shareHelpers.ts';
import { renderPartIconUrls } from './PartIconRenderer.ts';

export const BLUEPRINT_STORAGE_KEY = 'scraprig.blueprints.v1';

/**
 * How far a build-face hit is stepped along its normal to land in the
 * neighbouring cell. Generous enough to clear a curved placement surface — a
 * drum or a tyre is hit well inside its cell everywhere but the tangent point —
 * while staying under half a cell, so it can never skip past the neighbour.
 */
const FACE_STEP_M = CELL_SIZE * 0.3;

/**
 * Snap a surface normal to the nearest grid axis. Flat blocks already hit exact
 * axes; rounding each component instead would turn a curved hit into a diagonal
 * like (1,0,1) and resolve to no cell at all.
 */
function dominantAxis(normal: THREE.Vector3): THREE.Vector3 {
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(normal.x), 0, 0);
  if (ay >= az) return new THREE.Vector3(0, Math.sign(normal.y), 0);
  return new THREE.Vector3(0, 0, Math.sign(normal.z));
}

/** Light-green voxel occupying the exact cell prescribed by Roxy. */
function createTutorialVoxelMarker(): THREE.Group {
  const group = new THREE.Group();
  const size = CELL_SIZE * 0.94;
  const geometry = new THREE.BoxGeometry(size, size, size);
  const fill = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0x9dff78,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
  );
  fill.renderOrder = 8;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: 0xcaffaa,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    }),
  );
  edges.renderOrder = 9;
  group.add(fill, edges);
  group.visible = false;
  group.userData.editorPickable = false;
  return group;
}

/**
 * Blocks that are the player's for the whole run and may never leave the rig:
 * the Truck Heart, which everything else is bolted to, and the Build signature
 * block, which cannot be bought back from anywhere if it is scrapped.
 *
 * Every removal path — return to inventory, delete, sell, and the New Garage
 * clear-out — resolves through this one predicate, so none of them can drift
 * apart and let a signature block off through a side door.
 */
export function isFixedToRig(def: PartDefinition): boolean {
  return def.isRoot === true || def.buildSignature === true;
}

/** Exact consequences of selling an installed build before starting over. */
export function newGarageDisposalSummary(
  parts: readonly PlacedPart[],
  getDef: (defId: string) => PartDefinition,
): NewGarageDisposalSummary {
  const disposable = parts.filter((part) => !isFixedToRig(getDef(part.defId)));
  const investment = disposable.reduce(
    (total, part) => total + partInvestment(part),
    0,
  );
  const refund = disposable.reduce(
    (total, part) => total + sellRefund(part),
    0,
  );
  return {
    partCount: disposable.length,
    investment,
    refund,
    forfeited: investment - refund,
  };
}

/**
 * Seed a freshly placed part's config. Wheels arrive powered and braked so a
 * new wheel contributes immediately instead of mounting inert.
 *
 * `steering` is deliberately left undecided: deriveAutomaticWheelLayout picks
 * the axle ahead of the wheelbase midpoint, which is what makes the rig turn.
 * Forcing every wheel to steer would steer the rear axle the same way as the
 * front and crab the vehicle sideways instead of rotating it.
 */
export function defaultConfigForDef(def: PartDefinition): PartConfig {
  return def.wheel
    ? {
        driven: true,
        braking: true,
        steerInverted: false,
        suspensionPreset: 'standard',
      }
    : {};
}

/** Aggregate effective maximum health used by whole-vehicle upgrade previews. */
export function vehicleIntegrity(bp: VehicleBlueprint): number {
  return bp.parts.reduce(
    (total, part) => total + getEffectiveDef(part).health,
    0,
  );
}

/** Clone a blueprint with only the requested part advanced to its next level. */
export function previewUpgradedBlueprint(
  bp: VehicleBlueprint,
  partId: string,
): VehicleBlueprint | null {
  const selected = bp.parts.find((part) => part.id === partId);
  if (!selected) return null;
  const upgrade = nextUpgrade(selected);
  if (!upgrade) return null;

  return {
    ...bp,
    parts: bp.parts.map((part) => ({
      ...part,
      pos: { ...part.pos },
      config: {
        ...part.config,
        ...(part.id === partId ? { level: upgrade.targetLevel } : {}),
      },
    })),
  };
}

export interface VehicleUpgradeMetrics {
  totalDps: number;
  integrity: number;
  estimatedTopSpeedKph: number;
}

export interface UpgradeMetricsPreview {
  before: VehicleUpgradeMetrics;
  after: VehicleUpgradeMetrics;
}

/** Analyze the live and cloned next-level blueprints through the real model. */
export function previewUpgradeMetrics(
  bp: VehicleBlueprint,
  partId: string,
): UpgradeMetricsPreview | null {
  const upgraded = previewUpgradedBlueprint(bp, partId);
  if (!upgraded) return null;
  const beforeReport = analyzeVehicle(bp, getPartDef);
  const afterReport = analyzeVehicle(upgraded, getPartDef);
  return {
    before: {
      totalDps: beforeReport.totalDps,
      integrity: vehicleIntegrity(bp),
      estimatedTopSpeedKph: beforeReport.estimatedTopSpeedKph,
    },
    after: {
      totalDps: afterReport.totalDps,
      integrity: vehicleIntegrity(upgraded),
      estimatedTopSpeedKph: afterReport.estimatedTopSpeedKph,
    },
  };
}

interface GhostState {
  defId: string;
  orient: number;
}

/** Camera/layer state preserved across editor <-> runtime-mode round trips. */
export interface EditorViewState {
  cameraPos: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  layer: number;
}

export type EditorSfxCue =
  | 'click'
  | 'deny'
  | 'place'
  | 'remove'
  | 'purchase'
  | 'repair'
  | 'tutorialWord'
  | 'upgrade';

export interface EditorModeContext {
  history?: CommandHistory;
  view?: EditorViewState;
  profile: PlayerProfile;
  persistProfile(): void;
  onMenu(): void;
  onSaveAndQuit(): void;
  /** Presentation callback; the editor owns intent, while App owns audio. */
  onSfx?: (cue: EditorSfxCue) => void;
  notice?: string;
  /** Start/resume forced first-car onboarding in this Garage. */
  startTutorial?: boolean;
  /** App owns onboarding persistence across Garage -> Survival. */
  onTutorialSkipped?(): void;
  /** True only right after `beginNewGame()`, to open the rig picker. */
  isNewGame?: boolean;
  /**
   * The player picked a starting rig in that picker. App owns the swap: the
   * choice replaces the whole blueprint, grants the unlocks that rig needs to
   * stay repairable, and is written to the Profile so a finished run hands
   * back the same build.
   */
  onChooseBuild?: (buildId: BuildId) => void;
  runContext?: RunState;
  runRepair?: {
    partHp(): Record<string, number>;
    repairPart(id: string): boolean;
    repairAll(): boolean;
    /** Parts destroyed in a prior wave, not yet bought back and re-placed. */
    missingParts(): PlacedPart[];
  };
  runSummary?: RunSummary;
}

export class EditorMode {
  private readonly scene = new THREE.Scene();
  private persp: THREE.PerspectiveCamera;
  private ortho: THREE.OrthographicCamera;
  private camera: THREE.Camera;
  private controls: OrbitControls;
  private readonly partsGroup = new THREE.Group();
  private readonly overlays = new Overlays();
  private readonly raycaster = new THREE.Raycaster();
  private ghost: GhostState | null = null;
  private ghostMesh: THREE.Group | null = null;
  private ghostMeshKey: string | null = null;
  private ghostTarget: { pos: Vec3i; valid: boolean; message: string } | null =
    null;
  private readonly history: CommandHistory;
  private bp: VehicleBlueprint;
  private selected = new Set<string>();
  /** World point the selection shortcut card hangs above, or null when idle. */
  private selectionTipAnchor: THREE.Vector3 | null = null;
  private readonly tipProjection = new THREE.Vector3();
  private symmetry = false;
  private layer = -1;
  private readonly toggles: OverlayToggles = {
    ...defaultToggles(),
    com: true,
    contacts: true,
    supportPolygon: true,
    connections: false,
    arcs: false,
  };
  private ui: EditorUI;
  private tutorialOverlay: TutorialOverlay | null = null;
  private tutorialActive = false;
  private tutorialAvailable = false;
  private tutorialDragging = false;
  private tutorialAwaitingRotation = false;
  private tutorialRotationTurns = 0;
  /** Recipe and script for the rig currently being taught, in placement order. */
  private tutorialSpecs: readonly TutorialPartSpec[] = [];
  private tutorialSteps: readonly GarageTourStep[] = [];
  private readonly tutorialTarget = document.createElement('div');
  private readonly tutorialRotateButton = document.createElement('button');
  private readonly tutorialVoxelMarker = createTutorialVoxelMarker();
  private tutorialTargetWorld: THREE.Vector3 | null = null;
  private pointerDown: { x: number; y: number } | null = null;
  private lastPointer: { x: number; y: number } | null = null;
  private disposed = false;
  private explicitRenamePending = false;
  private readonly profile: PlayerProfile;
  private readonly persistProfile: () => void;
  private readonly onSfx: (cue: EditorSfxCue) => void;
  private readonly onTutorialSkipped: () => void;
  private readonly runContext: RunState | undefined;
  private readonly runRepair: EditorModeContext['runRepair'];
  private readonly runPartMaxHpAtEntry: ReadonlyMap<string, number>;
  private readonly runSummary: RunSummary | undefined;
  private readonly keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private readonly onUiButtonClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    this.onSfx('click');
  };

  constructor(
    container: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    initial: VehicleBlueprint,
    private readonly onTestDrive: (bp: VehicleBlueprint) => void,
    private readonly onFightZombies: (
      bp: VehicleBlueprint,
      tutorialHandoff: boolean,
    ) => void,
    context: EditorModeContext,
  ) {
    this.bp = initial;
    this.profile = context.profile;
    this.persistProfile = context.persistProfile;
    this.onSfx = context.onSfx ?? (() => undefined);
    this.onTutorialSkipped = context.onTutorialSkipped ?? (() => undefined);
    this.runContext = context.runContext;
    this.runRepair = context.runRepair;
    this.runPartMaxHpAtEntry = new Map(
      initial.parts.map((part) => [part.id, getEffectiveDef(part).health]),
    );
    this.runSummary = context.runSummary;
    this.tutorialAvailable = context.startTutorial === true;
    this.history =
      context.history ??
      new CommandHistory((moneyDelta) => this.mutateMoney(moneyDelta));
    this.scene.background = new THREE.Color(0x1f2530);
    this.scene.add(new THREE.HemisphereLight(0xcfd8e8, 0x2a2620, 1.25));
    const dir = new THREE.DirectionalLight(0xffffff, 1.55);
    dir.position.set(6, 10, 4);
    this.scene.add(dir);

    const aspect = container.clientWidth / container.clientHeight;
    this.persp = new THREE.PerspectiveCamera(55, aspect, 0.05, 200);
    this.persp.position.set(5, 4.5, 7);
    const oSize = 5;
    this.ortho = new THREE.OrthographicCamera(
      -oSize * aspect,
      oSize * aspect,
      oSize,
      -oSize,
      0.05,
      200,
    );
    this.camera = this.persp;
    this.controls = new OrbitControls(this.persp, renderer.domElement);
    this.controls.target.set(0, 1, 0);
    this.controls.enableDamping = true;
    this.raycaster.params.Line.threshold = 0;

    // Grid + bounds
    const gridW = (GRID_MAX.x - GRID_MIN.x + 1) * CELL_SIZE;
    const gridD = (GRID_MAX.z - GRID_MIN.z + 1) * CELL_SIZE;
    const grid = new THREE.GridHelper(
      Math.max(gridW, gridD),
      Math.max(GRID_MAX.x - GRID_MIN.x + 1, GRID_MAX.z - GRID_MIN.z + 1),
      0x39434f,
      0x272d36,
    );
    grid.position.y = 0.001;
    this.scene.add(grid);
    const bounds = new THREE.Box3(
      new THREE.Vector3(
        GRID_MIN.x * CELL_SIZE,
        GRID_MIN.y * CELL_SIZE,
        GRID_MIN.z * CELL_SIZE,
      ),
      new THREE.Vector3(
        (GRID_MAX.x + 1) * CELL_SIZE,
        (GRID_MAX.y + 1) * CELL_SIZE,
        (GRID_MAX.z + 1) * CELL_SIZE,
      ),
    );
    const boundsHelper = new THREE.Box3Helper(bounds, 0x2f3a48);
    this.scene.add(boundsHelper);

    this.scene.add(this.partsGroup);
    this.scene.add(this.overlays.group);
    this.scene.add(this.tutorialVoxelMarker);

    const partIconUrls = renderPartIconUrls(
      renderer,
      SIMPLE_PART_IDS.flatMap((id) => {
        const definition = PART_CATALOG[id];
        return definition ? [definition] : [];
      }),
    );
    this.ui = buildEditorUI(
      container,
      PART_CATALOG,
      {
        onPurchasePart: (defId) => this.handleStorePart(defId),
        onBuyPart: (defId) => this.buyInventoryPart(defId),
        onArmPart: (defId) => this.armGhost(defId),
        onTutorialPartDragStart: (defId, clientX, clientY) =>
          this.startTutorialPartDrag(defId, clientX, clientY),
        onTutorialPartDragMove: (clientX, clientY) =>
          this.moveTutorialPartDrag(clientX, clientY),
        onTutorialPartDragEnd: (clientX, clientY) =>
          this.endTutorialPartDrag(clientX, clientY),
        onTutorialPartDragCancel: () => this.cancelTutorialPartDrag(),
        onHotbarChange: (defIds) => this.setHotbar(defIds),
        newGarageDisposalSummary: () =>
          newGarageDisposalSummary(this.bp.parts, getPartDef),
        onNew: () =>
          this.resetBlueprint(this.createNewBlueprint(), 'Start new build'),
        onMenu: context.onMenu,
        onSaveAndQuit: context.onSaveAndQuit,
        onRename: (name) => {
          const pendingBefore = this.explicitRenamePending;
          this.explicitRenamePending ||= name !== this.bp.name;
          if (
            !this.exec(
              replaceBlueprintCommand({ ...this.bp, name }, 0, 'Rename build'),
            )
          )
            this.explicitRenamePending = pendingBefore;
        },
        onUndo: () => this.undo(),
        onRedo: () => this.redo(),
        onSymmetryToggle: (on) => {
          if (this.blockTutorialMutation('turn on mirror building')) {
            this.symmetry = false;
            return;
          }
          this.symmetry = on;
        },
        onView: (v) => this.setView(v),
        onLayerChange: (l) => {
          this.layer = l;
          this.rebuildMeshes();
        },
        onTestDrive: () => {
          if (this.tutorialActive) {
            this.deny('Finish the glowing build steps before Test Drive');
            return;
          }
          const report = validateBlueprint(this.bp, getPartDef);
          if (report.errors.length === 0) {
            this.onTestDrive(this.bp);
          }
        },
        onFightZombies: () => {
          const report = validateBlueprint(this.bp, getPartDef);
          if (report.errors.length > 0) return;
          if (this.tutorialActive) {
            const step = this.tutorialOverlay?.step;
            if (
              !step ||
              !garageTourActionAllowed(
                step,
                { kind: 'fight' },
                this.tourSnapshot(),
                this.tutorialSpecs,
              )
            ) {
              this.deny('Build each glowing piece before fighting');
              return;
            }
            this.stopTutorial();
            this.onFightZombies(this.bp, true);
            return;
          }
          this.onFightZombies(this.bp, false);
        },
        onStartTutorial: () => {
          if (this.tutorialAvailable) this.startTutorial();
          else this.ui.setStatus('Start a New Game to replay the guided build');
        },
        onConfigChange: (partId, key, value) =>
          this.changeConfig(partId, key, value),
        onAbilitySlotClick: (slot) => this.cycleAbilitySlot(slot),
        onUpgradePart: (partId) => this.buyUpgrade(partId),
        onRepairPart: (partId) => this.repairPart(partId),
        onRepairAll: () => this.repairAll(),
        onRebuildCar: () => this.rebuildCar(),
        onDeleteSelected: () => this.deleteSelected(),
        onReturnSelected: () => this.returnSelectedToInventory(),
        onRotateSelected: (axis) => this.rotateSelected(axis),
        onCancelTool: () => this.disarmTool(),
        onChooseBuild: (buildId) => context.onChooseBuild?.(buildId),
        onCopyCode: () => this.copyShareText(encodeShareCode(this.bp), 'code'),
        onCopyLink: () =>
          this.copyShareText(buildShareLink(encodeShareCode(this.bp)), 'link'),
        onImport: (input) => void this.importShareCode(input),
      },
      partIconUrls,
    );
    this.ui.root.addEventListener('click', this.onUiButtonClick, true);
    this.tutorialTarget.className = 'tutorial-build-target';
    this.tutorialTarget.hidden = true;
    this.tutorialTarget.setAttribute('aria-hidden', 'true');
    this.ui.root.appendChild(this.tutorialTarget);
    this.tutorialRotateButton.type = 'button';
    this.tutorialRotateButton.className = 'primary tutorial-rotate-button';
    this.tutorialRotateButton.textContent = '↻ Rotate Part (R)';
    this.tutorialRotateButton.hidden = true;
    this.tutorialRotateButton.addEventListener(
      'click',
      this.rotateTutorialGhost,
    );
    this.ui.root.appendChild(this.tutorialRotateButton);

    renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    renderer.domElement.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.keyHandler);

    if (context.view) {
      this.persp.position.set(
        context.view.cameraPos.x,
        context.view.cameraPos.y,
        context.view.cameraPos.z,
      );
      this.controls.target.set(
        context.view.target.x,
        context.view.target.y,
        context.view.target.z,
      );
      this.layer = context.view.layer;
    }
    this.refresh();
    if (context.notice) this.ui.setNotice(context.notice);
    if (context.startTutorial) this.startTutorial();
    // A new game opens onto the rig picker rather than the old "buy a weapon"
    // prompt: the three builds each arrive with a weapon already bolted on, so
    // the first decision is which rig, not which gun. App sets at most one of
    // these per `openEditor()`: the picker on the first open after New Game,
    // the tutorial on the re-open once a build has been chosen.
    if (context.isNewGame) this.ui.showBuildPrompt();
  }

  viewState(): EditorViewState {
    return {
      cameraPos: {
        x: this.persp.position.x,
        y: this.persp.position.y,
        z: this.persp.position.z,
      },
      target: {
        x: this.controls.target.x,
        y: this.controls.target.y,
        z: this.controls.target.z,
      },
      layer: this.layer,
    };
  }

  // ---------- rendering loop ----------

  update(): void {
    this.controls.update();
    if (this.tutorialVoxelMarker.visible) {
      const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.055;
      this.tutorialVoxelMarker.scale.setScalar(pulse);
    }
    this.updateSelectionTip();
    this.updateTutorialTarget();
    this.renderer.render(this.scene, this.camera);
  }

  private updateTutorialTarget(): void {
    if (!this.tutorialActive || !this.tutorialTargetWorld) {
      this.tutorialTarget.hidden = true;
      return;
    }
    const projected = this.tipProjection
      .copy(this.tutorialTargetWorld)
      .project(this.camera);
    if (projected.z > 1) {
      this.tutorialTarget.hidden = true;
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.tutorialTarget.hidden = false;
    this.tutorialTarget.style.left = `${rect.left + ((projected.x + 1) / 2) * rect.width}px`;
    this.tutorialTarget.style.top = `${rect.top + ((1 - projected.y) / 2) * rect.height}px`;
  }

  /**
   * Pin the shortcut card above the selection. It rides the camera every frame
   * rather than being placed once, so orbiting never leaves it stranded.
   */
  private updateSelectionTip(): void {
    const tip = this.ui.selectionTip;
    // While a part is armed, R turns the ghost and the card would be lying.
    if (!this.selectionTipAnchor || this.ghost) {
      tip.style.display = 'none';
      return;
    }
    const projected = this.tipProjection
      .copy(this.selectionTipAnchor)
      .project(this.camera);
    if (projected.z > 1) {
      tip.style.display = 'none';
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    tip.style.display = 'flex';
    tip.style.left = `${rect.left + ((projected.x + 1) / 2) * rect.width}px`;
    tip.style.top = `${rect.top + ((1 - projected.y) / 2) * rect.height}px`;
  }

  resize(w: number, h: number): void {
    const aspect = w / h;
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    const oSize = 5;
    this.ortho.left = -oSize * aspect;
    this.ortho.right = oSize * aspect;
    this.ortho.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.domElement.removeEventListener(
      'pointermove',
      this.onPointerMove,
    );
    this.renderer.domElement.removeEventListener(
      'pointerdown',
      this.onPointerDown,
    );
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener(
      'contextmenu',
      this.onContextMenu,
    );
    window.removeEventListener('keydown', this.keyHandler);
    this.tutorialRotateButton.removeEventListener(
      'click',
      this.rotateTutorialGhost,
    );
    this.ui.root.removeEventListener('click', this.onUiButtonClick, true);
    this.controls.dispose();
    this.tutorialOverlay?.dispose();
    disposeObjectResources(this.scene);
    this.scene.clear();
    this.ghostMesh = null;
    this.ui.root.remove();
  }

  blueprint(): VehicleBlueprint {
    return this.bp;
  }

  replaceBlueprint(bp: VehicleBlueprint): void {
    this.bp = bp;
    this.selected.clear();
    this.history.clear();
    this.refresh();
  }

  /** A non-blocking editor banner for application-level persistence warnings. */
  showNotice(text: string): void {
    this.ui.setNotice(text);
  }

  private createNewBlueprint(): VehicleBlueprint {
    const bp = createEmptyBlueprint('new-rig');
    return {
      ...bp,
      parts: [
        {
          id: 'p1',
          defId: 'chassis-core',
          pos: { x: 0, y: 1, z: 0 },
          orient: 0,
          config: {},
        },
      ],
    };
  }

  private resetBlueprint(next: VehicleBlueprint, label: string): boolean {
    if (this.blockTutorialMutation('start a different build')) return false;
    const refund = newGarageDisposalSummary(this.bp.parts, getPartDef).refund;
    const previousSelection = [...this.selected];
    this.selected.clear();
    if (!this.exec(replaceBlueprintCommand(next, refund, label))) {
      for (const partId of previousSelection) this.selected.add(partId);
      this.refreshSelectionUI();
      return false;
    }
    this.ui.setStatus(
      refund > 0 ? `Started a new build · sold old parts +$${refund}` : label,
    );
    return true;
  }

  /** Hard business gate: coach marks are guidance, never sole protection. */
  private blockTutorialMutation(action: string): boolean {
    if (!this.tutorialActive) return false;
    this.deny(`Finish or skip Roxy's tutorial before you ${action}`);
    return true;
  }

  /** Start/resume exact first-car build. New Game stages its free body kit. */
  startTutorial(): void {
    if (!this.tutorialAvailable && !this.tutorialActive) {
      this.ui.setStatus('Start a New Game to replay the guided build');
      return;
    }
    this.tutorialOverlay?.dispose();
    this.tutorialOverlay = null;
    this.tutorialActive = true;
    this.controls.enabled = false;
    // The coached build teaches the rig the player picked, so both the recipe
    // and the script come from their Build rather than from a fixed layout.
    const buildId = this.profile.buildId ?? DEFAULT_BUILD_ID;
    this.tutorialSpecs = tutorialBodySpecsForBuild(buildId);
    this.tutorialSteps = tutorialStepsForBuild(buildId);
    this.tutorialOverlay = new TutorialOverlay(
      this.ui.root,
      {
        tutorialAnchor: (step) => this.tutorialAnchor(step),
        prepareTutorialStep: (step) => this.prepareTutorialStep(step),
        playWordSound: () => this.onSfx('tutorialWord'),
        allowKey: (event) =>
          this.tutorialAwaitingRotation && event.key.toLowerCase() === 'r',
      },
      this.tourSnapshot(),
      this.tutorialSteps,
      this.tutorialSpecs,
      () => this.skipTutorial(),
    );
  }

  stopTutorial(): void {
    this.tutorialOverlay?.dispose();
    this.tutorialOverlay = null;
    this.tutorialActive = false;
    this.tutorialDragging = false;
    this.tutorialAwaitingRotation = false;
    this.tutorialRotationTurns = 0;
    this.controls.enabled = true;
    this.tutorialTarget.hidden = true;
    this.tutorialTargetWorld = null;
    this.tutorialRotateButton.hidden = true;
    this.tutorialVoxelMarker.visible = false;
    this.ui.highlightPaletteButton(null);
    this.ui.setTutorialDragPart(null);
  }

  private tourSnapshot(): ReturnType<typeof garageTourSnapshot> {
    return garageTourSnapshot(
      this.bp,
      this.inventory(),
      getPartDef,
      this.ghost?.defId ?? null,
      this.ghost?.orient ?? null,
      this.tutorialRotationTurns,
    );
  }

  private skipTutorial(): void {
    this.stopTutorial();
    this.tutorialAvailable = false;
    // Skipping hands over the finished rig for the build they chose, weapon
    // bolted on: the tutorial was the only way to earn those staged blocks, so
    // dropping it has to leave them with the same car it would have built.
    this.bp = buildStarterRig(this.profile.buildId ?? DEFAULT_BUILD_ID);
    this.profile.money = DEFAULT_MONEY;
    this.profile.inventory = {};
    delete this.profile.hotbarDefIds;
    this.history.clear();
    this.selected.clear();
    this.disarmGhost();
    try {
      this.persistProfile();
    } catch (err) {
      this.ui.setStatus(
        `Tutorial skip could not be saved: ${this.errorMessage(err)}`,
      );
    }
    this.refresh();
    this.persistGarage();
    this.onTutorialSkipped();
  }

  private tutorialAnchor(step: GarageTourStep): HTMLElement | null {
    if (step.kind === 'welcome') return null;
    if (step.kind === 'fight') return this.ui.tourAnchor('fight');
    if (step.kind === 'place' && step.piece) {
      if (this.tutorialAwaitingRotation) return this.tutorialRotateButton;
      if (this.tutorialDragging) return this.tutorialTarget;
      return this.ui.tutorialPartAnchor(step.piece.defId, 'store');
    }
    return this.ui.tutorialPartAnchor('turret', 'store');
  }

  private prepareTutorialStep(step: GarageTourStep): void {
    this.tutorialTarget.hidden = true;
    this.tutorialTargetWorld = null;
    this.tutorialAwaitingRotation = false;
    this.tutorialRotationTurns = 0;
    this.tutorialRotateButton.hidden = true;
    this.tutorialVoxelMarker.visible = false;
    this.ui.highlightPaletteButton(null);
    this.ui.setTutorialDragPart(null);
    if (step.kind === 'buy') {
      this.disarmGhost();
      this.ui.revealTutorialPart('turret');
      return;
    }
    if (step.kind !== 'place' || !step.piece) {
      this.disarmGhost();
      return;
    }
    this.disarmGhost();
    this.ui.revealTutorialPart(step.piece.defId);
    this.ui.setTutorialDragPart(step.piece.defId);
    this.focusTutorialPiece(step.piece);
  }

  private startTutorialPartDrag(
    defId: string,
    clientX: number,
    clientY: number,
  ): boolean {
    if (!this.tutorialActive || this.tutorialDragging) return false;
    const step = this.tutorialOverlay?.step;
    const piece = step?.piece;
    if (
      !step ||
      step.kind !== 'place' ||
      !piece ||
      piece.defId !== defId ||
      !garageTourActionAllowed(
        step,
        { kind: 'arm', defId },
        this.tourSnapshot(),
        this.tutorialSpecs,
      ) ||
      (this.inventory()[defId] ?? 0) <= 0
    ) {
      return false;
    }
    this.armTutorialPiece(piece);
    if (!this.ghost) return false;
    this.tutorialDragging = true;
    this.tutorialOverlay?.setDragging(true);
    this.lastPointer = { x: clientX, y: clientY };
    this.updateGhost(clientX, clientY);
    this.ui.setStatus('Keep holding. Drag the part onto the glowing car spot');
    return true;
  }

  private moveTutorialPartDrag(clientX: number, clientY: number): void {
    if (!this.tutorialDragging) return;
    this.lastPointer = { x: clientX, y: clientY };
    this.updateGhost(clientX, clientY);
  }

  private endTutorialPartDrag(clientX: number, clientY: number): void {
    if (!this.tutorialDragging) return;
    const step = this.tutorialOverlay?.step;
    const piece = step?.piece;
    this.lastPointer = { x: clientX, y: clientY };
    this.updateGhost(clientX, clientY);
    const targetRect = this.tutorialTarget.getBoundingClientRect();
    const releasedInsideGlow =
      clientX >= targetRect.left &&
      clientX <= targetRect.right &&
      clientY >= targetRect.top &&
      clientY <= targetRect.bottom;
    if (releasedInsideGlow) {
      // Whole visible glow means the same thing. Resolve its centre so edges
      // cannot raycast a neighbouring face and punish an apparently good drop.
      const targetX = targetRect.left + targetRect.width / 2;
      const targetY = targetRect.top + targetRect.height / 2;
      this.lastPointer = { x: targetX, y: targetY };
      this.updateGhost(targetX, targetY);
    }
    this.tutorialDragging = false;

    const exactCell =
      piece !== undefined &&
      this.ghost !== null &&
      this.ghostTarget !== null &&
      this.ghost.defId === piece.defId &&
      this.ghostTarget.pos.x === piece.pos.x &&
      this.ghostTarget.pos.y === piece.pos.y &&
      this.ghostTarget.pos.z === piece.pos.z;
    if (exactCell && this.ghost?.orient !== piece?.orient) {
      this.tutorialAwaitingRotation = true;
      this.tutorialRotateButton.hidden = false;
      this.tutorialOverlay?.setDragging(false);
      this.tutorialOverlay?.setAction(
        'Tap Rotate Part (R) until the preview turns green',
      );
      this.ui.setStatus('Good spot! Now rotate the part yourself');
      return;
    }

    this.tutorialOverlay?.setDragging(false);
    if (exactCell && this.ghost) this.placeGhost();
    if (this.tutorialActive && this.tutorialOverlay?.step === step) {
      this.disarmGhost();
      this.ui.setStatus('Try again: drag from the Store onto the exact glow');
    }
  }

  private cancelTutorialPartDrag(): void {
    if (!this.tutorialDragging) return;
    this.tutorialDragging = false;
    this.tutorialOverlay?.setDragging(false);
    this.disarmGhost();
  }

  private readonly rotateTutorialGhost = (): void => {
    if (!this.tutorialActive || !this.tutorialAwaitingRotation || !this.ghost)
      return;
    const step = this.tutorialOverlay?.step;
    if (!step?.piece || !this.ghostTarget) return;
    const action = nextStarterTutorialAction(step, this.tourSnapshot());
    if (
      action?.kind !== 'rotate' ||
      !garageTourActionAllowed(
        step,
        action,
        this.tourSnapshot(),
        this.tutorialSpecs,
      )
    ) {
      this.deny('Only the glowing Rotate button works right now');
      return;
    }
    this.ghost.orient = action.orient;
    this.tutorialRotationTurns += 1;
    this.refreshGhostAtLastPointer();

    const next = nextStarterTutorialAction(step, this.tourSnapshot());
    if (next?.kind === 'rotate') {
      this.tutorialOverlay?.setAction('Nice turn! Rotate it one more time');
      this.ui.setStatus('Rotate once more until the preview turns green');
      return;
    }
    if (next?.kind !== 'place') {
      this.deny('Grab the part again so it starts facing forward');
      this.tutorialAwaitingRotation = false;
      this.tutorialRotateButton.hidden = true;
      this.disarmGhost();
      return;
    }

    this.tutorialAwaitingRotation = false;
    this.tutorialRotateButton.hidden = true;
    this.ui.setStatus('Perfect! Green means it fits');
    this.placeGhost();
  };

  private armTutorialPiece(piece: TutorialPartSpec): void {
    if ((this.inventory()[piece.defId] ?? 0) <= 0) return;
    // Every Store grab starts unturned. Roxy never rotates a part for player.
    this.ghost = { defId: piece.defId, orient: 0 };
    this.tutorialRotationTurns = 0;
    this.ui.setArmedPart(piece.defId);
    this.selected.clear();
    this.refreshSelectionUI();
  }

  /** Snap the camera toward the exposed face the next piece attaches to. */
  private focusTutorialPiece(piece: TutorialPartSpec): void {
    const host = this.bp.parts.find((part) => {
      const dx = Math.abs(part.pos.x - piece.pos.x);
      const dy = Math.abs(part.pos.y - piece.pos.y);
      const dz = Math.abs(part.pos.z - piece.pos.z);
      return dx + dy + dz === 1;
    });
    if (!host) return;
    const hostCentre = cellCentreM(host.pos);
    const pieceCentre = cellCentreM(piece.pos);
    const face = new THREE.Vector3(
      (hostCentre.x + pieceCentre.x) / 2,
      (hostCentre.y + pieceCentre.y) / 2,
      (hostCentre.z + pieceCentre.z) / 2,
    );
    const outward = new THREE.Vector3(
      piece.pos.x - host.pos.x,
      piece.pos.y - host.pos.y,
      piece.pos.z - host.pos.z,
    ).normalize();
    this.tutorialTargetWorld = face;
    this.tutorialTarget.hidden = false;
    const markerCentre = cellCentreM(piece.pos);
    this.tutorialVoxelMarker.position.set(
      markerCentre.x,
      markerCentre.y,
      markerCentre.z,
    );
    this.tutorialVoxelMarker.scale.setScalar(1);
    this.tutorialVoxelMarker.visible = true;
    this.controls.target.copy(face);
    if (outward.y > 0.5) {
      this.persp.position.copy(face).add(new THREE.Vector3(3.2, 5.5, 4.2));
    } else {
      this.persp.position
        .copy(face)
        .addScaledVector(outward, 5.4)
        .add(new THREE.Vector3(0, 2.6, 0));
    }
    this.controls.update();
    this.updateTutorialTarget();
  }

  debugTutorialState(): { active: boolean; stepIndex: number; total: number } {
    return {
      active: this.tutorialActive,
      stepIndex: this.tutorialOverlay?.index ?? 0,
      total: this.tutorialOverlay?.total ?? this.tutorialSteps.length,
    };
  }

  /** Debug seam: advance a narration step the way the Next button does. */
  debugTutorialNext(): void {
    this.tutorialOverlay?.advance();
  }

  // ---------- views ----------

  private setView(v: 'persp' | 'front' | 'rear' | 'side' | 'top'): void {
    this.controls.dispose();
    if (v === 'persp') {
      this.camera = this.persp;
    } else {
      const d = 20;
      const pos: Record<string, [number, number, number, number]> = {
        front: [0, 1, d, 0],
        rear: [0, 1, -d, 0],
        side: [d, 1, 0, 0],
        top: [0, d, 0, 0],
      };
      const [x, y, z] = pos[v];
      this.ortho.position.set(x, y, z);
      this.ortho.up.set(0, v === 'top' ? 0 : 1, v === 'top' ? -1 : 0);
      this.ortho.lookAt(0, v === 'top' ? 0 : 1, 0);
      this.ortho.zoom = 1.6;
      this.ortho.updateProjectionMatrix();
      this.camera = this.ortho;
    }
    this.controls = new OrbitControls(
      this.camera as THREE.PerspectiveCamera,
      this.renderer.domElement,
    );
    this.controls.target.set(0, 1, 0);
    this.controls.enableDamping = true;
    this.controls.enableRotate = v === 'persp';
  }

  // ---------- blueprint changes ----------

  private exec(cmd: EditorCommand): boolean {
    if (!this.canApplyMoneyDelta(cmd.moneyDelta)) {
      this.deny(
        cmd.moneyDelta < 0
          ? `Not enough money — need $${-cmd.moneyDelta}`
          : 'That transaction would make the wallet invalid',
      );
      return false;
    }
    try {
      const preview = cmd.apply(this.bp);
      const command = wheelLayoutInputsChanged(this.bp, preview)
        ? batchCommand(cmd.label, [
            cmd,
            replaceBlueprintCommand(
              withAutomaticWheelConfigs(preview),
              0,
              'Configure automatic 2WD',
            ),
          ])
        : cmd;
      this.bp = this.history.execute(this.bp, command);
      this.refresh();
      this.autosave();
      return true;
    } catch (err) {
      this.deny(this.errorMessage(err));
      return false;
    }
  }

  private undo(): void {
    if (this.blockTutorialMutation('undo parts')) return;
    try {
      const label = this.history.undoLabels.at(-1) ?? '';
      const before = this.bp;
      const prev = this.history.undo(this.bp);
      if (prev) {
        this.bp = prev;
        if (this.isInventoryStockLabel(label)) {
          this.reconcilePlacementInventory(before, prev);
        }
        this.selected.clear();
        this.refresh();
        this.autosave();
      }
    } catch (err) {
      this.deny(this.errorMessage(err));
    }
  }

  private redo(): void {
    if (this.blockTutorialMutation('redo parts')) return;
    try {
      const label = this.history.redoLabels.at(-1) ?? '';
      const before = this.bp;
      const next = this.history.redo(this.bp);
      if (next) {
        this.bp = next;
        if (this.isInventoryStockLabel(label)) {
          this.reconcilePlacementInventory(before, next);
        }
        this.selected.clear();
        this.refresh();
        this.autosave();
      }
    } catch (err) {
      this.deny(this.errorMessage(err));
    }
  }

  private canApplyMoneyDelta(moneyDelta: number): boolean {
    if (!Number.isSafeInteger(moneyDelta)) return false;
    if (moneyDelta < 0) return canAfford(this.profile.money, -moneyDelta);
    return Number.isSafeInteger(this.profile.money + moneyDelta);
  }

  private mutateMoney(moneyDelta: number): void {
    if (!this.canApplyMoneyDelta(moneyDelta))
      throw new Error('Insufficient funds');
    const previousMoney = this.profile.money;
    this.profile.money += moneyDelta;
    try {
      this.persistProfile();
    } catch (error) {
      this.profile.money = previousMoney;
      throw error;
    }
  }

  private deny(message: string): void {
    this.onSfx('deny');
    this.ui.deny(message);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private inventory(): Record<string, number> {
    this.profile.inventory ??= {};
    return this.profile.inventory;
  }

  /**
   * Block types on the build bar. A profile that has never had one is seeded
   * from what the player owns and the seed is kept, so the bar stops moving
   * under them as soon as they see it.
   */
  private hotbar(): string[] {
    const resolved = resolveHotbar(this.profile.hotbarDefIds, this.inventory());
    this.profile.hotbarDefIds = resolved;
    return resolved;
  }

  /** Persists a bar the player just re-curated, rolling back a failed save. */
  private setHotbar(defIds: readonly string[]): void {
    if (this.blockTutorialMutation('change the build bar')) return;
    const previous = this.profile.hotbarDefIds;
    this.profile.hotbarDefIds = [...defIds];
    try {
      this.persistProfile();
    } catch (err) {
      this.profile.hotbarDefIds = previous;
      this.deny(`Build bar could not be saved: ${this.errorMessage(err)}`);
    }
    this.refreshProfile();
  }

  /**
   * Commands that move blocks between the rig and owned stock, and so have to
   * be mirrored in the inventory when undone or redone. Selling is not one:
   * the block leaves the game for cash either way.
   */
  private isInventoryStockLabel(label: string): boolean {
    return (
      label.startsWith('Place ') ||
      label === 'symmetric place' ||
      label === 'return to inventory'
    );
  }

  /** Keeps owned stock consistent when a placement is undone or redone. */
  private reconcilePlacementInventory(
    before: VehicleBlueprint,
    after: VehicleBlueprint,
  ): void {
    const beforeCounts = new Map<string, number>();
    const afterCounts = new Map<string, number>();
    for (const part of before.parts) {
      beforeCounts.set(part.defId, (beforeCounts.get(part.defId) ?? 0) + 1);
    }
    for (const part of after.parts) {
      afterCounts.set(part.defId, (afterCounts.get(part.defId) ?? 0) + 1);
    }
    const stock = this.inventory();
    for (const defId of new Set([
      ...beforeCounts.keys(),
      ...afterCounts.keys(),
    ])) {
      const inventoryDelta =
        (beforeCounts.get(defId) ?? 0) - (afterCounts.get(defId) ?? 0);
      if (inventoryDelta === 0) continue;
      const nextCount = Math.max(0, (stock[defId] ?? 0) + inventoryDelta);
      if (nextCount === 0) delete stock[defId];
      else stock[defId] = nextCount;
    }
    this.persistProfile();
  }

  private changeConfig(
    partId: string,
    key: string,
    value: boolean | string,
  ): void {
    if (this.blockTutorialMutation('change part settings')) return;
    if (key === 'level') {
      this.deny('Use Upgrade to increase a part level');
      return;
    }
    const part = getPart(this.bp, partId);
    if (!part) return;
    if (key === 'activeAbility') {
      this.setActiveAbility(partId, value === true);
      return;
    }
    const config: PartConfig = { ...part.config, [key]: value };
    this.exec(updateConfigCommand(partId, config));
    this.selectOnly(partId);
  }

  /**
   * Every ability part on the rig, in build order, as loadout candidates. A
   * part below its ability's unlock level is not one yet: the garage shows the
   * same empty box the fight would.
   */
  private abilityCandidates(): AbilityCandidate[] {
    const candidates: AbilityCandidate[] = [];
    for (const placed of this.bp.parts) {
      const def = getPartDef(placed.defId);
      if (def.ability === undefined) continue;
      const level = placed.config.level ?? 1;
      if (!abilityUnlocked(def.ability, level)) continue;
      candidates.push({
        partId: placed.id,
        partName: def.name,
        ability: def.ability,
        level,
        preferred: placed.config.activeAbility === true,
        slot: placed.config.abilitySlot,
      });
    }
    return candidates;
  }

  /**
   * Write a whole ability loadout back to the blueprint: every ability part
   * ends up with an explicit box or benched. Making the implicit auto-fill
   * explicit on the first edit is what keeps the other two boxes still when
   * the player changes one of them.
   */
  private commitAbilityLoadout(
    slotByPartId: ReadonlyMap<string, number>,
    label: string,
  ): boolean {
    const updates: ReturnType<typeof updateConfigCommand>[] = [];
    for (const placed of this.bp.parts) {
      if (getPartDef(placed.defId).ability === undefined) continue;
      const slot = slotByPartId.get(placed.id) ?? BENCHED_ABILITY_SLOT;
      if (placed.config.abilitySlot === slot) continue;
      updates.push(
        updateConfigCommand(placed.id, {
          ...placed.config,
          abilitySlot: slot,
          // The old tick is what this replaces; drop it so the two can never
          // disagree about the same part.
          activeAbility: undefined,
        }),
      );
    }
    if (updates.length === 0) return false;
    return this.exec(
      updates.length === 1 ? updates[0] : batchCommand(label, updates),
    );
  }

  /** Slot index per part id for the loadout as it stands right now. */
  private currentAbilitySlots(
    candidates: readonly AbilityCandidate[],
  ): Map<string, number> {
    const slots = new Map<string, number>();
    for (const assignment of resolveAbilityLoadout(candidates)) {
      slots.set(assignment.partId, assignment.slot);
    }
    return slots;
  }

  /**
   * A box in the garage ability planner was clicked: load the next ability the
   * rig carries into it, cycling through the ones no other box has claimed and
   * passing through empty on the way round.
   */
  private cycleAbilitySlot(slot: number): void {
    if (this.blockTutorialMutation('change abilities')) return;
    const candidates = this.abilityCandidates();
    if (candidates.length === 0) {
      this.ui.setStatus('Fit an ability part to fill this box');
      return;
    }
    const slots = this.currentAbilitySlots(candidates);
    const occupantId = [...slots].find(([, at]) => at === slot)?.[0] ?? null;
    // Abilities another box is showing stay put; the rest are this box's ring.
    const ring = candidates.filter(
      (candidate) =>
        candidate.partId === occupantId || !slots.has(candidate.partId),
    );
    const currentIndex = ring.findIndex(
      (candidate) => candidate.partId === occupantId,
    );
    const next = ring[currentIndex + 1] ?? null;

    const nextSlots = new Map<string, number>();
    for (const [partId, at] of slots) {
      if (at !== slot) nextSlots.set(partId, at);
    }
    if (next !== null) nextSlots.set(next.partId, slot);
    if (!this.commitAbilityLoadout(nextSlots, 'set ability slot')) return;
    this.ui.setStatus(
      next === null
        ? `${ABILITY_SLOT_KEYS[slot].toUpperCase()} slot cleared`
        : `${ABILITY_SLOT_KEYS[slot].toUpperCase()}: ${abilityMeta(next.ability).label}`,
    );
  }

  /**
   * The selected part's "equip" tick: drop it into the first free box, or take
   * it out of the bar. Equipping with every box full is refused rather than
   * silently bumping something the player already chose — the planner's boxes
   * are where a deliberate swap is made.
   */
  private setActiveAbility(partId: string, active: boolean): void {
    const part = getPart(this.bp, partId);
    if (!part || !getPartDef(part.defId).ability) return;
    const candidates = this.abilityCandidates();
    const slots = this.currentAbilitySlots(candidates);
    const equipped = slots.has(partId);
    if (equipped === active) return;

    const nextSlots = new Map(slots);
    if (active) {
      const taken = new Set(slots.values());
      const free = ABILITY_SLOT_KEYS.findIndex((_, slot) => !taken.has(slot));
      if (free === -1) {
        this.deny(
          `Only ${MAX_ABILITY_SLOTS} abilities fit the bar — clear a box first`,
        );
        this.selectOnly(partId);
        return;
      }
      nextSlots.set(partId, free);
    } else {
      nextSlots.delete(partId);
    }
    this.commitAbilityLoadout(nextSlots, 'set ability slot');
    this.selectOnly(partId);
  }

  /**
   * The selection, minus anything fixed to the rig. Returns an empty list
   * (after saying why) when the player only had fixed blocks selected, so the
   * two removal actions agree on what may come off.
   */
  private removableSelection(refusal: string): PlacedPart[] {
    const parts = [...this.selected]
      .map((id) => getPart(this.bp, id))
      .filter(
        (part): part is PlacedPart =>
          part !== undefined && !isFixedToRig(getPartDef(part.defId)),
      );
    if (parts.length === 0) {
      const blocked = [...this.selected]
        .map((id) => getPart(this.bp, id))
        .find(
          (part) => part !== undefined && isFixedToRig(getPartDef(part.defId)),
        );
      if (blocked !== undefined) {
        const def = getPartDef(blocked.defId);
        this.ui.setStatus(
          def.buildSignature === true
            ? `Your ${def.name} is part of the build and stays on the rig`
            : refusal,
        );
      }
    }
    return parts;
  }

  /**
   * Pull the selection off the rig and back into owned stock, ready to place
   * again for free. Unlike a sale the player keeps the blocks, so the only
   * money that moves is a full refund of their unlocks: inventory counts
   * blocks by type and cannot carry a level, and silently burning that spend
   * would make the move a trap.
   */
  private returnSelectedToInventory(): void {
    if (this.blockTutorialMutation('remove blocks')) return;
    const parts = this.removableSelection("Truck Heart can't be removed");
    if (parts.length === 0) return;
    const refund = parts.reduce(
      (total, part) => total + unlockInvestment(part),
      0,
    );
    const returned = this.exec(
      batchCommand(
        'return to inventory',
        parts.map((part) => removeCommand(part.id, unlockInvestment(part))),
      ),
    );
    if (!returned) return;
    const stock = this.inventory();
    for (const part of parts) stock[part.defId] = (stock[part.defId] ?? 0) + 1;
    this.persistProfile();
    this.selected.clear();
    this.refresh();
    const blocks = `${parts.length} block${parts.length === 1 ? '' : 's'}`;
    this.ui.setStatus(
      refund > 0
        ? `Returned ${blocks} to inventory — unlocks refunded +$${refund}`
        : `Returned ${blocks} to inventory`,
    );
    this.onSfx('remove');
  }

  private deleteSelected(): void {
    if (this.blockTutorialMutation('sell blocks')) return;
    const parts = this.removableSelection("Truck Heart can't be deleted");
    if (parts.length === 0) return;
    const refund = parts.reduce((total, part) => total + sellRefund(part), 0);
    const sold = this.exec(
      batchCommand(
        'sell selection',
        parts.map((part) => removeCommand(part.id, sellRefund(part))),
      ),
    );
    if (sold) {
      this.selected.clear();
      this.refresh();
      this.ui.setStatus(
        `Sold ${parts.length} part${parts.length === 1 ? '' : 's'} +$${refund}`,
      );
      this.onSfx('remove');
    }
  }

  private buyUpgrade(partId: string): boolean {
    if (this.blockTutorialMutation('upgrade blocks')) return false;
    const part = getPart(this.bp, partId);
    if (!part) {
      this.deny(`Unknown part: ${partId}`);
      return false;
    }
    const upgrade = nextUpgrade(part);
    if (!upgrade) {
      this.deny('This part is already at maximum level');
      return false;
    }
    const upgraded = this.exec(
      updateConfigCommand(
        part.id,
        { ...part.config, level: upgrade.targetLevel },
        -upgrade.price,
      ),
    );
    if (upgraded) {
      this.selectOnly(part.id);
      this.ui.setStatus(
        `${getPartDef(part.defId).name} upgraded to level ${upgrade.targetLevel} (-$${upgrade.price})`,
      );
      this.onSfx('upgrade');
    }
    return upgraded;
  }

  private currentRunPartHp(
    part: PlacedPart,
    partHp: Readonly<Record<string, number>>,
  ): number {
    const maxHp = getEffectiveDef(part).health;
    const storedHp = partHp[part.id];
    if (storedHp === undefined) return maxHp;
    const oldMaxHp = this.runPartMaxHpAtEntry.get(part.id) ?? maxHp;
    return scaledHpOnUpgrade(storedHp, oldMaxHp, maxHp);
  }

  private selectedRepairEconomy(part: PlacedPart): {
    cost: number;
    canRepair: boolean;
  } | null {
    if (!this.runRepair) return null;
    const partHp = this.runRepair.partHp();
    const storedHp = partHp[part.id];
    if (storedHp === undefined || storedHp <= 0) return null;
    const maxHp = getEffectiveDef(part).health;
    const currentHp = this.currentRunPartHp(part, partHp);
    if (currentHp >= maxHp) return null;
    const cost = partRepairCost(getPartDef(part.defId).cost, currentHp, maxHp);
    return { cost, canRepair: canAfford(this.profile.money, cost) };
  }

  private repairPart(partId: string): boolean {
    const part = getPart(this.bp, partId);
    const repair = part ? this.selectedRepairEconomy(part) : null;
    if (!part || !repair || !this.runRepair) return false;
    if (!repair.canRepair) {
      this.deny(`Not enough money - need $${repair.cost}`);
      return false;
    }
    if (!this.runRepair.repairPart(partId)) {
      this.deny('Repair could not be completed');
      return false;
    }
    this.refreshProfile();
    this.ui.setStatus(
      repair.cost === 0
        ? `${getPartDef(part.defId).name} repaired for free`
        : `${getPartDef(part.defId).name} repaired (-$${repair.cost})`,
    );
    this.onSfx('repair');
    return true;
  }

  private currentRepairPlan(): ReturnType<typeof repairPlan> | undefined {
    if (!this.runRepair) return undefined;
    const partHp = this.runRepair.partHp();
    return repairPlan(
      this.bp.parts
        .filter((part) => partHp[part.id] === undefined || partHp[part.id] > 0)
        .map((part) => ({
          id: part.id,
          baseCost: getPartDef(part.defId).cost,
          currentHp: this.currentRunPartHp(part, partHp),
          maxHp: getEffectiveDef(part).health,
        })),
    );
  }

  private repairAll(): boolean {
    const plan = this.currentRepairPlan();
    if (!plan || plan.totalCost <= 0 || !this.runRepair) return false;
    if (!canAfford(this.profile.money, plan.totalCost)) {
      this.deny(`Not enough money - need $${plan.totalCost}`);
      return false;
    }
    if (!this.runRepair.repairAll()) {
      this.deny('Repairs could not be completed');
      return false;
    }
    this.refreshProfile();
    this.ui.setStatus(`Vehicle fully repaired (-$${plan.totalCost})`);
    this.onSfx('repair');
    return true;
  }

  /**
   * Only parts whose old cell is still free are restorable right now; one a
   * player has since built over is silently left out of the cost and the
   * action rather than blocking the rest of the rebuild.
   */
  private currentRebuildPlan():
    { parts: PlacedPart[]; totalCost: number } | undefined {
    if (!this.runRepair) return undefined;
    const restorable = this.runRepair
      .missingParts()
      .filter(
        (part) =>
          canPlacePart(
            this.bp,
            getPartDef,
            part.defId,
            part.pos,
            part.orient,
            part.config,
          ).ok,
      );
    return {
      parts: restorable,
      totalCost: restorable.reduce(
        (sum, part) => sum + getPartDef(part.defId).cost,
        0,
      ),
    };
  }

  private rebuildCar(): boolean {
    const plan = this.currentRebuildPlan();
    if (!plan || plan.parts.length === 0) return false;
    if (!canAfford(this.profile.money, plan.totalCost)) {
      this.deny(`Not enough money - need $${plan.totalCost}`);
      return false;
    }
    const commands = plan.parts.map((part) =>
      placeCommand(part, -getPartDef(part.defId).cost),
    );
    if (!this.exec(batchCommand('Rebuild Car', commands))) return false;
    this.ui.setStatus(`Vehicle rebuilt (-$${plan.totalCost})`);
    this.onSfx('repair');
    return true;
  }

  private sellPart(partId: string): boolean {
    if (this.blockTutorialMutation('sell blocks')) return false;
    const part = getPart(this.bp, partId);
    if (!part) {
      this.deny(`Unknown part: ${partId}`);
      return false;
    }
    const def = getPartDef(part.defId);
    if (isFixedToRig(def)) {
      this.deny(
        def.buildSignature === true
          ? `${def.name} can't be sold — it's your build`
          : "Truck Heart can't be sold",
      );
      return false;
    }
    const refund = sellRefund(part);
    if (!this.exec(removeCommand(part.id, refund))) return false;
    this.selected.delete(part.id);
    this.refreshSelectionUI();
    this.rebuildMeshes();
    this.ui.setStatus(`Sold ${def.name} +$${refund}`);
    this.onSfx('remove');
    return true;
  }

  /**
   * One 90° step for the R (turn) and F (flip) keys.
   *
   * Guns flip about Z — a roll — because that is the turn that swings their
   * hardpoint onto the side of a block, which is how a gun gets side-mounted.
   * Rolling about X would only tip it nose-up or nose-down.
   */
  private rotationStep(def: PartDefinition, axis: 'y' | 'x'): number {
    if (axis === 'y') return orientationFromSteps(0, 1, 0);
    return def.weapon
      ? orientationFromSteps(0, 0, 1)
      : orientationFromSteps(1, 0, 0);
  }

  private rotateSelected(axis: 'y' | 'x'): void {
    if (this.blockTutorialMutation('rotate placed blocks')) return;
    const first = [...this.selected][0];
    if (!first) return;
    const part = getPart(this.bp, first);
    if (!part) return;
    const def = getPartDef(part.defId);
    const step = this.rotationStep(def, axis);
    let next = composeOrientations(step, part.orient);
    for (let i = 0; i < 4; i++) {
      if (!def.allowedOrientations || def.allowedOrientations.includes(next))
        break;
      next = composeOrientations(step, next);
    }
    const without = {
      ...this.bp,
      parts: this.bp.parts.filter((p) => p.id !== part.id),
    };
    const ok = canPlacePart(
      without,
      getPartDef,
      part.defId,
      part.pos,
      next,
      part.config,
    ).ok;
    if (ok) this.exec(rotateCommand(part.id, next));
    else this.ui.setStatus('Rotation blocked here');
    this.refreshGhostAtLastPointer();
  }

  // ---------- ghost placement ----------

  private armGhost(defId: string): void {
    if (this.blockTutorialMutation('pick a different block')) return;
    if ((this.inventory()[defId] ?? 0) <= 0) {
      this.deny(`No ${getPartDef(defId).name} in inventory`);
      return;
    }
    this.ghost = { defId, orient: 0 };
    this.ui.setArmedPart(defId);
    this.selected.clear();
    this.refreshSelectionUI();
  }

  private isUnlocked(defId: string): boolean {
    return (
      unlockCost(defId) === 0 || this.profile.unlockedDefIds.includes(defId)
    );
  }

  private unlockPart(defId: string): boolean {
    let def: ReturnType<typeof getPartDef>;
    try {
      def = getPartDef(defId);
    } catch {
      this.deny(`Unknown catalog part: ${defId}`);
      return false;
    }
    if (this.isUnlocked(defId)) return true;
    const price = unlockCost(defId);
    if (!canAfford(this.profile.money, price)) {
      this.deny(`Not enough money to unlock ${def.name} — need $${price}`);
      return false;
    }

    const previousMoney = this.profile.money;
    const previousUnlocks = [...this.profile.unlockedDefIds];
    this.profile.money -= price;
    this.profile.unlockedDefIds.push(defId);
    try {
      this.persistProfile();
    } catch (err) {
      this.profile.money = previousMoney;
      this.profile.unlockedDefIds.splice(
        0,
        this.profile.unlockedDefIds.length,
        ...previousUnlocks,
      );
      this.deny(`Unlock could not be saved: ${this.errorMessage(err)}`);
      return false;
    }
    this.refreshProfile();
    this.ui.setStatus(
      `Unlocked ${def.name} (-$${price}) — available to buy anytime`,
    );
    this.onSfx('purchase');
    return true;
  }

  private buyInventoryPart(defId: string): boolean {
    let def: ReturnType<typeof getPartDef>;
    try {
      def = getPartDef(defId);
    } catch {
      this.deny(`Unknown store part: ${defId}`);
      return false;
    }
    if (
      def.unique === true &&
      (this.inventory()[defId] ?? 0) +
        this.bp.parts.filter((part) => part.defId === defId).length >=
        1
    ) {
      this.deny(
        `${def.name} limit reached - only one can be owned or installed`,
      );
      return false;
    }
    if (!this.isUnlocked(defId)) return this.unlockPart(defId);
    if (!canAfford(this.profile.money, def.cost)) {
      this.deny(`Not enough money to buy ${def.name} - need $${def.cost}`);
      return false;
    }

    const previousMoney = this.profile.money;
    const stock = this.inventory();
    const previousCount = stock[defId] ?? 0;
    const previousHotbar = this.profile.hotbarDefIds;
    this.profile.money -= def.cost;
    stock[defId] = previousCount + 1;
    // A part you just paid for should be one click from placement.
    this.profile.hotbarDefIds = withHotbarSlot(this.hotbar(), defId);
    try {
      this.persistProfile();
    } catch (err) {
      this.profile.money = previousMoney;
      this.profile.hotbarDefIds = previousHotbar;
      const restoredStock = this.inventory();
      if (previousCount === 0) delete restoredStock[defId];
      else restoredStock[defId] = previousCount;
      this.deny(`Purchase could not be saved: ${this.errorMessage(err)}`);
      return false;
    }
    this.refreshProfile();
    this.ui.setStatus(`Bought ${def.name} (-$${def.cost})`);
    this.onSfx('purchase');
    return true;
  }

  /** Unlock now, or buy and arm later once that permanent unlock is owned. */
  private handleStorePart(defId: string): boolean {
    let def: ReturnType<typeof getPartDef>;
    try {
      def = getPartDef(defId);
    } catch {
      this.deny(`Unknown store part: ${defId}`);
      return false;
    }

    if (this.tutorialActive) {
      const step = this.tutorialOverlay?.step;
      if (
        !step ||
        !garageTourActionAllowed(
          step,
          { kind: 'buy', defId },
          this.tourSnapshot(),
          this.tutorialSpecs,
        )
      ) {
        this.deny('Roxy says: finish the glowing build steps first');
        return false;
      }
    }

    const offer = storeOffer(defId, this.profile.unlockedDefIds);
    if (offer.action === 'unlock') return this.unlockPart(defId);
    if (!this.buyInventoryPart(defId)) return false;
    if (!this.tutorialActive) this.armGhost(defId);
    this.refreshTutorial();
    this.ui.setStatus(
      `Bought ${def.name} and armed placement (-$${offer.price})`,
    );
    return true;
  }

  private changeInventory(defId: string, delta: number): boolean {
    const stock = this.inventory();
    const previousCount = stock[defId] ?? 0;
    const nextCount = previousCount + delta;
    if (!Number.isSafeInteger(nextCount) || nextCount < 0) return false;
    if (nextCount === 0) delete stock[defId];
    else stock[defId] = nextCount;
    try {
      this.persistProfile();
      return true;
    } catch (err) {
      const restoredStock = this.inventory();
      if (previousCount === 0) delete restoredStock[defId];
      else restoredStock[defId] = previousCount;
      this.deny(`Inventory could not be saved: ${this.errorMessage(err)}`);
      return false;
    }
  }

  private disarmGhost(): void {
    this.ghost = null;
    this.ghostTarget = null;
    this.ui.setArmedPart(null);
    if (this.ghostMesh) {
      this.scene.remove(this.ghostMesh);
      disposeObjectResources(this.ghostMesh);
      this.ghostMesh = null;
    }
    this.ghostMeshKey = null;
    this.ui.ghostTip.style.display = 'none';
  }

  private disarmTool(): void {
    this.disarmGhost();
  }

  private refreshGhostAtLastPointer(): void {
    if (this.lastPointer)
      this.updateGhost(this.lastPointer.x, this.lastPointer.y);
  }

  private updateGhost(clientX: number, clientY: number): void {
    if (!this.ghost) return;
    this.lastPointer = { x: clientX, y: clientY };
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const def = getPartDef(this.ghost.defId);
    const isFaceMounted = def.cells.length === 0;
    // Armour that owns a cell still wants to lie flat on whatever it was
    // dropped against, so the ghost picks its own orientation the way
    // face-mounted armour does instead of waiting for R/F.
    const isFlatArmour = !isFaceMounted && Boolean(def.armour);

    let target: Vec3i | null = null;
    let orient = this.ghost.orient;

    const hits = this.raycaster.intersectObjects(
      this.partsGroup.children,
      true,
    );
    const hit = hits.find((candidate) => this.isPlacementSurfaceHit(candidate));
    if (hit && hit.face) {
      const n = dominantAxis(
        hit.face.normal.clone().transformDirection(hit.object.matrixWorld),
      );
      const p = hit.point;
      if (isFaceMounted) {
        const host = p.clone().addScaledVector(n, -FACE_STEP_M);
        target = this.toCell(host);
        // Orient the armour socket ('pz' canonical) toward the hit face.
        orient = this.orientFacing({ x: n.x, y: n.y, z: n.z });
      } else {
        const adj = p.clone().addScaledVector(n, FACE_STEP_M);
        target = this.toCell(adj);
        // Point the plate's outward face away from the block it covers.
        if (isFlatArmour) {
          orient = this.orientFacing(
            { x: n.x, y: n.y, z: n.z },
            ARMOUR_FACE_AXIS,
          );
        }
      }
    } else {
      // Ground / layer plane.
      const planeY = (this.layer >= 0 ? this.layer : 0) * CELL_SIZE + 0.001;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
      const pt = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(plane, pt) && !isFaceMounted) {
        target = this.toCell(new THREE.Vector3(pt.x, planeY + 0.02, pt.z));
        // Nothing above the layer plane to hug: lie flat, face up.
        if (isFlatArmour)
          orient = this.orientFacing({ x: 0, y: 1, z: 0 }, ARMOUR_FACE_AXIS);
      }
    }

    if (!target) {
      this.ui.ghostTip.style.display = 'none';
      if (this.ghostMesh) this.ghostMesh.visible = false;
      this.ghostTarget = null;
      return;
    }

    const result = canPlacePart(
      this.bp,
      getPartDef,
      this.ghost.defId,
      target,
      orient,
      {},
    );
    this.ghost.orient = orient;
    this.ghostTarget = {
      pos: target,
      valid: result.ok,
      message: result.issues[0]?.message ?? '',
    };

    const meshKey = `${this.ghost.defId}:${orient}:${result.ok}`;
    if (!this.ghostMesh || this.ghostMeshKey !== meshKey) {
      if (this.ghostMesh) {
        this.scene.remove(this.ghostMesh);
        disposeObjectResources(this.ghostMesh);
      }
      const placed: PlacedPart = {
        id: '__ghost',
        defId: this.ghost.defId,
        pos: { x: 0, y: 0, z: 0 },
        orient,
        config: {},
      };
      this.ghostMesh = buildPartMesh(def, placed, 0.55);
      this.ghostMesh.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = (mesh.material as THREE.MeshLambertMaterial).clone();
        material.color.set(result.ok ? 0x5fd75f : 0xe05545);
        material.transparent = true;
        material.opacity = 0.55;
        mesh.material = material;
      });
      this.ghostMeshKey = meshKey;
      this.scene.add(this.ghostMesh);
    }
    this.ghostMesh.visible = true;
    this.ghostMesh.position.set(
      target.x * CELL_SIZE,
      target.y * CELL_SIZE,
      target.z * CELL_SIZE,
    );

    const tip = this.ui.ghostTip;
    if (!result.ok && result.issues.length > 0) {
      tip.textContent =
        result.issues[0].message +
        (result.issues[0].suggestion
          ? ` — ${result.issues[0].suggestion}`
          : '');
      tip.style.display = 'block';
      tip.style.left = `${clientX + 14}px`;
      tip.style.top = `${clientY + 14}px`;
    } else {
      tip.style.display = 'none';
    }
  }

  private orientFacing(
    normal: Vec3i,
    localAxis: Vec3i = { x: 0, y: 0, z: 1 },
  ): number {
    // Find an orientation sending the part's local axis to the given normal.
    for (let o = 0; o < 24; o++) {
      const v = rotateVec(o, localAxis);
      if (v.x === normal.x && v.y === normal.y && v.z === normal.z) return o;
    }
    return 0;
  }

  private toCell(p: THREE.Vector3): Vec3i {
    return {
      x: Math.floor(p.x / CELL_SIZE),
      y: Math.floor(p.y / CELL_SIZE),
      z: Math.floor(p.z / CELL_SIZE),
    };
  }

  private placeGhost(): void {
    this.refreshGhostAtLastPointer();
    if (!this.ghost || !this.ghostTarget) return;
    if (!this.isUnlocked(this.ghost.defId)) {
      this.deny('That catalog part is locked');
      return;
    }
    const available = this.inventory()[this.ghost.defId] ?? 0;
    if (available <= 0) {
      this.deny(`No ${getPartDef(this.ghost.defId).name} left in inventory`);
      this.disarmGhost();
      return;
    }
    const { pos } = this.ghostTarget;
    const def = getPartDef(this.ghost.defId);
    const placement = canPlacePart(
      this.bp,
      getPartDef,
      this.ghost.defId,
      pos,
      this.ghost.orient,
      {},
    );
    if (!placement.ok) {
      this.ghostTarget = {
        pos,
        valid: false,
        message: placement.issues[0]?.message ?? '',
      };
      this.refreshGhostAtLastPointer();
      return;
    }
    const id = nextPartId(this.bp);
    const tutorialPiece =
      this.tutorialActive &&
      this.tutorialOverlay?.step.piece?.defId === this.ghost.defId
        ? this.tutorialOverlay.step.piece
        : null;
    // A coached placement carries the settings the chosen rig specifies — the
    // Sparkrunner's off-road suspension and turbocharged engine, say. Placing
    // the block bare would hand the tutorial player a weaker car than skipping
    // the tutorial does, and the exact-match recipe would never accept it.
    const config = tutorialPiece
      ? { ...defaultConfigForDef(def), ...tutorialPiece.config }
      : defaultConfigForDef(def);
    const part: PlacedPart = {
      id,
      defId: this.ghost.defId,
      pos,
      orient: this.ghost.orient,
      config,
    };
    if (this.tutorialActive) {
      const step = this.tutorialOverlay?.step;
      const action = {
        kind: 'place' as const,
        defId: part.defId,
        pos: part.pos,
        orient: part.orient,
        config: part.config,
      };
      if (
        !step ||
        !starterTutorialPlacementAllowed(
          step,
          part.defId,
          part.pos,
          part.orient,
          part.config,
          this.tutorialRotationTurns,
        ) ||
        !garageTourActionAllowed(
          step,
          action,
          this.tourSnapshot(),
          this.tutorialSpecs,
        )
      ) {
        this.deny('That piece only fits on the glowing spot');
        return;
      }
    }
    const cmds: EditorCommand[] = [placeCommand(part)];

    if (
      !this.tutorialActive &&
      this.symmetry &&
      !def.unique &&
      available >= 2
    ) {
      const mPos = mirrorCellX(pos);
      if (mPos.x !== pos.x || def.cells.length === 0) {
        const after = cmds[0].apply(this.bp);
        const mirror = mirrorCommand(id, nextPartId(after));
        // Validate the mirrored placement before batching.
        try {
          const test = mirror.apply(after);
          const report = validateBlueprint(test, getPartDef);
          const overlaps = report.errors.some(
            (e) => e.code === 'OVERLAP' || e.code === 'OUT_OF_BOUNDS',
          );
          if (!overlaps) cmds.push(mirror);
        } catch {
          /* mirrored spot invalid — place single */
        }
      }
    }
    const usedCount = cmds.length;
    if (!this.changeInventory(part.defId, -usedCount)) return;
    if (
      this.exec(
        cmds.length > 1 ? batchCommand('symmetric place', cmds) : cmds[0],
      )
    ) {
      this.onSfx('place');
      if (this.tutorialActive) {
        // `exec` refreshed the exact next step, including its armed piece and
        // camera target. Do not let the old piece disarm that new instruction.
      } else if ((this.inventory()[part.defId] ?? 0) > 0) {
        // Keep the hotbar item armed so repeated clicks keep building with it.
        this.refreshGhostAtLastPointer();
      } else {
        this.disarmGhost();
      }
    } else {
      this.changeInventory(part.defId, usedCount);
    }
  }

  // ---------- selection ----------

  private selectAt(clientX: number, clientY: number, additive: boolean): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const partId = this.partIdAtIntersections(
      this.raycaster.intersectObjects(this.partsGroup.children, true),
    );
    if (!additive) this.selected.clear();
    if (partId) {
      if (additive && this.selected.has(partId)) this.selected.delete(partId);
      else this.selected.add(partId);
    }
    this.refreshSelectionUI();
    this.rebuildMeshes();
  }

  private isPlacementSurfaceHit(
    hit: THREE.Intersection<THREE.Object3D>,
  ): boolean {
    const mesh = hit.object as THREE.Mesh;
    if (
      !mesh.isMesh ||
      !mesh.visible ||
      !hit.face ||
      mesh.userData.placementSurface !== true
    )
      return false;
    let object: THREE.Object3D | null = mesh;
    while (object) {
      if (object.userData.editorPickable === false || !object.visible)
        return false;
      object = object.parent;
    }
    return true;
  }

  private partIdAtIntersections(
    hits: THREE.Intersection<THREE.Object3D>[],
  ): string | null {
    const hit = hits.find((candidate) => this.isPlacementSurfaceHit(candidate));
    if (!hit) return null;
    let object: THREE.Object3D | null = hit.object;
    while (object && !object.name.startsWith('part:')) object = object.parent;
    return object ? object.name.slice(5) : null;
  }

  private partIdAt(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    return this.partIdAtIntersections(
      this.raycaster.intersectObjects(this.partsGroup.children, true),
    );
  }

  private selectOnly(partId: string): void {
    this.selected.clear();
    this.selected.add(partId);
    this.refreshSelectionUI();
    this.rebuildMeshes();
  }

  /**
   * Which survival ability-bar slot a placed part currently claims, resolved
   * exactly the way the fight resolves it — so the garage and the HUD can
   * never disagree about what is equipped.
   */
  private abilitySlotStatus(partId: string): AbilitySlotStatus {
    const candidates = this.abilityCandidates();
    const assignment = resolveAbilityLoadout(candidates).find(
      (slot) => slot.partId === partId,
    );
    const part = getPart(this.bp, partId);
    const ability = part ? getPartDef(part.defId).ability : undefined;
    const locked =
      ability !== undefined &&
      !abilityUnlocked(ability, part?.config.level ?? 1);
    return {
      key: assignment?.key ?? null,
      candidates: candidates.length,
      capacity: MAX_ABILITY_SLOTS,
      lockedUntilLevel:
        locked && ability !== undefined ? abilityUnlockLevel(ability) : null,
    };
  }

  /**
   * Redraw the garage ability planner from the blueprint. The boxes show
   * exactly what the fight will show, resolved by the same function.
   */
  private refreshAbilityLoadout(): void {
    const assignments = resolveAbilityLoadout(this.abilityCandidates());
    const boxes: (AbilityLoadoutSlotView | null)[] = ABILITY_SLOT_KEYS.map(
      () => null,
    );
    for (const assignment of assignments) {
      const meta = abilityMeta(assignment.ability);
      boxes[assignment.slot] = {
        name: meta.label,
        glyph: meta.glyph,
        partName: assignment.partName,
        blurb: meta.blurb,
      };
    }
    this.ui.setAbilityLoadout(boxes);
  }

  private refreshSelectionUI(): void {
    this.updateSelectionTipAnchor();
    const first = [...this.selected][0];
    if (!first) {
      this.ui.setSelectedPart(null);
      this.refreshOverlays();
      return;
    }
    const part = getPart(this.bp, first);
    if (!part) return;
    const def = getPartDef(part.defId);
    const level = Math.min(
      def.upgrade?.maxLevel ?? 1,
      Math.max(1, Math.floor(part.config.level ?? 1)),
    );
    const upgrade = nextUpgrade(part);
    const selectedParts = [...this.selected]
      .map((id) => getPart(this.bp, id))
      .filter(
        (selectedPart): selectedPart is PlacedPart =>
          selectedPart !== undefined &&
          !isFixedToRig(getPartDef(selectedPart.defId)),
      );
    const selectionRefund = selectedParts.reduce(
      (total, selectedPart) => total + sellRefund(selectedPart),
      0,
    );
    const repair = this.selectedRepairEconomy(part);
    this.ui.setSelectedPart(
      def,
      part.id,
      level,
      getEffectiveDef(part),
      {
        nextUpgradePrice: upgrade?.price ?? null,
        canUpgrade:
          upgrade !== null && canAfford(this.profile.money, upgrade.price),
        sellRefund: selectionRefund,
        repairCost: repair?.cost ?? null,
        canRepair: repair?.canRepair ?? false,
        upgradePreview: previewUpgradeMetrics(this.bp, part.id) ?? undefined,
      },
      part.config,
      def.wheel
        ? deriveAutomaticWheelLayout(this.bp, getPartDef).steeringPartIds.has(
            part.id,
          )
        : undefined,
      def.ability ? this.abilitySlotStatus(part.id) : undefined,
    );
    this.refreshOverlays();
  }

  /**
   * Park the shortcut card over the centre of the selection, lifted clear of
   * the blocks so it never covers the thing it is describing.
   */
  private updateSelectionTipAnchor(): void {
    const centres = [...this.selected]
      .map((id) => getPart(this.bp, id))
      .filter((part): part is PlacedPart => part !== undefined)
      .map((part) => cellCentreM(part.pos));
    if (centres.length === 0) {
      this.selectionTipAnchor = null;
      return;
    }
    const anchor = this.selectionTipAnchor ?? new THREE.Vector3();
    anchor.set(0, 0, 0);
    for (const centre of centres)
      anchor.add(new THREE.Vector3(centre.x, centre.y, centre.z));
    anchor.divideScalar(centres.length);
    anchor.y += CELL_SIZE * 0.6;
    this.selectionTipAnchor = anchor;
  }

  // ---------- pointer/keyboard ----------

  private onPointerMove = (e: PointerEvent): void => {
    if (this.disposed) return;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.updateGhost(e.clientX, e.clientY);
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDown = { x: e.clientX, y: e.clientY };
    // Tap-only touch devices may never send a prior pointermove.
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.updateGhost(e.clientX, e.clientY);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointerDown) return;
    const moved = Math.hypot(
      e.clientX - this.pointerDown.x,
      e.clientY - this.pointerDown.y,
    );
    this.pointerDown = null;
    if (moved > 6) return; // drag = camera, not click
    if (e.button === 2) {
      this.deleteAt(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0) return;
    if (this.ghost) this.placeGhost();
    else this.selectAt(e.clientX, e.clientY, e.shiftKey);
  };

  private onContextMenu = (e: MouseEvent): void => e.preventDefault();

  private deleteAt(clientX: number, clientY: number): void {
    const id = this.partIdAt(clientX, clientY);
    if (!id) return;
    const part = getPart(this.bp, id);
    if (!part) return;
    this.sellPart(id);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.disposed) return;
    const t = e.target as HTMLElement;
    if (
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'SELECT' ||
        t.tagName === 'TEXTAREA')
    )
      return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    switch (key) {
      case 'escape':
        this.disarmTool();
        this.selected.clear();
        this.refreshSelectionUI();
        this.rebuildMeshes();
        break;
      case 'r':
        if (this.tutorialActive) {
          e.preventDefault();
          this.rotateTutorialGhost();
          break;
        }
        if (this.ghost) {
          this.ghost.orient = this.nextAllowedOrient(
            this.ghost.defId,
            this.ghost.orient,
            'y',
          );
          this.refreshGhostAtLastPointer();
        } else this.rotateSelected('y');
        break;
      case 'f':
        if (this.ghost) {
          this.ghost.orient = this.nextAllowedOrient(
            this.ghost.defId,
            this.ghost.orient,
            'x',
          );
          this.refreshGhostAtLastPointer();
        } else this.rotateSelected('x');
        break;
      case 'm':
        this.returnSelectedToInventory();
        break;
      case 'delete':
      case 'backspace':
        this.deleteSelected();
        break;
      case '1':
        this.setView('persp');
        break;
      case '2':
        this.setView('front');
        break;
      case '3':
        this.setView('rear');
        break;
      case '4':
        this.setView('side');
        break;
      case '5':
        this.setView('top');
        break;
    }
  }

  private nextAllowedOrient(
    defId: string,
    current: number,
    axis: 'y' | 'x',
  ): number {
    const def = getPartDef(defId);
    const step =
      axis === 'y'
        ? orientationFromSteps(0, 1, 0)
        : orientationFromSteps(1, 0, 0);
    let next = composeOrientations(step, current);
    for (let i = 0; i < 24; i++) {
      if (!def.allowedOrientations || def.allowedOrientations.includes(next))
        return next;
      next = composeOrientations(step, next);
    }
    return current;
  }

  // ---------- persistence ----------

  private slots(): Record<string, string> {
    try {
      const parsed: unknown = JSON.parse(
        localStorage.getItem(BLUEPRINT_STORAGE_KEY) ?? '{}',
      );
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      )
        return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
    } catch {
      return {};
    }
  }

  persistGarage(): void {
    this.writeCurrentSlot();
  }

  private autosave(): void {
    this.writeCurrentSlot();
  }

  private writeCurrentSlot(): boolean {
    try {
      const all = this.slots();
      const previousName = this.profile.currentBlueprintName;
      all[this.bp.name] = serializeBlueprint(this.bp);
      if (
        this.explicitRenamePending &&
        previousName !== undefined &&
        previousName !== this.bp.name
      ) {
        delete all[previousName];
      }
      localStorage.setItem(BLUEPRINT_STORAGE_KEY, JSON.stringify(all));
      this.profile.currentBlueprintName = this.bp.name;
      this.persistProfile();
      this.explicitRenamePending = false;
      return true;
    } catch (err) {
      this.ui.setStatus(`Autosave failed: ${this.errorMessage(err)}`);
      return false;
    }
  }

  // ---------- refresh ----------

  private refresh(): void {
    this.rebuildMeshes();
    this.refreshAnalysis();
    this.ui.setBlueprintName(this.bp.name);
    this.ui.setUndoRedo(this.history.canUndo, this.history.canRedo);
    this.ui.setEconomy(
      this.profile.money,
      this.profile.unlockedDefIds,
      this.inventory(),
      this.bp.parts.map((part) => part.defId),
      this.hotbar(),
    );
    this.refreshRunContext();
    this.refreshSelectionUI();
    this.refreshAbilityLoadout();
    this.refreshTutorial();
  }

  /** Feed the guided tour whatever the garage looks like now. */
  private refreshTutorial(): void {
    if (this.tutorialActive) this.tutorialOverlay?.update(this.tourSnapshot());
  }

  /** Refresh profile-backed UI after an App-side reward or debug grant. */
  refreshProfile(): void {
    this.ui.setEconomy(
      this.profile.money,
      this.profile.unlockedDefIds,
      this.inventory(),
      this.bp.parts.map((part) => part.defId),
      this.hotbar(),
    );
    this.refreshRunContext();
    this.refreshSelectionUI();
    // Buying goes through here rather than `refresh`, and the tour's first
    // action step is a purchase.
    this.refreshTutorial();
  }

  private refreshRunContext(): void {
    const plan = this.currentRepairPlan();
    const rebuildPlan = this.currentRebuildPlan();
    const nextWave = (this.runContext?.wave ?? 0) + 1;
    const threatNotice = threatWarningsForWave(nextWave).join(' ');
    const nextWaveNotice = threatNotice || undefined;
    this.ui.setRunContext(
      this.runContext?.wave,
      this.runSummary,
      plan
        ? {
            integrityPct: plan.integrityPct,
            totalCost: plan.totalCost,
            canRepairAll:
              plan.totalCost > 0 &&
              canAfford(this.profile.money, plan.totalCost),
            rebuildCost: rebuildPlan?.totalCost ?? 0,
            canRebuildAll:
              (rebuildPlan?.totalCost ?? 0) > 0 &&
              canAfford(this.profile.money, rebuildPlan?.totalCost ?? 0),
            nextWaveNotice,
          }
        : undefined,
    );
  }

  private rebuildMeshes(): void {
    disposeObjectResources(this.partsGroup);
    this.partsGroup.clear();
    for (const part of this.bp.parts) {
      const def = getPartDef(part.defId);
      let opacity = 1;
      let pickable = true;
      if (this.layer >= 0) {
        const above =
          def.cells.length === 0
            ? part.pos.y > this.layer
            : def.cells.every(
                (c) => part.pos.y + rotateVec(part.orient, c).y > this.layer,
              );
        if (above) {
          opacity = 0.12;
          pickable = false;
        }
      }
      const mesh = buildPartMesh(def, part, opacity);
      mesh.userData.editorPickable = pickable;
      mesh.traverse((object) => {
        object.userData.editorPickable = pickable;
      });
      if (this.selected.has(part.id)) {
        mesh.traverse((o) => {
          const m = o as THREE.Mesh;
          // Only materials that actually have an emissive uniform (Lambert);
          // forcing one onto MeshBasicMaterial crashes the Three renderer.
          if (
            m.isMesh &&
            (m.material as THREE.MeshLambertMaterial).isMeshLambertMaterial
          ) {
            const mat = (m.material as THREE.MeshLambertMaterial).clone();
            mat.emissive = new THREE.Color(0x2b4d17);
            mat.emissiveIntensity = 1;
            m.material = mat;
          }
        });
      }
      this.partsGroup.add(mesh);
    }
  }

  /**
   * Catalog parts this build uses that the player does not own. Deliberately
   * filtered through `isUnlocked` rather than the raw profile list, so a part
   * that costs nothing to unlock never reads as locked and strands an
   * otherwise legal build on the bench.
   */
  private lockedParts(): string[] {
    return lockedDefIdsFor(this.bp, this.profile.unlockedDefIds).filter(
      (defId) => !this.isUnlocked(defId),
    );
  }

  private refreshAnalysis(): void {
    const report = analyzeVehicle(this.bp, getPartDef);
    const validation = validateBlueprint(this.bp, getPartDef);
    this.ui.setBuildSummary(report, validation.errors, report.warnings);
    // A shared build arrives intact even when it names parts the player has
    // not bought; those hold it off the field until they are, which keeps
    // sharing frictionless without letting it skip progression.
    const locked = this.lockedParts();
    const blockedBy = validation.errors.map((e) => e.message);
    if (locked.length > 0) {
      blockedBy.push(
        `Locked parts: ${locked.map((defId) => getPartDef(defId).name).join(', ')}`,
      );
    }
    this.ui.setTestDriveEnabled(
      validation.errors.length === 0 &&
        locked.length === 0 &&
        this.bp.parts.length > 0,
      blockedBy,
    );
    this.refreshOverlays();
  }

  private copyShareText(text: string, kind: 'code' | 'link'): void {
    const label = kind === 'code' ? 'Build code' : 'Share link';
    // execCommand is deprecated but remains the only copy path on insecure
    // origins and older mobile browsers, where navigator.clipboard is absent.
    const fallback = (): boolean => {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      area.remove();
      return ok;
    };
    const done = (ok: boolean): void => {
      this.ui.setStatus(ok ? `${label} copied` : `Could not copy ${label}`);
    };
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      done(fallback());
      return;
    }
    void clipboard.writeText(text).then(
      () => done(true),
      () => done(fallback()),
    );
  }

  /**
   * Load a build from a pasted code or share link. The player chooses where it
   * lands; a decode failure never opens the dialog.
   */
  async importShareCode(input: string): Promise<void> {
    if (!input.trim()) return;
    let imported: VehicleBlueprint;
    try {
      imported = decodeShareCode(extractShareCode(input));
    } catch (error) {
      this.ui.setStatus(
        error instanceof ShareCodeError
          ? `Could not read that build code: ${error.message}`
          : 'Could not read that build code',
      );
      return;
    }
    const choice = await this.ui.askShareImportTarget(imported.name);
    if (choice === 'cancel') return;
    // A fresh id keeps the copy distinct from the sharer's build, and the
    // suffixed name means importing can never quietly overwrite a save slot.
    const name =
      choice === 'new-slot'
        ? sharedSlotName(imported.name, Object.keys(this.slots()))
        : this.bp.name;
    // Zero refund, unlike New Garage: importing is free, and the outgoing
    // build is not sold. Refunding here would hand back the value of a build
    // that "load as new slot" leaves sitting in its own save slot.
    const previousSelection = [...this.selected];
    this.selected.clear();
    if (
      !this.exec(
        replaceBlueprintCommand(
          { ...imported, id: crypto.randomUUID(), name },
          0,
          'Import shared build',
        ),
      )
    ) {
      for (const partId of previousSelection) this.selected.add(partId);
      this.refreshSelectionUI();
      this.ui.setStatus('Could not import that build');
      return;
    }
    const locked = this.lockedParts();
    this.ui.setStatus(
      locked.length > 0
        ? `Imported "${imported.name}" — buy ${locked.length} locked part${locked.length === 1 ? '' : 's'} to drive it`
        : `Imported "${imported.name}"`,
    );
  }

  private refreshOverlays(): void {
    const report = analyzeVehicle(this.bp, getPartDef);
    const connections = deriveConnections(this.bp, getPartDef);
    this.overlays.rebuild(
      this.bp,
      getPartDef,
      report,
      connections,
      this.toggles,
      this.selected,
    );
  }

  /** Debug seam helpers (used by Playwright). */
  debugPlace(
    defId: string,
    pos: Vec3i,
    orient = 0,
    config: PartConfig = {},
  ): { ok: boolean; issues: string[] } {
    let cost: number;
    try {
      cost = placeCost(defId);
    } catch {
      return { ok: false, issues: [`UNKNOWN_PART: ${defId}`] };
    }
    if (!this.isUnlocked(defId)) {
      this.deny(`${getPartDef(defId).name} is locked`);
      return { ok: false, issues: [`LOCKED_PART: ${defId}`] };
    }
    const def = getPartDef(defId);
    const baseConfig = { ...defaultConfigForDef(def), ...config };
    delete baseConfig.level;
    const result = canPlacePart(
      this.bp,
      getPartDef,
      defId,
      pos,
      orient,
      baseConfig,
    );
    if (!result.ok) {
      return {
        ok: false,
        issues: result.issues.map((issue) => `${issue.code}: ${issue.message}`),
      };
    }
    if (!canAfford(this.profile.money, cost)) {
      this.deny(`Not enough money — need $${cost}`);
      return { ok: false, issues: [`INSUFFICIENT_FUNDS: need $${cost}`] };
    }
    const part: PlacedPart = {
      id: nextPartId(this.bp),
      defId,
      pos,
      orient,
      config: baseConfig,
    };
    if (!this.exec(placeCommand(part, -cost))) {
      return { ok: false, issues: ['ECONOMY_DENIED: purchase failed'] };
    }
    return { ok: true, issues: [] };
  }

  debugConfigure(pos: Vec3i, config: PartConfig): boolean {
    const occ = buildOccupancy(this.bp);
    const id = occ.get(`${pos.x},${pos.y},${pos.z}`);
    if (!id) return false;
    const part = getPart(this.bp, id);
    if (!part) return false;
    if (config.level !== undefined) {
      this.deny('Use buyUpgrade(partId) to increase a part level');
      return false;
    }
    return this.exec(updateConfigCommand(id, { ...part.config, ...config }));
  }

  debugUndo(): void {
    this.undo();
  }

  debugRedo(): void {
    this.redo();
  }

  debugBuyUpgrade(partId: string): boolean {
    return this.buyUpgrade(partId);
  }

  debugSellPart(partId: string): boolean {
    return this.sellPart(partId);
  }

  debugUnlockPart(defId: string): boolean {
    return this.unlockPart(defId);
  }

  /** Selects a part by id so headless checks can drive the inspector UI. */
  debugSelectPart(partId: string): boolean {
    if (!this.bp.parts.some((part) => part.id === partId)) return false;
    this.selectOnly(partId);
    return true;
  }
}

/** Fill missing persistent wheel defaults without freezing derived steering. */
export function withAutomaticWheelConfigs(
  bp: VehicleBlueprint,
): VehicleBlueprint {
  const layout = deriveAutomaticWheelLayout(bp, getPartDef);
  let changed = false;
  const parts = bp.parts.map((part) => {
    if (!getPartDef(part.defId).wheel) return part;
    const config = { ...part.config };
    if (config.driven === undefined) {
      config.driven = layout.drivenPartIds.has(part.id);
    }
    if (config.braking === undefined) config.braking = true;
    if (config.steerInverted === undefined) config.steerInverted = false;
    if (
      Object.keys(config).every(
        (key) =>
          config[key as keyof PartConfig] ===
          part.config[key as keyof PartConfig],
      )
    ) {
      return part;
    }
    changed = true;
    return { ...part, config };
  });
  return changed ? { ...bp, parts } : bp;
}

function wheelLayoutInputsChanged(
  before: VehicleBlueprint,
  after: VehicleBlueprint,
): boolean {
  const relevant = (bp: VehicleBlueprint): string[] =>
    bp.parts
      .filter((part) => {
        const def = getPartDef(part.defId);
        return def.wheel !== undefined;
      })
      .map(
        (part) =>
          `${part.id}|${part.defId}|${part.pos.x},${part.pos.y},${part.pos.z}`,
      )
      .sort();
  const beforeLayout = relevant(before);
  const afterLayout = relevant(after);
  return (
    beforeLayout.length !== afterLayout.length ||
    beforeLayout.some((value, index) => value !== afterLayout[index])
  );
}

function disposeObjectResources(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line))
      return;
    const renderable = object as THREE.Mesh | THREE.Line;
    geometries.add(renderable.geometry);
    const renderableMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : [renderable.material];
    for (const material of renderableMaterials) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}
