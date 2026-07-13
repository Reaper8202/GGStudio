/**
 * Always-on HUD: wave/zombies, health bar, money/kills, SWARMED warning,
 * bottom-right reset-vehicle + mute buttons, damage vignette, money
 * popups, and center banners (wave start/complete, purchase confirmation).
 *
 * Built once into `#hud-root` and updated only via events, per the frozen
 * event contract in `src/types/index.ts`. Owned by Agent D (UI & Progression).
 */
import { GamePhase } from "../types";
import type { GameContext } from "../types";
import { EconomyUiConfig } from "../config/economyConfig";

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

/** Restarts a CSS animation on `element` by toggling `className` off/on. */
function retriggerAnimation(element: HTMLElement, className: string): void {
  element.classList.remove(className);
  // Force a reflow so the class removal is observed before re-adding it.
  void element.offsetWidth;
  element.classList.add(className);
}

export class Hud {
  private readonly ctx: GameContext;

  private readonly waveLabel: HTMLDivElement;
  private readonly zombiesLabel: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly healthText: HTMLDivElement;
  private readonly swarmWarning: HTMLDivElement;
  private readonly moneyLabel: HTMLDivElement;
  private readonly killsLabel: HTMLDivElement;
  private readonly moneyPopupLayer: HTMLDivElement;
  private readonly resetVehicleBtn: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly vignette: HTMLDivElement;
  private readonly bannerLayer: HTMLDivElement;

  private lastMoney: number;
  private lastMaxHealth = 100;

  constructor(ctx: GameContext, hudRoot: HTMLElement) {
    this.ctx = ctx;
    this.lastMoney = ctx.state.money;

    const layer = el("div", "hud-layer");

    // --- top-left: wave + zombies remaining ---------------------------
    const topLeft = el("div", "hud-topleft hud-panel");
    this.waveLabel = el("div", "hud-wave-label", "Wave 1");
    this.zombiesLabel = el("div", "hud-zombies-label", "0 zombies left");
    topLeft.append(this.waveLabel, this.zombiesLabel);

    // --- top-center: health bar + SWARMED warning ----------------------
    const topCenter = el("div", "hud-topcenter");
    const healthPanel = el("div", "hud-health-panel hud-panel");
    const healthTrack = el("div", "hud-health-bar-track");
    this.healthFill = el("div", "hud-health-bar-fill");
    healthTrack.append(this.healthFill);
    this.healthText = el("div", "hud-health-text", "100 / 100");
    healthPanel.append(healthTrack, this.healthText);
    this.swarmWarning = el("div", "hud-swarm-warning", "SWARMED");
    topCenter.append(healthPanel, this.swarmWarning);

    // --- top-right: money + kills ---------------------------------------
    const topRight = el("div", "hud-topright hud-panel");
    this.moneyLabel = el("div", "hud-money-label", `$${this.ctx.state.money}`);
    this.killsLabel = el("div", "hud-kills-label", "0 kills");
    this.moneyPopupLayer = el("div", "hud-money-popup-layer");
    topRight.append(this.moneyLabel, this.killsLabel, this.moneyPopupLayer);

    // --- bottom-right: reset vehicle + mute -----------------------------
    const bottomRight = el("div", "hud-bottomright");
    this.resetVehicleBtn = el("button", "hud-btn hud-reset-btn", "Reset Vehicle");
    this.resetVehicleBtn.type = "button";
    this.resetVehicleBtn.addEventListener("click", () => {
      this.ctx.events.emit("ui:resetVehicle", {});
    });
    this.muteBtn = el("button", "hud-btn hud-mute-btn", ctx.state.muted ? "\u{1F507}" : "\u{1F50A}");
    this.muteBtn.type = "button";
    this.muteBtn.addEventListener("click", () => {
      this.ctx.state.muted = !this.ctx.state.muted;
      this.muteBtn.textContent = this.ctx.state.muted ? "\u{1F507}" : "\u{1F50A}";
    });
    bottomRight.append(this.resetVehicleBtn, this.muteBtn);

    // --- damage vignette --------------------------------------------------
    this.vignette = el("div", "hud-vignette");
    this.vignette.style.animationDuration = `${EconomyUiConfig.damageFlashDurationMs}ms`;

    // --- center banners -----------------------------------------------------
    this.bannerLayer = el("div", "hud-banner-layer");

    layer.append(
      topLeft,
      topCenter,
      topRight,
      bottomRight,
      this.vignette,
      this.bannerLayer
    );
    hudRoot.appendChild(layer);

    this.updateHealthDisplay(this.lastMaxHealth, this.lastMaxHealth);
    this.bindEvents();
  }

  private bindEvents(): void {
    const events = this.ctx.events;

    events.on("phase:changed", (payload) => {
      this.resetVehicleBtn.classList.toggle(
        "is-visible",
        payload.phase === GamePhase.WaveActive
      );
    });

    events.on("wave:started", (payload) => {
      this.waveLabel.textContent = `Wave ${payload.wave}`;
      this.zombiesLabel.textContent = `${payload.totalZombies} zombies left`;
      this.showBanner(`WAVE ${payload.wave}`);
    });

    events.on("zombies:remaining", (payload) => {
      this.zombiesLabel.textContent = `${payload.remaining} zombies left`;
    });

    events.on("wave:completed", (payload) => {
      this.showBanner(
        "WAVE COMPLETE",
        `+$${payload.reward}`
      );
    });

    events.on("upgrade:purchased", () => {
      this.showBanner("UPGRADE PURCHASED");
    });

    events.on("vehicle:healthChanged", (payload) => {
      this.updateHealthDisplay(payload.health, payload.maxHealth);
    });

    events.on("vehicle:damaged", () => {
      retriggerAnimation(this.vignette, "is-flashing");
    });

    events.on("swarm:changed", (payload) => {
      this.swarmWarning.classList.toggle("is-active", payload.swarmed);
    });

    events.on("money:changed", (payload) => {
      this.applyMoney(payload.money);
    });

    events.on("kills:changed", (payload) => {
      this.killsLabel.textContent = `${payload.totalKills} kills`;
    });

    events.on("game:restarted", () => {
      this.waveLabel.textContent = `Wave ${this.ctx.state.wave}`;
      this.zombiesLabel.textContent = "0 zombies left";
      this.killsLabel.textContent = `${this.ctx.state.totalKills} kills`;
      this.lastMoney = this.ctx.state.money;
      this.moneyLabel.textContent = `$${this.ctx.state.money}`;
      this.swarmWarning.classList.remove("is-active");
      this.resetVehicleBtn.classList.remove("is-visible");
      this.moneyPopupLayer.replaceChildren();
      this.bannerLayer.replaceChildren();
    });
  }

  private applyMoney(money: number): void {
    const delta = money - this.lastMoney;
    this.lastMoney = money;
    this.moneyLabel.textContent = `$${money}`;
    if (delta > 0) this.spawnMoneyPopup(delta);
  }

  private spawnMoneyPopup(delta: number): void {
    const popup = el("div", "hud-money-popup", `+$${delta}`);
    popup.style.animationDuration = `${EconomyUiConfig.moneyPopupDurationMs}ms`;
    popup.addEventListener("animationend", () => popup.remove());
    this.moneyPopupLayer.appendChild(popup);
  }

  private showBanner(text: string, subText?: string): void {
    const banner = el("div", "hud-banner", text);
    banner.style.animationDuration = `${EconomyUiConfig.bannerDurationMs}ms`;
    banner.addEventListener("animationend", () => banner.remove());
    this.bannerLayer.appendChild(banner);

    if (subText) {
      const sub = el("div", "hud-banner hud-banner-sub", subText);
      sub.style.animationDuration = `${EconomyUiConfig.bannerDurationMs}ms`;
      sub.addEventListener("animationend", () => sub.remove());
      this.bannerLayer.appendChild(sub);
    }
  }

  private updateHealthDisplay(health: number, maxHealth: number): void {
    this.lastMaxHealth = maxHealth;
    const fraction = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 0;
    const hue = 120 * fraction;
    this.healthFill.style.width = `${fraction * 100}%`;
    this.healthFill.style.background = `hsl(${hue} 70% 45%)`;
    this.healthText.textContent = `${Math.max(0, Math.round(health))} / ${Math.round(maxHealth)}`;
  }
}
