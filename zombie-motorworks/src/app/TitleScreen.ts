import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleBlueprint } from '../core/types.ts';
import { deserializeBlueprint } from '../core/serialize.ts';
import { getPartDef } from '../core/parts.ts';
import { buildPartMesh } from '../editor/meshes.ts';
import { BLUEPRINT_STORAGE_KEY } from '../editor/EditorMode.ts';
import { Graveyard } from '../survival/Graveyard.ts';
import { profileStore } from './profileStore.ts';
// buildStarterBlueprint is a plain function export; the cross-import back
// into App.ts is safe because it is only invoked at call time, well after
// both modules have finished linking.
import { buildStarterBlueprint } from './App.ts';

export interface TitleScreenHandlers {
  onNewGame(): void;
  onContinue(): void;
}

const ORBIT_RADIUS_M = 12;
const ORBIT_HEIGHT_M = 5;
const ORBIT_PERIOD_S = 25;

const PORTRAIT_ROOT = `${import.meta.env.BASE_URL}assets/zombies/portraits`;

/** Loads the same "current" blueprint App would resume into, for the backdrop car. */
function loadBackdropBlueprint(): VehicleBlueprint {
  try {
    const profile = profileStore.load();
    const name = profile.currentBlueprintName;
    if (name) {
      const raw = localStorage.getItem(BLUEPRINT_STORAGE_KEY);
      if (raw) {
        const slots = JSON.parse(raw) as Record<string, unknown>;
        const json = slots[name];
        if (typeof json === 'string') return deserializeBlueprint(json);
      }
    }
  } catch {
    // Fall through to the starter rig — the title backdrop is cosmetic only.
  }
  return buildStarterBlueprint();
}

function buildVehicleGroup(bp: VehicleBlueprint): THREE.Group {
  const group = new THREE.Group();
  group.name = 'title-vehicle';
  for (const part of bp.parts) {
    let def;
    try {
      def = getPartDef(part.defId);
    } catch {
      continue;
    }
    const mesh = buildPartMesh(def, part);
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    group.add(mesh);
  }
  return group;
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

/**
 * Boot screen: DOM title card on top of a live 3D graveyard backdrop with the
 * player's parked vehicle and a slow orbiting camera. It owns and removes
 * every listener and 3D resource it creates.
 */
export class TitleScreen {
  readonly root = document.createElement('section');

  private readonly newGameButton = document.createElement('button');
  private readonly continueButton = document.createElement('button');
  private readonly confirmation = document.createElement('div');
  private readonly confirmButton = document.createElement('button');
  private readonly cancelButton = document.createElement('button');
  private disposed = false;

  // ---- 3D backdrop ----
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly backdropWorld: RAPIER.World;
  private readonly graveyard: Graveyard;
  private readonly vehicleGroup: THREE.Group;
  private readonly orbitCenter: THREE.Vector3;

  private readonly onNewGameClick = (): void => {
    this.requestNewGame();
  };

  private readonly onContinueClick = (): void => {
    this.continueGame();
  };

  private readonly onConfirmClick = (): void => {
    if (this.disposed) return;
    this.handlers.onNewGame();
  };

  private readonly onCancelClick = (): void => {
    if (this.disposed) return;
    this.confirmation.hidden = true;
    this.newGameButton.disabled = false;
    this.continueButton.disabled = !this.hasSave;
  };

  constructor(
    container: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly hasSave: boolean,
    private readonly handlers: TitleScreenHandlers,
  ) {
    this.root.className = 'title-screen';
    this.root.setAttribute('aria-labelledby', 'game-title');

    const panel = document.createElement('div');
    panel.className = 'panel title-panel';

    const kicker = document.createElement('div');
    kicker.className = 'title-kicker';
    kicker.textContent = 'SCRAP. BUILD. SURVIVE.';

    const title = document.createElement('h1');
    title.id = 'game-title';
    title.textContent = 'ZOMBIE MOTORWORKS';

    const subtitle = document.createElement('p');
    subtitle.className = 'title-subtitle';
    subtitle.textContent = 'Build the last ride out of the graveyard.';

    const actions = document.createElement('div');
    actions.className = 'title-actions';

    this.newGameButton.type = 'button';
    this.newGameButton.className = 'primary title-action';
    this.newGameButton.textContent = 'New Game';

    this.continueButton.type = 'button';
    this.continueButton.className = 'title-action';
    this.continueButton.textContent = 'Continue';
    this.continueButton.hidden = !hasSave;
    this.continueButton.disabled = !hasSave;

    actions.append(this.newGameButton, this.continueButton);

    this.confirmation.className = 'title-confirm';
    this.confirmation.hidden = true;
    const warning = document.createElement('p');
    warning.textContent =
      'This erases your garage, money and unlocks. Start over?';
    const confirmActions = document.createElement('div');
    confirmActions.className = 'title-confirm-actions';

    this.confirmButton.type = 'button';
    this.confirmButton.className = 'danger';
    this.confirmButton.textContent = 'Confirm';
    this.cancelButton.type = 'button';
    this.cancelButton.textContent = 'Cancel';
    confirmActions.append(this.confirmButton, this.cancelButton);
    this.confirmation.append(warning, confirmActions);

    const zombieLeft = document.createElement('img');
    zombieLeft.className = 'title-zombie title-zombie-left';
    zombieLeft.src = `${PORTRAIT_ROOT}/zed-2.png`;
    zombieLeft.alt = '';
    zombieLeft.setAttribute('aria-hidden', 'true');

    const zombieRight = document.createElement('img');
    zombieRight.className = 'title-zombie title-zombie-right';
    zombieRight.src = `${PORTRAIT_ROOT}/zed-5.png`;
    zombieRight.alt = '';
    zombieRight.setAttribute('aria-hidden', 'true');

    panel.append(kicker, title, subtitle, actions, this.confirmation, zombieLeft, zombieRight);
    this.root.appendChild(panel);
    container.appendChild(this.root);

    this.newGameButton.addEventListener('click', this.onNewGameClick);
    this.continueButton.addEventListener('click', this.onContinueClick);
    this.confirmButton.addEventListener('click', this.onConfirmClick);
    this.cancelButton.addEventListener('click', this.onCancelClick);

    // ---- 3D backdrop: graveyard (visuals only) + parked vehicle + orbit cam ----
    const aspect = Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1);
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);

    this.backdropWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.graveyard = new Graveyard(this.scene, this.backdropWorld, {
      collidersEnabled: false,
    });

    const parkPosition = new THREE.Vector3(2, 0, 2);
    this.vehicleGroup = buildVehicleGroup(loadBackdropBlueprint());
    this.vehicleGroup.position.copy(parkPosition);
    this.vehicleGroup.rotation.y = Math.PI / 5;
    this.scene.add(this.vehicleGroup);

    this.orbitCenter = parkPosition.clone().add(new THREE.Vector3(0, 0.8, 0));
    this.updateCamera(0);
  }

  /** Advances the orbiting camera and renders the backdrop with the shared renderer. */
  update(): void {
    if (this.disposed) return;
    this.updateCamera(this.clock.getElapsedTime());
    this.graveyard.follow(this.vehicleGroup);
    this.renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number): void {
    if (this.disposed || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private updateCamera(elapsedS: number): void {
    const angle = (elapsedS / ORBIT_PERIOD_S) * Math.PI * 2;
    this.camera.position.set(
      this.orbitCenter.x + Math.cos(angle) * ORBIT_RADIUS_M,
      this.orbitCenter.y + ORBIT_HEIGHT_M,
      this.orbitCenter.z + Math.sin(angle) * ORBIT_RADIUS_M,
    );
    this.camera.lookAt(this.orbitCenter);
  }

  /** Starts immediately for a fresh profile, or asks before replacing a save. */
  requestNewGame(): boolean {
    if (this.disposed) return false;
    if (this.hasSave) {
      this.confirmation.hidden = false;
      this.newGameButton.disabled = true;
      this.continueButton.disabled = true;
      return false;
    }
    this.handlers.onNewGame();
    return true;
  }

  continueGame(): boolean {
    if (this.disposed || !this.hasSave) return false;
    this.handlers.onContinue();
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.newGameButton.removeEventListener('click', this.onNewGameClick);
    this.continueButton.removeEventListener('click', this.onContinueClick);
    this.confirmButton.removeEventListener('click', this.onConfirmClick);
    this.cancelButton.removeEventListener('click', this.onCancelClick);
    this.root.remove();

    this.graveyard.dispose();
    disposeObjectResources(this.scene);
    this.scene.clear();
    this.backdropWorld.free();
  }
}
