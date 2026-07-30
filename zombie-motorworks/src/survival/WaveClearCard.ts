import './WaveClearCard.css';
import type { BadgeAward } from '../core/badges.ts';
import { playSfx } from '../app/sfx.ts';
import { isDevMode } from './devtuning/devMode.ts';
import { recordFeel } from './devtuning/feelLog.ts';
import type { FeelRating } from './devtuning/feelLog.ts';

export interface WaveClearRepairOffer {
  /** Total cost to restore every damaged part, in dollars. Always > 0. */
  cost: number;
  /** False when the player cannot afford it — show the price, disable the action. */
  affordable: boolean;
}

export interface WaveClearCardView {
  wave: number;
  /** Total banked this wave, badge bonus included. */
  moneyEarned: number;
  /** Share of `moneyEarned` paid by badges. 0 when none were earned. */
  badgeBonus: number;
  runMoneyTotal: number;
  kills: number;
  elapsedSeconds: number;
  integrityPct: number;
  nextWaveComposition: string;
  warnings: readonly string[];
  badges: readonly BadgeAward[];
  newBadgeIds: readonly string[];
  /** null when the rig is undamaged, so there is nothing to offer. */
  repair: WaveClearRepairOffer | null;
}

export interface WaveClearCardHandlers {
  onContinue(): void;
  onGarage(): void;
  onRepairAndContinue(): void;
}

interface StatRow {
  readonly root: HTMLDivElement;
  readonly value: HTMLSpanElement;
}

interface BadgeElement {
  readonly root: HTMLDivElement;
}

let nextTitleId = 1;

export class WaveClearCard {
  readonly root: HTMLElement;

  private handlers: WaveClearCardHandlers | null;
  private readonly card: HTMLElement;
  private readonly title: HTMLHeadingElement;
  private readonly moneyRow: HTMLDivElement;
  private readonly moneyCounter: HTMLDivElement;
  private readonly moneyValue: HTMLSpanElement;
  private readonly moneyNote: HTMLDivElement;
  private readonly coinLayer: HTMLDivElement;
  private readonly statRows: StatRow[] = [];
  private readonly badgesBlock: HTMLElement;
  private readonly badgesBonus: HTMLSpanElement;
  private readonly badgesGrid: HTMLDivElement;
  private readonly badgeElements: BadgeElement[] = [];
  private readonly feelBlock: HTMLElement | null;
  private feelButtons: HTMLButtonElement[] = [];
  private feelNote: HTMLInputElement | null = null;
  private feelRating: FeelRating | null = null;
  private feelView: WaveClearCardView | null = null;
  private readonly previewBlock: HTMLElement;
  private readonly previewValue: HTMLDivElement;
  private readonly warningBlock: HTMLElement;
  private readonly repairButton: HTMLButtonElement;
  private readonly repairPrice: HTMLSpanElement;
  private readonly continueButton: HTMLButtonElement;
  private readonly garageButton: HTMLButtonElement;
  private readonly timeoutIds = new Set<number>();
  private readonly animationFrameIds = new Set<number>();
  private finalMoneyEarned = 0;
  private sequenceRunning = false;
  private keydownAttached = false;
  private disposed = false;

  constructor(handlers: WaveClearCardHandlers) {
    this.handlers = handlers;
    this.root = element('section', 'wave-clear');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    // Focusable so the reveal sequence can hold focus without arming a button.
    this.root.tabIndex = -1;
    this.root.setAttribute('aria-modal', 'true');

    const titleId = `wave-clear-title-${nextTitleId}`;
    nextTitleId += 1;
    this.root.setAttribute('aria-labelledby', titleId);

    this.card = element('article', 'wave-clear__card');
    const header = element('header', 'wave-clear__header');
    const eyebrow = element('div', 'wave-clear__eyebrow');
    setTextIfChanged(eyebrow, 'SURVIVAL PAYOUT // SECURED');
    this.title = element('h2', 'wave-clear__title');
    this.title.id = titleId;
    header.append(eyebrow, this.title);

    const body = element('div', 'wave-clear__body');
    this.moneyRow = element('div', 'wave-clear__money');
    const moneyLabel = element('span', 'wave-clear__money-label');
    setTextIfChanged(moneyLabel, 'WAVE PAYOUT');
    this.moneyCounter = element('div', 'wave-clear__money-counter');
    const moneyPrefix = element('span', 'wave-clear__money-prefix');
    moneyPrefix.setAttribute('aria-hidden', 'true');
    setTextIfChanged(moneyPrefix, '+');
    this.moneyValue = element('span', 'wave-clear__money-value');
    this.moneyCounter.append(moneyPrefix, this.moneyValue);
    this.coinLayer = element('div', 'wave-clear__coins');
    this.coinLayer.setAttribute('aria-hidden', 'true');
    this.moneyNote = element('div', 'wave-clear__money-note');
    this.moneyNote.hidden = true;
    const moneyLabelStack = element('div', 'wave-clear__money-labels');
    moneyLabelStack.append(moneyLabel, this.moneyNote);
    this.moneyRow.append(moneyLabelStack, this.moneyCounter, this.coinLayer);

    const stats = element('section', 'wave-clear__stats');
    stats.setAttribute('aria-label', 'Wave statistics');
    this.statRows.push(
      this.buildStatRow(stats, 'Zombies Killed'),
      this.buildStatRow(stats, 'Clear Time'),
      this.buildStatRow(stats, 'Vehicle Integrity'),
      this.buildStatRow(stats, 'Run Total Banked'),
    );

    this.badgesBlock = element('section', 'wave-clear__badges');
    const badgesHeader = element('div', 'wave-clear__badges-header');
    const badgesTitle = element('h3', 'wave-clear__section-title');
    setTextIfChanged(badgesTitle, 'BADGES EARNED');
    this.badgesBonus = element('span', 'wave-clear__badges-bonus');
    this.badgesBonus.hidden = true;
    badgesHeader.append(badgesTitle, this.badgesBonus);
    this.badgesGrid = element('div', 'wave-clear__badge-grid');
    this.badgesBlock.append(badgesHeader, this.badgesGrid);

    this.previewBlock = element('section', 'wave-clear__preview');
    const previewTitle = element('h3', 'wave-clear__section-title');
    setTextIfChanged(previewTitle, 'NEXT WAVE // INCOMING');
    this.previewValue = element('div', 'wave-clear__preview-value');
    this.previewBlock.append(previewTitle, this.previewValue);

    this.warningBlock = element('section', 'wave-clear__warnings');
    this.warningBlock.setAttribute('role', 'status');

    body.append(
      this.moneyRow,
      stats,
      this.badgesBlock,
      this.previewBlock,
      this.warningBlock,
    );

    const actions = element('footer', 'wave-clear__actions');
    this.repairButton = element(
      'button',
      'wave-clear__button wave-clear__button--repair',
    );
    this.repairButton.type = 'button';
    this.repairButton.hidden = true;
    const repairLabel = element('span', 'wave-clear__button-label');
    setTextIfChanged(repairLabel, 'Repair & Continue');
    this.repairPrice = element('span', 'wave-clear__button-price');
    this.repairButton.append(repairLabel, this.repairPrice);
    this.continueButton = element(
      'button',
      'wave-clear__button wave-clear__button--primary',
    );
    this.continueButton.type = 'button';
    setTextIfChanged(this.continueButton, 'Continue Now');
    this.garageButton = element('button', 'wave-clear__button');
    this.garageButton.type = 'button';
    setTextIfChanged(this.garageButton, 'Garage / Repair');
    actions.append(this.repairButton, this.continueButton, this.garageButton);

    this.feelBlock = isDevMode() ? this.buildFeelRow() : null;
    if (this.feelBlock !== null) body.appendChild(this.feelBlock);

    this.card.append(header, body, actions);
    this.root.appendChild(this.card);

    this.root.addEventListener('pointerdown', this.onBackdropInput);
    this.root.addEventListener('click', this.onBackdropInput);
    this.repairButton.addEventListener('click', this.onRepairAndContinue);
    this.continueButton.addEventListener('click', this.onContinue);
    this.garageButton.addEventListener('click', this.onGarage);
  }

  /**
   * Dev-only strip for rating the wave just cleared.
   *
   * Sits on the clear card because that is the one moment the player has just
   * finished the wave and has not yet started thinking about the next one, and
   * because the numbers it files the verdict against are already on screen.
   */
  private buildFeelRow(): HTMLElement {
    const block = element('section', 'wave-clear__feel');
    const title = element('h3', 'wave-clear__section-title');
    setTextIfChanged(title, 'HOW DID THAT WAVE FEEL?');

    const row = element('div', 'wave-clear__feel-row');
    const options: [FeelRating, string][] = [
      ['easy', 'Too easy'],
      ['right', 'About right'],
      ['hard', 'Too hard'],
    ];
    const buttons: HTMLButtonElement[] = [];
    for (const [rating, label] of options) {
      const button = element('button', 'wave-clear__feel-btn');
      button.type = 'button';
      setTextIfChanged(button, label);
      button.addEventListener('click', () => {
        this.rateWave(rating);
        for (const other of buttons) {
          other.classList.toggle('wave-clear__feel-btn--on', other === button);
        }
      });
      buttons.push(button);
      row.appendChild(button);
    }
    this.feelButtons = buttons;

    this.feelNote = element('input', 'wave-clear__feel-note');
    this.feelNote.type = 'text';
    this.feelNote.placeholder = 'What made it that way? (optional)';
    // Re-file on every keystroke so a note typed after the verdict is not lost
    // when the player hits Continue without leaving the field.
    this.feelNote.addEventListener('input', () => {
      if (this.feelRating !== null) this.rateWave(this.feelRating);
    });

    block.append(title, row, this.feelNote);
    return block;
  }

  /** Point the rating controls at the wave now on screen, unanswered. */
  private resetFeelRow(view: WaveClearCardView): void {
    if (this.feelBlock === null) return;
    this.feelView = view;
    this.feelRating = null;
    for (const button of this.feelButtons) {
      button.classList.remove('wave-clear__feel-btn--on');
    }
    if (this.feelNote !== null) this.feelNote.value = '';
  }

  private rateWave(rating: FeelRating): void {
    if (this.feelView === null) return;
    this.feelRating = rating;
    const note = this.feelNote?.value.trim() ?? '';
    recordFeel({
      wave: this.feelView.wave,
      rating,
      seconds: this.feelView.elapsedSeconds,
      integrityPct: this.feelView.integrityPct,
      kills: this.feelView.kills,
      ...(note === '' ? {} : { note }),
    });
  }

  /** Shows the card and starts the reveal sequence from the top. */
  show(view: WaveClearCardView): void {
    if (this.disposed) return;

    this.cancelAsync();
    this.sequenceRunning = true;
    this.finalMoneyEarned = Math.max(0, Math.round(view.moneyEarned));
    this.resetRevealState();
    this.renderView(view);
    this.resetFeelRow(view);

    this.root.hidden = false;
    // Flushing after removing the reveal class lets a reused card replay its entrance.
    void this.card.offsetWidth;
    this.root.classList.add('wave-clear--visible');
    this.attachKeydown();
    // Focus the dialog, not an action, while the reveal plays. Space and Enter
    // activate a focused button, so autofocusing an action here would make the
    // player's instinctive "skip this" keypress start the next wave instead.
    // applyFinalState hands focus to the primary action once the sequence settles.
    this.root.focus();
    playSfx('cardIn');

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      playSfx('waveClear');
      if (this.finalMoneyEarned > 0) {
        playSfx('coinTick', { pitch: 1.2 });
      }
      view.badges.forEach(() => playSfx('badgeStamp'));
      this.applyFinalState();
      return;
    }

    this.schedule(() => playSfx('waveClear'), 250);
    this.schedule(() => this.startMoneyReveal(), 350);

    this.statRows.forEach((row, index) => {
      this.schedule(
        () => row.root.classList.add('wave-clear__stat-row--visible'),
        900 + index * 60,
      );
    });

    this.badgeElements.forEach((badge, index) => {
      this.schedule(
        () => {
          badge.root.classList.add('wave-clear__badge--stamped');
          playSfx('badgeStamp');
        },
        1500 + index * 180,
      );
    });

    this.schedule(() => {
      this.previewBlock.classList.add('wave-clear__preview--visible');
      if (!this.warningBlock.hidden) {
        this.warningBlock.classList.add('wave-clear__warnings--visible');
      }
    }, 2200);

    const finalBadgeDelay =
      this.badgeElements.length > 0
        ? 1500 + (this.badgeElements.length - 1) * 180 + 420
        : 0;
    this.schedule(
      () => this.applyFinalState(),
      Math.max(2500, finalBadgeDelay),
    );
  }

  hide(): void {
    this.cancelAsync();
    this.sequenceRunning = false;
    this.detachKeydown();
    this.coinLayer.replaceChildren();
    this.root.classList.remove('wave-clear--visible', 'wave-clear--complete');
    this.root.hidden = true;
  }

  isVisible(): boolean {
    return !this.root.hidden;
  }

  /** Jump straight to the finished state. Idempotent. */
  skip(): void {
    this.skipInternal(true);
  }

  private skipInternal(focusPrimary: boolean): void {
    if (!this.isVisible() || this.disposed) return;
    this.applyFinalState(focusPrimary);
  }

  dispose(): void {
    if (this.disposed) return;
    this.hide();
    this.disposed = true;
    this.root.removeEventListener('pointerdown', this.onBackdropInput);
    this.root.removeEventListener('click', this.onBackdropInput);
    this.repairButton.removeEventListener('click', this.onRepairAndContinue);
    this.continueButton.removeEventListener('click', this.onContinue);
    this.garageButton.removeEventListener('click', this.onGarage);
    this.root.remove();
    this.root.replaceChildren();
    this.statRows.length = 0;
    this.badgeElements.length = 0;
    this.handlers = null;
  }

  private buildStatRow(parent: HTMLElement, labelText: string): StatRow {
    const root = element('div', 'wave-clear__stat-row');
    const label = element('span', 'wave-clear__stat-label');
    setTextIfChanged(label, labelText);
    const value = element('span', 'wave-clear__stat-value');
    root.append(label, value);
    parent.appendChild(root);
    return { root, value };
  }

  private renderView(view: WaveClearCardView): void {
    setTextIfChanged(this.title, `WAVE ${view.wave} CLEARED`);
    this.setMoney(0);

    const values = [
      formatInteger(view.kills),
      formatDuration(view.elapsedSeconds),
      `${Math.round(view.integrityPct)}%`,
      formatMoney(view.runMoneyTotal),
    ];
    this.statRows.forEach((row, index) => {
      setTextIfChanged(row.value, values[index]);
    });

    setTextIfChanged(this.previewValue, view.nextWaveComposition);
    setTextIfChanged(this.warningBlock, view.warnings.join(' '));
    this.warningBlock.hidden = view.warnings.length === 0;

    const repair = view.repair;
    this.repairButton.hidden = repair === null;
    this.repairButton.disabled = repair !== null && !repair.affordable;
    this.repairButton.title =
      repair !== null && !repair.affordable
        ? 'You cannot afford this repair.'
        : '';
    this.repairButton.classList.toggle(
      'wave-clear__button--primary',
      repair !== null,
    );
    this.continueButton.classList.toggle(
      'wave-clear__button--primary',
      repair === null,
    );
    setTextIfChanged(
      this.repairPrice,
      repair === null ? '' : formatMoney(repair.cost),
    );

    const badgeBonus = Math.max(0, Math.round(view.badgeBonus));
    this.moneyNote.hidden = badgeBonus <= 0;
    setTextIfChanged(
      this.moneyNote,
      badgeBonus > 0 ? `INCLUDES ${formatMoney(badgeBonus)} BADGE BONUS` : '',
    );
    this.badgesBonus.hidden = badgeBonus <= 0;
    setTextIfChanged(
      this.badgesBonus,
      badgeBonus > 0 ? `+${formatMoney(badgeBonus)}` : '',
    );

    this.badgesGrid.replaceChildren();
    this.badgeElements.length = 0;
    this.badgesBlock.hidden = view.badges.length === 0;
    const newBadgeIds = new Set(view.newBadgeIds);
    for (const { badge, bonus } of view.badges) {
      const root = element(
        'div',
        `wave-clear__badge wave-clear__badge--${badge.tier}`,
      );
      const isNew = newBadgeIds.has(badge.id);
      root.classList.toggle('wave-clear__badge--new', isNew);

      const icon = element('span', 'wave-clear__badge-icon');
      icon.setAttribute('aria-hidden', 'true');
      setTextIfChanged(icon, badge.icon);
      const copy = element('span', 'wave-clear__badge-copy');
      const name = element('strong', 'wave-clear__badge-name');
      setTextIfChanged(name, badge.name);
      const description = element('span', 'wave-clear__badge-description');
      setTextIfChanged(description, badge.description);
      copy.append(name, description);
      root.append(icon, copy);

      if (bonus > 0) {
        const payout = element('span', 'wave-clear__badge-payout');
        setTextIfChanged(payout, `+${formatMoney(bonus)}`);
        root.appendChild(payout);
      }

      if (isNew) {
        const flag = element('span', 'wave-clear__badge-new');
        setTextIfChanged(flag, 'NEW');
        root.appendChild(flag);
      }

      this.badgesGrid.appendChild(root);
      this.badgeElements.push({ root });
    }
  }

  private resetRevealState(): void {
    this.root.classList.remove('wave-clear--visible', 'wave-clear--complete');
    this.moneyRow.classList.remove('wave-clear__money--visible');
    this.moneyCounter.classList.remove(
      'wave-clear__money-counter--bump-a',
      'wave-clear__money-counter--bump-b',
    );
    this.coinLayer.replaceChildren();
    this.statRows.forEach((row) =>
      row.root.classList.remove('wave-clear__stat-row--visible'),
    );
    this.previewBlock.classList.remove('wave-clear__preview--visible');
    this.warningBlock.classList.remove('wave-clear__warnings--visible');
  }

  private startMoneyReveal(): void {
    if (!this.sequenceRunning) return;
    this.moneyRow.classList.add('wave-clear__money--visible');

    const coinCount = 8 + (this.finalMoneyEarned % 7);
    const staggerMs = 38;
    const flightMs = 320;
    for (let index = 0; index < coinCount; index += 1) {
      const coin = element('span', 'wave-clear__coin');
      coin.setAttribute('aria-hidden', 'true');
      setTextIfChanged(coin, '💰');
      coin.style.setProperty(
        '--wave-clear-coin-delay',
        `${index * staggerMs}ms`,
      );
      coin.style.setProperty(
        '--wave-clear-coin-start-x',
        `${-150 - (index % 4) * 22}px`,
      );
      coin.style.setProperty(
        '--wave-clear-coin-start-y',
        `${(index % 5) * 8 - 16}px`,
      );
      coin.style.setProperty(
        '--wave-clear-coin-mid-x',
        `${-62 - (index % 3) * 14}px`,
      );
      coin.style.setProperty(
        '--wave-clear-coin-arc-y',
        `${-38 - (index % 4) * 10}px`,
      );
      this.coinLayer.appendChild(coin);

      this.schedule(
        () => {
          const pitch =
            coinCount === 1 ? 1.2 : 0.85 + (index / (coinCount - 1)) * 0.75;
          playSfx('coinTick', { pitch });
          this.bumpMoneyCounter(index);
        },
        flightMs + index * staggerMs,
      );
    }

    const countDuration = flightMs + (coinCount - 1) * staggerMs;
    this.animateMoneyCount(countDuration);
    this.schedule(() => this.coinLayer.replaceChildren(), countDuration + 180);
  }

  private animateMoneyCount(durationMs: number): void {
    const startedAt = performance.now();
    const step = (now: number): void => {
      if (!this.sequenceRunning) return;
      const progress = clamp((now - startedAt) / durationMs, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.setMoney(Math.round(this.finalMoneyEarned * eased));
      if (progress < 1) {
        this.requestFrame(step);
      } else {
        this.setMoney(this.finalMoneyEarned);
      }
    };
    this.requestFrame(step);
  }

  private bumpMoneyCounter(index: number): void {
    this.moneyCounter.classList.remove(
      'wave-clear__money-counter--bump-a',
      'wave-clear__money-counter--bump-b',
    );
    this.moneyCounter.classList.add(
      index % 2 === 0
        ? 'wave-clear__money-counter--bump-a'
        : 'wave-clear__money-counter--bump-b',
    );
  }

  private setMoney(value: number): void {
    setTextIfChanged(this.moneyValue, formatMoney(value));
  }

  /**
   * `focusPrimary` is false for keyboard skips. Space activates a focused
   * button on keyup, so moving focus to Continue during the keydown that
   * asked to skip would let the trailing keyup start the next wave.
   */
  private applyFinalState(focusPrimary = true): void {
    this.cancelAsync();
    this.sequenceRunning = false;
    this.root.classList.add('wave-clear--complete');
    this.moneyRow.classList.add('wave-clear__money--visible');
    this.setMoney(this.finalMoneyEarned);
    this.coinLayer.replaceChildren();
    this.moneyCounter.classList.remove(
      'wave-clear__money-counter--bump-a',
      'wave-clear__money-counter--bump-b',
    );
    this.statRows.forEach((row) =>
      row.root.classList.add('wave-clear__stat-row--visible'),
    );
    this.badgeElements.forEach((badge) =>
      badge.root.classList.add('wave-clear__badge--stamped'),
    );
    this.previewBlock.classList.add('wave-clear__preview--visible');
    if (!this.warningBlock.hidden) {
      this.warningBlock.classList.add('wave-clear__warnings--visible');
    }
    // Only move focus if the dialog still holds it, so a player who tabbed
    // elsewhere mid-reveal is not yanked back to the button.
    if (focusPrimary && document.activeElement === this.root) {
      this.primaryButton().focus();
    }
  }

  private primaryButton(): HTMLButtonElement {
    return this.repairButton.hidden || this.repairButton.disabled
      ? this.continueButton
      : this.repairButton;
  }

  private schedule(callback: () => void, delayMs: number): void {
    const id = window.setTimeout(() => {
      this.timeoutIds.delete(id);
      callback();
    }, delayMs);
    this.timeoutIds.add(id);
  }

  private requestFrame(callback: FrameRequestCallback): void {
    const id = window.requestAnimationFrame((time) => {
      this.animationFrameIds.delete(id);
      callback(time);
    });
    this.animationFrameIds.add(id);
  }

  private cancelAsync(): void {
    for (const id of this.timeoutIds) {
      window.clearTimeout(id);
    }
    this.timeoutIds.clear();
    for (const id of this.animationFrameIds) {
      window.cancelAnimationFrame(id);
    }
    this.animationFrameIds.clear();
  }

  private attachKeydown(): void {
    if (this.keydownAttached) return;
    window.addEventListener('keydown', this.onKeydown);
    this.keydownAttached = true;
  }

  private detachKeydown(): void {
    if (!this.keydownAttached) return;
    window.removeEventListener('keydown', this.onKeydown);
    this.keydownAttached = false;
  }

  private readonly onBackdropInput = (event: Event): void => {
    if (!this.sequenceRunning) return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('.wave-clear__actions') !== null
    ) {
      return;
    }
    this.skip();
  };

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (
      !this.sequenceRunning ||
      ![' ', 'Enter', 'Escape'].includes(event.key)
    ) {
      return;
    }
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('.wave-clear__actions') !== null
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.skipInternal(false);
  };

  private readonly onContinue = (): void => {
    this.handlers?.onContinue();
  };

  private readonly onRepairAndContinue = (): void => {
    this.handlers?.onRepairAndContinue();
  };

  private readonly onGarage = (): void => {
    this.handlers?.onGarage();
  };
}

function formatMoney(value: number): string {
  return `$${Math.max(0, Math.round(value)).toLocaleString()}`;
}

function formatInteger(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString();
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function setTextIfChanged(element: Node, value: string): void {
  if (element.textContent !== value) {
    element.textContent = value;
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
