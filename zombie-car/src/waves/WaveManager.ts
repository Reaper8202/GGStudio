/**
 * Endless wave director. Owned by Agent C (Combat).
 *
 * Every time the phase becomes `WaveActive` (director-driven, both for the
 * very first wave and after each Upgrade -> Countdown -> WaveActive cycle)
 * this begins a new wave: assigns a zombie count/health/speed multiplier via
 * `waveConfig.ts` formulas, hands the multipliers to `ZombieSystem`, and
 * throttle-spawns zombies from it each fixedUpdate while the phase stays
 * WaveActive. A wave is complete once every assigned zombie has been spawned
 * and none remain alive (spawned-but-not-yet-dead, including ones still
 * mid-spawn-animation) — at that point it emits `wave:completed` with this
 * wave's reward and stops spawning until the next `WaveActive` transition.
 * The director (Agent A) owns the actual phase transition to Upgrade.
 */
import type { GameContext, GameEvents, GameSystem } from "../types";
import { GamePhase } from "../types";
import type { ZombieSystem } from "../zombies/ZombieSystem";
import {
  SPAWN_INTERVAL_SECONDS,
  healthMultiplierForWave,
  maxActiveZombiesForWave,
  speedMultiplierForWave,
  waveRewardForWave,
  zombieCountForWave,
} from "../config/waveConfig";

export class WaveManager implements GameSystem {
  private readonly ctx: GameContext;
  private readonly zombies: ZombieSystem;

  /** Total zombies assigned to the current wave. */
  private assignedCount = 0;
  /** How many of those have been spawned so far. */
  private spawnedCount = 0;
  /** How many zombies have died so far this wave. */
  private killedCount = 0;
  private spawnTimer = 0;
  /** True once `wave:completed` has fired for the current wave (or before
   *  any wave has started) — guards against re-emitting / re-spawning. */
  private waveDone = true;
  private lastEmittedRemaining = -1;

  constructor(ctx: GameContext, zombies: ZombieSystem) {
    this.ctx = ctx;
    this.zombies = zombies;

    ctx.events.on("phase:changed", this.handlePhaseChanged);
    ctx.events.on("zombie:killed", this.handleZombieKilled);
  }

  // ---------------------------------------------------------------------
  // GameSystem
  // ---------------------------------------------------------------------

  fixedUpdate(dt: number): void {
    if (this.ctx.state.phase !== GamePhase.WaveActive) return;
    if (this.waveDone) return;

    if (this.spawnedCount < this.assignedCount) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = SPAWN_INTERVAL_SECONDS;
        if (this.zombies.getActiveCount() < maxActiveZombiesForWave(this.ctx.state.wave)) {
          if (this.zombies.trySpawn()) {
            this.spawnedCount++;
          }
        }
      }
    }

    this.checkWaveComplete();
  }

  reset(): void {
    this.assignedCount = 0;
    this.spawnedCount = 0;
    this.killedCount = 0;
    this.spawnTimer = 0;
    this.waveDone = true;
    this.lastEmittedRemaining = -1;
    // state.wave/zombiesRemainingInWave are reset by the director itself;
    // the next wave begins on the next `phase:changed` -> WaveActive.
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private readonly handlePhaseChanged = (payload: GameEvents["phase:changed"]): void => {
    if (payload.phase !== GamePhase.WaveActive) return;
    this.beginWave();
  };

  private readonly handleZombieKilled = (): void => {
    if (this.waveDone) return;
    this.killedCount++;
    this.updateRemaining();
    this.checkWaveComplete();
  };

  private beginWave(): void {
    const state = this.ctx.state;
    state.wave += 1;
    const wave = state.wave;

    this.assignedCount = zombieCountForWave(wave);
    this.spawnedCount = 0;
    this.killedCount = 0;
    this.spawnTimer = 0;
    this.waveDone = false;

    this.zombies.setWaveMultipliers(healthMultiplierForWave(wave), speedMultiplierForWave(wave));

    this.ctx.events.emit("wave:started", { wave, totalZombies: this.assignedCount });
    this.updateRemaining();
  }

  private updateRemaining(): void {
    const remaining = Math.max(0, this.assignedCount - this.killedCount);
    this.ctx.state.zombiesRemainingInWave = remaining;
    if (remaining !== this.lastEmittedRemaining) {
      this.lastEmittedRemaining = remaining;
      this.ctx.events.emit("zombies:remaining", { remaining });
    }
  }

  private checkWaveComplete(): void {
    if (this.waveDone) return;
    if (this.spawnedCount < this.assignedCount) return;
    if (this.zombies.getActiveCount() > 0) return;

    this.waveDone = true;
    this.ctx.events.emit("wave:completed", {
      wave: this.ctx.state.wave,
      reward: waveRewardForWave(this.ctx.state.wave),
    });
  }
}
