import './badgeGallery.css';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleBlueprint } from '../core/types.ts';
import { deserializeBlueprint } from '../core/serialize.ts';
import { getPartDef } from '../core/parts.ts';
import { buildPartMesh } from '../editor/meshes.ts';
import { BLUEPRINT_STORAGE_KEY } from '../editor/EditorMode.ts';
import type { Arena } from '../survival/arena/Arena.ts';
import { ArenaBuilder } from '../survival/arena/ArenaBuilder.ts';
import { GRAVEYARD } from '../survival/arena/recipes/graveyard.ts';
import type { SavedRun } from '../core/runSave.ts';
import { leaderboardRows, type LeaderboardRow } from '../core/leaderboard.ts';
import { BADGES } from '../core/badges.ts';
import {
  badgeProgress,
  badgeStore,
  type BadgeCollection,
} from './badgeStore.ts';
import { leaderboardStore } from './leaderboardStore.ts';
import { profileStore } from './profileStore.ts';
// buildStarterBlueprint is a plain function export; the cross-import back
// into App.ts is safe because it is only invoked at call time, well after
// both modules have finished linking.
import { buildStarterBlueprint } from './App.ts';

export interface TitleScreenHandlers {
  onNewGame(): void;
  onContinue(): void;
  onResumeRun(): void;
}

const ORBIT_RADIUS_M = 12;
const ORBIT_HEIGHT_M = 5;
const ORBIT_PERIOD_S = 25;

const PORTRAIT_ROOT = `${import.meta.env.BASE_URL}assets/zombies/portraits`;

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function ago(count: number, unit: string): string {
  return `${count.toLocaleString()} ${unit}${count === 1 ? '' : 's'} ago`;
}

/** Formats a completed-run timestamp relative to `now` without reading the DOM. */
export function formatRelativeDate(
  timestamp: number,
  now: number = Date.now(),
): string {
  if (
    !Number.isFinite(timestamp) ||
    !Number.isFinite(now) ||
    timestamp >= now
  ) {
    return 'just now';
  }

  const elapsed = now - timestamp;
  if (elapsed < MINUTE_MS) {
    return ago(Math.max(1, Math.floor(elapsed / SECOND_MS)), 'second');
  }
  if (elapsed < HOUR_MS) {
    return ago(Math.floor(elapsed / MINUTE_MS), 'minute');
  }
  if (elapsed < DAY_MS) {
    return ago(Math.floor(elapsed / HOUR_MS), 'hour');
  }
  if (elapsed < WEEK_MS) {
    return ago(Math.floor(elapsed / DAY_MS), 'day');
  }
  return ago(Math.floor(elapsed / WEEK_MS), 'week');
}

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

function buildTitleLeaderboard(
  rows: readonly LeaderboardRow[],
  now: number,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'leaderboard';
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'leaderboard__empty';
    empty.textContent =
      'No runs yet. Take your rig out and set the first score.';
    wrapper.appendChild(empty);
    return wrapper;
  }

  const table = document.createElement('table');
  table.setAttribute('aria-label', 'Local leaderboard');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Rank', 'Score', 'Wave', 'Kills', 'When']) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    headRow.appendChild(cell);
  }
  head.appendChild(headRow);

  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    const rank = document.createElement('th');
    rank.scope = 'row';
    rank.textContent = String(row.rank);
    tr.appendChild(rank);
    for (const value of [row.score, row.wave, row.kills]) {
      const cell = document.createElement('td');
      cell.textContent = value.toLocaleString();
      tr.appendChild(cell);
    }
    const completed = document.createElement('td');
    completed.textContent = formatRelativeDate(row.at, now);
    tr.appendChild(completed);
    body.appendChild(tr);
  }

  table.append(head, body);
  wrapper.appendChild(table);
  return wrapper;
}

function buildBadgeGallery(
  collection: BadgeCollection,
  now: number,
): HTMLElement {
  const gallery = document.createElement('div');
  gallery.className = 'badge-gallery';
  gallery.setAttribute('role', 'list');

  for (const badge of BADGES) {
    const record = collection[badge.id];
    const isEarned = record !== undefined;
    const tile = document.createElement('article');
    tile.className = [
      'badge-gallery__tile',
      `badge-gallery__tile--${badge.tier}`,
      isEarned ? 'badge-gallery__tile--earned' : 'badge-gallery__tile--locked',
    ].join(' ');
    tile.setAttribute('role', 'listitem');
    if (!isEarned) {
      tile.setAttribute(
        'aria-label',
        `${badge.name}: ${badge.description} — locked`,
      );
    }

    const icon = document.createElement('span');
    icon.className = 'badge-gallery__icon';
    icon.textContent = isEarned ? badge.icon : '🔒';
    icon.setAttribute('aria-hidden', 'true');

    const heading = document.createElement('div');
    heading.className = 'badge-gallery__heading';
    const name = document.createElement('h3');
    name.className = 'badge-gallery__name';
    name.textContent = badge.name;
    const tier = document.createElement('span');
    tier.className = 'badge-gallery__tier';
    tier.textContent = badge.tier;
    heading.append(name, tier);

    const description = document.createElement('p');
    description.className = 'badge-gallery__description';
    description.textContent = badge.description;

    tile.append(icon, heading, description);

    if (record !== undefined) {
      const details = document.createElement('div');
      details.className = 'badge-gallery__details';
      const earnedAt = document.createElement('span');
      earnedAt.textContent = `Earned ${formatRelativeDate(
        record.firstEarnedAt,
        now,
      )}`;
      details.appendChild(earnedAt);
      if (record.count > 1) {
        const count = document.createElement('span');
        count.className = 'badge-gallery__count';
        count.textContent = `×${record.count.toLocaleString()}`;
        details.appendChild(count);
      }
      tile.appendChild(details);
    }

    gallery.appendChild(tile);
  }

  return gallery;
}

/**
 * Boot screen: DOM title card on top of a live 3D graveyard backdrop with the
 * player's parked vehicle and a slow orbiting camera. It owns and removes
 * every listener and 3D resource it creates.
 */
export class TitleScreen {
  readonly root = document.createElement('section');

  private readonly resumeRunButton = document.createElement('button');
  private readonly newGameButton = document.createElement('button');
  private readonly continueButton = document.createElement('button');
  private readonly leaderboardButton = document.createElement('button');
  private readonly leaderboardOverlay = document.createElement('div');
  private readonly leaderboardContent = document.createElement('div');
  private readonly leaderboardCloseButton = document.createElement('button');
  private readonly badgesButton = document.createElement('button');
  private readonly badgesOverlay = document.createElement('div');
  private readonly badgesProgress = document.createElement('p');
  private readonly badgesContent = document.createElement('div');
  private readonly badgesCloseButton = document.createElement('button');
  private readonly confirmation = document.createElement('div');
  private readonly confirmButton = document.createElement('button');
  private readonly cancelButton = document.createElement('button');
  private disposed = false;

  // ---- 3D backdrop ----
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly backdropWorld: RAPIER.World;
  private readonly arena: Arena;
  private readonly vehicleGroup: THREE.Group;
  private readonly orbitCenter: THREE.Vector3;

  private readonly onNewGameClick = (): void => {
    this.requestNewGame();
  };

  private readonly onResumeRunClick = (): void => {
    this.resumeRun();
  };

  private readonly onContinueClick = (): void => {
    this.continueGame();
  };

  private readonly onLeaderboardClick = (): void => {
    if (this.disposed) return;
    this.closeBadges();
    this.leaderboardContent.replaceChildren(
      buildTitleLeaderboard(
        leaderboardRows(leaderboardStore.load()),
        Date.now(),
      ),
    );
    this.leaderboardOverlay.hidden = false;
    this.leaderboardCloseButton.focus();
  };

  private readonly onLeaderboardCloseClick = (): void => {
    this.closeLeaderboard();
  };

  private readonly onLeaderboardOverlayPointerDown = (
    event: PointerEvent,
  ): void => {
    if (event.target === this.leaderboardOverlay) this.closeLeaderboard();
  };

  private readonly onLeaderboardKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    this.closeLeaderboard();
    event.preventDefault();
  };

  private readonly onBadgesClick = (): void => {
    if (this.disposed) return;
    this.closeLeaderboard();
    const collection = badgeStore.load();
    const progress = badgeProgress(collection);
    this.badgesProgress.textContent = `${progress.earned} / ${progress.total} earned`;
    this.badgesContent.replaceChildren(
      buildBadgeGallery(collection, Date.now()),
    );
    this.badgesOverlay.hidden = false;
    this.badgesCloseButton.focus();
  };

  private readonly onBadgesCloseClick = (): void => {
    this.closeBadges();
  };

  private readonly onBadgesOverlayPointerDown = (event: PointerEvent): void => {
    if (event.target === this.badgesOverlay) this.closeBadges();
  };

  private readonly onBadgesKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    this.closeBadges();
    event.preventDefault();
  };

  private readonly onConfirmClick = (): void => {
    if (this.disposed) return;
    this.handlers.onNewGame();
  };

  private readonly onCancelClick = (): void => {
    if (this.disposed) return;
    this.confirmation.hidden = true;
    this.resumeRunButton.disabled = this.savedRun === null;
    this.newGameButton.disabled = false;
    this.continueButton.disabled = !this.hasSave;
  };

  constructor(
    container: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly hasSave: boolean,
    private readonly handlers: TitleScreenHandlers,
    private readonly savedRun: SavedRun | null = null,
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

    this.resumeRunButton.type = 'button';
    this.resumeRunButton.className = 'primary title-action';
    this.resumeRunButton.textContent =
      savedRun === null ? 'Resume Run' : `Resume Run — Wave ${savedRun.wave}`;
    this.resumeRunButton.hidden = savedRun === null;
    this.resumeRunButton.disabled = savedRun === null;

    this.newGameButton.type = 'button';
    this.newGameButton.className =
      savedRun === null ? 'primary title-action' : 'title-action';
    this.newGameButton.textContent = 'New Game';

    this.continueButton.type = 'button';
    this.continueButton.className = 'title-action';
    this.continueButton.textContent = 'Continue';
    this.continueButton.hidden = !hasSave;
    this.continueButton.disabled = !hasSave;

    this.leaderboardButton.type = 'button';
    this.leaderboardButton.className = 'title-action';
    this.leaderboardButton.textContent = 'Leaderboard';
    this.leaderboardButton.setAttribute('aria-haspopup', 'dialog');

    this.badgesButton.type = 'button';
    this.badgesButton.className = 'title-action';
    this.badgesButton.textContent = 'Badges';
    this.badgesButton.setAttribute('aria-haspopup', 'dialog');

    actions.append(
      this.resumeRunButton,
      this.newGameButton,
      this.continueButton,
      this.leaderboardButton,
      this.badgesButton,
    );

    this.confirmation.className = 'title-confirm';
    this.confirmation.hidden = true;
    const warning = document.createElement('p');
    warning.textContent = savedRun
      ? 'This discards your saved run and erases your garage, money and unlocks. Start over?'
      : 'This erases your garage, money and unlocks. Start over?';
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

    this.leaderboardOverlay.className = 'title-leaderboard-overlay';
    this.leaderboardOverlay.hidden = true;
    this.leaderboardOverlay.setAttribute('role', 'dialog');
    this.leaderboardOverlay.setAttribute('aria-modal', 'true');
    this.leaderboardOverlay.setAttribute(
      'aria-labelledby',
      'title-leaderboard-title',
    );
    this.leaderboardOverlay.setAttribute(
      'aria-describedby',
      'title-leaderboard-description',
    );
    const leaderboardDialog = document.createElement('section');
    leaderboardDialog.className = 'panel title-leaderboard-dialog';
    const leaderboardTitle = document.createElement('h2');
    leaderboardTitle.id = 'title-leaderboard-title';
    leaderboardTitle.textContent = 'Local Leaderboard';
    const leaderboardDescription = document.createElement('p');
    leaderboardDescription.id = 'title-leaderboard-description';
    leaderboardDescription.textContent = 'Your best runs on this device.';
    this.leaderboardContent.className = 'title-leaderboard__board';
    const leaderboardActions = document.createElement('div');
    leaderboardActions.className = 'title-leaderboard__actions';
    this.leaderboardCloseButton.type = 'button';
    this.leaderboardCloseButton.className = 'primary';
    this.leaderboardCloseButton.textContent = 'Back to Title';
    leaderboardActions.appendChild(this.leaderboardCloseButton);
    leaderboardDialog.append(
      leaderboardTitle,
      leaderboardDescription,
      this.leaderboardContent,
      leaderboardActions,
    );
    this.leaderboardOverlay.appendChild(leaderboardDialog);

    this.badgesOverlay.className = 'title-badges-overlay';
    this.badgesOverlay.hidden = true;
    this.badgesOverlay.setAttribute('role', 'dialog');
    this.badgesOverlay.setAttribute('aria-modal', 'true');
    this.badgesOverlay.setAttribute('aria-labelledby', 'title-badges-title');
    this.badgesOverlay.setAttribute(
      'aria-describedby',
      'title-badges-progress',
    );
    const badgesDialog = document.createElement('section');
    badgesDialog.className = 'panel title-badges-dialog';
    const badgesTitle = document.createElement('h2');
    badgesTitle.id = 'title-badges-title';
    badgesTitle.textContent = 'BADGES';
    this.badgesProgress.id = 'title-badges-progress';
    this.badgesProgress.className = 'title-badges__progress';
    this.badgesContent.className = 'title-badges__gallery';
    const badgesActions = document.createElement('div');
    badgesActions.className = 'title-badges__actions';
    this.badgesCloseButton.type = 'button';
    this.badgesCloseButton.className = 'primary';
    this.badgesCloseButton.textContent = 'Back to Title';
    badgesActions.appendChild(this.badgesCloseButton);
    badgesDialog.append(
      badgesTitle,
      this.badgesProgress,
      this.badgesContent,
      badgesActions,
    );
    this.badgesOverlay.appendChild(badgesDialog);

    panel.append(
      kicker,
      title,
      subtitle,
      actions,
      this.confirmation,
      zombieLeft,
      zombieRight,
    );
    this.root.append(panel, this.leaderboardOverlay, this.badgesOverlay);
    container.appendChild(this.root);

    this.resumeRunButton.addEventListener('click', this.onResumeRunClick);
    this.newGameButton.addEventListener('click', this.onNewGameClick);
    this.continueButton.addEventListener('click', this.onContinueClick);
    this.leaderboardButton.addEventListener('click', this.onLeaderboardClick);
    this.leaderboardCloseButton.addEventListener(
      'click',
      this.onLeaderboardCloseClick,
    );
    this.leaderboardOverlay.addEventListener(
      'pointerdown',
      this.onLeaderboardOverlayPointerDown,
    );
    this.leaderboardOverlay.addEventListener(
      'keydown',
      this.onLeaderboardKeyDown,
    );
    this.badgesButton.addEventListener('click', this.onBadgesClick);
    this.badgesCloseButton.addEventListener('click', this.onBadgesCloseClick);
    this.badgesOverlay.addEventListener(
      'pointerdown',
      this.onBadgesOverlayPointerDown,
    );
    this.badgesOverlay.addEventListener('keydown', this.onBadgesKeyDown);
    this.confirmButton.addEventListener('click', this.onConfirmClick);
    this.cancelButton.addEventListener('click', this.onCancelClick);

    // ---- 3D backdrop: graveyard (visuals only) + parked vehicle + orbit cam ----
    const aspect =
      Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1);
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);

    this.backdropWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.arena = new ArenaBuilder(
      this.scene,
      this.backdropWorld,
      GRAVEYARD,
      0x47524156,
      { collidersEnabled: false },
    );

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
    this.arena.follow(this.vehicleGroup);
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
    if (this.hasSave || this.savedRun !== null) {
      this.confirmation.hidden = false;
      this.resumeRunButton.disabled = true;
      this.newGameButton.disabled = true;
      this.continueButton.disabled = true;
      return false;
    }
    this.handlers.onNewGame();
    return true;
  }

  resumeRun(): boolean {
    if (this.disposed || this.savedRun === null) return false;
    this.handlers.onResumeRun();
    return true;
  }

  continueGame(): boolean {
    if (this.disposed || !this.hasSave) return false;
    this.handlers.onContinue();
    return true;
  }

  private closeLeaderboard(): void {
    if (this.disposed || this.leaderboardOverlay.hidden) return;
    this.leaderboardOverlay.hidden = true;
    this.leaderboardButton.focus();
  }

  private closeBadges(): void {
    if (this.disposed || this.badgesOverlay.hidden) return;
    this.badgesOverlay.hidden = true;
    this.badgesButton.focus();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resumeRunButton.removeEventListener('click', this.onResumeRunClick);
    this.newGameButton.removeEventListener('click', this.onNewGameClick);
    this.continueButton.removeEventListener('click', this.onContinueClick);
    this.leaderboardButton.removeEventListener(
      'click',
      this.onLeaderboardClick,
    );
    this.leaderboardCloseButton.removeEventListener(
      'click',
      this.onLeaderboardCloseClick,
    );
    this.leaderboardOverlay.removeEventListener(
      'pointerdown',
      this.onLeaderboardOverlayPointerDown,
    );
    this.leaderboardOverlay.removeEventListener(
      'keydown',
      this.onLeaderboardKeyDown,
    );
    this.badgesButton.removeEventListener('click', this.onBadgesClick);
    this.badgesCloseButton.removeEventListener(
      'click',
      this.onBadgesCloseClick,
    );
    this.badgesOverlay.removeEventListener(
      'pointerdown',
      this.onBadgesOverlayPointerDown,
    );
    this.badgesOverlay.removeEventListener('keydown', this.onBadgesKeyDown);
    this.confirmButton.removeEventListener('click', this.onConfirmClick);
    this.cancelButton.removeEventListener('click', this.onCancelClick);
    this.root.remove();

    this.arena.dispose();
    disposeObjectResources(this.scene);
    this.scene.clear();
    this.backdropWorld.free();
  }
}
