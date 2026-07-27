import './WaveClearCard.css';
import type { BadgeDefinition } from '../core/badges.ts';
import { playSfx } from '../app/sfx.ts';

export interface WaveClearCardView {
  wave: number;
  moneyEarned: number;
  runMoneyTotal: number;
  kills: number;
  elapsedSeconds: number;
  integrityPct: number;
  damagedParts: number;
  lostParts: readonly string[];
  /** Preformatted composition string for the next wave. */
  nextWaveComposition: string;
  warnings: readonly string[];
  badges: readonly BadgeDefinition[];
  /** Subset of `badges` earned for the first time ever — extra flourish. */
  newBadgeIds: readonly string[];
}

export interface WaveClearCardHandlers {
  onContinue(): void;
  onGarage(): void;
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
  private readonly coinLayer: HTMLDivElement;
  private readonly statRows: StatRow[] = [];
  private readonly badgesBlock: HTMLElement;
  private readonly badgesGrid: HTMLDivElement;
  private readonly badgeElements: BadgeElement[] = [];
  private readonly previewBlock: HTMLElement;
  private readonly previewValue: HTMLDivElement;
  private readonly warningBlock: HTMLElement;
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
    this.moneyRow.append(moneyLabel, this.moneyCounter, this.coinLayer);

    const stats = element('section', 'wave-clear__stats');
    stats.setAttribute('aria-label', 'Wave statistics');
    this.statRows.push(
      this.buildStatRow(stats, 'Zombies Killed'),
      this.buildStatRow(stats, 'Clear Time'),
      this.buildStatRow(stats, 'Vehicle Integrity'),
      this.buildStatRow(stats, 'Damaged Parts'),
      this.buildStatRow(stats, 'Parts Lost'),
      this.buildStatRow(stats, 'Run Total Banked'),
    );

    this.badgesBlock = element('section', 'wave-clear__badges');
    const badgesTitle = element('h3', 'wave-clear__section-title');
    setTextIfChanged(badgesTitle, 'BADGES EARNED');
    this.badgesGrid = element('div', 'wave-clear__badge-grid');
    this.badgesBlock.append(badgesTitle, this.badgesGrid);

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
    this.continueButton = element(
      'button',
      'wave-clear__button wave-clear__button--primary',
    );
    this.continueButton.type = 'button';
    setTextIfChanged(this.continueButton, 'Continue Now');
    this.garageButton = element('button', 'wave-clear__button');
    this.garageButton.type = 'button';
    setTextIfChanged(this.garageButton, 'Garage / Repair');
    actions.append(this.continueButton, this.garageButton);

    this.card.append(header, body, actions);
    this.root.appendChild(this.card);

    this.root.addEventListener('pointerdown', this.onBackdropInput);
    this.root.addEventListener('click', this.onBackdropInput);
    this.continueButton.addEventListener('click', this.onContinue);
    this.garageButton.addEventListener('click', this.onGarage);
  }

  /** Shows the card and starts the reveal sequence from the top. */
  show(view: WaveClearCardView): void {
    if (this.disposed) return;

    this.cancelAsync();
    this.sequenceRunning = true;
    this.finalMoneyEarned = Math.max(0, Math.round(view.moneyEarned));
    this.resetRevealState();
    this.renderView(view);

    this.root.hidden = false;
    // Flushing after removing the reveal class lets a reused card replay its entrance.
    void this.card.offsetWidth;
    this.root.classList.add('wave-clear--visible');
    this.attachKeydown();
    // Focus the dialog, not the button, while the reveal plays. Space and Enter
    // activate a focused button, so autofocusing Continue here would make the
    // player's instinctive "skip this" keypress start the next wave instead.
    // applyFinalState hands focus to Continue once the sequence settles.
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
      formatInteger(view.damagedParts),
      view.lostParts.length > 0 ? view.lostParts.join(', ') : 'None',
      formatMoney(view.runMoneyTotal),
    ];
    this.statRows.forEach((row, index) => {
      setTextIfChanged(row.value, values[index]);
    });

    setTextIfChanged(this.previewValue, view.nextWaveComposition);
    setTextIfChanged(this.warningBlock, view.warnings.join(' '));
    this.warningBlock.hidden = view.warnings.length === 0;

    this.badgesGrid.replaceChildren();
    this.badgeElements.length = 0;
    this.badgesBlock.hidden = view.badges.length === 0;
    const newBadgeIds = new Set(view.newBadgeIds);
    for (const badge of view.badges) {
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
      this.continueButton.focus();
    }
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
