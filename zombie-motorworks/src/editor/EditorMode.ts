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
import {
  buildOccupancy,
  getPart,
  nextPartId,
} from '../core/blueprint.ts';
import { canPlacePart, validateBlueprint } from '../core/placement.ts';
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
import { Overlays, defaultToggles, type OverlayToggles } from './overlays.ts';
import { buildEditorUI, type EditorUI } from './ui.ts';
import { TutorialOverlay } from './TutorialOverlay.ts';
import { createTutorialBlueprint, TUTORIAL_STEPS, tutorialProgress } from '../core/tutorial.ts';
import { getEffectiveDef } from '../core/upgrades.ts';
import { deriveAutomaticWheelLayout } from '../core/wheelLayout.ts';
import {
  canAfford,
  nextUpgrade,
  placeCost,
  sellRefund,
  unlockCost,
  type RunState,
} from '../core/economy.ts';
import type { PlayerProfile } from '../core/profile.ts';

export const BLUEPRINT_STORAGE_KEY = 'scraprig.blueprints.v1';
const TUTORIAL_DONE_KEY = 'scraprig.tutorial-done';

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
      }
    : {};
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

export interface EditorModeContext {
  history?: CommandHistory;
  view?: EditorViewState;
  profile: PlayerProfile;
  persistProfile(): void;
  onMenu(): void;
  notice?: string;
  runContext?: RunState;
  runSummary?: { wavesSurvived: number; moneyEarned: number };
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
  private ghostTarget: { pos: Vec3i; valid: boolean; message: string } | null = null;
  private readonly history: CommandHistory;
  private bp: VehicleBlueprint;
  private selected = new Set<string>();
  private symmetry = false;
  private layer = -1;
  private readonly toggles: OverlayToggles = { ...defaultToggles(), com: true, contacts: true, supportPolygon: true, connections: false, arcs: false };
  private ui: EditorUI;
  private tutorialOverlay: TutorialOverlay | null = null;
  private tutorialActive = false;
  private pointerDown: { x: number; y: number } | null = null;
  private lastPointer: { x: number; y: number } | null = null;
  private eraseArmed = false;
  private disposed = false;
  private explicitRenamePending = false;
  private readonly profile: PlayerProfile;
  private readonly persistProfile: () => void;
  private readonly runContext: RunState | undefined;
  private readonly runSummary: { wavesSurvived: number; moneyEarned: number } | undefined;
  private readonly keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(
    container: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    initial: VehicleBlueprint,
    private readonly onTestDrive: (bp: VehicleBlueprint) => void,
    private readonly onFightZombies: (bp: VehicleBlueprint) => void,
    context: EditorModeContext,
  ) {
    this.bp = initial;
    this.profile = context.profile;
    this.persistProfile = context.persistProfile;
    this.runContext = context.runContext;
    this.runSummary = context.runSummary;
    this.history = context.history ?? new CommandHistory((moneyDelta) => this.mutateMoney(moneyDelta));
    this.scene.background = new THREE.Color(0x1a1e26);
    this.scene.add(new THREE.HemisphereLight(0xcfd8e8, 0x2a2620, 1.05));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(6, 10, 4);
    this.scene.add(dir);

    const aspect = container.clientWidth / container.clientHeight;
    this.persp = new THREE.PerspectiveCamera(55, aspect, 0.05, 200);
    this.persp.position.set(5, 4.5, 7);
    const oSize = 5;
    this.ortho = new THREE.OrthographicCamera(-oSize * aspect, oSize * aspect, oSize, -oSize, 0.05, 200);
    this.camera = this.persp;
    this.controls = new OrbitControls(this.persp, renderer.domElement);
    this.controls.target.set(0, 1, 0);
    this.controls.enableDamping = true;
    this.raycaster.params.Line.threshold = 0;

    // Grid + bounds
    const gridW = (GRID_MAX.x - GRID_MIN.x + 1) * CELL_SIZE;
    const gridD = (GRID_MAX.z - GRID_MIN.z + 1) * CELL_SIZE;
    const grid = new THREE.GridHelper(Math.max(gridW, gridD), Math.max(GRID_MAX.x - GRID_MIN.x + 1, GRID_MAX.z - GRID_MIN.z + 1), 0x39434f, 0x272d36);
    grid.position.y = 0.001;
    this.scene.add(grid);
    const bounds = new THREE.Box3(
      new THREE.Vector3(GRID_MIN.x * CELL_SIZE, GRID_MIN.y * CELL_SIZE, GRID_MIN.z * CELL_SIZE),
      new THREE.Vector3((GRID_MAX.x + 1) * CELL_SIZE, (GRID_MAX.y + 1) * CELL_SIZE, (GRID_MAX.z + 1) * CELL_SIZE),
    );
    const boundsHelper = new THREE.Box3Helper(bounds, 0x2f3a48);
    this.scene.add(boundsHelper);

    this.scene.add(this.partsGroup);
    this.scene.add(this.overlays.group);

    this.ui = buildEditorUI(container, PART_CATALOG, {
      onBuyPart: (defId) => this.buyInventoryPart(defId),
      onArmPart: (defId) => this.armGhost(defId),
      onNew: () => this.resetBlueprint(this.createNewBlueprint(), 'Start new build'),
      onMenu: context.onMenu,
      onRename: (name) => {
        const pendingBefore = this.explicitRenamePending;
        this.explicitRenamePending ||= name !== this.bp.name;
        if (!this.exec(
          replaceBlueprintCommand({ ...this.bp, name }, 0, 'Rename build'),
        )) this.explicitRenamePending = pendingBefore;
      },
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onSymmetryToggle: (on) => {
        this.symmetry = on;
      },
      onView: (v) => this.setView(v),
      onLayerChange: (l) => {
        this.layer = l;
        this.rebuildMeshes();
      },
      onTestDrive: () => {
        const report = validateBlueprint(this.bp, getPartDef);
        if (report.errors.length === 0) {
          if (this.tutorialActive) {
            localStorage.setItem(TUTORIAL_DONE_KEY, '1');
            this.stopTutorial();
          }
          this.onTestDrive(this.bp);
        }
      },
      onFightZombies: () => {
        const report = validateBlueprint(this.bp, getPartDef);
        if (report.errors.length === 0) {
          if (this.tutorialActive) {
            localStorage.setItem(TUTORIAL_DONE_KEY, '1');
            this.stopTutorial();
          }
          this.onFightZombies(this.bp);
        }
      },
      onStartTutorial: () => this.startTutorial(),
      onConfigChange: (partId, key, value) => this.changeConfig(partId, key, value),
      onUpgradePart: (partId) => this.buyUpgrade(partId),
      onDeleteSelected: () => this.deleteSelected(),
      onRotateSelected: (axis) => this.rotateSelected(axis),
      onToggleErase: () => this.toggleErase(),
      onCancelTool: () => this.disarmTool(),
    });

    renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    renderer.domElement.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.keyHandler);

    if (context.view) {
      this.persp.position.set(context.view.cameraPos.x, context.view.cameraPos.y, context.view.cameraPos.z);
      this.controls.target.set(context.view.target.x, context.view.target.y, context.view.target.z);
      this.layer = context.view.layer;
    }
    this.ui.setRunContext(this.runContext?.wave, this.runSummary);
    this.refresh();
    if (context.notice) this.ui.setNotice(context.notice);
  }

  viewState(): EditorViewState {
    return {
      cameraPos: { x: this.persp.position.x, y: this.persp.position.y, z: this.persp.position.z },
      target: { x: this.controls.target.x, y: this.controls.target.y, z: this.controls.target.z },
      layer: this.layer,
    };
  }

  // ---------- rendering loop ----------

  update(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.keyHandler);
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
      parts: [{ id: 'p1', defId: 'chassis-core', pos: { x: 0, y: 1, z: 0 }, orient: 0, config: {} }],
    };
  }

  private resetBlueprint(next: VehicleBlueprint, label: string): boolean {
    const refund = this.bp.parts.reduce(
      (total, part) =>
        total + (getPartDef(part.defId).isRoot ? 0 : sellRefund(part)),
      0,
    );
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

  /** Start the guided build with its own fresh blueprint. */
  startTutorial(): void {
    this.tutorialOverlay?.dispose();
    this.tutorialOverlay = null;
    this.tutorialActive = false;
    if (!this.resetBlueprint(createTutorialBlueprint(), 'Start tutorial build'))
      return;
    this.tutorialActive = true;
    this.tutorialOverlay = new TutorialOverlay(this.ui.root, this.ui, () => this.stopTutorial());
    this.tutorialOverlay.update(this.bp, getPartDef);
  }

  stopTutorial(): void {
    this.tutorialOverlay?.dispose();
    this.tutorialOverlay = null;
    this.tutorialActive = false;
    this.ui.highlightPaletteButton(null);
  }

  debugTutorialState(): { active: boolean; stepIndex: number; total: number } {
    return {
      active: this.tutorialActive,
      stepIndex: this.tutorialActive ? tutorialProgress(this.bp, getPartDef) : 0,
      total: TUTORIAL_STEPS.length,
    };
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
    this.controls = new OrbitControls(this.camera as THREE.PerspectiveCamera, this.renderer.domElement);
    this.controls.target.set(0, 1, 0);
    this.controls.enableDamping = true;
    this.controls.enableRotate = v === 'persp';
  }

  // ---------- blueprint changes ----------

  private exec(cmd: EditorCommand): boolean {
    if (!this.canApplyMoneyDelta(cmd.moneyDelta)) {
      this.deny(cmd.moneyDelta < 0
        ? `Not enough money — need $${-cmd.moneyDelta}`
        : 'That transaction would make the wallet invalid');
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
    try {
      const label = this.history.undoLabels.at(-1) ?? '';
      const before = this.bp;
      const prev = this.history.undo(this.bp);
      if (prev) {
        this.bp = prev;
        if (this.isInventoryPlacementLabel(label)) {
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
    try {
      const label = this.history.redoLabels.at(-1) ?? '';
      const before = this.bp;
      const next = this.history.redo(this.bp);
      if (next) {
        this.bp = next;
        if (this.isInventoryPlacementLabel(label)) {
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
    if (!this.canApplyMoneyDelta(moneyDelta)) throw new Error('Insufficient funds');
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
    this.ui.deny(message);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private inventory(): Record<string, number> {
    this.profile.inventory ??= {};
    return this.profile.inventory;
  }

  private isInventoryPlacementLabel(label: string): boolean {
    return label.startsWith('Place ') || label === 'symmetric place';
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
    for (const defId of new Set([...beforeCounts.keys(), ...afterCounts.keys()])) {
      const inventoryDelta = (beforeCounts.get(defId) ?? 0) - (afterCounts.get(defId) ?? 0);
      if (inventoryDelta === 0) continue;
      const nextCount = Math.max(0, (stock[defId] ?? 0) + inventoryDelta);
      if (nextCount === 0) delete stock[defId];
      else stock[defId] = nextCount;
    }
    this.persistProfile();
  }

  private changeConfig(partId: string, key: string, value: boolean | string): void {
    if (key === 'level') {
      this.deny('Use Upgrade to increase a part level');
      return;
    }
    const part = getPart(this.bp, partId);
    if (!part) return;
    const config: PartConfig = { ...part.config, [key]: value };
    this.exec(updateConfigCommand(partId, config));
    this.selectOnly(partId);
  }

  private deleteSelected(): void {
    const parts = [...this.selected]
      .map((id) => getPart(this.bp, id))
      .filter((part): part is PlacedPart => part !== undefined && !getPartDef(part.defId).isRoot);
    if (parts.length === 0) {
      if ([...this.selected].some((id) => {
        const part = getPart(this.bp, id);
        return part ? getPartDef(part.defId).isRoot : false;
      })) {
        this.ui.setStatus("Truck Heart can't be deleted");
      }
      return;
    }
    const refund = parts.reduce((total, part) => total + sellRefund(part), 0);
    const sold = this.exec(batchCommand(
      'sell selection',
      parts.map((part) => removeCommand(part.id, sellRefund(part))),
    ));
    if (sold) {
      this.selected.clear();
      this.refresh();
      this.ui.setStatus(`Sold ${parts.length} part${parts.length === 1 ? '' : 's'} +$${refund}`);
    }
  }

  private buyUpgrade(partId: string): boolean {
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
    const upgraded = this.exec(updateConfigCommand(
      part.id,
      { ...part.config, level: upgrade.targetLevel },
      -upgrade.price,
    ));
    if (upgraded) {
      this.selectOnly(part.id);
      this.ui.setStatus(`${getPartDef(part.defId).name} upgraded to level ${upgrade.targetLevel} (-$${upgrade.price})`);
    }
    return upgraded;
  }

  private sellPart(partId: string): boolean {
    const part = getPart(this.bp, partId);
    if (!part) {
      this.deny(`Unknown part: ${partId}`);
      return false;
    }
    const def = getPartDef(part.defId);
    if (def.isRoot) {
      this.deny("Truck Heart can't be sold");
      return false;
    }
    const refund = sellRefund(part);
    if (!this.exec(removeCommand(part.id, refund))) return false;
    this.selected.delete(part.id);
    this.refreshSelectionUI();
    this.rebuildMeshes();
    this.ui.setStatus(`Sold ${def.name} +$${refund}`);
    return true;
  }

  private rotateSelected(axis: 'y' | 'x'): void {
    const first = [...this.selected][0];
    if (!first) return;
    const part = getPart(this.bp, first);
    if (!part) return;
    const step = axis === 'y' ? orientationFromSteps(0, 1, 0) : orientationFromSteps(1, 0, 0);
    let next = composeOrientations(step, part.orient);
    const def = getPartDef(part.defId);
    for (let i = 0; i < 4; i++) {
      if (!def.allowedOrientations || def.allowedOrientations.includes(next)) break;
      next = composeOrientations(step, next);
    }
    const without = { ...this.bp, parts: this.bp.parts.filter((p) => p.id !== part.id) };
    const ok = canPlacePart(without, getPartDef, part.defId, part.pos, next, part.config).ok;
    if (ok) this.exec(rotateCommand(part.id, next));
    else this.ui.setStatus('Rotation blocked here');
    this.refreshGhostAtLastPointer();
  }

  // ---------- ghost placement ----------

  private armGhost(defId: string): void {
    if ((this.inventory()[defId] ?? 0) <= 0) {
      this.deny(`No ${getPartDef(defId).name} in inventory`);
      return;
    }
    this.eraseArmed = false;
    this.ghost = { defId, orient: 0 };
    this.ui.setArmedPart(defId);
    this.selected.clear();
    this.refreshSelectionUI();
  }

  private isUnlocked(defId: string): boolean {
    return unlockCost(defId) === 0 || this.profile.unlockedDefIds.includes(defId);
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
      this.profile.unlockedDefIds.splice(0, this.profile.unlockedDefIds.length, ...previousUnlocks);
      this.deny(`Unlock could not be saved: ${this.errorMessage(err)}`);
      return false;
    }
    this.refreshProfile();
    this.ui.setStatus(`Unlocked ${def.name} (-$${price})`);
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
      defId === 'driver-seat' &&
      (this.inventory()[defId] ?? 0) +
        this.bp.parts.filter((part) => part.defId === defId).length >=
        1
    ) {
      this.deny('Driver Seat limit reached - only one can be owned or installed');
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
    this.profile.money -= def.cost;
    stock[defId] = previousCount + 1;
    try {
      this.persistProfile();
    } catch (err) {
      this.profile.money = previousMoney;
      const restoredStock = this.inventory();
      if (previousCount === 0) delete restoredStock[defId];
      else restoredStock[defId] = previousCount;
      this.deny(`Purchase could not be saved: ${this.errorMessage(err)}`);
      return false;
    }
    this.refreshProfile();
    this.ui.setStatus(`Bought ${def.name} (-$${def.cost})`);
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

  private toggleErase(): void {
    if (this.eraseArmed) {
      this.disarmTool();
      return;
    }
    this.disarmGhost();
    this.eraseArmed = true;
    this.ui.setArmedPart('erase');
    this.ui.setStatus('Erase: click a part to remove it');
  }

  private disarmTool(): void {
    this.eraseArmed = false;
    this.disarmGhost();
  }

  private refreshGhostAtLastPointer(): void {
    if (this.lastPointer) this.updateGhost(this.lastPointer.x, this.lastPointer.y);
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

    let target: Vec3i | null = null;
    let orient = this.ghost.orient;

    const hits = this.raycaster.intersectObjects(this.partsGroup.children, true);
    const hit = hits.find((candidate) => this.isPlacementSurfaceHit(candidate));
    if (hit && hit.face) {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).round();
      const p = hit.point;
      if (isFaceMounted) {
        const host = new THREE.Vector3(p.x - n.x * 0.02, p.y - n.y * 0.02, p.z - n.z * 0.02);
        target = this.toCell(host);
        // Orient the armour socket ('pz' canonical) toward the hit face.
        orient = this.orientFacing({ x: n.x, y: n.y, z: n.z });
      } else {
        const adj = new THREE.Vector3(p.x + n.x * 0.02, p.y + n.y * 0.02, p.z + n.z * 0.02);
        target = this.toCell(adj);
      }
    } else {
      // Ground / layer plane.
      const planeY = (this.layer >= 0 ? this.layer : 0) * CELL_SIZE + 0.001;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
      const pt = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(plane, pt) && !isFaceMounted) {
        target = this.toCell(new THREE.Vector3(pt.x, planeY + 0.02, pt.z));
      }
    }

    if (!target) {
      this.ui.ghostTip.style.display = 'none';
      if (this.ghostMesh) this.ghostMesh.visible = false;
      this.ghostTarget = null;
      return;
    }

    const result = canPlacePart(this.bp, getPartDef, this.ghost.defId, target, orient, {});
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
      const placed: PlacedPart = { id: '__ghost', defId: this.ghost.defId, pos: { x: 0, y: 0, z: 0 }, orient, config: {} };
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
    this.ghostMesh.position.set(target.x * CELL_SIZE, target.y * CELL_SIZE, target.z * CELL_SIZE);

    const tip = this.ui.ghostTip;
    if (!result.ok && result.issues.length > 0) {
      tip.textContent = result.issues[0].message + (result.issues[0].suggestion ? ` — ${result.issues[0].suggestion}` : '');
      tip.style.display = 'block';
      tip.style.left = `${clientX + 14}px`;
      tip.style.top = `${clientY + 14}px`;
    } else {
      tip.style.display = 'none';
    }
  }

  private orientFacing(normal: Vec3i): number {
    // Find an orientation sending +Z to the given axis normal.
    for (let o = 0; o < 24; o++) {
      const v = rotateVec(o, { x: 0, y: 0, z: 1 });
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
    const placement = canPlacePart(this.bp, getPartDef, this.ghost.defId, pos, this.ghost.orient, {});
    if (!placement.ok) {
      this.ghostTarget = { pos, valid: false, message: placement.issues[0]?.message ?? '' };
      this.refreshGhostAtLastPointer();
      return;
    }
    const id = nextPartId(this.bp);
    const config = defaultConfigForDef(def);
    const part: PlacedPart = { id, defId: this.ghost.defId, pos, orient: this.ghost.orient, config };
    const cmds: EditorCommand[] = [placeCommand(part)];

    if (this.symmetry && !def.unique && available >= 2) {
      const mPos = mirrorCellX(pos);
      if (mPos.x !== pos.x || def.cells.length === 0) {
        const after = cmds[0].apply(this.bp);
        const mirror = mirrorCommand(id, nextPartId(after));
        // Validate the mirrored placement before batching.
        try {
          const test = mirror.apply(after);
          const report = validateBlueprint(test, getPartDef);
          const overlaps = report.errors.some((e) => e.code === 'OVERLAP' || e.code === 'OUT_OF_BOUNDS');
          if (!overlaps) cmds.push(mirror);
        } catch {
          /* mirrored spot invalid — place single */
        }
      }
    }
    const usedCount = cmds.length;
    if (!this.changeInventory(part.defId, -usedCount)) return;
    if (this.exec(cmds.length > 1 ? batchCommand('symmetric place', cmds) : cmds[0])) {
      this.disarmGhost();
      this.selectOnly(id);
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
    const partId = this.partIdAtIntersections(this.raycaster.intersectObjects(this.partsGroup.children, true));
    if (!additive) this.selected.clear();
    if (partId) {
      if (additive && this.selected.has(partId)) this.selected.delete(partId);
      else this.selected.add(partId);
    }
    this.refreshSelectionUI();
    this.rebuildMeshes();
  }

  private isPlacementSurfaceHit(hit: THREE.Intersection<THREE.Object3D>): boolean {
    const mesh = hit.object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || !hit.face || mesh.userData.placementSurface !== true) return false;
    let object: THREE.Object3D | null = mesh;
    while (object) {
      if (object.userData.editorPickable === false || !object.visible) return false;
      object = object.parent;
    }
    return true;
  }

  private partIdAtIntersections(hits: THREE.Intersection<THREE.Object3D>[]): string | null {
    const hit = hits.find((candidate) => this.isPlacementSurfaceHit(candidate));
    if (!hit) return null;
    let object: THREE.Object3D | null = hit.object;
    while (object && !object.name.startsWith('part:')) object = object.parent;
    return object ? object.name.slice(5) : null;
  }

  private partIdAt(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    ), this.camera);
    return this.partIdAtIntersections(this.raycaster.intersectObjects(this.partsGroup.children, true));
  }

  private selectOnly(partId: string): void {
    this.selected.clear();
    this.selected.add(partId);
    this.refreshSelectionUI();
    this.rebuildMeshes();
  }

  private refreshSelectionUI(): void {
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
      .filter((selectedPart): selectedPart is PlacedPart =>
        selectedPart !== undefined && !getPartDef(selectedPart.defId).isRoot);
    const selectionRefund = selectedParts.reduce(
      (total, selectedPart) => total + sellRefund(selectedPart),
      0,
    );
    this.ui.setSelectedPart(def, part.id, level, getEffectiveDef(part), {
      nextUpgradePrice: upgrade?.price ?? null,
      canUpgrade: upgrade !== null && canAfford(this.profile.money, upgrade.price),
      sellRefund: selectionRefund,
    }, part.config, def.wheel
      ? deriveAutomaticWheelLayout(this.bp, getPartDef).steeringPartIds.has(part.id)
      : undefined);
    this.refreshOverlays();
  }

  // ---------- pointer/keyboard ----------

  private onPointerMove = (e: PointerEvent): void => {
    if (this.disposed) return;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.updateGhost(e.clientX, e.clientY);
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDown = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointerDown) return;
    const moved = Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y);
    this.pointerDown = null;
    if (moved > 6) return; // drag = camera, not click
    if (e.button === 2) {
      this.deleteAt(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0) return;
    if (this.eraseArmed) this.deleteAt(e.clientX, e.clientY);
    else if (this.ghost) this.placeGhost();
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
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
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
        if (this.ghost) {
          this.ghost.orient = this.nextAllowedOrient(this.ghost.defId, this.ghost.orient, 'y');
          this.refreshGhostAtLastPointer();
        } else this.rotateSelected('y');
        break;
      case 'f':
        if (this.ghost) {
          this.ghost.orient = this.nextAllowedOrient(this.ghost.defId, this.ghost.orient, 'x');
          this.refreshGhostAtLastPointer();
        } else this.rotateSelected('x');
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

  private nextAllowedOrient(defId: string, current: number, axis: 'y' | 'x'): number {
    const def = getPartDef(defId);
    const step = axis === 'y' ? orientationFromSteps(0, 1, 0) : orientationFromSteps(1, 0, 0);
    let next = composeOrientations(step, current);
    for (let i = 0; i < 24; i++) {
      if (!def.allowedOrientations || def.allowedOrientations.includes(next)) return next;
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
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return {};
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] =>
          typeof entry[1] === 'string'),
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
    );
    this.refreshSelectionUI();
    if (this.tutorialActive) this.tutorialOverlay?.update(this.bp, getPartDef);
  }

  /** Refresh profile-backed UI after an App-side reward or debug grant. */
  refreshProfile(): void {
    this.ui.setEconomy(
      this.profile.money,
      this.profile.unlockedDefIds,
      this.inventory(),
      this.bp.parts.map((part) => part.defId),
    );
    this.refreshSelectionUI();
  }

  private rebuildMeshes(): void {
    disposeObjectResources(this.partsGroup);
    this.partsGroup.clear();
    for (const part of this.bp.parts) {
      const def = getPartDef(part.defId);
      let opacity = 1;
      let pickable = true;
      if (this.layer >= 0) {
        const above = def.cells.length === 0 ? part.pos.y > this.layer :
          def.cells.every((c) => part.pos.y + rotateVec(part.orient, c).y > this.layer);
        if (above) {
          opacity = 0.12;
          pickable = false;
        }
      }
      const mesh = buildPartMesh(def, part, opacity);
      mesh.userData.editorPickable = pickable;
      mesh.traverse((object) => { object.userData.editorPickable = pickable; });
      if (this.selected.has(part.id)) {
        mesh.traverse((o) => {
          const m = o as THREE.Mesh;
          // Only materials that actually have an emissive uniform (Lambert);
          // forcing one onto MeshBasicMaterial crashes the Three renderer.
          if (m.isMesh && (m.material as THREE.MeshLambertMaterial).isMeshLambertMaterial) {
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

  private refreshAnalysis(): void {
    const report = analyzeVehicle(this.bp, getPartDef);
    const validation = validateBlueprint(this.bp, getPartDef);
    this.ui.setBuildSummary(report, validation.errors, report.warnings);
    this.ui.setTestDriveEnabled(
      validation.errors.length === 0 && this.bp.parts.length > 0,
      validation.errors.map((e) => e.message),
    );
    this.refreshOverlays();
  }

  private refreshOverlays(): void {
    const report = analyzeVehicle(this.bp, getPartDef);
    const connections = deriveConnections(this.bp, getPartDef);
    this.overlays.rebuild(this.bp, getPartDef, report, connections, this.toggles, this.selected);
  }

  /** Debug seam helpers (used by Playwright). */
  debugPlace(defId: string, pos: Vec3i, orient = 0, config: PartConfig = {}): { ok: boolean; issues: string[] } {
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
    const result = canPlacePart(this.bp, getPartDef, defId, pos, orient, baseConfig);
    if (!result.ok) {
      return { ok: false, issues: result.issues.map((issue) => `${issue.code}: ${issue.message}`) };
    }
    if (!canAfford(this.profile.money, cost)) {
      this.deny(`Not enough money — need $${cost}`);
      return { ok: false, issues: [`INSUFFICIENT_FUNDS: need $${cost}`] };
    }
    const part: PlacedPart = { id: nextPartId(this.bp), defId, pos, orient, config: baseConfig };
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
}

/** Fill missing persistent wheel defaults without freezing derived steering. */
export function withAutomaticWheelConfigs(bp: VehicleBlueprint): VehicleBlueprint {
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
    if (Object.keys(config).every((key) => config[key as keyof PartConfig] === part.config[key as keyof PartConfig])) {
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
        return def.wheel !== undefined || def.providesControl === true;
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
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line)) return;
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
