/** Garage DOM UI: store, inventory, vehicle stats, and selected-part inspector. */

import { KID_LABELS, SIMPLE_PART_IDS } from '../core/tutorial.ts';
import {
  PAINT_COLORS,
  type PartDefinition,
  type PartConfig,
  type ValidationIssue,
  type VehicleAnalysisReport,
} from '../core/types.ts';
import {
  TURRET_MODULE_MAX_LEVEL,
  type TurretModule,
} from '../core/turretModules.ts';

export interface EditorUIHandlers {
  /** Atomic production store action; old harnesses may omit this callback. */
  onPurchasePart?(defId: string): void;
  onBuyPart(defId: string): void;
  onArmPart(defId: string): void;
  onToggleErase(): void;
  onCancelTool(): void;
  newGarageDisposalSummary(): NewGarageDisposalSummary;
  onNew(): void;
  onMenu(): void;
  onRename(name: string): void;
  onUndo(): void;
  onRedo(): void;
  onSymmetryToggle(on: boolean): void;
  onView(view: 'persp' | 'front' | 'rear' | 'side' | 'top'): void;
  onLayerChange(layer: number): void;
  onTestDrive(): void;
  onFightZombies(): void;
  onStartTutorial(): void;
  onConfigChange(partId: string, key: string, value: boolean | string): void;
  onUpgradePart(partId: string): void;
  onRepairPart(partId: string): void;
  onRepairAll(): void;
  onBuyTurretModule(partId: string, module: TurretModule): void;
  onDeleteSelected(): void;
  onRotateSelected(axis: 'y' | 'x'): void;
}

export interface SelectedPartEconomy {
  nextUpgradePrice: number | null;
  canUpgrade: boolean;
  sellRefund: number;
  repairCost: number | null;
  canRepair: boolean;
  turretModules?: Record<TurretModule, TurretModuleEconomy>;
  upgradePreview?: {
    before: {
      totalDps: number;
      integrity: number;
      estimatedTopSpeedKph: number;
    };
    after: {
      totalDps: number;
      integrity: number;
      estimatedTopSpeedKph: number;
    };
  };
}

export interface TurretModuleEconomy {
  level: number;
  targetLevel: number | null;
  price: number | null;
  unlocked: boolean;
  canBuy: boolean;
}

export interface RunSummary {
  failedWave: number;
  bankedMoneyRetained: number;
  pendingMoneyDiscarded: number;
  destroyedPartNames: string[];
}

export interface NewGarageDisposalSummary {
  partCount: number;
  investment: number;
  refund: number;
  forfeited: number;
}

export interface RunRepairEconomy {
  integrityPct: number;
  totalCost: number;
  canRepairAll: boolean;
  nextWaveNotice?: string;
}

export interface EditorUI {
  root: HTMLElement;
  setBlueprintName(name: string): void;
  setUndoRedo(canUndo: boolean, canRedo: boolean): void;
  setBuildSummary(
    report: VehicleAnalysisReport,
    errors: ValidationIssue[],
    warnings: ValidationIssue[],
  ): void;
  setTestDriveEnabled(enabled: boolean, blockedBy: string[]): void;
  setSelectedPart(
    def: PartDefinition | null,
    partId?: string,
    level?: number,
    effectiveDef?: PartDefinition,
    economy?: SelectedPartEconomy,
    config?: PartConfig,
    effectiveSteering?: boolean,
  ): void;
  setEconomy(
    money: number,
    unlockedDefIds: readonly string[],
    inventory: Readonly<Record<string, number>>,
    installedDefIds: readonly string[],
  ): void;
  setRunContext(
    wave?: number,
    summary?: RunSummary,
    repair?: RunRepairEconomy,
  ): void;
  setArmedPart(defId: string | null): void;
  highlightPaletteButton(defId: string | null): void;
  setStatus(text: string): void;
  setNotice(text: string): void;
  deny(text: string): void;
  ghostTip: HTMLDivElement;
}

interface CollapsiblePanel {
  panel: HTMLElement;
  body: HTMLElement;
}

function buildCollapsiblePanel(titleText: string, className: string): CollapsiblePanel {
  const panel = document.createElement('section');
  panel.className = `panel dock-panel ${className}`;
  const header = document.createElement('header');
  header.className = 'dock-panel__header';
  const title = document.createElement('h2');
  title.textContent = titleText;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'dock-panel__toggle';
  toggle.setAttribute('aria-label', `Collapse ${titleText}`);
  toggle.setAttribute('aria-expanded', 'true');
  const body = document.createElement('div');
  body.className = 'dock-panel__body';
  toggle.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('is-collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${titleText}`);
  });
  header.append(title, toggle);
  panel.append(header, body);
  return { panel, body };
}

function buildMetric(
  labelText: string,
  valueText: string,
  value: number,
  max: number,
  intent = 'neutral',
): HTMLElement {
  const metric = document.createElement('div');
  metric.className = `garage-stat garage-stat--${intent}`;
  const header = document.createElement('div');
  header.className = 'garage-stat__header';
  const label = document.createElement('span');
  label.textContent = labelText;
  const output = document.createElement('strong');
  output.textContent = valueText;
  header.append(label, output);
  const track = document.createElement('div');
  track.className = 'garage-stat__track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', labelText);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(max));
  track.setAttribute('aria-valuenow', String(Math.round(value)));
  const fill = document.createElement('span');
  fill.className = 'garage-stat__fill';
  fill.style.setProperty('--garage-stat-value', `${Math.min(100, Math.max(0, (value / max) * 100))}%`);
  track.appendChild(fill);
  metric.append(header, track);
  return metric;
}

function partThumbnail(def: PartDefinition): HTMLImageElement {
  const common = `
    <path d="M16 24 32 15 48 24 32 33Z" fill="#59604f"/>
    <path d="M16 24 32 33 32 50 16 41Z" fill="#363b32"/>
    <path d="M32 33 48 24 48 41 32 50Z" fill="#242923"/>
    <path d="M16 24 32 15 48 24" fill="none" stroke="#737b67" stroke-width="2"/>
  `;
  const drawings: Record<string, string> = {
    'frame-box': common,
    'frame-reinforced': `
      ${common}
      <path d="M20 27 32 34 44 27M22 39 32 45 42 39" fill="none" stroke="#8a5035" stroke-width="3"/>
    `,
    'wheel-standard': `
      <ellipse cx="32" cy="34" rx="15" ry="20" fill="#171a17" stroke="#555b50" stroke-width="5"/>
      <ellipse cx="32" cy="34" rx="6" ry="9" fill="#89995a"/>
      <path d="M32 16V52M18 34H46" stroke="#080a08" stroke-width="3"/>
    `,
    'wheel-offroad': `
      <path d="M18 14H26V19H38V14H46V22H50V46H46V54H38V49H26V54H18V46H14V22H18Z" fill="#1a1d19"/>
      <ellipse cx="32" cy="34" rx="13" ry="17" fill="#343a31" stroke="#070807" stroke-width="4"/>
      <rect x="27" y="27" width="10" height="14" fill="#89995a"/>
    `,
    'wheel-moto': `
      <ellipse cx="32" cy="34" rx="10" ry="21" fill="#171a17" stroke="#555b50" stroke-width="3"/>
      <ellipse cx="32" cy="34" rx="4" ry="8" fill="#89995a"/>
      <path d="M32 13V55M24 34H40" stroke="#080a08" stroke-width="2"/>
      <path d="M26 20 38 48M38 20 26 48" stroke="#343a31" stroke-width="2"/>
    `,
    'tread-tank': `
      <rect x="8" y="18" width="48" height="28" rx="14" fill="#1a1d19" stroke="#555b50" stroke-width="3"/>
      <circle cx="20" cy="32" r="7" fill="#343a31"/>
      <circle cx="32" cy="32" r="7" fill="#343a31"/>
      <circle cx="44" cy="32" r="7" fill="#343a31"/>
      <path d="M14 18H50M14 46H50" stroke="#89995a" stroke-width="3"/>
      <path d="M20 15V21M32 15V21M44 15V21M20 43V49M32 43V49M44 43V49" stroke="#8a5035" stroke-width="2"/>
    `,
    'engine-small': `
      ${common}
      <path d="M21 20 29 16V25L21 29ZM35 16 43 20V29L35 25Z" fill="#8a5035"/>
      <path d="M22 38H42" stroke="#89995a" stroke-width="3"/>
    `,
    'fuel-tank': `
      <path d="M20 18H44V50H20Z" fill="#3b4137"/>
      <path d="M24 14H34V20H24Z" fill="#59604f"/>
      <path d="M20 28H44M20 42H44" stroke="#20241f" stroke-width="4"/>
      <path d="M26 34H38" stroke="#8a5035" stroke-width="3"/>
    `,
    turret: `
      ${common}
      <path d="M24 17 32 12 40 17V28L32 32 24 28Z" fill="#4b5245"/>
      <path d="M34 16H55V21H34Z" fill="#8a5035"/>
    `,
    'armour-plate': `
      <path d="M15 20 32 12 49 20V46L32 54 15 46Z" fill="#3e4439"/>
      <path d="M20 23 32 17 44 23V43L32 49 20 43Z" fill="#59604f"/>
      <path d="M22 25 42 41M42 25 22 41" stroke="#242923" stroke-width="3"/>
    `,
    'cannon-heavy': `
      ${common}
      <path d="M22 18 34 12 43 18V28L32 34 22 28Z" fill="#4a5044"/>
      <path d="M34 14H58V21H34Z" fill="#8a5035"/>
      <path d="M53 12H61V23H53Z" fill="#2a2e28"/>
    `,
    'barrel-drum': `
      <path d="M10 24H54V44H10Z" fill="#6b4a2e"/>
      <ellipse cx="10" cy="34" rx="5" ry="10" fill="#4a3320"/>
      <ellipse cx="54" cy="34" rx="5" ry="10" fill="#8a5035"/>
      <path d="M14 22H18V26H14ZM26 20H30V24H26ZM38 22H42V26H38ZM20 42H24V46H20ZM32 44H36V48H32ZM44 42H48V46H44Z" fill="#242923"/>
      <path d="M10 30H54M10 38H54" stroke="#4a3320" stroke-width="2"/>
    `,
    'sniper-light': `
      ${common}
      <path d="M26 20 32 16 38 20V27L32 31 26 27Z" fill="#4b5245"/>
      <path d="M33 17H60V20H33Z" fill="#8a5035"/>
      <path d="M57 15H61V22H57Z" fill="#2a2e28"/>
      <circle cx="36" cy="13" r="3" fill="#89995a"/>
    `,
    flamethrower: `
      ${common}
      <path d="M24 18 32 14 40 18V28L32 32 24 28Z" fill="#5a3a28"/>
      <path d="M34 16H46V22H34Z" fill="#8a5035"/>
      <path d="M46 14H50V24H46Z" fill="#2a2e28"/>
      <path d="M50 16 58 12 55 19 61 21 52 24Z" fill="#c96a2f"/>
      <path d="M52 17 57 15 55 20Z" fill="#e0a13e"/>
    `,
  };
  const drawing = drawings[def.id] ?? common;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" shape-rendering="crispEdges"><rect width="64" height="64" fill="#090b09"/>${drawing}</svg>`;
  const image = document.createElement('img');
  image.className = 'part-thumbnail';
  image.alt = '';
  image.draggable = false;
  image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  return image;
}

export function buildEditorUI(
  container: HTMLElement,
  catalog: Record<string, PartDefinition>,
  handlers: EditorUIHandlers,
): EditorUI {
  const root = document.createElement('div');
  root.className = 'ui-layer garage-ui';
  container.appendChild(root);

  const btn = (label: string, fn: () => void, title = ''): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', fn);
    return button;
  };

  const newGarageOverlay = document.createElement('div');
  newGarageOverlay.className = 'garage-confirm-overlay';
  newGarageOverlay.hidden = true;
  newGarageOverlay.setAttribute('role', 'dialog');
  newGarageOverlay.setAttribute('aria-modal', 'true');
  newGarageOverlay.setAttribute('aria-labelledby', 'new-garage-title');
  newGarageOverlay.setAttribute('aria-describedby', 'new-garage-description');
  const newGarageDialog = document.createElement('section');
  newGarageDialog.className = 'panel garage-confirm';
  const newGarageTitle = document.createElement('h2');
  newGarageTitle.id = 'new-garage-title';
  newGarageTitle.textContent = 'Start a New Garage?';
  const newGarageDescription = document.createElement('p');
  newGarageDescription.id = 'new-garage-description';
  newGarageDescription.textContent =
    'Installed parts will be sold at their exact resale value before the current build is replaced.';
  const newGarageStats = document.createElement('dl');
  newGarageStats.className = 'garage-confirm__stats';
  const summaryValue = (labelText: string): HTMLElement => {
    const label = document.createElement('dt');
    label.textContent = labelText;
    const value = document.createElement('dd');
    newGarageStats.append(label, value);
    return value;
  };
  const newGaragePartCount = summaryValue('Installed non-root parts');
  const newGarageInvestment = summaryValue('Total paid investment');
  const newGarageRefund = summaryValue('Resale refund');
  const newGarageForfeited = summaryValue('Value forfeited');
  const newGarageActions = document.createElement('div');
  newGarageActions.className = 'garage-confirm__actions';
  let newGarageReturnFocus: HTMLElement | null = null;
  const closeNewGarageDialog = (): void => {
    newGarageOverlay.hidden = true;
    newGarageReturnFocus?.focus();
    newGarageReturnFocus = null;
  };
  const cancelNewGarage = btn('Cancel', closeNewGarageDialog);
  const confirmNewGarage = btn('Sell Parts and Start New', () => {
    newGarageOverlay.hidden = true;
    handlers.onNew();
    newGarageReturnFocus = null;
  });
  confirmNewGarage.className = 'danger';
  newGarageActions.append(cancelNewGarage, confirmNewGarage);
  newGarageDialog.append(
    newGarageTitle,
    newGarageDescription,
    newGarageStats,
    newGarageActions,
  );
  newGarageOverlay.appendChild(newGarageDialog);
  newGarageOverlay.addEventListener('pointerdown', (event) => {
    if (event.target === newGarageOverlay) closeNewGarageDialog();
  });
  newGarageOverlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeNewGarageDialog();
    event.preventDefault();
  });
  root.appendChild(newGarageOverlay);

  const openNewGarageDialog = (trigger: HTMLElement): void => {
    const summary = handlers.newGarageDisposalSummary();
    newGaragePartCount.textContent = String(summary.partCount);
    newGarageInvestment.textContent = `$${summary.investment}`;
    newGarageRefund.textContent = `$${summary.refund}`;
    newGarageForfeited.textContent = `$${summary.forfeited}`;
    newGarageReturnFocus = trigger;
    newGarageOverlay.hidden = false;
    cancelNewGarage.focus();
  };

  const top = document.createElement('div');
  top.className = 'topbar';
  root.appendChild(top);
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'garage-name';
  nameInput.title = 'Vehicle name';
  nameInput.addEventListener('change', () => handlers.onRename(nameInput.value));
  const menuBtn = btn('Menu', handlers.onMenu);
  const newGarageBtn = btn('New Garage', () =>
    openNewGarageDialog(newGarageBtn),
  );
  newGarageBtn.setAttribute('aria-haspopup', 'dialog');
  top.append(nameInput, newGarageBtn, menuBtn);
  const undoBtn = btn('Undo', handlers.onUndo, 'Ctrl+Z');
  const redoBtn = btn('Redo', handlers.onRedo, 'Ctrl+Shift+Z');
  top.append(undoBtn, redoBtn);
  let symmetry = false;
  const symmetryBtn = btn('Mirror Build', () => {
    symmetry = !symmetry;
    symmetryBtn.classList.toggle('active', symmetry);
    symmetryBtn.setAttribute('aria-pressed', String(symmetry));
    handlers.onSymmetryToggle(symmetry);
  });
  symmetryBtn.setAttribute('aria-pressed', 'false');
  top.appendChild(symmetryBtn);
  const viewSelect = document.createElement('select');
  viewSelect.title = 'View (keys 1-5)';
  for (const [label, value] of [['3D', 'persp'], ['Front', 'front'], ['Rear', 'rear'], ['Side', 'side'], ['Top', 'top']] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    viewSelect.appendChild(option);
  }
  viewSelect.addEventListener('change', () =>
    handlers.onView(viewSelect.value as 'persp' | 'front' | 'rear' | 'side' | 'top'),
  );
  top.append(viewSelect, btn('Tutorial', handlers.onStartTutorial), btn('Help', () => toggleHelp()));
  const testBtn = btn('Test Drive', handlers.onTestDrive);
  testBtn.className = 'primary btn-hero btn-hero-first';
  const fightBtn = btn('Fight Zombies', handlers.onFightZombies);
  fightBtn.className = 'primary btn-hero btn-hero-fight';
  const moneyReadout = document.createElement('span');
  moneyReadout.className = 'panel money-readout';
  moneyReadout.textContent = '$0';
  moneyReadout.addEventListener('animationend', () => moneyReadout.classList.remove('deny-shake'));
  top.append(testBtn, fightBtn, moneyReadout);

  const runBanner = document.createElement('div');
  runBanner.className = 'panel run-banner';
  runBanner.style.display = 'none';
  root.appendChild(runBanner);
  const runBannerText = document.createElement('span');
  runBannerText.className = 'run-banner__text';
  const runBannerWarning = document.createElement('span');
  runBannerWarning.className = 'run-banner__warning';
  const repairAllBtn = btn('Repair All $0', handlers.onRepairAll);
  repairAllBtn.className = 'primary run-banner__repair';
  const noticeBanner = document.createElement('div');
  noticeBanner.className = 'panel editor-notice';
  noticeBanner.style.display = 'none';
  root.appendChild(noticeBanner);

  const garageDock = document.createElement('aside');
  garageDock.className = 'garage-dock';
  root.appendChild(garageDock);

  const store = buildCollapsiblePanel('Store', 'store-panel');
  const storeFilters = document.createElement('div');
  storeFilters.className = 'store-filters';
  const essentialsFilter = document.createElement('button');
  essentialsFilter.type = 'button';
  essentialsFilter.textContent = 'Essentials';
  essentialsFilter.className = 'active';
  essentialsFilter.setAttribute('aria-pressed', 'true');
  const weaponsFilter = document.createElement('button');
  weaponsFilter.type = 'button';
  weaponsFilter.textContent = 'Weapons';
  weaponsFilter.setAttribute('aria-pressed', 'false');
  storeFilters.append(essentialsFilter, weaponsFilter);
  const storeContent = document.createElement('div');
  storeContent.className = 'dock-list store-list';
  store.body.append(storeFilters, storeContent);
  const inventory = buildCollapsiblePanel('Inventory', 'inventory-panel');
  const inventoryContent = document.createElement('div');
  inventoryContent.className = 'dock-list inventory-list';
  const inventoryEmpty = document.createElement('p');
  inventoryEmpty.className = 'inventory-empty';
  inventoryEmpty.textContent = 'No loose parts. Buy stock from the Store.';
  inventory.body.append(inventoryContent, inventoryEmpty);
  garageDock.append(store.panel, inventory.panel);

  const storeButtons = new Map<string, HTMLButtonElement>();
  const storePriceLabels = new Map<string, HTMLElement>();
  const storePriceBreakdowns = new Map<string, HTMLElement>();
  const storeUnlockMilestones = new Map<string, HTMLElement>();
  const inventoryButtons = new Map<string, HTMLButtonElement>();
  const inventoryCountLabels = new Map<string, HTMLElement>();
  let armed: string | null = null;
  let highlighted: string | null = null;

  for (const id of SIMPLE_PART_IDS) {
    const def = catalog[id];
    if (!def) continue;
    const displayName = KID_LABELS[id]?.name ?? def.name;
    const description = KID_LABELS[id]?.blurb ?? def.description;

    const storeButton = document.createElement('button');
    storeButton.className = 'part-btn store-item';
    storeButton.dataset.partId = id;
    storeButton.dataset.storeGroup = def.category === 'weapon' ? 'weapons' : 'essentials';
    const storeName = document.createElement('strong');
    storeName.textContent = displayName;
    const storePreview = partThumbnail(def);
    const storeBlurb = document.createElement('small');
    storeBlurb.className = 'part-description';
    storeBlurb.textContent = description;
    const price = document.createElement('small');
    price.className = 'part-price';
    const priceBreakdown = document.createElement('small');
    priceBreakdown.className = 'part-price-breakdown';
    priceBreakdown.hidden = true;
    const unlockMilestone = document.createElement('small');
    unlockMilestone.className = 'part-unlock-milestone';
    unlockMilestone.hidden = true;
    storeButton.append(
      storeName,
      storePreview,
      storeBlurb,
      price,
      priceBreakdown,
      unlockMilestone,
    );
    storeButton.addEventListener('click', () => {
      if (handlers.onPurchasePart) handlers.onPurchasePart(id);
      else handlers.onBuyPart(id);
    });
    storeContent.appendChild(storeButton);
    storeButtons.set(id, storeButton);
    storePriceLabels.set(id, price);
    storePriceBreakdowns.set(id, priceBreakdown);
    storeUnlockMilestones.set(id, unlockMilestone);

    const inventoryButton = document.createElement('button');
    inventoryButton.className = 'part-btn inventory-item';
    inventoryButton.dataset.partId = id;
    const inventoryName = document.createElement('strong');
    inventoryName.textContent = displayName;
    const inventoryPreview = partThumbnail(def);
    const inventoryBlurb = document.createElement('small');
    inventoryBlurb.className = 'part-description';
    inventoryBlurb.textContent = description;
    const count = document.createElement('small');
    count.className = 'inventory-count';
    count.textContent = '0';
    inventoryButton.append(inventoryName, inventoryPreview, inventoryBlurb, count);
    inventoryButton.addEventListener('click', () =>
      armed === id ? handlers.onCancelTool() : handlers.onArmPart(id),
    );
    inventoryContent.appendChild(inventoryButton);
    inventoryButtons.set(id, inventoryButton);
    inventoryCountLabels.set(id, count);
  }

  const setStoreFilter = (group: 'essentials' | 'weapons'): void => {
    const essentialsActive = group === 'essentials';
    essentialsFilter.classList.toggle('active', essentialsActive);
    weaponsFilter.classList.toggle('active', !essentialsActive);
    essentialsFilter.setAttribute('aria-pressed', String(essentialsActive));
    weaponsFilter.setAttribute('aria-pressed', String(!essentialsActive));
    for (const button of storeButtons.values()) {
      button.hidden = button.dataset.storeGroup !== group;
    }
  };
  essentialsFilter.addEventListener('click', () => setStoreFilter('essentials'));
  weaponsFilter.addEventListener('click', () => setStoreFilter('weapons'));
  setStoreFilter('essentials');

  const inventoryTools = document.createElement('div');
  inventoryTools.className = 'inventory-tools';
  const eraseButton = btn('Erase Part', handlers.onToggleErase, 'Delete a part with the next click');
  eraseButton.className = 'erase-btn';
  const cancelButton = btn('Cancel Tool', handlers.onCancelTool);
  cancelButton.className = 'cancel-tool';
  cancelButton.style.display = 'none';
  inventoryTools.append(eraseButton, cancelButton);
  inventory.body.appendChild(inventoryTools);

  const selectedPanel = document.createElement('aside');
  selectedPanel.className = 'panel selected-panel';
  const selectedHeader = document.createElement('header');
  selectedHeader.className = 'selected-panel__header';
  const selectedEyebrow = document.createElement('span');
  selectedEyebrow.textContent = 'Model Selection';
  const selectedHeading = document.createElement('h2');
  selectedHeading.textContent = 'Selected Part';
  selectedHeader.append(selectedEyebrow, selectedHeading);
  const selectedContent = document.createElement('div');
  selectedContent.className = 'selected-panel__content';
  selectedPanel.append(selectedHeader, selectedContent);
  root.appendChild(selectedPanel);

  const vehicleStats = document.createElement('section');
  vehicleStats.className = 'panel vehicle-stats';
  const vehicleStatsHeader = document.createElement('header');
  vehicleStatsHeader.className = 'vehicle-stats__header';
  const vehicleStatsTitle = document.createElement('h2');
  vehicleStatsTitle.textContent = 'Vehicle Stats';
  const vehicleStatsToggle = document.createElement('button');
  vehicleStatsToggle.type = 'button';
  vehicleStatsToggle.className = 'dock-panel__toggle';
  vehicleStatsToggle.setAttribute('aria-label', 'Collapse Vehicle Stats');
  vehicleStatsToggle.setAttribute('aria-expanded', 'true');
  vehicleStatsToggle.addEventListener('click', () => {
    const collapsed = vehicleStats.classList.toggle('is-collapsed');
    vehicleStatsToggle.setAttribute('aria-expanded', String(!collapsed));
    vehicleStatsToggle.setAttribute(
      'aria-label',
      `${collapsed ? 'Expand' : 'Collapse'} Vehicle Stats`,
    );
  });
  vehicleStatsHeader.append(vehicleStatsTitle, vehicleStatsToggle);
  const vehicleStatsContent = document.createElement('div');
  vehicleStatsContent.className = 'vehicle-stats__content';
  vehicleStats.append(vehicleStatsHeader, vehicleStatsContent);
  root.appendChild(vehicleStats);

  const bottom = document.createElement('div');
  bottom.className = 'bottombar';
  root.appendChild(bottom);
  const layerLabel = document.createElement('span');
  layerLabel.textContent = 'Build height: All';
  const layerSlider = document.createElement('input');
  layerSlider.type = 'range';
  layerSlider.min = '-1';
  layerSlider.max = '8';
  layerSlider.value = '-1';
  layerSlider.addEventListener('input', () => {
    const layer = Number(layerSlider.value);
    layerLabel.textContent = layer < 0 ? 'Build height: All' : `Build height: ${layer}`;
    handlers.onLayerChange(layer);
  });
  const status = document.createElement('span');
  status.className = 'status';
  bottom.append(layerLabel, layerSlider, status);

  const ghostTip = document.createElement('div');
  ghostTip.className = 'ghost-tip';
  ghostTip.style.display = 'none';
  root.appendChild(ghostTip);

  const help = buildHelpOverlay();
  help.style.display = 'none';
  root.appendChild(help);
  const HELP_SEEN_KEY = 'scraprig.help-seen';
  const toggleHelp = (): void => {
    const showing = help.style.display !== 'none';
    help.style.display = showing ? 'none' : 'block';
    if (!showing) localStorage.setItem(HELP_SEEN_KEY, '1');
  };
  help.querySelector('button')?.addEventListener('click', toggleHelp);
  const debugMode = new URLSearchParams(location.search).get('debug') === '1';
  const WELCOME_SEEN_KEY = 'scraprig.welcome-seen';
  const TUTORIAL_DONE_KEY = 'scraprig.tutorial-done';
  if (!debugMode && !localStorage.getItem(TUTORIAL_DONE_KEY) && !localStorage.getItem(HELP_SEEN_KEY) && !localStorage.getItem(WELCOME_SEEN_KEY)) {
    const welcome = buildWelcomeDialog(
      () => { localStorage.setItem(WELCOME_SEEN_KEY, '1'); welcome.remove(); handlers.onStartTutorial(); },
      () => { localStorage.setItem(WELCOME_SEEN_KEY, '1'); welcome.remove(); },
    );
    root.appendChild(welcome);
  }

  const showNoSelection = (): void => {
    root.classList.remove('has-selection');
    selectedPanel.classList.remove('is-visible');
    selectedContent.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'selected-empty';
    const mark = document.createElement('span');
    mark.textContent = '[ ]';
    const text = document.createElement('p');
    text.textContent = 'Select a block on the model to inspect, upgrade, rotate, paint, or sell it.';
    empty.append(mark, text);
    selectedContent.appendChild(empty);
  };
  showNoSelection();

  return {
    root,
    ghostTip,
    setBlueprintName: (name) => { nameInput.value = name; },
    setUndoRedo: (canUndo, canRedo) => {
      undoBtn.disabled = !canUndo;
      redoBtn.disabled = !canRedo;
    },
    setBuildSummary: (report, errors, warnings) => {
      const stabilityValues: Record<string, number> = {
        low: 100,
        medium: 68,
        high: 34,
        extreme: 8,
      };
      const stabilityLabels: Record<string, string> = {
        low: 'Stable',
        medium: 'Watch',
        high: 'High Risk',
        extreme: 'Critical',
      };
      vehicleStatsContent.replaceChildren(
        buildMetric('Mass', `${report.totalMassKg.toFixed(0)} KG`, report.totalMassKg, 4000),
        buildMetric('Stability', stabilityLabels[report.rolloverRisk] ?? 'Unknown', stabilityValues[report.rolloverRisk] ?? 0, 100, report.rolloverRisk),
        buildMetric('DPS', report.totalDps.toFixed(1), report.totalDps, 160, 'damage'),
        buildMetric('Top Speed', `${report.estimatedTopSpeedKph.toFixed(0)} KM/H`, report.estimatedTopSpeedKph, 120),
        buildMetric('Power / Weight', `${report.powerToWeightKwPerT.toFixed(0)} KW/T`, report.powerToWeightKwPerT, 180),
      );
      const issues = errors.length > 0 ? errors.slice(0, 1) : warnings.slice(0, 1);
      if (issues.length > 0) {
        const issue = document.createElement('div');
        issue.className = `garage-stats__issue ${issues[0].severity === 'error' ? 'issue-error' : 'issue-warning'}`;
        issue.textContent = issues[0].message;
        vehicleStatsContent.appendChild(issue);
      }
    },
    setTestDriveEnabled: (enabled, blockedBy) => {
      const blockedTitle = `Blocked: ${blockedBy.join('; ')}`;
      testBtn.disabled = !enabled;
      testBtn.title = enabled ? 'Enter the test chamber' : blockedTitle;
      fightBtn.disabled = !enabled;
      fightBtn.title = enabled ? 'Fight zombies' : blockedTitle;
    },
    setSelectedPart: (
      def,
      partId,
      level = 1,
      effectiveDef = def ?? undefined,
      economy,
      partConfig,
      effectiveSteering,
    ) => {
      if (!def || !partId) {
        showNoSelection();
        return;
      }
      root.classList.add('has-selection');
      selectedPanel.classList.add('is-visible');
      selectedContent.replaceChildren();
      const title = document.createElement('div');
      title.className = 'selected-part__title';
      const name = document.createElement('h3');
      // Match the store/HUD: show the kid-facing label (e.g. "Zombie Blaster"),
      // falling back to the catalog name.
      name.textContent = KID_LABELS[def.id]?.name ?? def.name;
      const levelBadge = document.createElement('span');
      const maxLevel = def.upgrade?.maxLevel;
      levelBadge.textContent = maxLevel === undefined ? `LV ${level}` : `LV ${level}/${maxLevel}`;
      title.append(name, levelBadge);
      const description = document.createElement('p');
      description.className = 'selected-part__description';
      description.textContent = KID_LABELS[def.id]?.blurb ?? def.description;
      selectedContent.append(title, description);

      const statList = document.createElement('div');
      statList.className = 'selected-part__stats';
      for (const stat of effectiveStatLabels(effectiveDef ?? def)) {
        const row = document.createElement('div');
        const [labelText, valueText] = stat;
        const label = document.createElement('span');
        label.textContent = labelText;
        const value = document.createElement('strong');
        value.textContent = valueText;
        row.append(label, value);
        statList.appendChild(row);
      }
      selectedContent.appendChild(statList);

      if (effectiveDef?.wheel) {
        const advanced = document.createElement('details');
        advanced.className = 'selected-part__wheel-advanced';
        const advancedSummary = document.createElement('summary');
        advancedSummary.textContent = 'Advanced wheel setup';
        const config = document.createElement('div');
        config.className = 'selected-part__config';
        for (const [labelText, key] of [['Driven', 'driven'], ['Steering', 'steering'], ['Braking', 'braking']] as const) {
          const label = document.createElement('label');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.checked = key === 'steering'
            ? (partConfig?.steering ?? effectiveSteering ?? false)
            : partConfig?.[key] === true;
          input.addEventListener('change', () => handlers.onConfigChange(partId, key, input.checked));
          label.append(input, labelText);
          config.appendChild(label);
        }
        advanced.append(advancedSummary, config);
        selectedContent.appendChild(advanced);
      }

      if ((effectiveDef ?? def).ability) {
        const abilitySection = document.createElement('label');
        abilitySection.className = 'selected-part__ability';
        const abilityInput = document.createElement('input');
        abilityInput.type = 'checkbox';
        abilityInput.checked = partConfig?.activeAbility === true;
        abilityInput.addEventListener('change', () =>
          handlers.onConfigChange(partId, 'activeAbility', abilityInput.checked),
        );
        abilitySection.append(abilityInput, 'Bind to Q ability');
        selectedContent.appendChild(abilitySection);
      }

      const paintSection = document.createElement('div');
      paintSection.className = 'selected-part__paint';
      const paintLabel = document.createElement('span');
      paintLabel.textContent = 'Paint';
      const swatches = document.createElement('div');
      swatches.className = 'paint-swatches';
      for (const [paint, color] of Object.entries(PAINT_COLORS)) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'paint-swatch';
        swatch.style.background = `#${color.toString(16).padStart(6, '0')}`;
        swatch.title = `Paint ${paint}`;
        swatch.setAttribute('aria-label', `Paint ${paint}`);
        swatch.addEventListener('click', () => handlers.onConfigChange(partId, 'paint', paint));
        swatches.appendChild(swatch);
      }
      paintSection.append(paintLabel, swatches);
      selectedContent.appendChild(paintSection);

      const actions = document.createElement('div');
      actions.className = 'selected-part__actions';
      const repairCost = economy?.repairCost ?? null;
      if (repairCost !== null) {
        const repairButton = btn(
          repairCost === 0 ? 'Repair (free)' : `Repair  $${repairCost}`,
          () => handlers.onRepairPart(partId),
        );
        repairButton.className = 'primary selected-upgrade';
        repairButton.disabled = economy?.canRepair !== true;
        if (economy?.canRepair === false) {
          repairButton.title = 'Not enough money';
        }
        actions.appendChild(repairButton);
      }
      const nextPrice = economy?.nextUpgradePrice ?? null;
      const upgradePreview = economy?.upgradePreview;
      if (nextPrice !== null && upgradePreview) {
        const previewRows: [string, string][] = [];
        if (upgradePreview.before.totalDps !== upgradePreview.after.totalDps) {
          previewRows.push([
            'DPS',
            `${upgradePreview.before.totalDps.toFixed(1)} → ${upgradePreview.after.totalDps.toFixed(1)}`,
          ]);
        }
        if (upgradePreview.before.integrity !== upgradePreview.after.integrity) {
          previewRows.push([
            'Integrity',
            `${formatStat(upgradePreview.before.integrity)} → ${formatStat(upgradePreview.after.integrity)}`,
          ]);
        }
        if (
          upgradePreview.before.estimatedTopSpeedKph !==
          upgradePreview.after.estimatedTopSpeedKph
        ) {
          previewRows.push([
            'Top Speed',
            `${upgradePreview.before.estimatedTopSpeedKph.toFixed(0)} → ${upgradePreview.after.estimatedTopSpeedKph.toFixed(0)} km/h`,
          ]);
        }
        if (previewRows.length > 0) {
          const preview = document.createElement('div');
          preview.className = 'selected-part__upgrade-preview';
          const previewHeading = document.createElement('span');
          previewHeading.className = 'selected-part__upgrade-preview-title';
          previewHeading.textContent = 'Next upgrade';
          preview.appendChild(previewHeading);
          for (const [labelText, valueText] of previewRows) {
            const row = document.createElement('div');
            row.className = 'selected-part__upgrade-preview-row';
            const label = document.createElement('span');
            label.textContent = labelText;
            const value = document.createElement('strong');
            value.textContent = valueText;
            row.append(label, value);
            preview.appendChild(row);
          }
          selectedContent.appendChild(preview);
        }
      }
      const upgradeButton = btn(
        nextPrice === null ? 'Max Level' : `Upgrade  $${nextPrice}`,
        () => handlers.onUpgradePart(partId),
      );
      upgradeButton.className = 'primary selected-upgrade';
      upgradeButton.disabled = nextPrice === null || economy?.canUpgrade !== true;
      if (nextPrice !== null && economy?.canUpgrade === false) upgradeButton.title = 'Not enough money';
      actions.appendChild(upgradeButton);
      if (!def.isRoot) {
        actions.append(
          btn('Turn', () => handlers.onRotateSelected('y'), 'R'),
          btn('Flip', () => handlers.onRotateSelected('x'), 'F'),
          btn(`Sell  +$${economy?.sellRefund ?? 0}`, handlers.onDeleteSelected, 'Delete'),
        );
      }
      selectedContent.appendChild(actions);

      if (def.id === 'turret' && economy?.turretModules) {
        const moduleSection = document.createElement('div');
        moduleSection.className = 'selected-part__modules';
        for (const module of ['emp', 'piercing'] as const) {
          const moduleEconomy = economy.turretModules[module];
          const displayName = module === 'emp' ? 'EMP' : 'Piercing';
          const row = document.createElement('div');
          row.className = 'selected-part__module-row';
          const label = document.createElement('span');
          label.textContent = `${displayName}  L${moduleEconomy.level} / ${TURRET_MODULE_MAX_LEVEL}`;
          const buyButton = btn(
            moduleEconomy.targetLevel === null || moduleEconomy.price === null
              ? 'Max'
              : `${displayName} L${moduleEconomy.targetLevel}  $${moduleEconomy.price}`,
            () => handlers.onBuyTurretModule(partId, module),
          );
          buyButton.className = 'selected-part__module-buy';
          buyButton.disabled = !moduleEconomy.canBuy;
          if (!moduleEconomy.unlocked) {
            buyButton.title =
              'Clear wave 10 or kill a Phone Addict to unlock EMP';
          } else if (
            moduleEconomy.price !== null &&
            !moduleEconomy.canBuy
          ) {
            buyButton.title = 'Not enough money';
          }
          row.append(label, buyButton);
          moduleSection.appendChild(row);
        }
        selectedContent.appendChild(moduleSection);
      }
    },
    setEconomy: (money, unlockedDefIds, currentInventory, installedDefIds) => {
      moneyReadout.textContent = `$${money}`;
      const unlocked = new Set(unlockedDefIds);
      const installedCounts = new Map<string, number>();
      for (const defId of installedDefIds) {
        installedCounts.set(defId, (installedCounts.get(defId) ?? 0) + 1);
      }
      let stockCount = 0;
      for (const id of SIMPLE_PART_IDS) {
        const def = catalog[id];
        if (!def) continue;
        const storeButton = storeButtons.get(id);
        const inventoryButton = inventoryButtons.get(id);
        const countLabel = inventoryCountLabels.get(id);
        const count = Math.max(0, currentInventory[id] ?? 0);
        stockCount += count;
        if (inventoryButton) {
          inventoryButton.disabled = count <= 0;
          inventoryButton.classList.toggle('is-empty', count <= 0);
          inventoryButton.setAttribute('aria-label', `${def.name}, ${count} in inventory`);
        }
        if (countLabel) countLabel.textContent = `x${count}`;

        const locked = (def.unlockCost ?? 0) > 0 && !unlocked.has(def.id);
        const unlockPrice = def.unlockCost ?? 0;
        const price = locked ? unlockPrice + def.cost : def.cost;
        const unaffordable = price > money;
        const atOwnershipLimit =
          def.unique === true &&
          count + (installedCounts.get(id) ?? 0) >= 1;
        storeButton?.classList.toggle('locked', locked);
        storeButton?.classList.toggle('unaffordable', unaffordable);
        storeButton?.classList.toggle('limit-reached', atOwnershipLimit);
        storeButton?.classList.toggle(
          'has-unlock-milestone',
          locked && id === 'mine-sweeper',
        );
        if (storeButton) {
          storeButton.disabled = unaffordable || atOwnershipLimit;
          storeButton.setAttribute('aria-label', atOwnershipLimit
            ? `${def.name}, ownership limit reached`
            : locked
            ? `${def.name} — Unlock & Buy $${price}`
            : `${def.name} — Buy & Place $${price}`);
          storeButton.title = atOwnershipLimit
            ? `${def.name} limit reached: 1 owned or installed`
            : locked
            ? `Unlock ${def.name} and buy one part for $${price}`
            : `Buy one ${def.name} and arm it for placement for $${price}`;
        }
        const priceLabel = storePriceLabels.get(id);
        if (priceLabel) {
          priceLabel.textContent = atOwnershipLimit
            ? 'Limit 1'
            : locked
              ? `Unlock & Buy $${price}`
              : `Buy & Place $${price}`;
        }
        const priceBreakdown = storePriceBreakdowns.get(id);
        if (priceBreakdown) {
          priceBreakdown.hidden = !locked || atOwnershipLimit;
          priceBreakdown.textContent = id === 'mine-sweeper'
            ? `Unlock early $${unlockPrice} + Part $${def.cost}`
            : `Unlock $${unlockPrice} + Part $${def.cost}`;
        }
        const unlockMilestone = storeUnlockMilestones.get(id);
        if (unlockMilestone) {
          unlockMilestone.hidden =
            !locked || atOwnershipLimit || id !== 'mine-sweeper';
          unlockMilestone.textContent = 'Free after Wave 7';
        }
      }
      inventoryEmpty.style.display = stockCount > 0 ? 'none' : 'block';
    },
    setRunContext: (wave, summary, repair) => {
      menuBtn.style.display = wave === undefined ? '' : 'none';
      if (wave !== undefined) {
        runBannerText.textContent = repair
          ? `Next: Wave ${wave + 1} · Integrity ${Math.round(repair.integrityPct)}%`
          : `Next: Wave ${wave + 1} · Rebuild before continuing`;
        runBannerWarning.textContent = repair?.nextWaveNotice ?? '';
        runBannerWarning.hidden = repair?.nextWaveNotice === undefined;
        if (repair) {
          repairAllBtn.textContent = `Repair All $${repair.totalCost}`;
          repairAllBtn.disabled =
            repair.totalCost === 0 || !repair.canRepairAll;
          repairAllBtn.title =
            repair.totalCost === 0
              ? 'Nothing to repair'
              : repair.canRepairAll
                ? 'Fully repair all surviving parts'
                : 'Not enough money';
          runBanner.replaceChildren(
            runBannerText,
            runBannerWarning,
            repairAllBtn,
          );
        } else {
          runBanner.replaceChildren(runBannerText, runBannerWarning);
        }
        runBanner.style.display = 'block';
        runBanner.classList.remove('run-summary');
        runBanner.classList.add('run-active');
        fightBtn.textContent = `Start Wave ${wave + 1}`;
        return;
      }
      fightBtn.textContent = 'Fight Zombies';
      runBanner.classList.remove('run-active');
      if (summary) {
        const primary = document.createElement('div');
        primary.className = 'run-banner__summary-line';
        primary.textContent =
          `Run ended on Wave ${summary.failedWave} · ` +
          `$${summary.bankedMoneyRetained} banked money retained · ` +
          `$${summary.pendingMoneyDiscarded} failed-wave pending money discarded`;
        const recovery = document.createElement('div');
        recovery.className = 'run-banner__summary-line';
        recovery.textContent =
          `Wave ${summary.failedWave} checkpoint restored · ` +
          'Survivors recovered to full HP';
        const losses = document.createElement('div');
        losses.className = 'run-banner__summary-line';
        losses.textContent = `Earlier cleared-wave losses: ${
          summary.destroyedPartNames.length > 0
            ? summary.destroyedPartNames.join(', ')
            : 'None'
        }`;
        runBanner.replaceChildren(primary, recovery, losses);
        runBanner.style.display = 'block';
        runBanner.classList.add('run-summary');
      } else {
        runBanner.style.display = 'none';
        runBanner.classList.remove('run-summary');
      }
    },
    setArmedPart: (defId) => {
      if (armed) (armed === 'erase' ? eraseButton : inventoryButtons.get(armed))?.classList.remove('active');
      armed = defId;
      if (armed) (armed === 'erase' ? eraseButton : inventoryButtons.get(armed))?.classList.add('active');
      cancelButton.style.display = armed ? 'block' : 'none';
    },
    highlightPaletteButton: (defId) => {
      if (highlighted) inventoryButtons.get(highlighted)?.classList.remove('tutorial-glow');
      highlighted = defId;
      if (highlighted) inventoryButtons.get(highlighted)?.classList.add('tutorial-glow');
    },
    setStatus: (text) => { status.textContent = text; },
    setNotice: (text) => {
      noticeBanner.textContent = text;
      noticeBanner.style.display = 'block';
    },
    deny: (text) => {
      status.textContent = text;
      moneyReadout.classList.remove('deny-shake');
      void moneyReadout.offsetWidth;
      moneyReadout.classList.add('deny-shake');
    },
  };
}

function effectiveStatLabels(def: PartDefinition): [string, string][] {
  const labels: [string, string][] = [['Integrity', `${formatStat(def.health)} HP`]];
  if (def.engine) {
    const peakTorque = Math.max(0, ...def.engine.torqueCurve.map(([, torque]) => torque));
    labels.push(
      ['Power', `${formatStat(def.engine.maxPowerKw)} KW`],
      ['Torque', `${formatStat(peakTorque)} NM`],
    );
  }
  if (def.wheel) {
    labels.push(['Grip', `${def.wheel.frictionLong.toFixed(2)} / ${def.wheel.frictionLat.toFixed(2)}`]);
    labels.push([
      'Steering',
      def.wheel.skidSteer
        ? 'Tracked'
        : `${formatStat(def.wheel.maxSteerAngleDeg)}°`,
    ]);
  }
  if (def.weapon) {
    labels.push(
      ['Damage', formatStat(def.weapon.damage)],
      ['Fire Rate', `${formatStat(def.weapon.fireRate)} / S`],
      ['DPS', formatStat(def.weapon.damage * def.weapon.fireRate)],
      // Weapons have unlimited ammo now — fuel is the managed resource.
      ['Ammo', 'Unlimited'],
    );
  }
  if (def.ability?.kind === 'freeze') {
    labels.push(
      ['Activate', 'Press Q'],
      ['Freezes', `${formatStat(def.ability.baseTargets ?? 0)} zombies`],
      ['Duration', `${formatStat(def.ability.baseDurationSeconds)} S`],
      ['Cooldown', `${formatStat(def.ability.cooldownSeconds)} S`],
    );
  }
  if (def.ability?.kind === 'shield') {
    labels.push(
      ['Activate', 'Press Q'],
      ['Effect', 'Invulnerable'],
      ['Duration', `${formatStat(def.ability.baseDurationSeconds)} S`],
      ['Cooldown', `${formatStat(def.ability.cooldownSeconds)} S`],
    );
  }
  if (def.armour) labels.push(['Protection', formatStat(def.armour.protection)]);
  return labels;
}

function formatStat(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function buildWelcomeDialog(onStartTutorial: () => void, onClose: () => void): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'panel welcome-panel';
  const prompt = document.createElement('div');
  prompt.textContent = 'Want to learn how to build a truck?';
  const actions = document.createElement('div');
  actions.className = 'welcome-actions';
  const tutorial = document.createElement('button');
  tutorial.className = 'primary';
  tutorial.textContent = 'Start Tutorial';
  tutorial.addEventListener('click', onStartTutorial);
  const close = document.createElement('button');
  close.textContent = 'Explore Garage';
  close.addEventListener('click', onClose);
  actions.append(tutorial, close);
  wrap.append(prompt, actions);
  return wrap;
}

function buildHelpOverlay(): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'panel help-panel';
  wrap.innerHTML = `
    <div class="help-panel__header"><b>How to build a vehicle</b><button>Close</button></div>
    <div class="cat-title">quick start</div>
    <ol><li>Buy a part in the Store to add it to Inventory and arm it for immediate placement.</li>
    <li>Place the armed part, or select any loose Inventory part later. Green can place; red explains why it cannot.</li>
    <li>Build blocks around the Truck Heart. Everything needs to connect face-to-face.</li>
    <li>Select a placed part to upgrade, rotate, paint, or sell it in the right inspector.</li>
    <li>Use Test Drive when the vehicle is ready.</li></ol>
    <div class="cat-title">controls</div>
    <table><tr><td>Orbit / zoom</td><td>left-drag / mouse wheel; keys <b>1-5</b> choose views</td></tr>
    <tr><td>Rotate selected / held part</td><td><b>R</b> turn; <b>F</b> flip</td></tr>
    <tr><td>Erase</td><td>right-click, Erase Part, or <b>Delete</b> on a selected part</td></tr>
    <tr><td>Undo / redo</td><td>Ctrl+Z / Ctrl+Shift+Z</td></tr><tr><td>Layers</td><td>bottom slider slices the build by height</td></tr></table>`;
  return wrap;
}
