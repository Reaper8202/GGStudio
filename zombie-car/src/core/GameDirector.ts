/**
 * Owns `state.phase` transitions for the whole run. Owned by Agent A
 * (Foundation & World) per docs/STATUS.md's "Integration contract":
 *
 *   boot ⇒ Countdown(3s) ⇒ WaveActive
 *   "wave:completed"    ⇒ Upgrade
 *   "ui:startNextWave"  ⇒ Countdown
 *   "vehicle:destroyed" ⇒ GameOver
 *   "ui:restartRun"     ⇒ reset all systems ⇒ emit "game:restarted" ⇒ Countdown
 *
 * `phase:changed` is emitted on every transition. This is also the single
 * place `main.ts` registers gameplay systems (`registerSystem`), so the
 * director can call `reset()` on all of them for a clean in-place restart.
 */
import { GamePhase, createDefaultModifiers } from "../types";
import type { GameContext, GameSystem } from "../types";
import { GameConfig } from "../config/gameConfig";
import type { GameLoop } from "./GameLoop";

export class GameDirector {
  private readonly ctx: GameContext;
  private readonly loop: GameLoop;

  private countdownRemaining = 0;
  private countdownAccumulator = 0;

  constructor(ctx: GameContext, loop: GameLoop) {
    this.ctx = ctx;
    this.loop = loop;

    ctx.events.on("wave:completed", this.handleWaveCompleted);
    ctx.events.on("ui:startNextWave", this.handleStartNextWave);
    ctx.events.on("vehicle:destroyed", this.handleVehicleDestroyed);
    ctx.events.on("ui:restartRun", this.handleRestartRun);

    // The director itself needs a fixed-rate tick to advance the countdown
    // clock independent of render frame rate.
    this.loop.registerSystem(this);
  }

  /** Used by `main.ts` to register every gameplay system with the loop. */
  registerSystem(sys: GameSystem): void {
    this.loop.registerSystem(sys);
  }

  /** Call once after all systems are registered to start the very first countdown. */
  boot(): void {
    this.beginCountdown();
  }

  /** Advances the countdown clock; a no-op outside the Countdown phase. */
  fixedUpdate(dt: number): void {
    if (this.ctx.state.phase !== GamePhase.Countdown) return;

    this.countdownAccumulator += dt;
    while (this.countdownAccumulator >= 1) {
      this.countdownAccumulator -= 1;
      this.countdownRemaining -= 1;
      if (this.countdownRemaining > 0) {
        this.ctx.events.emit("countdown:tick", {
          secondsRemaining: this.countdownRemaining,
        });
      } else {
        this.transition(GamePhase.WaveActive);
        break;
      }
    }
  }

  private readonly handleWaveCompleted = (): void => {
    if (this.ctx.state.phase !== GamePhase.WaveActive) return;
    this.transition(GamePhase.Upgrade);
  };

  private readonly handleStartNextWave = (): void => {
    if (this.ctx.state.phase !== GamePhase.Upgrade) return;
    this.beginCountdown();
  };

  private readonly handleVehicleDestroyed = (): void => {
    if (this.ctx.state.phase === GamePhase.GameOver) return;
    this.transition(GamePhase.GameOver);
  };

  private readonly handleRestartRun = (): void => {
    // Reset shared state BEFORE system resets: systems (e.g. the vehicle's
    // max-health restore) read `state.modifiers` inside `reset()`, so stale
    // upgrade modifiers must be gone first.
    const state = this.ctx.state;
    state.wave = 0;
    state.money = GameConfig.startingMoney;
    state.totalMoneyEarned = 0;
    state.totalKills = 0;
    state.zombiesRemainingInWave = 0;
    state.upgradeLevels = {};
    state.modifiers = createDefaultModifiers();

    for (const system of this.loop.getSystems()) {
      system.reset?.();
    }

    this.ctx.events.emit("game:restarted", {});

    // Also resets `state.phase` (via `transition`) and restarts the clock.
    this.beginCountdown();
  };

  private beginCountdown(): void {
    this.transition(GamePhase.Countdown);
    this.countdownRemaining = GameConfig.countdownSeconds;
    this.countdownAccumulator = 0;
    this.ctx.events.emit("countdown:tick", {
      secondsRemaining: this.countdownRemaining,
    });
  }

  private transition(next: GamePhase): void {
    const previous = this.ctx.state.phase;
    this.ctx.state.phase = next;
    this.ctx.events.emit("phase:changed", { phase: next, previous });
  }
}
