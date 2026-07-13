/**
 * Game-over overlay: dark backdrop, final wave/kills/money earned, and a
 * Restart Run button (`ui:restartRun`). Shown on `phase:changed` ->
 * `GameOver`, hidden on any other phase and on `game:restarted`. Owned by
 * Agent D (UI & Progression).
 */
import { GamePhase } from "../types";
import type { GameContext } from "../types";

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

export class GameOverOverlay {
  private readonly ctx: GameContext;
  private readonly backdrop: HTMLDivElement;
  private readonly waveStatEl: HTMLDivElement;
  private readonly killsStatEl: HTMLDivElement;
  private readonly moneyStatEl: HTMLDivElement;

  constructor(ctx: GameContext, hudRoot: HTMLElement) {
    this.ctx = ctx;

    this.backdrop = el("div", "hud-gameover-backdrop");
    const panel = el("div", "hud-gameover-panel hud-panel");

    const title = el("div", "hud-gameover-title", "GAME OVER");

    const stats = el("div", "hud-gameover-stats");
    this.waveStatEl = el("div", "hud-gameover-stat-wave");
    this.killsStatEl = el("div", "hud-gameover-stat-kills");
    this.moneyStatEl = el("div", "hud-gameover-stat-money");
    stats.append(this.waveStatEl, this.killsStatEl, this.moneyStatEl);

    const restartBtn = el("button", "hud-restart-btn", "Restart Run");
    restartBtn.type = "button";
    restartBtn.addEventListener("click", () => {
      this.ctx.events.emit("ui:restartRun", {});
    });

    panel.append(title, stats, restartBtn);
    this.backdrop.appendChild(panel);
    hudRoot.appendChild(this.backdrop);

    this.bindEvents();
  }

  private bindEvents(): void {
    const events = this.ctx.events;

    events.on("phase:changed", (payload) => {
      if (payload.phase === GamePhase.GameOver) {
        this.refreshStats();
        this.backdrop.classList.add("is-visible");
      } else {
        this.backdrop.classList.remove("is-visible");
      }
    });

    events.on("game:restarted", () => {
      this.backdrop.classList.remove("is-visible");
    });
  }

  private refreshStats(): void {
    const state = this.ctx.state;
    this.waveStatEl.innerHTML = "";
    this.waveStatEl.append("Final wave: ", el("strong", "", String(state.wave)));
    this.killsStatEl.innerHTML = "";
    this.killsStatEl.append("Total kills: ", el("strong", "", String(state.totalKills)));
    this.moneyStatEl.innerHTML = "";
    this.moneyStatEl.append(
      "Total money earned: ",
      el("strong", "", `$${state.totalMoneyEarned}`)
    );
  }
}
