/**
 * Big center countdown number (3-2-1, pop animation) during `Countdown`,
 * with a "GO!" flash on the `Countdown` -> `WaveActive` transition. Owned
 * by Agent D (UI & Progression).
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

function retriggerAnimation(element: HTMLElement, className: string): void {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

export class CountdownOverlay {
  private readonly ctx: GameContext;
  private readonly layer: HTMLDivElement;
  private readonly numberEl: HTMLDivElement;
  private readonly goEl: HTMLDivElement;

  constructor(ctx: GameContext, hudRoot: HTMLElement) {
    this.ctx = ctx;

    this.layer = el("div", "hud-countdown-layer");
    this.numberEl = el("div", "hud-countdown-number", "3");
    this.numberEl.style.animationDuration = `${EconomyUiConfig.countdownPopDurationMs}ms`;
    this.goEl = el("div", "hud-countdown-go", "GO!");
    this.goEl.style.animationDuration = `${EconomyUiConfig.goFlashDurationMs}ms`;
    this.layer.append(this.numberEl, this.goEl);
    hudRoot.appendChild(this.layer);

    this.goEl.addEventListener("animationend", () => {
      this.goEl.classList.remove("is-flashing");
      this.layer.classList.remove("is-visible");
    });

    this.bindEvents();
  }

  private bindEvents(): void {
    const events = this.ctx.events;

    events.on("phase:changed", (payload) => {
      if (payload.phase === GamePhase.Countdown) {
        this.layer.classList.add("is-visible");
        this.numberEl.style.opacity = "1";
        this.goEl.classList.remove("is-flashing");
        this.goEl.style.opacity = "0";
      } else if (
        payload.previous === GamePhase.Countdown &&
        payload.phase === GamePhase.WaveActive
      ) {
        this.numberEl.style.opacity = "0";
        this.goEl.style.opacity = "1";
        retriggerAnimation(this.goEl, "is-flashing");
      } else {
        this.layer.classList.remove("is-visible");
      }
    });

    events.on("countdown:tick", (payload) => {
      this.numberEl.textContent = String(payload.secondsRemaining);
      retriggerAnimation(this.numberEl, "is-popping");
    });

    events.on("game:restarted", () => {
      this.layer.classList.remove("is-visible");
      this.numberEl.classList.remove("is-popping");
      this.goEl.classList.remove("is-flashing");
      this.numberEl.style.opacity = "0";
      this.goEl.style.opacity = "0";
      this.numberEl.textContent = "3";
    });
  }
}
