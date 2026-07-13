/**
 * Upgrade panel shown during the `Upgrade` phase: money + wave-cleared
 * header, a scrollable grid of the 7 upgrade cards (name, description,
 * level, current/next effect, price, Buy), and a prominent Start Next
 * Wave button (`ui:startNextWave` — never auto-started). Owned by Agent D
 * (UI & Progression). Needs the `Economy` instance for prices/purchases.
 */
import { GamePhase } from "../types";
import type { GameContext, UpgradeDefinition } from "../types";
import type { Economy } from "../economy/Economy";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

interface CardRefs {
  def: UpgradeDefinition;
  levelEl: HTMLSpanElement;
  currentEffectEl: HTMLSpanElement;
  nextRowEl: HTMLDivElement;
  nextEffectEl: HTMLSpanElement;
  priceEl: HTMLSpanElement;
  buyBtn: HTMLButtonElement;
}

export class UpgradePanel {
  private readonly ctx: GameContext;
  private readonly economy: Economy;

  private readonly backdrop: HTMLDivElement;
  private readonly moneyEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly cards = new Map<string, CardRefs>();

  private lastClearedWave = 0;
  private lastReward = 0;

  constructor(ctx: GameContext, hudRoot: HTMLElement, economy: Economy) {
    this.ctx = ctx;
    this.economy = economy;

    this.backdrop = el("div", "hud-upgrade-backdrop");
    const panel = el("div", "hud-upgrade-panel hud-panel");

    const header = el("div", "hud-upgrade-header");
    this.titleEl = el("div", "hud-upgrade-title", "Upgrades");
    this.moneyEl = el("div", "hud-upgrade-money", `$${ctx.state.money}`);
    header.append(this.titleEl, this.moneyEl);

    const grid = el("div", "hud-upgrade-grid");
    for (const def of economy.getDefinitions()) {
      const { card, refs } = this.buildCard(def);
      this.cards.set(def.id, refs);
      grid.appendChild(card);
    }

    const startBtn = el("button", "hud-start-wave-btn", "Start Next Wave");
    startBtn.type = "button";
    startBtn.addEventListener("click", () => {
      this.ctx.events.emit("ui:startNextWave", {});
    });

    panel.append(header, grid, startBtn);
    this.backdrop.appendChild(panel);
    hudRoot.appendChild(this.backdrop);

    this.bindEvents();
  }

  private buildCard(def: UpgradeDefinition): { card: HTMLDivElement; refs: CardRefs } {
    const card = el("div", "hud-upgrade-card");

    const top = el("div", "hud-upgrade-card-top");
    top.append(el("div", "hud-upgrade-name", def.name));
    const levelEl = el("span", "hud-upgrade-level", "Lv 0");
    top.appendChild(levelEl);

    const desc = el("div", "hud-upgrade-desc", def.description);

    const effects = el("div", "hud-upgrade-effects");
    const currentEffectEl = el("span", "hud-upgrade-current", def.effectText(0));
    const nextRowEl = el("div", "hud-upgrade-next-row");
    nextRowEl.append(document.createTextNode("Next: "));
    const nextEffectEl = el("span", "hud-upgrade-next", def.effectText(1));
    nextRowEl.appendChild(nextEffectEl);
    effects.append(currentEffectEl, nextRowEl);

    const bottom = el("div", "hud-upgrade-card-bottom");
    const priceEl = el("span", "hud-upgrade-price", `$${this.economy.getPrice(def.id, 0)}`);
    const buyBtn = el("button", "hud-buy-btn", "Buy");
    buyBtn.type = "button";
    buyBtn.addEventListener("click", () => {
      this.economy.purchase(def.id);
    });
    bottom.append(priceEl, buyBtn);

    card.append(top, desc, effects, bottom);

    return {
      card,
      refs: { def, levelEl, currentEffectEl, nextRowEl, nextEffectEl, priceEl, buyBtn },
    };
  }

  private bindEvents(): void {
    const events = this.ctx.events;

    events.on("phase:changed", (payload) => {
      const visible = payload.phase === GamePhase.Upgrade;
      this.backdrop.classList.toggle("is-visible", visible);
      if (visible) {
        this.titleEl.textContent =
          this.lastClearedWave > 0
            ? `Wave ${this.lastClearedWave} Cleared! +$${this.lastReward}`
            : "Upgrades";
        this.refreshAll();
      }
    });

    events.on("wave:completed", (payload) => {
      this.lastClearedWave = payload.wave;
      this.lastReward = payload.reward;
    });

    events.on("money:changed", (payload) => {
      this.moneyEl.textContent = `$${payload.money}`;
      this.refreshAffordability();
    });

    events.on("upgrade:purchased", () => {
      this.refreshAll();
    });

    events.on("game:restarted", () => {
      this.backdrop.classList.remove("is-visible");
      this.lastClearedWave = 0;
      this.lastReward = 0;
      this.moneyEl.textContent = `$${this.ctx.state.money}`;
      this.refreshAll();
    });
  }

  private refreshAll(): void {
    for (const id of this.cards.keys()) this.refreshCard(id);
  }

  private refreshAffordability(): void {
    for (const id of this.cards.keys()) this.refreshCard(id, true);
  }

  private refreshCard(id: string, affordabilityOnly = false): void {
    const refs = this.cards.get(id);
    if (!refs) return;

    const { def } = refs;
    const level = this.ctx.state.upgradeLevels[id] ?? 0;
    const maxed = def.maximumLevel !== undefined && level >= def.maximumLevel;
    const price = this.economy.getPrice(id, level);
    const affordable = this.ctx.state.money >= price;

    if (!affordabilityOnly) {
      refs.levelEl.textContent = maxed ? "MAX" : `Lv ${level}`;
      refs.currentEffectEl.textContent = def.effectText(level);
      refs.nextRowEl.style.display = maxed ? "none" : "";
      if (!maxed) refs.nextEffectEl.textContent = def.effectText(level + 1);
      refs.priceEl.textContent = maxed ? "MAX" : `$${price}`;
    }

    refs.buyBtn.disabled = maxed || !affordable;
  }
}
