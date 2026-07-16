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
import { buildEditorUI, buildInspectorPanel, type EditorUI } from './ui.ts';

const STORAGE_KEY = 'scraprig.blueprints.v1';

interface GhostState {
  defId: string;
  orient: number;
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
  private ghostTarget: { pos: Vec3i; valid: boolean; message: string } | null = null;
  private readonly history = new CommandHistory();
  private bp: VehicleBlueprint;
  private selected = new Set<string>();
  private symmetry = false;
  private layer = -1;
  private viewMode: 'normal' | 'xray' | 'structure' = 'normal';
  private hideArmour = false;
  private hideShell = false;
  private toggles: OverlayToggles = defaultToggles();
  private ui: EditorUI;
  private pointerDown: { x: number; y: number } | null = null;
  private disposed = false;
  private readonly keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(
    container: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    initial: VehicleBlueprint,
    private readonly onTestDrive: (bp: VehicleBlueprint) => void,
  ) {
    this.bp = initial;
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
      onNew: () => this.replaceBlueprint(createEmptyBlueprint('new-rig')),
      onRename: (name) => {
        this.bp = { ...this.bp, name };
        this.refresh();
      },
      onDuplicateBlueprint: () => {
        this.bp = { ...this.bp, id: `${this.bp.id}-copy`, name: `${this.bp.name} copy` };
        this.save();
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
      onViewMode: (mode, hideArmour, hideShell) => {
        this.viewMode = mode;
        this.hideArmour = hideArmour;
        this.hideShell = hideShell;
        this.rebuildMeshes();
      },
      onOverlayToggle: (key, on) => {
        (this.toggles as unknown as Record<string, boolean>)[key] = on;
        this.refreshOverlays();
      },
      onTestDrive: () => {
        const report = validateBlueprint(this.bp, getPartDef);
        if (report.errors.length === 0) this.onTestDrive(this.bp);
      },
      onConfigChange: (partId, key, value) => this.changeConfig(partId, key, value),
      onDeleteSelected: () => this.deleteSelected(),
      onMirrorSelected: () => this.mirrorSelected(),
      onDuplicateSelected: () => this.duplicateSelected(),
      onRotateSelected: (axis) => this.rotateSelected(axis),
    });

    renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.keyHandler);

    this.refreshSlots();
    this.refresh();
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
    window.removeEventListener('keydown', this.keyHandler);
    this.controls.dispose();
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
    if (ids.length === 0) return;
    this.exec(batchCommand('delete selection', ids.map((id) => removeCommand(id))));
    this.selected.clear();
    this.refresh();
  }

  private mirrorSelected(): void {
    const cmds: EditorCommand[] = [];
    let bp = this.bp;
    for (const id of this.selected) {
      const part = getPart(bp, id);
      if (!part) continue;
      const newId = nextPartId(bp);
      const mirroredPos = mirrorCellX(part.pos);
      if (mirroredPos.x === part.pos.x) continue;
      const result = canPlacePart(bp, getPartDef, part.defId, mirroredPos, part.orient, part.config);
      if (!result.ok) continue;
      const cmd = mirrorCommand(id, newId);
      cmds.push(cmd);
      bp = cmd.apply(bp);
    }
    if (cmds.length > 0) this.exec(batchCommand('mirror selection', cmds));
  }

  private duplicateSelected(): void {
    // Duplicate armed as ghost: pick first selected part and arm its def.
    const first = [...this.selected][0];
    if (!first) return;
    const part = getPart(this.bp, first);
    if (!part) return;
    this.armGhost(part.defId);
    if (this.ghost) this.ghost.orient = part.orient;
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
  }

  // ---------- ghost placement ----------

  private armGhost(defId: string): void {
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
    this.ui.ghostTip.style.display = 'none';
  }

  private updateGhost(clientX: number, clientY: number): void {
    if (!this.ghost) return;
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
    const hit = hits.find((h) => (h.object as THREE.Object3D).visible);
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

    if (this.ghostMesh) this.scene.remove(this.ghostMesh);
    const placed: PlacedPart = { id: '__ghost', defId: this.ghost.defId, pos: target, orient, config: {} };
    this.ghostMesh = buildPartMesh(def, placed, 0.55);
    this.ghostMesh.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const m = (mesh.material as THREE.MeshLambertMaterial).clone();
        m.color.set(result.ok ? 0x5fd75f : 0xe05545);
        m.transparent = true;
        m.opacity = 0.55;
        mesh.material = m;
      }
    });
    this.scene.add(this.ghostMesh);

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
    if (!this.ghost || !this.ghostTarget || !this.ghostTarget.valid) return;
    const { pos } = this.ghostTarget;
    const def = getPartDef(this.ghost.defId);
    const id = nextPartId(this.bp);
    const config: PartConfig = def.wheel ? { braking: true, suspensionPreset: 'standard' } : {};
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
    this.exec(cmds.length > 1 ? batchCommand('symmetric place', cmds) : cmds[0]);
  }

  // ---------- selection ----------

  private selectAt(clientX: number, clientY: number, additive: boolean): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.partsGroup.children, true);
    const hit = hits.find((h) => h.object.visible);
    let partId: string | null = null;
    if (hit) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj && !obj.name.startsWith('part:')) obj = obj.parent;
      if (obj) partId = obj.name.slice(5);
    }
    if (!additive) this.selected.clear();
    if (partId) {
      if (additive && this.selected.has(partId)) this.selected.delete(partId);
      else this.selected.add(partId);
    }
    this.refreshSelectionUI();
    this.rebuildMeshes();
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
      this.ui.setInspector(null);
      this.refreshOverlays();
      return;
    }
    const part = getPart(this.bp, first);
    if (!part) return;
    const def = getPartDef(part.defId);
    this.ui.setInspector(
      buildInspectorPanel(def, part.id, part.config as Record<string, unknown>, {
        onConfigChange: (id: string, k: string, v: boolean | string) => this.changeConfig(id, k, v),
        onDeleteSelected: () => this.deleteSelected(),
        onMirrorSelected: () => this.mirrorSelected(),
        onDuplicateSelected: () => this.duplicateSelected(),
        onRotateSelected: (axis: 'y' | 'x') => this.rotateSelected(axis),
      }),
    );
    this.refreshOverlays();
  }

  // ---------- pointer/keyboard ----------

  private onPointerMove = (e: PointerEvent): void => {
    if (this.disposed) return;
    this.updateGhost(e.clientX, e.clientY);
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDown = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointerDown) return;
    const moved = Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y);
    this.pointerDown = null;
    if (moved > 6 || e.button !== 0) return; // drag = camera, not click
    if (this.ghost) this.placeGhost();
    else this.selectAt(e.clientX, e.clientY, e.shiftKey);
  };

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
    if ((e.ctrlKey || e.metaKey) && key === 'd') {
      e.preventDefault();
      this.duplicateSelected();
      return;
    }
    switch (key) {
      case 'escape':
        this.disarmGhost();
        this.selected.clear();
        this.refreshSelectionUI();
        this.rebuildMeshes();
        break;
      case 'r':
        if (this.ghost) {
          this.ghost.orient = this.nextAllowedOrient(this.ghost.defId, this.ghost.orient, 'y');
        } else this.rotateSelected('y');
        break;
      case 'f':
        if (this.ghost) {
          this.ghost.orient = this.nextAllowedOrient(this.ghost.defId, this.ghost.orient, 'x');
        } else this.rotateSelected('x');
        break;
      case 'delete':
      case 'backspace':
        this.deleteSelected();
        break;
      case 'm':
        this.mirrorSelected();
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
    this.rebuildMeshes();
    this.refreshAnalysis();
    this.ui.setBlueprintName(this.bp.name);
    this.ui.setUndoRedo(this.history.canUndo, this.history.canRedo);
  }

  private rebuildMeshes(): void {
    this.partsGroup.clear();
    for (const part of this.bp.parts) {
      const def = getPartDef(part.defId);
      if (this.viewMode === 'structure' && def.category !== 'structural') continue;
      if (this.hideArmour && def.armour && !def.armour.cosmetic) continue;
      if (this.hideShell && def.armour?.cosmetic) continue;
      let opacity = 1;
      if (this.viewMode === 'xray') opacity = 0.35;
      if (this.layer >= 0) {
        const above = def.cells.length === 0 ? part.pos.y > this.layer :
          def.cells.every((c) => part.pos.y + rotateVec(part.orient, c).y > this.layer);
        if (above) opacity = Math.min(opacity, 0.12);
      }
      const mesh = buildPartMesh(def, part, opacity);
      if (this.selected.has(part.id)) {
        mesh.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
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
    const com = report.centreOfMass;
    this.ui.setStats([
      ['Parts', String(this.bp.parts.length)],
      ['Mass', `${report.totalMassKg.toFixed(0)} kg`],
      ['Cost', `$${report.totalCost}`],
      ['CoM height', `${com.y.toFixed(2)} m`],
      ['Front/rear', `${(report.frontMassFraction * 100).toFixed(0)}% front`],
      ['Left/right', `${(report.leftMassFraction * 100).toFixed(0)}% left`],
      ['Track', `${report.trackWidthM.toFixed(2)} m`],
      ['Wheelbase', `${report.wheelbaseM.toFixed(2)} m`],
      ['Clearance', `${report.groundClearanceM.toFixed(2)} m`],
      ['Power/weight', `${report.powerToWeightKwPerT.toFixed(0)} kW/t`],
      ['Stability', report.rolloverRisk],
      ['Margin', `${report.stabilityMarginM.toFixed(2)} m`],
      ['Max slope', `${report.estimatedMaxSlopeDeg.toFixed(0)}°`],
      ['Fuel', `${report.fuelCapacityL.toFixed(0)} L`],
    ]);
    this.ui.setIssues(validation.errors, report.warnings);
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
