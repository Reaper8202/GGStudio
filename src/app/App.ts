/**
 * Application shell: owns the WebGL renderer and switches between the editor
 * and the test chamber. RAPIER.init() runs exactly once at boot. Entering the
 * chamber passes a deep-cloned blueprint; returning restores the editor with
 * the original untouched.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PartConfig, PlacedPart, Vec3i, VehicleBlueprint } from '../core/types.ts';
import { createEmptyBlueprint } from '../core/blueprint.ts';
import { serializeBlueprint, deserializeBlueprint } from '../core/serialize.ts';
import { validateBlueprint } from '../core/placement.ts';
import { analyzeVehicle } from '../core/analysis.ts';
import { getPartDef } from '../core/parts.ts';
import { composeOrientations, orientationFromSteps } from '../core/grid.ts';
import { EditorMode, type EditorViewState } from '../editor/EditorMode.ts';
import { CommandHistory } from '../core/commands.ts';
import { ChamberMode, type ScenarioName } from '../chamber/ChamberMode.ts';
import type { VehicleControls } from '../runtime/vehicle.ts';

export class App {
  private renderer!: THREE.WebGLRenderer;
  private editor: EditorMode | null = null;
  private chamber: ChamberMode | null = null;
  private bp: VehicleBlueprint = createEmptyBlueprint('starter-rig');
  /** Survive editor <-> chamber round trips: undo history and camera/layer. */
  private readonly history = new CommandHistory();
  private savedView: EditorViewState | undefined;

  constructor(private readonly root: HTMLElement) {}

  async start(): Promise<void> {
    await RAPIER.init();
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.root.clientWidth, this.root.clientHeight);
    this.renderer.domElement.className = 'viewport';
    this.root.appendChild(this.renderer.domElement);
    window.addEventListener('resize', () => {
      this.renderer.setSize(this.root.clientWidth, this.root.clientHeight);
      this.editor?.resize(this.root.clientWidth, this.root.clientHeight);
      this.chamber?.resize(this.root.clientWidth, this.root.clientHeight);
    });

    this.bp = buildStarterBlueprint();
    this.openEditor();

    const loop = (): void => {
      requestAnimationFrame(loop);
      this.editor?.update();
      this.chamber?.update();
    };
    loop();
  }

  private openEditor(): void {
    this.chamber?.dispose();
    this.chamber = null;
    this.editor = new EditorMode(this.root, this.renderer, this.bp, (bp) => this.enterChamber(bp), {
      history: this.history,
      view: this.savedView,
    });
    this.editor.resize(this.root.clientWidth, this.root.clientHeight);
  }

  private enterChamber(bp: VehicleBlueprint): void {
    this.bp = bp;
    this.savedView = this.editor?.viewState();
    this.editor?.dispose();
    this.editor = null;
    this.chamber = new ChamberMode(this.root, this.renderer, bp, () => this.openEditor());
    this.chamber.resize(this.root.clientWidth, this.root.clientHeight);
  }

  debugSeam(): Record<string, unknown> {
    return {
      orient: {
        yaw90: orientationFromSteps(0, 1, 0),
        yaw180: orientationFromSteps(0, 2, 0),
        rollX90: orientationFromSteps(1, 0, 0),
      },
      composeOrient: (a: number, b: number) => composeOrientations(a, b),
      mode: () => (this.chamber ? 'chamber' : 'editor'),
      getBlueprintJson: () => serializeBlueprint(this.editor?.blueprint() ?? this.bp),
      loadBlueprintJson: (json: string) => this.editor?.replaceBlueprint(deserializeBlueprint(json)),
      place: (defId: string, pos: Vec3i, orient = 0, config: PartConfig = {}) =>
        this.editor?.debugPlace(defId, pos, orient, config),
      configureAt: (pos: Vec3i, config: PartConfig) => this.editor?.debugConfigure(pos, config),
      undo: () => this.editor?.debugUndo(),
      redo: () => this.editor?.debugRedo(),
      validate: () => validateBlueprint(this.editor?.blueprint() ?? this.bp, getPartDef),
      analyze: () => analyzeVehicle(this.editor?.blueprint() ?? this.bp, getPartDef),
      enterTest: () => {
        const bp = this.editor?.blueprint();
        if (!bp) return false;
        const v = validateBlueprint(bp, getPartDef);
        if (v.errors.length > 0) return false;
        this.enterChamber(bp);
        return true;
      },
      backToEditor: () => this.openEditor(),
      setControls: (c: Partial<VehicleControls>) => this.chamber?.debugSetControls(c),
      telemetry: () => this.chamber?.debugTelemetry(),
      setScenario: (s: ScenarioName) => this.chamber?.debugSetScenario(s),
      resetVehicle: () => this.chamber?.reset(),
    };
  }
}

/** A small, valid, drivable starter rig so first boot isn't a blank grid. */
export function buildStarterBlueprint(): VehicleBlueprint {
  const yaw180 = orientationFromSteps(0, 2, 0);
  let n = 0;
  const part = (defId: string, pos: Vec3i, orient = 0, config: PartConfig = {}): PlacedPart => ({
    id: `p${++n}`,
    defId,
    pos,
    orient,
    config,
  });
  const wheelCfg = (steering: boolean): PartConfig => ({
    driven: true,
    steering,
    braking: true,
    suspensionPreset: 'standard',
  });
  const parts: PlacedPart[] = [
    part('chassis-core', { x: 0, y: 1, z: 0 }),
    part('driver-seat', { x: 0, y: 2, z: 0 }),
    // 3-wide deck, z -1..2 spine plus flanks (long wheelbase resists wheelies).
    part('frame-box', { x: 0, y: 1, z: 1 }),
    part('frame-box', { x: 0, y: 1, z: 2 }),
    part('frame-box', { x: 0, y: 1, z: -1 }),
    part('frame-box', { x: 1, y: 1, z: 0 }),
    part('frame-box', { x: -1, y: 1, z: 0 }),
    part('frame-box', { x: 1, y: 1, z: 1 }),
    part('frame-box', { x: -1, y: 1, z: 1 }),
    part('frame-box', { x: 1, y: 1, z: -1 }),
    part('frame-box', { x: -1, y: 1, z: -1 }),
    part('wheel-mount', { x: 1, y: 1, z: 2 }),
    part('wheel-mount', { x: -1, y: 1, z: 2 }),
    part('wheel-mount', { x: 1, y: 1, z: -2 }),
    part('wheel-mount', { x: -1, y: 1, z: -2 }),
    part('wheel-standard', { x: 2, y: 1, z: 2 }, yaw180, wheelCfg(true)),
    part('wheel-standard', { x: -2, y: 1, z: 2 }, 0, wheelCfg(true)),
    part('wheel-standard', { x: 2, y: 1, z: -2 }, yaw180, wheelCfg(false)),
    part('wheel-standard', { x: -2, y: 1, z: -2 }, 0, wheelCfg(false)),
    part('engine-mount', { x: 0, y: 1, z: -2 }),
    part('engine-small', { x: 0, y: 2, z: -2 }),
    part('fuel-tank', { x: 0, y: 2, z: -1 }),
  ];
  return { ...createEmptyBlueprint('starter-rig'), parts };
}
