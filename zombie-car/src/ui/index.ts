/**
 * Single wiring entry point for Agent D's systems (UI & Progression).
 * `main.ts` (Agent A) calls `createUiSystems(ctx)` once, after `#hud-root`
 * exists, and registers the returned systems with the director/loop per
 * `docs/STATUS.md`'s integration contract (economy before ui).
 */
import "./hud.css";
import type { GameContext } from "../types";
import { Economy } from "../economy/Economy";
import { Hud } from "./Hud";
import { CountdownOverlay } from "./CountdownOverlay";
import { UpgradePanel } from "./UpgradePanel";
import { GameOverOverlay } from "./GameOverOverlay";

export { Economy } from "../economy/Economy";
export { Hud } from "./Hud";
export { CountdownOverlay } from "./CountdownOverlay";
export { UpgradePanel } from "./UpgradePanel";
export { GameOverOverlay } from "./GameOverOverlay";

export interface UiSystems {
  economy: Economy;
  hud: Hud;
  countdown: CountdownOverlay;
  upgradePanel: UpgradePanel;
  gameOver: GameOverOverlay;
}

/**
 * Builds the economy + every HTML/CSS HUD surface into `#hud-root`. Safe to
 * call once; all DOM is built up front and updated only via events
 * afterwards.
 */
export function createUiSystems(ctx: GameContext): UiSystems {
  const hudRoot = document.getElementById("hud-root");
  if (!hudRoot) {
    throw new Error("ui: #hud-root not found in index.html");
  }

  const economy = new Economy(ctx);
  const hud = new Hud(ctx, hudRoot);
  const countdown = new CountdownOverlay(ctx, hudRoot);
  const upgradePanel = new UpgradePanel(ctx, hudRoot, economy);
  const gameOver = new GameOverOverlay(ctx, hudRoot);

  return { economy, hud, countdown, upgradePanel, gameOver };
}
