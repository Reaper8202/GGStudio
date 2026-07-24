import { CREW_COLORS } from '../config/constants';

/**
 * DOM overlay UI (menu / HUD / game-over / pause). Zero canvas text, zero
 * webfonts — everything is styled in index.html. The Game assigns the
 * on* callbacks; keyboard shortcuts route to whichever screen is visible
 * (gameplay keys are handled by InputController, which is disabled whenever
 * a screen is up, so there is no double-handling).
 */
export class UI {
  onStart: () => void = () => {};
  onRestart: () => void = () => {};
  onRevive: () => void = () => {};
  onResumeTap: () => void = () => {};
  onColorPick: (hex: number) => void = () => {};

  private readonly menu = byId('menu');
  private readonly menuBest = byId('menu-best');
  private readonly gameover = byId('gameover');
  private readonly goScore = byId('go-score');
  private readonly goLine = byId('go-line');
  private readonly btnRevive = byId('btn-revive') as HTMLButtonElement;
  private readonly btnRestart = byId('btn-restart') as HTMLButtonElement;
  private readonly paused = byId('paused');
  private readonly hud = byId('hud');
  private readonly score = byId('score');
  private readonly best = byId('best');
  private readonly dist = byId('dist');
  private readonly coins = byId('coins');
  private readonly toastEl = byId('toast');
  private readonly colors = byId('colors');
  private readonly swatches: HTMLButtonElement[] = [];

  private lastScore = -1;
  private lastCoins = -1;
  private lastDist = -1;

  constructor() {
    this.menu.addEventListener('pointerdown', () => this.onStart());
    this.paused.addEventListener('pointerdown', () => this.onResumeTap());
    this.btnRestart.addEventListener('pointerdown', () => this.onRestart());
    this.btnRevive.addEventListener('pointerdown', () => this.onRevive());

    for (const hex of CREW_COLORS) {
      const btn = document.createElement('button');
      btn.className = 'swatch';
      btn.style.backgroundColor = `#${hex.toString(16).padStart(6, '0')}`;
      btn.addEventListener('pointerdown', (e) => {
        // Stop this from bubbling to #menu's pointerdown, which starts the run.
        e.stopPropagation();
        this.selectSwatch(btn);
        this.onColorPick(hex);
      });
      this.colors.appendChild(btn);
      this.swatches.push(btn);
    }

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      if (!this.menu.hidden) {
        e.preventDefault();
        this.onStart();
      } else if (!this.gameover.hidden) {
        e.preventDefault();
        this.onRestart();
      } else if (!this.paused.hidden) {
        e.preventDefault();
        this.onResumeTap();
      }
    });
  }

  showMenu(best: number): void {
    this.menu.hidden = false;
    this.gameover.hidden = true;
    this.paused.hidden = true;
    this.hud.hidden = true;
    this.menuBest.hidden = best <= 0;
    this.menuBest.textContent = `BEST  ${best}`;
  }

  showHud(best: number): void {
    this.menu.hidden = true;
    this.gameover.hidden = true;
    this.paused.hidden = true;
    this.hud.hidden = false;
    this.setBest(best);
    this.lastScore = this.lastCoins = this.lastDist = -1;
  }

  showGameOver(score: number, coins: number, best: number, newBest: boolean, canRevive: boolean): void {
    this.gameover.hidden = false;
    this.goScore.textContent = String(score);
    this.goLine.innerHTML = newBest
      ? '<span class="newbest">NEW BEST!</span>'
      : `BEST ${best} &nbsp;·&nbsp; ${coins} coins`;
    this.btnRevive.hidden = !canRevive;
    this.btnRevive.disabled = false;
    this.btnRevive.textContent = '▶  REVIVE (watch ad)';
    this.btnRestart.disabled = false;
  }

  hideGameOver(): void {
    this.gameover.hidden = true;
  }

  showPaused(show: boolean): void {
    this.paused.hidden = !show;
  }

  setButtonsBusy(busy: boolean): void {
    this.btnRevive.disabled = busy;
    this.btnRestart.disabled = busy;
  }

  reviveUnavailable(): void {
    this.btnRevive.disabled = true;
    this.btnRevive.textContent = 'AD NOT AVAILABLE';
    this.btnRestart.disabled = false;
  }

  updateHud(score: number, coins: number, meters: number): void {
    if (score !== this.lastScore) {
      this.lastScore = score;
      this.score.textContent = String(score);
    }
    if (coins !== this.lastCoins) {
      this.lastCoins = coins;
      this.coins.textContent = `● ${coins}`;
    }
    const m = Math.floor(meters);
    if (m !== this.lastDist) {
      this.lastDist = m;
      this.dist.textContent = `${m}m`;
    }
  }

  setBest(best: number): void {
    this.best.textContent = `BEST ${best}`;
  }

  toast(text: string, ms = 3500): void {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = '1';
    setTimeout(() => {
      this.toastEl.style.opacity = '0';
    }, ms);
  }

  /** Marks the swatch matching `hex` as selected (used at boot for the persisted choice). Falls back to the first swatch. */
  setSelectedColor(hex: number): void {
    const idx = CREW_COLORS.indexOf(hex as (typeof CREW_COLORS)[number]);
    const btn = this.swatches[idx >= 0 ? idx : 0];
    if (btn) this.selectSwatch(btn);
  }

  private selectSwatch(btn: HTMLButtonElement): void {
    for (const s of this.swatches) s.classList.toggle('selected', s === btn);
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}
