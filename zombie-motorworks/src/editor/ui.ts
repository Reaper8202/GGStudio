/** Garage DOM UI: store, inventory, vehicle stats, and selected-part inspector. */

import {
  HOTBAR_CAPACITY,
  resolveHotbar,
  toggleHotbarSlot,
  withHotbarSlot,
} from '../core/hotbar.ts';
import { ABILITY_SLOT_KEYS } from '../core/abilities.ts';
import { KID_LABELS, SIMPLE_PART_IDS } from '../core/tutorial.ts';
import {
  type PartDefinition,
  type PartConfig,
  type ValidationIssue,
  type VehicleAnalysisReport,
} from '../core/types.ts';
import {
  MAX_UPGRADE_STEPS,
  upgradeStars,
  upgradeStepsFor,
} from '../core/partUpgrades.ts';
import { upgradePrice } from '../core/upgrades.ts';

export interface EditorUIHandlers {
  /** Atomic production store action; old harnesses may omit this callback. */
  onPurchasePart?(defId: string): void;
  onBuyPart(defId: string): void;
  onArmPart(defId: string): void;
  /** The player re-curated the build bar; older harnesses may omit this. */
  onHotbarChange?(defIds: readonly string[]): void;
  onCancelTool(): void;
  newGarageDisposalSummary(): NewGarageDisposalSummary;
  onNew(): void;
  onMenu(): void;
  onSaveAndQuit(): void;
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
  /** A box in the garage ability planner was clicked: load the next ability. */
  onAbilitySlotClick(slot: number): void;
  onUpgradePart(partId: string): void;
  onRepairPart(partId: string): void;
  onRepairAll(): void;
  onDeleteSelected(): void;
  /** Take the selection off the rig and back into owned stock, not for cash. */
  onReturnSelected(): void;
  onRotateSelected(axis: 'y' | 'x'): void;
}

export interface SelectedPartEconomy {
  nextUpgradePrice: number | null;
  canUpgrade: boolean;
  sellRefund: number;
  repairCost: number | null;
  canRepair: boolean;
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

export interface RunSummary {
  failedWave: number;
  /** Final arcade score recorded on the leaderboard. */
  score: number;
  kills: number;
  isPersonalBest: boolean;
  /** 1-based local-board rank, or null when the run did not place. */
  rank: number | null;
  destroyedPartNames: string[];
}

export interface NewGarageDisposalSummary {
  partCount: number;
  investment: number;
  refund: number;
  forfeited: number;
}

/** One box of the garage's ability planner; null when the box is empty. */
export interface AbilityLoadoutSlotView {
  /** Ability name, e.g. "Cryo Nova". */
  name: string;
  /** Single glyph for the ability's kind. */
  glyph: string;
  /** Placed part supplying it, e.g. "Ice Cannon". */
  partName: string;
  /** Hover text: what the ability does. */
  blurb: string;
}

/** Where a selected ability part stands in the three-slot survival bar. */
export interface AbilitySlotStatus {
  /** Key of the slot it fills (`q`/`e`/`r`), or null when it missed the cut. */
  key: string | null;
  /** Ability parts on the rig right now. */
  candidates: number;
  /** Slots the bar has. */
  capacity: number;
  /**
   * Upgrade level this part has to reach before its ability can be equipped at
   * all, or null once it has. Set means the part missed the cut because it is
   * not upgraded far enough, not because the bar is full.
   */
  lockedUntilLevel: number | null;
}

export interface RunRepairEconomy {
  integrityPct: number;
  totalCost: number;
  canRepairAll: boolean;
  nextWaveNotice?: string;
}

type StoreGroup = 'essentials' | 'weapons' | 'defence' | 'mobility';

/**
 * Catalog parts filed under `weapon` that are bought for defence: they carry no
 * normal fire, only an ability the player reaches for when the rig is in
 * trouble — a bubble to hide behind, or a ring to shove a swarm off the doors.
 */
const DEFENSIVE_WEAPON_PART_IDS = new Set([
  'shield-generator',
  'pulse-emitter',
]);

/** Catalog parts filed under `weapon` that are really about getting around. */
const MOBILITY_WEAPON_PART_IDS = new Set(['nitro-injector', 'phase-drive']);

function storeGroupForPart(def: PartDefinition): StoreGroup {
  if (def.category === 'movement' || MOBILITY_WEAPON_PART_IDS.has(def.id)) {
    return 'mobility';
  }
  if (def.category === 'protection' || DEFENSIVE_WEAPON_PART_IDS.has(def.id)) {
    return 'defence';
  }
  if (def.category === 'weapon') return 'weapons';
  return 'essentials';
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
    abilitySlot?: AbilitySlotStatus,
  ): void;
  /** Fill the garage ability planner; entries are per box, null when empty. */
  setAbilityLoadout(slots: readonly (AbilityLoadoutSlotView | null)[]): void;
  setEconomy(
    money: number,
    unlockedDefIds: readonly string[],
    inventory: Readonly<Record<string, number>>,
    installedDefIds: readonly string[],
    /** Chosen build-bar block types; omit to seed one from the inventory. */
    hotbarDefIds?: readonly string[],
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
  /**
   * Shortcut hint pinned to the current selection in the viewport. EditorMode
   * owns its position; `buildEditorUI` only owns its contents.
   */
  selectionTip: HTMLDivElement;
}

interface CollapsiblePanel {
  panel: HTMLElement;
  body: HTMLElement;
  setCollapsed(collapsed: boolean): void;
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
  const setCollapsed = (collapsed: boolean): void => {
    panel.classList.toggle('is-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${titleText}`);
  };
  toggle.addEventListener('click', () =>
    setCollapsed(!panel.classList.contains('is-collapsed')),
  );
  header.append(title, toggle);
  panel.append(header, body);
  return { panel, body, setCollapsed };
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

/**
 * Star rating for a part's unlocks: one filled star per unlock bought, five
 * slots always drawn so an untouched part reads as "0 of 5" at a glance rather
 * than as a part without upgrades at all.
 */
function buildStarRating(level: number): HTMLElement {
  const earned = upgradeStars(level);
  const rating = document.createElement('div');
  rating.className = 'selected-part__rating';
  rating.setAttribute('role', 'img');
  rating.setAttribute('aria-label', `${earned} of ${MAX_UPGRADE_STEPS} upgrades fitted`);
  const stars = document.createElement('span');
  stars.className = 'selected-part__stars';
  for (let i = 0; i < MAX_UPGRADE_STEPS; i++) {
    const star = document.createElement('span');
    star.className = i < earned ? 'star is-earned' : 'star';
    star.textContent = i < earned ? '★' : '☆';
    stars.appendChild(star);
  }
  const count = document.createElement('span');
  count.className = 'selected-part__rating-count';
  count.textContent = `${earned}/${MAX_UPGRADE_STEPS}`;
  rating.append(stars, count);
  return rating;
}

/** The stat changes the next unlock would make, as `before → after` rows. */
function upgradeDeltaRows(
  preview: NonNullable<SelectedPartEconomy['upgradePreview']>,
): [string, string][] {
  const rows: [string, string][] = [];
  if (preview.before.totalDps !== preview.after.totalDps) {
    rows.push([
      'DPS',
      `${preview.before.totalDps.toFixed(1)} → ${preview.after.totalDps.toFixed(1)}`,
    ]);
  }
  if (preview.before.integrity !== preview.after.integrity) {
    rows.push([
      'Integrity',
      `${formatStat(preview.before.integrity)} → ${formatStat(preview.after.integrity)}`,
    ]);
  }
  if (preview.before.estimatedTopSpeedKph !== preview.after.estimatedTopSpeedKph) {
    rows.push([
      'Top Speed',
      `${preview.before.estimatedTopSpeedKph.toFixed(0)} → ${preview.after.estimatedTopSpeedKph.toFixed(0)} km/h`,
    ]);
  }
  return rows;
}

/**
 * The part's unlock chain: every upgrade it can ever fit, named and priced,
 * with the ones already bought ticked off and exactly one buyable — the next
 * link. Buying is the same `onUpgradePart` call as before; what changed is that
 * the player can see what the money buys before spending it.
 */
function buildUpgradeSection(
  def: PartDefinition,
  level: number,
  economy: SelectedPartEconomy | undefined,
  onUnlock: () => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'selected-part__upgrades';

  const heading = document.createElement('div');
  heading.className = 'selected-part__upgrades-title';
  const headingText = document.createElement('span');
  headingText.textContent = 'Upgrades';
  const headingCount = document.createElement('span');
  headingCount.textContent = `${upgradeStars(level)}/${MAX_UPGRADE_STEPS} unlocked`;
  heading.append(headingText, headingCount);
  section.appendChild(heading);

  const steps = upgradeStepsFor(def);
  const nextStep = steps.find((step) => step.level === level + 1);

  if (!nextStep) {
    const maxed = document.createElement('p');
    maxed.className = 'selected-part__upgrades-maxed';
    maxed.textContent = `Fully upgraded — all ${MAX_UPGRADE_STEPS} unlocks fitted.`;
    section.appendChild(maxed);
    return section;
  }

  const price = economy?.nextUpgradePrice ?? upgradePrice(def, nextStep.level) ?? 0;
  const unlock = document.createElement('button');
  unlock.type = 'button';
  unlock.className = 'upgrade-unlock';
  unlock.disabled = economy?.canUpgrade !== true;
  if (economy?.canUpgrade === false) unlock.title = 'Not enough money';
  const unlockIcon = document.createElement('span');
  unlockIcon.className = 'upgrade-unlock__icon';
  unlockIcon.textContent = nextStep.icon;
  const unlockText = document.createElement('span');
  unlockText.className = 'upgrade-unlock__text';
  const unlockLead = document.createElement('strong');
  unlockLead.textContent = `Unlock ${nextStep.name}`;
  const unlockBlurb = document.createElement('span');
  unlockBlurb.textContent = nextStep.blurb;
  unlockText.append(unlockLead, unlockBlurb);
  const unlockCost = document.createElement('span');
  unlockCost.className = 'upgrade-unlock__cost';
  unlockCost.textContent = `$${price}`;
  unlock.append(unlockIcon, unlockText, unlockCost);
  unlock.addEventListener('click', onUnlock);
  section.appendChild(unlock);

  const deltaRows = economy?.upgradePreview
    ? upgradeDeltaRows(economy.upgradePreview)
    : [];
  if (deltaRows.length > 0) {
    const preview = document.createElement('div');
    preview.className = 'selected-part__upgrade-preview';
    for (const [labelText, valueText] of deltaRows) {
      const row = document.createElement('div');
      row.className = 'selected-part__upgrade-preview-row';
      const label = document.createElement('span');
      label.textContent = labelText;
      const value = document.createElement('strong');
      value.textContent = valueText;
      row.append(label, value);
      preview.appendChild(row);
    }
    section.appendChild(preview);
  }

  // One step of lookahead and no more. Showing the whole chain turned the panel
  // into a price list; showing what comes after the current buy is enough to
  // make saving up a decision.
  const afterStep = steps.find((step) => step.level === nextStep.level + 1);
  if (afterStep) {
    const row = document.createElement('div');
    row.className = 'upgrade-step is-locked';
    const icon = document.createElement('span');
    icon.className = 'upgrade-step__icon';
    icon.textContent = afterStep.icon;
    const text = document.createElement('span');
    text.className = 'upgrade-step__text';
    const name = document.createElement('strong');
    name.textContent = `Then: ${afterStep.name}`;
    const blurb = document.createElement('span');
    blurb.textContent = afterStep.blurb;
    text.append(name, blurb);
    const status = document.createElement('span');
    status.className = 'upgrade-step__status';
    status.textContent = `$${upgradePrice(def, afterStep.level) ?? 0}`;
    row.append(icon, text, status);
    section.appendChild(row);
  }
  return section;
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
      <path d="M8 40H50V48H8Z" fill="#2a2e28"/>
      <path d="M12 22 20 16H42L48 22V36L40 40H18L12 36Z" fill="#4a5044"/>
      <path d="M34 20H58V28H34Z" fill="#8a5035"/>
      <path d="M53 17H61V31H53Z" fill="#2a2e28"/>
    `,
    'barrel-drum': `
      <path d="M10 24H54V44H10Z" fill="#6b4a2e"/>
      <ellipse cx="10" cy="34" rx="5" ry="10" fill="#4a3320"/>
      <ellipse cx="54" cy="34" rx="5" ry="10" fill="#8a5035"/>
      <path d="M14 22H18V26H14ZM26 20H30V24H26ZM38 22H42V26H38ZM20 42H24V46H20ZM32 44H36V48H32ZM44 42H48V46H44Z" fill="#242923"/>
      <path d="M10 30H54M10 38H54" stroke="#4a3320" stroke-width="2"/>
    `,
    'spike-ram': `
      <circle cx="32" cy="32" r="8" fill="#4b5245"/>
      <path d="M32 6 36 20 28 20Z" fill="#8a939c"/>
      <path d="M32 58 36 44 28 44Z" fill="#8a939c"/>
      <path d="M6 32 20 36 20 28Z" fill="#8a939c"/>
      <path d="M58 32 44 36 44 28Z" fill="#8a939c"/>
      <path d="M14 14 24 24 18 26 12 20Z" fill="#8a939c"/>
      <path d="M50 50 40 40 46 38 52 44Z" fill="#8a939c"/>
    `,
    sawblade: `
      <circle cx="32" cy="32" r="20" fill="#5c6570" stroke="#242923" stroke-width="2"/>
      <circle cx="32" cy="32" r="6" fill="#242923"/>
      <path d="M32 8 36 16 28 16ZM32 56 36 48 28 48ZM8 32 16 28 16 36ZM56 32 48 36 48 28Z" fill="#8a939c"/>
      <path d="M12 12 20 16 16 20ZM52 52 44 48 48 44ZM12 52 16 44 20 48ZM52 12 48 20 44 16Z" fill="#8a939c"/>
    `,
    // Curved mouldboard seen from its working side, wings capping both ends
    // and a shoved heap of bodies piling up against the face.
    'dozer-blade': `
      <path d="M10 16H16V50H10ZM48 16H54V50H48Z" fill="#8a6f17"/>
      <path d="M16 18H48V22H16Z" fill="#e0bc3c"/>
      <path d="M16 22H48V42H16Z" fill="#c9a227"/>
      <path d="M16 42H48V48H16Z" fill="#8a6f17"/>
      <path d="M16 48H48V52H16Z" fill="#c6cdd4"/>
      <path d="M22 22H26V42H22ZM38 22H42V42H38Z" fill="#a8871c"/>
      <path d="M20 30H44V34H20Z" fill="#e0bc3c"/>
      <path d="M18 52H24V58H18ZM28 50H34V58H28ZM40 52H46V58H40Z" fill="#4c6b3f"/>
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
    // Emitter dome throwing two rings of force outward.
    'pulse-emitter': `
      ${common}
      <path d="M24 20 32 16 40 20V26L32 30 24 26Z" fill="#7a53c8"/>
      <path d="M27 20 32 17 37 20 32 23Z" fill="#cbb4ff"/>
      <path d="M12 20 20 16M52 20 44 16M12 32 20 28M52 32 44 28" stroke="#b79bf0" stroke-width="4" fill="none"/>
      <path d="M4 26 12 21M60 26 52 21" stroke="#7a53c8" stroke-width="4" fill="none"/>
    `,
    // Strapped pressure bottles over a solenoid, venting a jet out the back.
    'nitro-injector': `
      ${common}
      <path d="M20 14H32V44H20Z" fill="#76837c"/>
      <path d="M20 14H25V44H20Z" fill="#a8b3ac"/>
      <path d="M34 18H44V44H34Z" fill="#67736d"/>
      <path d="M34 18H38V44H34Z" fill="#93a09a"/>
      <path d="M23 10H29V15H23ZM36 14H42V19H36Z" fill="#2a2e28"/>
      <path d="M20 26H32V31H20Z" fill="#3fbd7a"/>
      <path d="M34 29H44V33H34Z" fill="#3fbd7a"/>
      <path d="M18 20H46V23H18ZM18 38H46V41H18Z" fill="#20241f"/>
      <path d="M14 44H48V50H14Z" fill="#4a5049"/>
      <circle cx="44" cy="47" r="2" fill="#7bffbc"/>
      <path d="M8 46 16 44 12 50 20 52 4 56Z" fill="#e0a13e"/>
      <path d="M9 49 15 47 13 51Z" fill="#fff3c4"/>
    `,
    // Chromed spine in a lit trough: scales widening towards the muzzle.
    'phase-drive': `
      ${common}
      <path d="M6 30H58V36H6Z" fill="#1b2c33"/>
      <path d="M8 32H56V34H8Z" fill="#2fe3d0"/>
      <path d="M10 26H16V38H10Z" fill="#8d97a1"/>
      <path d="M12 24H14V40H12Z" fill="#cfd6dd"/>
      <path d="M20 24H27V40H20Z" fill="#9aa4ae"/>
      <path d="M22 22H25V42H22Z" fill="#dfe6ec"/>
      <path d="M31 22H39V42H31Z" fill="#9aa4ae"/>
      <path d="M33 20H37V44H33Z" fill="#dfe6ec"/>
      <path d="M17 30H20V34H17ZM28 30H31V34H28ZM43 30H46V34H43Z" fill="#2fe3d0"/>
      <path d="M46 24H50V40H46Z" fill="#8d97a1"/>
      <path d="M52 26H56V38H52Z" fill="#3f9dff"/>
      <path d="M53 30H55V34H53Z" fill="#d9fff9"/>
      <path d="M12 27H14V29H12ZM23 25H25V27H23ZM34 23H36V25H34ZM12 39H14V41H12ZM23 41H25V43H23ZM34 43H36V45H34Z" fill="#2a2e28"/>
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

/**
 * Blocky history arrows for the top bar. Inline (rather than a data URI) so the
 * glyph inherits the button's colour through hover and the disabled state.
 */
const UNDO_ICON_SVG =
  `<svg class="icon-btn__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
  `<path d="M10 4 2 10l8 6z" fill="currentColor"/>` +
  `<path d="M9 10h6a5 5 0 0 1 0 10h-4" fill="none" stroke="currentColor" stroke-width="3"/>` +
  `</svg>`;
const REDO_ICON_SVG =
  `<svg class="icon-btn__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
  `<path d="M14 4l8 6-8 6z" fill="currentColor"/>` +
  `<path d="M15 10H9a5 5 0 0 0 0 10h4" fill="none" stroke="currentColor" stroke-width="3"/>` +
  `</svg>`;
const MIRROR_ICON_SVG =
  `<svg class="icon-btn__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
  `<path d="M12 2v20" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="2 2"/>` +
  `<path d="M3 7h6v10H3zM15 7h6v10h-6z" fill="currentColor"/>` +
  `</svg>`;
const CANCEL_ICON_SVG =
  `<svg class="icon-btn__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
  `<path d="M5 8 8 5l11 11-3 3zM19 8 16 5 5 16l3 3z" fill="currentColor"/>` +
  `</svg>`;
/** Price tag: the sell button's mark, so the action reads before the label. */
const SELL_ICON_SVG =
  `<svg class="selected-part__action-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
  `<path d="M2 12 12 2h10v10L12 22z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>` +
  `<path d="M16 6h3v3h-3z" fill="currentColor"/>` +
  `</svg>`;
/** Block dropping into an open crate: putting a part back into inventory. */
const STOW_ICON_SVG =
  `<svg class="selected-part__action-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
  `<path d="M9 2h6v5h4l-7 7-7-7h4z" fill="currentColor"/>` +
  `<path d="M3 15v7h18v-7" fill="none" stroke="currentColor" stroke-width="2.4"/>` +
  `</svg>`;
/** Turn arrow, paired with the sell tag so both actions carry a mark. */
const TURN_ICON_SVG =
  `<svg class="selected-part__action-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
  `<path d="M12 5a7 7 0 1 0 7 7" fill="none" stroke="currentColor" stroke-width="2.4"/>` +
  `<path d="M12 1 8 5l4 4z" fill="currentColor"/>` +
  `</svg>`;

/** Crate-of-blocks mark for the inventory button on the build bar. */
function inventoryIcon(): HTMLImageElement {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">` +
    `<path d="M4 6H28V26H4Z" fill="#20241f" stroke="#737b67" stroke-width="2"/>` +
    `<path d="M8 10H14V15H8ZM18 10H24V15H18ZM8 18H14V23H8ZM18 18H24V23H18Z" fill="#89995a"/>` +
    `</svg>`;
  const image = document.createElement('img');
  image.className = 'inventory-toggle__icon';
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

  /** Square, label-free button carrying an inline SVG glyph. */
  const iconBtn = (
    svg: string,
    label: string,
    fn: () => void,
    hint: string,
  ): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-btn';
    button.innerHTML = svg;
    button.title = `${label} (${hint})`;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', fn);
    return button;
  };

  /** Glyph + label, with an optional trailing figure such as a refund price. */
  const iconLabelBtn = (
    svg: string,
    label: string,
    fn: () => void,
    figure?: string,
  ): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    const glyph = document.createElement('span');
    glyph.className = 'selected-part__action-icon';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.innerHTML = svg;
    const text = document.createElement('span');
    text.className = 'selected-part__action-label';
    text.textContent = label;
    button.append(glyph, text);
    if (figure !== undefined) {
      const amount = document.createElement('strong');
      amount.className = 'selected-part__action-figure';
      amount.textContent = figure;
      button.appendChild(amount);
    }
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
  const saveAndQuitBtn = btn('Save & Quit', handlers.onSaveAndQuit);
  // Banking a wave only means something inside a run; `setRunContext` reveals
  // this in place of Menu once one is active.
  saveAndQuitBtn.style.display = 'none';
  const newGarageBtn = btn('New Garage', () =>
    openNewGarageDialog(newGarageBtn),
  );
  newGarageBtn.setAttribute('aria-haspopup', 'dialog');
  top.append(nameInput, newGarageBtn);
  const history = document.createElement('div');
  history.className = 'topbar-history';
  const undoBtn = iconBtn(UNDO_ICON_SVG, 'Undo', handlers.onUndo, 'Ctrl+Z');
  const redoBtn = iconBtn(REDO_ICON_SVG, 'Redo', handlers.onRedo, 'Ctrl+Shift+Z');
  history.append(undoBtn, redoBtn);
  top.appendChild(history);
  let symmetry = false;
  const symmetryBtn = iconBtn(
    MIRROR_ICON_SVG,
    'Mirror build',
    () => {
      symmetry = !symmetry;
      symmetryBtn.classList.toggle('active', symmetry);
      symmetryBtn.setAttribute('aria-pressed', String(symmetry));
      symmetryBtn.setAttribute(
        'aria-label',
        `Mirror build, ${symmetry ? 'on' : 'off'}`,
      );
      symmetryBtn.title = `Mirror build: ${symmetry ? 'on' : 'off'}`;
      handlers.onSymmetryToggle(symmetry);
    },
    'off',
  );
  symmetryBtn.setAttribute('aria-pressed', 'false');
  symmetryBtn.setAttribute('aria-label', 'Mirror build, off');
  symmetryBtn.title = 'Mirror build: off';
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
  top.appendChild(viewSelect);

  // Build height lives in the top bar beside the view picker: it slices the
  // model the same way the camera presets do, so the two belong together.
  const layerControl = document.createElement('label');
  layerControl.className = 'topbar-layer';
  const layerLabel = document.createElement('span');
  layerLabel.className = 'topbar-layer__label';
  layerLabel.textContent = 'Height';
  const layerSlider = document.createElement('input');
  layerSlider.type = 'range';
  layerSlider.className = 'topbar-layer__slider';
  layerSlider.min = '-1';
  layerSlider.max = '8';
  layerSlider.value = '-1';
  layerSlider.setAttribute('aria-label', 'Build height');
  const layerValue = document.createElement('span');
  layerValue.className = 'topbar-layer__value';
  layerValue.textContent = 'All';
  layerSlider.addEventListener('input', () => {
    const layer = Number(layerSlider.value);
    const text = layer < 0 ? 'All' : String(layer);
    layerValue.textContent = text;
    layerSlider.setAttribute('aria-valuetext', text);
    layerControl.title = `Build height: ${text}`;
    handlers.onLayerChange(layer);
  });
  layerSlider.setAttribute('aria-valuetext', 'All');
  layerControl.title = 'Build height: All';
  layerControl.append(layerLabel, layerSlider, layerValue);
  top.appendChild(layerControl);

  const utilityButtons = document.createElement('div');
  utilityButtons.className = 'topbar-utilities';
  utilityButtons.append(
    menuBtn,
    saveAndQuitBtn,
    btn('Tutorial', handlers.onStartTutorial),
    btn('Help', () => toggleHelp()),
  );
  top.appendChild(utilityButtons);
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

  // With the bottom bar gone the status line floats just above the build bar,
  // and stays invisible (`:empty`) until there is something to say.
  const status = document.createElement('div');
  status.className = 'status garage-status';
  status.setAttribute('role', 'status');
  root.appendChild(status);
  const setStatus = (text: string): void => {
    status.textContent = text;
  };

  const garageDock = document.createElement('aside');
  garageDock.className = 'garage-dock';
  root.appendChild(garageDock);

  const store = buildCollapsiblePanel('Store', 'store-panel');
  const storeSearch = document.createElement('input');
  storeSearch.type = 'search';
  storeSearch.className = 'store-search';
  storeSearch.placeholder = 'Search parts...';
  storeSearch.setAttribute('aria-label', 'Search store parts');
  storeSearch.autocomplete = 'off';
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
  const defenceFilter = document.createElement('button');
  defenceFilter.type = 'button';
  defenceFilter.textContent = 'Defence';
  defenceFilter.setAttribute('aria-pressed', 'false');
  const mobilityFilter = document.createElement('button');
  mobilityFilter.type = 'button';
  mobilityFilter.textContent = 'Mobility';
  mobilityFilter.setAttribute('aria-pressed', 'false');
  storeFilters.append(
    essentialsFilter,
    weaponsFilter,
    defenceFilter,
    mobilityFilter,
  );
  const storeContent = document.createElement('div');
  storeContent.className = 'dock-list store-list';
  const storeEmpty = document.createElement('p');
  storeEmpty.className = 'store-empty';
  storeEmpty.textContent = 'No matching parts';
  storeEmpty.setAttribute('aria-live', 'polite');
  storeEmpty.hidden = true;
  // Tiles carry their price as their `order`, so park the placeholder past them.
  storeEmpty.style.order = '999999';
  store.body.append(storeSearch, storeFilters, storeContent);

  garageDock.appendChild(store.panel);

  // Inventory lives in a popover over the build bar rather than in the dock, so
  // the model keeps the middle of the screen until the player goes looking.
  const inventoryPopover = document.createElement('div');
  inventoryPopover.className = 'inventory-popover';
  inventoryPopover.id = 'garage-inventory-popover';
  inventoryPopover.hidden = true;
  const inventoryHint = document.createElement('p');
  inventoryHint.className = 'inventory-hint';
  const inventoryContent = document.createElement('div');
  inventoryContent.className = 'dock-list inventory-grid';
  const inventoryEmpty = document.createElement('p');
  inventoryEmpty.className = 'inventory-empty';
  inventoryEmpty.textContent = 'Buy parts in the Store to stock your inventory';
  inventoryEmpty.setAttribute('aria-live', 'polite');
  inventoryPopover.append(inventoryHint, inventoryContent);

  const storeButtons = new Map<string, HTMLButtonElement>();
  const storePriceLabels = new Map<string, HTMLElement>();
  const storePriceBreakdowns = new Map<string, HTMLElement>();
  const storeUnlockMilestones = new Map<string, HTMLElement>();
  const inventoryButtons = new Map<string, HTMLButtonElement>();
  const inventoryCountLabels = new Map<string, HTMLElement>();
  const inventorySlotBadges = new Map<string, HTMLElement>();
  let armed: string | null = null;
  let highlighted: string | null = null;
  let hotbar: string[] = [];
  let stock: Readonly<Record<string, number>> = {};

  for (const id of SIMPLE_PART_IDS) {
    const def = catalog[id];
    if (!def) continue;
    const displayName = KID_LABELS[id]?.name ?? def.name;
    const description = KID_LABELS[id]?.blurb ?? def.description;

    const storeButton = document.createElement('button');
    storeButton.className = 'part-btn store-item';
    storeButton.dataset.partId = id;
    storeButton.dataset.storeGroup = storeGroupForPart(def);
    storeButton.dataset.searchText = [
      displayName,
      def.name,
      description,
      def.description,
    ].join(' ').toLocaleLowerCase();
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
    storeButton.addEventListener('animationend', () =>
      storeButton.classList.remove('is-revealed'),
    );
    storeContent.appendChild(storeButton);
    storeButtons.set(id, storeButton);
    storePriceLabels.set(id, price);
    storePriceBreakdowns.set(id, priceBreakdown);
    storeUnlockMilestones.set(id, unlockMilestone);

    const inventoryButton = document.createElement('button');
    inventoryButton.className = 'part-btn inventory-item inventory-tile';
    inventoryButton.type = 'button';
    inventoryButton.dataset.partId = id;
    inventoryButton.hidden = true;
    const inventoryName = document.createElement('strong');
    inventoryName.textContent = displayName;
    const inventoryPreview = partThumbnail(def);
    const inventoryBlurb = document.createElement('small');
    inventoryBlurb.className = 'part-description';
    inventoryBlurb.textContent = description;
    const count = document.createElement('small');
    count.className = 'inventory-count';
    count.textContent = 'x0';
    const slotBadge = document.createElement('small');
    slotBadge.className = 'inventory-tile__slot';
    slotBadge.hidden = true;
    inventoryButton.append(
      inventoryName,
      inventoryPreview,
      inventoryBlurb,
      count,
      slotBadge,
    );
    inventoryButton.addEventListener('click', () => toggleHotbarEntry(id));
    inventoryContent.appendChild(inventoryButton);
    inventoryButtons.set(id, inventoryButton);
    inventoryCountLabels.set(id, count);
    inventorySlotBadges.set(id, slotBadge);
  }
  storeContent.appendChild(storeEmpty);
  inventoryContent.appendChild(inventoryEmpty);

  // The build bar: a fixed row of slots, one per chosen block type. Slots keep
  // their position whatever the inventory does, so muscle memory survives
  // buying, placing, and running a type down to zero.
  const hotbarPanel = document.createElement('section');
  hotbarPanel.className = 'panel hotbar-panel';
  hotbarPanel.setAttribute('aria-label', 'Active block selection');
  const hotbarList = document.createElement('div');
  // `inventory-list` is the long-standing hook for the bar in tests.
  hotbarList.className = 'inventory-list hotbar-list';

  const inventoryToggle = document.createElement('button');
  inventoryToggle.type = 'button';
  inventoryToggle.className = 'inventory-toggle';
  inventoryToggle.setAttribute('aria-expanded', 'false');
  inventoryToggle.setAttribute('aria-controls', inventoryPopover.id);
  const inventoryToggleIcon = inventoryIcon();
  const inventoryToggleBadge = document.createElement('small');
  inventoryToggleBadge.className = 'inventory-toggle__badge';
  inventoryToggle.append(inventoryToggleIcon, inventoryToggleBadge);
  const setInventoryOpen = (open: boolean): void => {
    inventoryPopover.hidden = !open;
    inventoryToggle.classList.toggle('active', open);
    inventoryToggle.setAttribute('aria-expanded', String(open));
    inventoryToggle.setAttribute(
      'aria-label',
      open ? 'Close inventory' : 'Open inventory',
    );
    inventoryToggle.title = open
      ? 'Close inventory'
      : 'Inventory — pick which blocks sit on the build bar';
  };
  inventoryToggle.addEventListener('click', () =>
    setInventoryOpen(inventoryPopover.hidden),
  );
  setInventoryOpen(false);

  // Only shown while a tool is armed, so the resting bar stays just slots.
  const cancelButton = iconBtn(
    CANCEL_ICON_SVG,
    'Cancel Tool',
    handlers.onCancelTool,
    'Esc',
  );
  cancelButton.classList.add('cancel-tool');
  cancelButton.style.display = 'none';

  hotbarPanel.append(
    inventoryPopover,
    cancelButton,
    hotbarList,
    inventoryToggle,
  );
  root.appendChild(hotbarPanel);

  // Anything else the player touches — canvas, store, topbar — dismisses it.
  window.addEventListener('pointerdown', (event) => {
    if (inventoryPopover.hidden) return;
    const target = event.target;
    if (
      target instanceof Node &&
      (inventoryPopover.contains(target) || inventoryToggle.contains(target))
    ) {
      return;
    }
    setInventoryOpen(false);
  });
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || inventoryPopover.hidden) return;
    setInventoryOpen(false);
    inventoryToggle.focus();
  });

  interface HotbarSlotView {
    defId: string | null;
    button: HTMLButtonElement;
    name: HTMLElement;
    art: HTMLElement;
    count: HTMLElement;
  }

  const hotbarSlots: HotbarSlotView[] = Array.from(
    { length: HOTBAR_CAPACITY },
    (_, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'part-btn inventory-item hotbar-slot';
      const key = document.createElement('span');
      key.className = 'hotbar-slot__index';
      key.setAttribute('aria-hidden', 'true');
      key.textContent = String(index + 1);
      // Kept for screen readers; the visible slot is art plus count only.
      const name = document.createElement('strong');
      name.className = 'hotbar-slot__name';
      const art = document.createElement('span');
      art.className = 'hotbar-slot__art';
      const count = document.createElement('small');
      count.className = 'inventory-count';
      button.append(key, name, art, count);
      const slot: HotbarSlotView = { defId: null, button, name, art, count };
      button.addEventListener('click', () => {
        if (!slot.defId) {
          setStatus(
            'Empty slot - open the Inventory button on the bar to fill it',
          );
          return;
        }
        // A slot the player has run down to zero is a shopping list entry, not
        // a dead button: send them straight to its shelf in the store.
        if ((stock[slot.defId] ?? 0) <= 0) {
          revealInStore(slot.defId);
          return;
        }
        if (armed === slot.defId) handlers.onCancelTool();
        else handlers.onArmPart(slot.defId);
      });
      // Right-click clears a slot without a trip to the inventory grid.
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        if (slot.defId) toggleHotbarEntry(slot.defId);
      });
      hotbarList.appendChild(button);
      return slot;
    },
  );

  /** Repaints slot art, stock, and armed/tutorial state from `hotbar`. */
  const renderHotbar = (): void => {
    hotbarSlots.forEach((slot, index) => {
      const defId = hotbar[index] ?? null;
      const def = defId === null ? undefined : catalog[defId];
      slot.defId = def ? defId : null;
      if (!def || slot.defId === null) {
        delete slot.button.dataset.partId;
        slot.button.classList.add('hotbar-slot--empty');
        slot.button.classList.remove('is-out-of-stock');
        slot.name.textContent = '';
        slot.count.textContent = '';
        slot.art.replaceChildren();
        slot.button.setAttribute('aria-label', `Slot ${index + 1}, empty`);
        slot.button.title = 'Open the Inventory button to pick a block';
        return;
      }
      const count = Math.max(0, stock[slot.defId] ?? 0);
      const displayName = KID_LABELS[slot.defId]?.name ?? def.name;
      slot.button.dataset.partId = slot.defId;
      slot.button.classList.remove('hotbar-slot--empty');
      slot.button.classList.toggle('is-out-of-stock', count <= 0);
      slot.name.textContent = displayName;
      slot.count.textContent = `x${count}`;
      slot.art.replaceChildren(partThumbnail(def));
      slot.button.setAttribute(
        'aria-label',
        count > 0
          ? `Slot ${index + 1}, ${displayName}, ${count} in inventory`
          : `Slot ${index + 1}, ${displayName}, none left — show it in the store`,
      );
      slot.button.title =
        count > 0
          ? `Arm ${displayName} (right-click to clear the slot)`
          : `${displayName} - none left, click to find it in the Store`;
    });
    applyToolStates();
  };

  /** Mirrors armed tool and tutorial glow onto the bar and inventory grid. */
  const applyToolStates = (): void => {
    for (const slot of hotbarSlots) {
      slot.button.classList.toggle(
        'active',
        slot.defId !== null && slot.defId === armed,
      );
      slot.button.classList.toggle(
        'tutorial-glow',
        slot.defId !== null && slot.defId === highlighted,
      );
    }
    for (const [id, button] of inventoryButtons) {
      button.classList.toggle('tutorial-glow', id === highlighted);
    }
    cancelButton.style.display = armed ? 'block' : 'none';
  };

  /** Inventory click: slot the block type, or take it back off the bar. */
  const toggleHotbarEntry = (defId: string): void => {
    hotbar = toggleHotbarSlot(hotbar, defId);
    if (armed !== null && !hotbar.includes(armed)) {
      handlers.onCancelTool();
    }
    renderInventory();
    handlers.onHotbarChange?.(hotbar);
  };

  /** Repaints the inventory grid tiles and the bar they feed. */
  const renderInventory = (): void => {
    let ownedTypes = 0;
    for (const id of SIMPLE_PART_IDS) {
      const def = catalog[id];
      if (!def) continue;
      const count = Math.max(0, stock[id] ?? 0);
      const tile = inventoryButtons.get(id);
      const countLabel = inventoryCountLabels.get(id);
      const slotBadge = inventorySlotBadges.get(id);
      const slotIndex = hotbar.indexOf(id);
      if (count > 0) ownedTypes += 1;
      if (countLabel) countLabel.textContent = `x${count}`;
      if (slotBadge) {
        slotBadge.hidden = slotIndex < 0;
        slotBadge.textContent = `SLOT ${slotIndex + 1}`;
      }
      if (!tile) continue;
      const displayName = KID_LABELS[id]?.name ?? def.name;
      tile.hidden = count <= 0;
      tile.classList.toggle('is-slotted', slotIndex >= 0);
      tile.setAttribute('aria-pressed', String(slotIndex >= 0));
      tile.setAttribute(
        'aria-label',
        slotIndex >= 0
          ? `${displayName}, ${count} in inventory, in slot ${slotIndex + 1} — click to remove`
          : `${displayName}, ${count} in inventory — click to add to the bar`,
      );
      tile.title =
        slotIndex >= 0
          ? `Remove ${displayName} from slot ${slotIndex + 1}`
          : `Put ${displayName} on the build bar`;
    }
    inventoryEmpty.hidden = ownedTypes > 0;
    inventoryHint.textContent = `Build bar ${hotbar.length}/${HOTBAR_CAPACITY} - click a block to slot it`;
    inventoryToggleBadge.textContent = String(ownedTypes);
    renderHotbar();
  };

  let activeStoreGroup: StoreGroup = 'essentials';
  const applyStoreFilters = (): void => {
    const query = storeSearch.value.trim().toLocaleLowerCase();
    let visibleCount = 0;
    for (const button of storeButtons.values()) {
      const matchesGroup = button.dataset.storeGroup === activeStoreGroup;
      const matchesSearch = !query || button.dataset.searchText?.includes(query);
      button.hidden = !matchesGroup || !matchesSearch;
      if (!button.hidden) visibleCount += 1;
    }
    storeEmpty.hidden = visibleCount > 0;
  };
  const setStoreFilter = (group: StoreGroup): void => {
    activeStoreGroup = group;
    const filters = [
      [essentialsFilter, 'essentials'],
      [weaponsFilter, 'weapons'],
      [defenceFilter, 'defence'],
      [mobilityFilter, 'mobility'],
    ] as const;
    for (const [filter, filterGroup] of filters) {
      const active = group === filterGroup;
      filter.classList.toggle('active', active);
      filter.setAttribute('aria-pressed', String(active));
    }
    applyStoreFilters();
  };
  essentialsFilter.addEventListener('click', () => setStoreFilter('essentials'));
  weaponsFilter.addEventListener('click', () => setStoreFilter('weapons'));
  defenceFilter.addEventListener('click', () => setStoreFilter('defence'));
  mobilityFilter.addEventListener('click', () => setStoreFilter('mobility'));
  storeSearch.addEventListener('input', applyStoreFilters);
  setStoreFilter('essentials');

  /**
   * Scrolls the store to a part and flashes it: the answer to "I want more of
   * this block". Clears whatever search and filter were hiding it first.
   */
  const revealInStore = (defId: string): void => {
    const def = catalog[defId];
    const storeButton = storeButtons.get(defId);
    if (!def || !storeButton) return;
    setInventoryOpen(false);
    store.setCollapsed(false);
    storeSearch.value = '';
    setStoreFilter(storeGroupForPart(def));
    storeButton.scrollIntoView({ block: 'center' });
    storeButton.classList.remove('is-revealed');
    void storeButton.offsetWidth;
    storeButton.classList.add('is-revealed');
    const displayName = KID_LABELS[defId]?.name ?? def.name;
    setStatus(`Out of ${displayName} - buy more in the Store`);
  };

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

  // Ability bar planner: the same three boxes the fight shows, bottom-right so
  // they sit clear of the store, the stats panel, and the build bar. Clicking a
  // box cycles which of the rig's ability parts is loaded into it.
  const abilityLoadout = document.createElement('section');
  abilityLoadout.className = 'panel ability-loadout';
  abilityLoadout.setAttribute('aria-label', 'Ability bar');
  const abilityLoadoutHeader = document.createElement('header');
  const abilityLoadoutTitle = document.createElement('h2');
  abilityLoadoutTitle.textContent = 'Abilities';
  const abilityLoadoutHint = document.createElement('span');
  abilityLoadoutHint.textContent = 'Click to swap';
  abilityLoadoutHeader.append(abilityLoadoutTitle, abilityLoadoutHint);
  const abilityLoadoutBoxes = document.createElement('div');
  abilityLoadoutBoxes.className = 'ability-loadout__boxes';
  abilityLoadout.append(abilityLoadoutHeader, abilityLoadoutBoxes);
  root.appendChild(abilityLoadout);

  interface AbilityLoadoutBox {
    root: HTMLButtonElement;
    glyph: HTMLSpanElement;
    name: HTMLSpanElement;
    part: HTMLSpanElement;
  }
  const abilityLoadoutBoxList: AbilityLoadoutBox[] = ABILITY_SLOT_KEYS.map(
    (key, slot) => {
      const box = document.createElement('button');
      box.type = 'button';
      box.className = 'ability-loadout__slot';
      box.dataset.slot = String(slot);
      const keyBadge = document.createElement('span');
      keyBadge.className = 'ability-loadout__key';
      keyBadge.textContent = key.toUpperCase();
      const glyph = document.createElement('span');
      glyph.className = 'ability-loadout__glyph';
      glyph.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'ability-loadout__name';
      const part = document.createElement('span');
      part.className = 'ability-loadout__part';
      box.append(keyBadge, glyph, name, part);
      box.addEventListener('click', () => handlers.onAbilitySlotClick(slot));
      abilityLoadoutBoxes.appendChild(box);
      return { root: box, glyph, name, part };
    },
  );


  const ghostTip = document.createElement('div');
  ghostTip.className = 'ghost-tip';
  ghostTip.style.display = 'none';
  root.appendChild(ghostTip);

  // Shortcut card that rides along with whatever block is selected. It stays up
  // for the whole selection rather than waiting on a hover, because the two
  // keys it teaches are the ones players otherwise never discover.
  const selectionTip = document.createElement('div');
  selectionTip.className = 'selection-tip';
  selectionTip.setAttribute('aria-hidden', 'true');
  selectionTip.style.display = 'none';
  for (const [key, actionLabel] of [
    ['R', 'Rotate'],
    ['M', 'Return to inventory'],
  ] as const) {
    const row = document.createElement('span');
    row.className = 'selection-tip__row';
    const keyBadge = document.createElement('kbd');
    keyBadge.textContent = key;
    const label = document.createElement('span');
    label.textContent = actionLabel;
    row.append(keyBadge, label);
    selectionTip.appendChild(row);
  }
  root.appendChild(selectionTip);

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
    text.textContent = 'Select a block on the model to inspect, upgrade, rotate, or sell it.';
    empty.append(mark, text);
    selectedContent.appendChild(empty);
  };
  showNoSelection();

  return {
    root,
    ghostTip,
    selectionTip,
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
      abilitySlot,
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
      // No level number: the stars under the name are the whole story.
      title.append(name);
      const description = document.createElement('p');
      description.className = 'selected-part__description';
      description.textContent = KID_LABELS[def.id]?.blurb ?? def.description;
      selectedContent.append(title);
      if (def.upgrade !== undefined) selectedContent.append(buildStarRating(level));
      selectedContent.append(description);

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

      if (def.upgrade !== undefined) {
        selectedContent.appendChild(
          buildUpgradeSection(def, level, economy, () => handlers.onUpgradePart(partId)),
        );
      }

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
        // Ability bar picker. Ticking a part claims one of the three slots;
        // with three or fewer ability parts on the rig every one is equipped
        // anyway, so the tick only decides anything once the rig has more
        // abilities than the bar can hold.
        const abilitySection = document.createElement('label');
        abilitySection.className = 'selected-part__ability';
        const abilityInput = document.createElement('input');
        abilityInput.type = 'checkbox';
        // Ticked when the part actually holds a box, not when a config flag
        // says so — the planner and this tick are two views of one loadout.
        abilityInput.checked = abilitySlot
          ? abilitySlot.key !== null
          : partConfig?.activeAbility === true;
        // Nothing to equip until the part is upgraded into its ability.
        abilityInput.disabled = abilitySlot?.lockedUntilLevel != null;
        abilityInput.addEventListener('change', () =>
          handlers.onConfigChange(partId, 'activeAbility', abilityInput.checked),
        );
        abilitySection.append(abilityInput, 'Equip to ability bar');
        if (abilitySlot) {
          const status = document.createElement('span');
          status.className = 'selected-part__ability-slot';
          if (abilitySlot.lockedUntilLevel !== null) {
            status.classList.add('is-benched');
            status.textContent = `Unlocks at Lv ${abilitySlot.lockedUntilLevel}`;
          } else if (abilitySlot.key === null) {
            status.classList.add('is-benched');
            status.textContent = `Bench (bar full: ${abilitySlot.capacity}/${abilitySlot.candidates})`;
          } else {
            status.textContent = `Slot ${abilitySlot.key.toUpperCase()}`;
          }
          abilitySection.appendChild(status);
        }
        selectedContent.appendChild(abilitySection);
      }

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
      if (!def.isRoot) {
        const turnButton = iconLabelBtn(
          TURN_ICON_SVG,
          'Turn',
          () => handlers.onRotateSelected('y'),
        );
        turnButton.classList.add('selected-part__turn');
        turnButton.title = 'Rotate this block (R)';
        const stowButton = iconLabelBtn(
          STOW_ICON_SVG,
          'Stow',
          handlers.onReturnSelected,
        );
        stowButton.classList.add('selected-part__stow');
        stowButton.title =
          'Take this block off the rig and back into your inventory, free to place again (M)';
        stowButton.setAttribute('aria-label', 'Return block to inventory');
        const refund = economy?.sellRefund ?? 0;
        const sellButton = iconLabelBtn(
          SELL_ICON_SVG,
          'Sell',
          handlers.onDeleteSelected,
          `+$${refund}`,
        );
        sellButton.classList.add('selected-part__sell');
        sellButton.title = `Sell this block for $${refund} — it leaves your inventory for good (Delete)`;
        sellButton.setAttribute('aria-label', `Sell block, refunds $${refund}`);
        actions.append(turnButton, stowButton, sellButton);
      }
      selectedContent.appendChild(actions);

    },
    setAbilityLoadout: (slots) => {
      abilityLoadoutBoxList.forEach((box, slot) => {
        const view = slots[slot] ?? null;
        const filled = view !== null;
        box.root.classList.toggle('is-empty', !filled);
        box.glyph.textContent = filled ? view.glyph : '+';
        box.name.textContent = filled ? view.name : 'Empty';
        box.part.textContent = filled ? view.partName : 'No ability fitted';
        box.root.title = filled
          ? `${view.name} — ${view.blurb} (from ${view.partName}). Click to load another ability here.`
          : 'No ability in this box. Click to load one the rig carries.';
      });
    },
    setEconomy: (
      money,
      unlockedDefIds,
      currentInventory,
      installedDefIds,
      hotbarDefIds,
    ) => {
      moneyReadout.textContent = `$${money}`;
      stock = currentInventory;
      hotbar = resolveHotbar(hotbarDefIds, currentInventory);
      const unlocked = new Set(unlockedDefIds);
      const installedCounts = new Map<string, number>();
      for (const defId of installedDefIds) {
        installedCounts.set(defId, (installedCounts.get(defId) ?? 0) + 1);
      }
      for (const id of SIMPLE_PART_IDS) {
        const def = catalog[id];
        if (!def) continue;
        const storeButton = storeButtons.get(id);
        const count = Math.max(0, currentInventory[id] ?? 0);

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
        // Affordable tiles are lit; everything else recedes into the panel.
        storeButton?.classList.toggle(
          'is-affordable',
          !unaffordable && !atOwnershipLimit,
        );
        storeButton?.classList.toggle(
          'has-unlock-milestone',
          locked && id === 'mine-sweeper',
        );
        if (storeButton) {
          // Cheapest first. `order` reshuffles the grid without touching the
          // DOM, so a live search or a focused tile keeps its place.
          storeButton.style.order = String(price);
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
      renderInventory();
    },
    setRunContext: (wave, summary, repair) => {
      menuBtn.style.display = wave === undefined ? '' : 'none';
      saveAndQuitBtn.style.display = wave === undefined ? 'none' : '';
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
          `Score ${summary.score.toLocaleString()} · ` +
          `${summary.kills.toLocaleString()} zombies killed`;
        const recovery = document.createElement('div');
        recovery.className = 'run-banner__summary-line';
        const resetNote =
          'Rig and cash reset · Unlocked parts kept';
        recovery.textContent = summary.isPersonalBest
          ? `New best score! · ${resetNote}`
          : summary.rank === null
            ? resetNote
            : `Ranked #${summary.rank} · ${resetNote}`;
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
      armed = defId;
      applyToolStates();
    },
    highlightPaletteButton: (defId) => {
      highlighted = defId;
      // A tutorial step that points at a block is unfollowable when that block
      // is off the bar, so claim a free slot for it first.
      if (defId !== null && !hotbar.includes(defId)) {
        const next = withHotbarSlot(hotbar, defId);
        if (next.length !== hotbar.length) {
          hotbar = next;
          renderInventory();
          handlers.onHotbarChange?.(hotbar);
          return;
        }
      }
      applyToolStates();
    },
    setStatus,
    setNotice: (text) => {
      noticeBanner.textContent = text;
      noticeBanner.style.display = 'block';
    },
    deny: (text) => {
      setStatus(text);
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
      ['Ability', 'Cryo Nova'],
      ['Freezes', `${formatStat(def.ability.baseTargets ?? 0)} zombies`],
      ['Duration', `${formatStat(def.ability.baseDurationSeconds)} S`],
      ['Cooldown', `${formatStat(def.ability.cooldownSeconds)} S`],
    );
  }
  if (def.ability?.kind === 'shield') {
    labels.push(
      ['Ability', 'Shield'],
      ['Effect', 'Invulnerable'],
      ['Duration', `${formatStat(def.ability.baseDurationSeconds)} S`],
      ['Cooldown', `${formatStat(def.ability.cooldownSeconds)} S`],
    );
  }
  if (def.ability?.kind === 'pulse') {
    labels.push(
      ['Ability', 'Shockwave'],
      ['Blast', `${formatStat(def.ability.baseDamage ?? 0)} DMG`],
      ['Radius', `${formatStat(def.ability.rangeM ?? 0)} M`],
      ['Cooldown', `${formatStat(def.ability.cooldownSeconds)} S`],
    );
  }
  if (def.ability?.kind === 'overdrive') {
    labels.push(
      ['Ability', 'Overdrive'],
      ['Thrust', `${formatStat(def.ability.baseThrustAccel ?? 0)} M/S²`],
      ['Torque', `x${formatStat(def.ability.baseTorqueMultiplier ?? 1)}`],
      ['Top Speed', `x${formatStat(def.ability.baseTopSpeedMultiplier ?? 1)}`],
      ['Duration', `${formatStat(def.ability.baseDurationSeconds)} S`],
      ['Cooldown', `${formatStat(def.ability.cooldownSeconds)} S`],
    );
  }
  if (def.ability?.kind === 'phase') {
    labels.push(
      ['Ability', 'Phase'],
      ['Blink', `${formatStat(def.ability.rangeM ?? 0)} M`],
      ['Effect', 'Passes through'],
      ['Cooldown', `${formatStat(def.ability.cooldownSeconds)} S`],
    );
  }
  if (def.ability?.kind === 'hellfire') {
    labels.push(
      ['Ability', 'Hellfire'],
      ['Damage', `x${formatStat(def.ability.baseDamageMultiplier ?? 1)}`],
      ['Reach', `x${formatStat(def.ability.rangeMultiplier ?? 1)}`],
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
    <li>Open Inventory with the crate button beside the build bar, then click a block to slot it (5 slots; click it again or right-click a slot to clear it).</li>
    <li>Click a bar slot to arm that block, then place it. Green can place; red explains why it cannot. A slot showing x0 jumps you to that block in the Store.</li>
    <li>Build blocks around the Truck Heart. Everything needs to connect face-to-face.</li>
    <li>Select a placed part to upgrade, rotate, or sell it in the right inspector.</li>
    <li>Use Test Drive when the vehicle is ready.</li></ol>
    <div class="cat-title">controls</div>
    <table><tr><td>Orbit / zoom</td><td>left-drag / mouse wheel; keys <b>1-5</b> choose views</td></tr>
    <tr><td>Rotate selected / held part</td><td><b>R</b> turn; <b>F</b> flip</td></tr>
    <tr><td>Return to inventory</td><td><b>M</b> on a selected part — keep it, free to place again</td></tr>
    <tr><td>Sell for cash</td><td>right-click a part, or <b>Delete</b> on a selected part</td></tr>
    <tr><td>Undo / redo</td><td>Ctrl+Z / Ctrl+Shift+Z</td></tr><tr><td>Layers</td><td>the Height slider in the top bar slices the build</td></tr></table>`;
  return wrap;
}
