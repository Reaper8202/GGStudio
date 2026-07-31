import './badgeGallery.css';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleBlueprint } from '../core/types.ts';
import { deserializeBlueprint } from '../core/serialize.ts';
import { getPartDef } from '../core/parts.ts';
import { buildPartMesh } from '../editor/meshes.ts';
import { BLUEPRINT_STORAGE_KEY } from '../editor/EditorMode.ts';
import { biomeHandlingSummary, type BiomeId } from '../core/biomes.ts';
import type { Arena } from '../survival/arena/Arena.ts';
import { ArenaBuilder } from '../survival/arena/ArenaBuilder.ts';
import {
  BIOMES,
  DEFAULT_BIOME_ID,
  getBiome,
} from '../survival/arena/recipes/index.ts';
import type { SavedRun } from '../core/runSave.ts';
import { leaderboardRows, type LeaderboardRow } from '../core/leaderboard.ts';
import {
  createAudioVolumeControl,
  type AudioVolumeControl,
} from '../ui/audioVolumeControl.ts';
import { buildLeaderboardTable } from '../ui/leaderboardTable.ts';
import { BADGES } from '../core/badges.ts';
import {
  badgeProgress,
  badgeStore,
  type BadgeCollection,
} from './badgeStore.ts';
import { leaderboardStore } from './leaderboardStore.ts';
import { profileStore } from './profileStore.ts';
import {
  getMusicVolume,
  getSfxVolume,
  playSfx,
  setMusicVolume,
  setSfxVolume,
  unlockAudio,
} from './sfx.ts';
// buildStarterBlueprint is a plain function export; the cross-import back
// into App.ts is safe because it is only invoked at call time, well after
// both modules have finished linking.
import { buildStarterBlueprint } from './App.ts';

export interface TitleScreenHandlers {
  onNewGame(): void;
  onContinue(): void;
  onResumeRun(): void;
  /** The player picked the map their next run starts on. */
  onBiomeSelected(biomeId: BiomeId): void;
}

const ORBIT_RADIUS_M = 12;
const ORBIT_HEIGHT_M = 5;
const ORBIT_PERIOD_S = 25;

/**
 * Chunky white marks for the corner rail, drawn on the same 24-grid and
 * `currentColor` convention as the garage's icon buttons. Inline rather than a
 * data URI so each glyph follows the button through its hover colour.
 */
const TROPHY_ICON_SVG =
  `<svg class="title-icon-button__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
  `<path d="M6 2h12v6l-2 4H8L6 8z" fill="currentColor"/>` +
  `<path d="M11 12h2v4h-2zM8 16h8v2H8zM6 18h12v3H6z" fill="currentColor"/>` +
  `<path d="M6 4H3v3l3 2M18 4h3v3l-3 2" fill="none" stroke="currentColor" stroke-width="2"/>` +
  `</svg>`;
const MEDAL_ICON_SVG =
  `<svg class="title-icon-button__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
  `<path d="M6 2h4l2 5-3 2zM18 2h-4l-2 5 3 2z" fill="currentColor"/>` +
  `<circle cx="12" cy="15" r="6" fill="none" stroke="currentColor" stroke-width="2"/>` +
  `<circle cx="12" cy="15" r="2.5" fill="currentColor"/>` +
  `</svg>`;
const SLIDERS_ICON_SVG =
  `<svg class="title-icon-button__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
  `<path d="M2 5h20v2H2zM2 11h20v2H2zM2 17h20v2H2z" fill="currentColor"/>` +
  `<path d="M6 3h3v6H6zM14 9h3v6h-3zM9 15h3v6H9z" fill="currentColor"/>` +
  `</svg>`;

/** Fixed so the backdrop of a given map looks the same on every boot. */
const BACKDROP_SEED = 0x47524156;

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

/** The pair of zombies leaning in from the panel edges. Decorative only. */
function buildZombies(): HTMLImageElement[] {
  return (
    [
      ['left', 'zed-2'],
      ['right', 'zed-5'],
    ] as const
  ).map(([side, portrait]) => {
    const zombie = document.createElement('img');
    zombie.className = `title-zombie title-zombie-${side}`;
    zombie.src = `${PORTRAIT_ROOT}/${portrait}.png`;
    zombie.alt = '';
    zombie.setAttribute('aria-hidden', 'true');
    return zombie;
  });
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
  return buildLeaderboardTable(rows, {
    emptyMessage: 'No runs yet. Take your rig out and set the first score.',
    ariaLabel: 'Local leaderboard',
    formatWhen: (at) => formatRelativeDate(at, now),
  });
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

  private readonly panel = document.createElement('div');
  private readonly mapPanel = document.createElement('div');
  private readonly resumeButton = document.createElement('button');
  private readonly newGameButton = document.createElement('button');
  private readonly startRunButton = document.createElement('button');
  private readonly backButton = document.createElement('button');
  private readonly leaderboardButton = document.createElement('button');
  private readonly leaderboardOverlay = document.createElement('div');
  private readonly leaderboardContent = document.createElement('div');
  private readonly leaderboardCloseButton = document.createElement('button');
  private readonly badgesButton = document.createElement('button');
  private readonly badgesOverlay = document.createElement('div');
  private readonly badgesProgress = document.createElement('p');
  private readonly badgesContent = document.createElement('div');
  private readonly badgesCloseButton = document.createElement('button');
  private readonly settingsButton = document.createElement('button');
  private readonly settingsOverlay = document.createElement('div');
  private readonly settingsCloseButton = document.createElement('button');
  private readonly sfxVolumeControl: AudioVolumeControl =
    createAudioVolumeControl({
      label: 'Sound effects',
      classes: {
        row: 'title-settings__row',
        label: 'title-settings__label',
        input: 'title-settings__volume',
        output: 'title-settings__volume-value',
      },
    });
  private readonly musicVolumeControl: AudioVolumeControl =
    createAudioVolumeControl({
      label: 'Music',
      classes: {
        row: 'title-settings__row',
        label: 'title-settings__label',
        input: 'title-settings__volume',
        output: 'title-settings__volume-value',
      },
    });
  private readonly confirmation = document.createElement('div');
  private readonly confirmButton = document.createElement('button');
  private readonly cancelButton = document.createElement('button');
  /** One row per selectable map, keyed so selection can restyle them. */
  private readonly mapRows = new Map<BiomeId, HTMLButtonElement>();
  private readonly listenerRemovers: (() => void)[] = [];
  private audioUnlocked = false;
  private disposed = false;

  private readonly onUiButtonClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    this.unlockAudioFromInput();
    playSfx('uiClick');
  };

  // ---- 3D backdrop ----
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly backdropWorld: RAPIER.World;
  /** Rebuilt in place whenever the player picks a different map. */
  private arena: Arena;
  private readonly vehicleGroup: THREE.Group;
  private readonly orbitCenter: THREE.Vector3;

  private readonly onNewGameClick = (): void => {
    this.requestNewGame();
  };

  private readonly onResumeClick = (): void => {
    this.resume();
  };

  private readonly onStartRunClick = (): void => {
    this.startNewGame();
  };

  private readonly onBackClick = (): void => {
    this.showMainScreen();
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

  private readonly onSettingsClick = (): void => {
    if (this.disposed) return;
    this.closeLeaderboard();
    this.closeBadges();
    this.settingsOverlay.hidden = false;
    this.settingsCloseButton.focus();
  };

  private readonly onSettingsCloseClick = (): void => {
    this.closeSettings();
  };

  private readonly onSettingsOverlayPointerDown = (
    event: PointerEvent,
  ): void => {
    if (event.target === this.settingsOverlay) this.closeSettings();
  };

  private readonly onSettingsKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    this.closeSettings();
    event.preventDefault();
  };

  private readonly onSfxVolumeInput = (): void => {
    if (this.disposed) return;
    this.unlockAudioFromInput();
    setSfxVolume(Number(this.sfxVolumeControl.input.value) / 100);
    this.syncVolumeControls();
  };

  private readonly onMusicVolumeInput = (): void => {
    if (this.disposed) return;
    this.unlockAudioFromInput();
    setMusicVolume(Number(this.musicVolumeControl.input.value) / 100);
    this.syncVolumeControls();
  };

  /** Arrows move between rows, as a radiogroup is expected to. */
  private readonly onMapKeyDown = (event: KeyboardEvent): void => {
    const step =
      event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : 0;
    if (step === 0 || this.disposed) return;

    const ids = [...this.mapRows.keys()];
    const current = ids.indexOf(this.selectedBiomeId);
    const next = ids[(current + step + ids.length) % ids.length];
    if (next !== undefined) this.selectBiome(next);
    event.preventDefault();
  };

  private readonly onConfirmClick = (): void => {
    if (this.disposed) return;
    this.showMapScreen();
  };

  private readonly onCancelClick = (): void => {
    this.showMainScreen();
  };

  constructor(
    container: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly hasSave: boolean,
    private readonly handlers: TitleScreenHandlers,
    private readonly savedRun: SavedRun | null = null,
    private selectedBiomeId: BiomeId = DEFAULT_BIOME_ID,
  ) {
    this.root.className = 'title-screen';
    this.root.setAttribute('aria-labelledby', 'game-title');

    this.panel.className = 'panel title-panel';

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

    // One resume button covers both saves: a run in flight resumes at its
    // wave, and a garage-only save resumes at wave 1.
    const canResume = savedRun !== null || hasSave;
    this.resumeButton.type = 'button';
    this.resumeButton.className = 'primary title-action';
    this.resumeButton.textContent = `Resume Run — Wave ${savedRun?.wave ?? 1}`;
    this.resumeButton.hidden = !canResume;
    this.resumeButton.disabled = !canResume;

    this.newGameButton.type = 'button';
    this.newGameButton.className = canResume
      ? 'title-action'
      : 'primary title-action';
    this.newGameButton.textContent = 'New Game';

    actions.append(this.resumeButton, this.newGameButton);

    // Leaderboard, badges and settings are secondary: they live as icons in
    // the corner rail so the panel keeps a single column of run actions.
    const utilityRail = document.createElement('div');
    utilityRail.className = 'title-utility-rail';
    for (const [button, icon, label] of [
      [this.leaderboardButton, TROPHY_ICON_SVG, 'Leaderboard'],
      [this.badgesButton, MEDAL_ICON_SVG, 'Badges'],
      [this.settingsButton, SLIDERS_ICON_SVG, 'Settings'],
    ] as const) {
      button.type = 'button';
      button.className = 'title-icon-button';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = icon;
      utilityRail.appendChild(button);
    }

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

    this.settingsOverlay.className = 'title-settings-overlay';
    this.settingsOverlay.hidden = true;
    this.settingsOverlay.setAttribute('role', 'dialog');
    this.settingsOverlay.setAttribute('aria-modal', 'true');
    this.settingsOverlay.setAttribute(
      'aria-labelledby',
      'title-settings-title',
    );
    const settingsDialog = document.createElement('section');
    settingsDialog.className = 'panel title-settings-dialog';
    const settingsTitle = document.createElement('h2');
    settingsTitle.id = 'title-settings-title';
    settingsTitle.textContent = 'SETTINGS';
    const volumeControls = document.createElement('div');
    volumeControls.className = 'title-settings__volume-controls';
    volumeControls.append(
      this.sfxVolumeControl.row,
      this.musicVolumeControl.row,
    );
    this.syncVolumeControls();
    const settingsActions = document.createElement('div');
    settingsActions.className = 'title-settings__actions';
    this.settingsCloseButton.type = 'button';
    this.settingsCloseButton.className = 'primary';
    this.settingsCloseButton.textContent = 'Back to Title';
    settingsActions.appendChild(this.settingsCloseButton);
    settingsDialog.append(settingsTitle, volumeControls, settingsActions);
    this.settingsOverlay.appendChild(settingsDialog);

    this.panel.append(
      kicker,
      title,
      subtitle,
      actions,
      this.confirmation,
      ...buildZombies(),
    );
    this.buildMapScreen();
    this.root.append(
      this.panel,
      this.mapPanel,
      utilityRail,
      this.leaderboardOverlay,
      this.badgesOverlay,
      this.settingsOverlay,
    );
    container.appendChild(this.root);
    this.root.addEventListener('click', this.onUiButtonClick, true);
    this.listenerRemovers.push(() =>
      this.root.removeEventListener('click', this.onUiButtonClick, true),
    );

    this.listen(this.resumeButton, 'click', this.onResumeClick);
    this.listen(this.newGameButton, 'click', this.onNewGameClick);
    this.listen(this.startRunButton, 'click', this.onStartRunClick);
    this.listen(this.backButton, 'click', this.onBackClick);
    this.listen(this.leaderboardButton, 'click', this.onLeaderboardClick);
    this.listen(
      this.leaderboardCloseButton,
      'click',
      this.onLeaderboardCloseClick,
    );
    this.listen(
      this.leaderboardOverlay,
      'pointerdown',
      this.onLeaderboardOverlayPointerDown,
    );
    this.listen(this.leaderboardOverlay, 'keydown', this.onLeaderboardKeyDown);
    this.listen(this.badgesButton, 'click', this.onBadgesClick);
    this.listen(this.badgesCloseButton, 'click', this.onBadgesCloseClick);
    this.listen(
      this.badgesOverlay,
      'pointerdown',
      this.onBadgesOverlayPointerDown,
    );
    this.listen(this.badgesOverlay, 'keydown', this.onBadgesKeyDown);
    this.listen(this.settingsButton, 'click', this.onSettingsClick);
    this.listen(this.settingsCloseButton, 'click', this.onSettingsCloseClick);
    this.listen(
      this.settingsOverlay,
      'pointerdown',
      this.onSettingsOverlayPointerDown,
    );
    this.listen(this.settingsOverlay, 'keydown', this.onSettingsKeyDown);
    this.listen(this.sfxVolumeControl.input, 'input', this.onSfxVolumeInput);
    this.listen(
      this.musicVolumeControl.input,
      'input',
      this.onMusicVolumeInput,
    );
    this.listen(this.confirmButton, 'click', this.onConfirmClick);
    this.listen(this.cancelButton, 'click', this.onCancelClick);

    // ---- 3D backdrop: selected map (visuals only) + parked vehicle + orbit cam ----
    const aspect =
      Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1);
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);

    this.backdropWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.arena = this.buildBackdropArena();

    const parkPosition = new THREE.Vector3(2, 0, 2);
    this.vehicleGroup = buildVehicleGroup(loadBackdropBlueprint());
    this.vehicleGroup.position.copy(parkPosition);
    this.vehicleGroup.rotation.y = Math.PI / 5;
    this.scene.add(this.vehicleGroup);

    this.orbitCenter = parkPosition.clone().add(new THREE.Vector3(0, 0.8, 0));
    this.updateCamera(0);
  }

  /** Registers a listener whose removal `dispose` takes care of. */
  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void {
    target.addEventListener(type, handler);
    this.listenerRemovers.push(() => target.removeEventListener(type, handler));
  }

  /** Second screen, shown after New Game: one row per map, top to bottom. */
  private buildMapScreen(): void {
    this.mapPanel.className = 'panel title-panel title-map-panel';
    this.mapPanel.hidden = true;

    const kicker = document.createElement('div');
    kicker.className = 'title-kicker';
    kicker.textContent = 'NEW GAME';

    const heading = document.createElement('h2');
    heading.className = 'title-map-panel__heading';
    heading.id = 'title-maps-label';
    heading.textContent = 'CHOOSE YOUR MAP';

    const list = document.createElement('div');
    list.className = 'title-maps';
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-labelledby', 'title-maps-label');

    for (const biome of Object.values(BIOMES)) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `title-map title-map--${biome.difficulty}`;
      row.setAttribute('role', 'radio');
      row.title = biome.blurb;

      const head = document.createElement('span');
      head.className = 'title-map__head';

      const name = document.createElement('span');
      name.className = 'title-map__name';
      name.textContent = biome.name;

      // The row's accent colour carries the same message; the word keeps it
      // readable for anyone who cannot pick the colours apart.
      const difficulty = document.createElement('span');
      difficulty.className = 'title-map__difficulty';
      difficulty.textContent = biome.difficulty;
      head.append(name, difficulty);

      const handling = document.createElement('span');
      handling.className = 'title-map__handling';
      handling.textContent = biomeHandlingSummary(biome);

      row.append(head, handling);
      this.listen(row, 'click', () => this.selectBiome(biome.id));
      this.mapRows.set(biome.id, row);
      list.appendChild(row);
    }
    this.listen(list, 'keydown', this.onMapKeyDown);
    this.syncMapCards();

    const actions = document.createElement('div');
    actions.className = 'title-actions';
    this.startRunButton.type = 'button';
    this.startRunButton.className = 'primary title-action';
    this.startRunButton.textContent = 'Start Run';
    this.backButton.type = 'button';
    this.backButton.className = 'title-action';
    this.backButton.textContent = 'Back';
    actions.append(this.startRunButton, this.backButton);

    this.mapPanel.append(kicker, heading, list, actions, ...buildZombies());
  }

  private showMapScreen(): void {
    this.panel.hidden = true;
    this.mapPanel.hidden = false;
    this.mapRows.get(this.selectedBiomeId)?.focus();
  }

  private showMainScreen(): void {
    if (this.disposed) return;
    this.mapPanel.hidden = true;
    this.panel.hidden = false;
    this.confirmation.hidden = true;
    this.resumeButton.disabled = this.savedRun === null && !this.hasSave;
    this.newGameButton.disabled = false;
    this.newGameButton.focus();
  }

  private selectBiome(biomeId: BiomeId): void {
    if (this.disposed || biomeId === this.selectedBiomeId) return;
    this.selectedBiomeId = biomeId;
    this.syncMapCards();
    this.mapRows.get(biomeId)?.focus();
    this.rebuildBackdrop();
    this.handlers.onBiomeSelected(biomeId);
    this.unlockAudioFromInput();
    playSfx('uiClick');
  }

  private syncMapCards(): void {
    for (const [biomeId, card] of this.mapRows) {
      const selected = biomeId === this.selectedBiomeId;
      card.classList.toggle('title-map--selected', selected);
      card.setAttribute('aria-checked', String(selected));
      // Roving tabindex: one stop for the whole group, arrows move within it.
      card.tabIndex = selected ? 0 : -1;
    }
  }

  private buildBackdropArena(): Arena {
    return new ArenaBuilder(
      this.scene,
      this.backdropWorld,
      getBiome(this.selectedBiomeId),
      BACKDROP_SEED,
      { collidersEnabled: false },
    );
  }

  /** Swaps the backdrop to the picked map so it previews where the run starts. */
  private rebuildBackdrop(): void {
    // Disposing first restores the scene background and fog the old arena
    // captured, so the new one inherits a clean scene rather than its colours.
    this.arena.dispose();
    this.arena = this.buildBackdropArena();
  }

  private syncVolumeControls(): void {
    const sfxPercent = Math.round(getSfxVolume() * 100);
    const musicPercent = Math.round(getMusicVolume() * 100);
    this.sfxVolumeControl.setPercent(sfxPercent);
    this.musicVolumeControl.setPercent(musicPercent);
  }

  private unlockAudioFromInput(): void {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    unlockAudio();
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

  /** Opens the map screen, asking first when a save would be erased. */
  requestNewGame(): boolean {
    if (this.disposed) return false;
    if (this.hasSave || this.savedRun !== null) {
      this.confirmation.hidden = false;
      this.resumeButton.disabled = true;
      this.newGameButton.disabled = true;
      return false;
    }
    this.showMapScreen();
    return true;
  }

  /** Erases the old save and starts on the selected map. */
  startNewGame(): boolean {
    if (this.disposed) return false;
    this.handlers.onNewGame();
    return true;
  }

  /** One button, two saves: the run in flight if there is one, else the garage. */
  resume(): boolean {
    if (this.disposed) return false;
    if (this.savedRun === null) return this.continueGame();
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

  private closeSettings(): void {
    if (this.disposed || this.settingsOverlay.hidden) return;
    this.settingsOverlay.hidden = true;
    this.settingsButton.focus();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const remove of this.listenerRemovers) remove();
    this.listenerRemovers.length = 0;
    this.root.remove();

    this.arena.dispose();
    disposeObjectResources(this.scene);
    this.scene.clear();
    this.backdropWorld.free();
  }
}
