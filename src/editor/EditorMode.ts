/**
 * 3D vehicle editor: orbit/ortho cameras, layer slicing, ghost placement,
 * selection, symmetry, overlays, reversible commands, save/load.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PartConfig, PlacedPart, Vec3i, VehicleBlueprint } from '../core/types.ts';
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
  rotateCommand,
  updateConfigCommand,
  type EditorCommand,
} from '../core/commands.ts';
import { serializeBlueprint, deserializeBlueprint } from '../core/serialize.ts';
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

const STORAGE_KEY = 'scraprig.blueprints.v1';
const TUTORIAL_DONE_KEY = 'scraprig.tutorial-done';

interface GhostState {
  defId: string;
  orient: number;
}

/** Camera/layer state preserved across editor <-> chamber round trips. */
export interface EditorViewState {
  cameraPos: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  layer: number;
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
  private readonly keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(
    container: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    initial: VehicleBlueprint,
    private readonly onTestDrive: (bp: VehicleBlueprint) => void,
    restore?: { history?: CommandHistory; view?: EditorViewState },
  ) {
    this.bp = initial;
    this.history = restore?.history ?? new CommandHistory();
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
      onArmPart: (defId) => this.armGhost(defId),
      onSave: () => this.save(),
      onLoad: (slot) => this.load(slot),
      onNew: () => this.replaceBlueprint(this.createNewBlueprint()),
      onRename: (name) => {
        this.bp = { ...this.bp, name };
        this.refresh();
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
      onStartTutorial: () => this.startTutorial(),
      onConfigChange: (partId, key, value) => this.changeConfig(partId, key, value),
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

    if (restore?.view) {
      this.persp.position.set(restore.view.cameraPos.x, restore.view.cameraPos.y, restore.view.cameraPos.z);
      this.controls.target.set(restore.view.target.x, restore.view.target.y, restore.view.target.z);
      this.layer = restore.view.layer;
    }
    this.refreshSlots();
    this.refresh();
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

  private createNewBlueprint(): VehicleBlueprint {
    const bp = createEmptyBlueprint('new-rig');
    return {
      ...bp,
      parts: [{ id: 'p1', defId: 'chassis-core', pos: { x: 0, y: 1, z: 0 }, orient: 0, config: {} }],
    };
  }

  /** Start the guided build with its own fresh blueprint. */
  startTutorial(): void {
    this.tutorialOverlay?.dispose();
    this.tutorialOverlay = null;
    this.tutorialActive = true;
    this.replaceBlueprint(createTutorialBlueprint());
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
    try {
      this.bp = this.history.execute(this.bp, cmd);
      this.refresh();
      return true;
    } catch (err) {
      this.ui.setStatus(String(err));
      return false;
    }
  }

  private undo(): void {
    const prev = this.history.undo(this.bp);
    if (prev) {
      this.bp = prev;
      this.selected.clear();
      this.refresh();
    }
  }

  private redo(): void {
    const next = this.history.redo(this.bp);
    if (next) {
      this.bp = next;
      this.selected.clear();
      this.refresh();
    }
  }

  private changeConfig(partId: string, key: string, value: boolean | string): void {
    const part = getPart(this.bp, partId);
    if (!part) return;
    const config: PartConfig = { ...part.config, [key]: value };
    this.exec(updateConfigCommand(partId, config));
    this.selectOnly(partId);
  }

  private deleteSelected(): void {
    const ids = [...this.selected].filter((id) => {
      const p = getPart(this.bp, id);
      return p && !getPartDef(p.defId).isRoot;
    });
    if (ids.length === 0) {
      if ([...this.selected].some((id) => {
        const part = getPart(this.bp, id);
        return part ? getPartDef(part.defId).isRoot : false;
      })) {
        this.ui.setStatus("🔒 Truck Heart can't be deleted");
      }
      return;
    }
    this.exec(batchCommand('delete selection', ids.map((id) => removeCommand(id))));
    this.selected.clear();
    this.refresh();
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
    this.eraseArmed = false;
    this.ghost = { defId, orient: 0 };
    this.ui.setArmedPart(defId);
    this.selected.clear();
    this.refreshSelectionUI();
  }

  private disarmGhost(): void {
    this.ghost = null;
    this.ghostTarget = null;
    this.ui.setArmedPart(null);
    if (this.ghostMesh) {
      this.scene.remove(this.ghostMesh);
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
      if (this.ghostMesh) this.scene.remove(this.ghostMesh);
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
    const { pos } = this.ghostTarget;
    const def = getPartDef(this.ghost.defId);
    const placement = canPlacePart(this.bp, getPartDef, this.ghost.defId, pos, this.ghost.orient, {});
    if (!placement.ok) {
      this.ghostTarget = { pos, valid: false, message: placement.issues[0]?.message ?? '' };
      this.refreshGhostAtLastPointer();
      return;
    }
    const id = nextPartId(this.bp);
    const config: PartConfig = {};
    const part: PlacedPart = { id, defId: this.ghost.defId, pos, orient: this.ghost.orient, config };
    const cmds: EditorCommand[] = [placeCommand(part)];

    if (this.symmetry && !def.unique) {
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
    if (this.exec(cmds.length > 1 ? batchCommand('symmetric place', cmds) : cmds[0])) {
      this.disarmGhost();
      this.selectOnly(id);
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
    this.ui.setSelectedPart(def, part.id);
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
    if (getPartDef(part.defId).isRoot) {
      this.ui.setStatus("🔒 Truck Heart can't be deleted");
      return;
    }
    if (this.exec(removeCommand(id))) {
      this.selected.delete(id);
      this.refreshSelectionUI();
      this.rebuildMeshes();
    }
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
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  }

  private save(): void {
    const all = this.slots();
    all[this.bp.name] = serializeBlueprint(this.bp);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    this.refreshSlots();
    this.ui.setStatus(`Saved "${this.bp.name}"`);
  }

  private load(slot: string): void {
    const all = this.slots();
    const json = all[slot];
    if (!json) return;
    try {
      this.replaceBlueprint(deserializeBlueprint(json));
      this.ui.setStatus(`Loaded "${slot}"`);
    } catch (err) {
      this.ui.setStatus(`Load failed: ${String(err)}`);
    }
  }

  private refreshSlots(): void {
    this.ui.setSlots(Object.keys(this.slots()), this.bp.name);
  }

  // ---------- refresh ----------

  private refresh(): void {
    this.normalizeWheels();
    this.rebuildMeshes();
    this.refreshAnalysis();
    this.ui.setBlueprintName(this.bp.name);
    this.ui.setUndoRedo(this.history.canUndo, this.history.canRedo);
    this.refreshSelectionUI();
    if (this.tutorialActive) this.tutorialOverlay?.update(this.bp, getPartDef);
  }

  private rebuildMeshes(): void {
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
    this.ui.setBuildSummary(report.totalMassKg, report.rolloverRisk, validation.errors, report.warnings);
    this.ui.setTestDriveEnabled(
      validation.errors.length === 0 && this.bp.parts.length > 0,
      validation.errors.map((e) => e.message),
    );
    this.refreshOverlays();
  }

  private normalizeWheels(): void {
    const wheels = this.bp.parts.filter((part) => getPartDef(part.defId).wheel);
    if (wheels.length === 0) return;
    const minZ = Math.min(...wheels.map((wheel) => wheel.pos.z));
    const maxZ = Math.max(...wheels.map((wheel) => wheel.pos.z));
    const midpoint = (minZ + maxZ) / 2;
    const allSteer = minZ === maxZ;
    let changed = false;
    const parts = this.bp.parts.map((part) => {
      if (!getPartDef(part.defId).wheel) return part;
      const config: PartConfig = {
        ...part.config,
        driven: true,
        braking: true,
        steerInverted: false,
        suspensionPreset: 'standard',
        steering: allSteer || part.pos.z > midpoint,
      };
      const differs = Object.keys(config).some((key) => config[key as keyof PartConfig] !== part.config[key as keyof PartConfig]) ||
        Object.keys(part.config).some((key) => !(key in config));
      if (!differs) return part;
      changed = true;
      return { ...part, config };
    });
    if (changed) this.bp = { ...this.bp, parts };
  }

  private refreshOverlays(): void {
    const report = analyzeVehicle(this.bp, getPartDef);
    const connections = deriveConnections(this.bp, getPartDef);
    this.overlays.rebuild(this.bp, getPartDef, report, connections, this.toggles, this.selected);
  }

  /** Debug seam helpers (used by Playwright). */
  debugPlace(defId: string, pos: Vec3i, orient = 0, config: PartConfig = {}): { ok: boolean; issues: string[] } {
    const result = canPlacePart(this.bp, getPartDef, defId, pos, orient, config);
    if (result.ok) {
      const part: PlacedPart = { id: nextPartId(this.bp), defId, pos, orient, config };
      this.exec(placeCommand(part));
    }
    return { ok: result.ok, issues: result.issues.map((i) => `${i.code}: ${i.message}`) };
  }

  debugConfigure(pos: Vec3i, config: PartConfig): boolean {
    const occ = buildOccupancy(this.bp);
    const id = occ.get(`${pos.x},${pos.y},${pos.z}`);
    if (!id) return false;
    const part = getPart(this.bp, id);
    if (!part) return false;
    this.exec(updateConfigCommand(id, { ...part.config, ...config }));
    return true;
  }

  debugUndo(): void {
    this.undo();
  }

  debugRedo(): void {
    this.redo();
  }
}
