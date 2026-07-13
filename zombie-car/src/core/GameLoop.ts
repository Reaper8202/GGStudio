/**
 * requestAnimationFrame-driven game loop with a fixed-step physics
 * accumulator. Owned by Agent A (Foundation & World).
 *
 * - `fixedUpdate(dt)` runs on every registered `GameSystem` at a constant
 *   `fixedDt`, once per accumulated step, immediately followed by
 *   `physics.step()` — so gameplay code and the physics world always see
 *   the same, deterministic timestep.
 * - `update(dt)` runs once per rendered frame, after all fixed steps for
 *   that frame, with the (clamped) real frame delta — for visual-only
 *   interpolation/animation work.
 * - `onRender` (if provided) fires once per rendered frame, after all
 *   `update` calls, so systems (camera, etc.) have applied their frame's
 *   changes before the scene is drawn.
 * - Large deltas (tab throttling, breakpoints, slow frames) are clamped via
 *   `maxFrameDt` so the simulation never tries to "catch up" in one jump.
 * - When the tab is hidden (`document.hidden`), the simulation fully pauses
 *   — no fixed/frame updates run — and on resume the elapsed wall-clock
 *   time is dropped rather than simulated, avoiding a large catch-up burst.
 */
import type { GameContext, GameSystem } from "../types";
import { GameConfig } from "../config/gameConfig";

/** Safety valve: max fixed steps run per rendered frame before we give up
 * catching up and drop the remaining accumulated time. Guards against a
 * spiral of death if a single fixed step becomes unexpectedly expensive. */
const MAX_STEPS_PER_FRAME = 8;

export class GameLoop {
  private readonly ctx: GameContext;
  private readonly onRender?: () => void;
  private readonly systems: GameSystem[] = [];

  private rafHandle: number | null = null;
  private running = false;
  private lastTime = 0;
  private accumulator = 0;

  constructor(ctx: GameContext, onRender?: () => void) {
    this.ctx = ctx;
    this.onRender = onRender;
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  /** Register a system to receive `fixedUpdate`/`update` calls each loop tick. */
  registerSystem(sys: GameSystem): void {
    this.systems.push(sys);
  }

  /** All systems registered so far, in registration order. */
  getSystems(): readonly GameSystem[] {
    return this.systems;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  private handleVisibilityChange = (): void => {
    if (!this.running) return;
    if (!document.hidden) {
      // Coming back into view: drop whatever time passed while hidden
      // instead of simulating a huge catch-up burst.
      this.lastTime = performance.now();
      this.accumulator = 0;
    }
  };

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.tick);

    if (document.hidden) {
      // Fully paused: keep the clock in sync so the next visible frame
      // doesn't see a huge elapsed delta, but run no simulation/render.
      this.lastTime = now;
      return;
    }

    let frameDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!Number.isFinite(frameDt) || frameDt < 0) frameDt = 0;
    frameDt = Math.min(frameDt, GameConfig.maxFrameDt);

    this.accumulator += frameDt;

    const fixedDt = GameConfig.fixedDt;
    let steps = 0;
    while (this.accumulator >= fixedDt && steps < MAX_STEPS_PER_FRAME) {
      for (const system of this.systems) system.fixedUpdate?.(fixedDt);
      this.ctx.physics.step();
      this.accumulator -= fixedDt;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) {
      // Physics fell too far behind real time; drop the remainder rather
      // than spiral further.
      this.accumulator = 0;
    }

    for (const system of this.systems) system.update?.(frameDt);

    this.onRender?.();
  };
}
