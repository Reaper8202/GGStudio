/**
 * Run economy: money/kills bookkeeping from combat events, plus upgrade
 * purchases. Owned by Agent D (UI & Progression). Mutates only
 * `state.money`, `state.totalMoneyEarned`, `state.totalKills`, and (via
 * `UpgradeDefinition.apply`) `state.upgradeLevels` / `state.modifiers` — the
 * fields the frozen contract in `src/types/index.ts` reserves for it.
 */
import type { GameContext, GameEvents, GameSystem, UpgradeDefinition } from "../types";
import { upgradeDefinitions } from "../config/upgradeDefs";

export class Economy implements GameSystem {
  private readonly ctx: GameContext;
  private readonly definitions: readonly UpgradeDefinition[] = upgradeDefinitions;
  private readonly definitionsById: ReadonlyMap<string, UpgradeDefinition>;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.definitionsById = new Map(this.definitions.map((def) => [def.id, def]));

    ctx.events.on("zombie:killed", this.handleZombieKilled);
    ctx.events.on("wave:completed", this.handleWaveCompleted);
    // The director resets state.money/totalMoneyEarned/totalKills/upgradeLevels
    // itself before emitting this; we just re-broadcast so the HUD refreshes.
    ctx.events.on("game:restarted", this.handleRestarted);
  }

  /** All seven upgrade definitions, in display order. */
  getDefinitions(): readonly UpgradeDefinition[] {
    return this.definitions;
  }

  /** price(level) = round(basePrice * priceGrowth^level); level = levels owned. */
  getPrice(id: string, level: number): number {
    const def = this.definitionsById.get(id);
    if (!def) return Infinity;
    return Math.round(def.basePrice * Math.pow(def.priceGrowth, level));
  }

  /**
   * No-op: the director resets `state.money`/`upgradeLevels`/`modifiers`
   * itself (before this runs) and then emits `game:restarted`, which is
   * what actually re-broadcasts `money:changed`/`kills:changed` to the
   * HUD. Declared to give this class a concrete `GameSystem` member.
   */
  reset(): void {
    // Intentionally empty — see doc comment above.
  }

  /** Attempts to buy the next level of `id`. Returns false if maxed/unaffordable. */
  purchase(id: string): boolean {
    const def = this.definitionsById.get(id);
    if (!def) return false;

    const state = this.ctx.state;
    const level = state.upgradeLevels[id] ?? 0;
    if (def.maximumLevel !== undefined && level >= def.maximumLevel) return false;

    const price = this.getPrice(id, level);
    if (state.money < price) return false;

    state.money -= price;
    const newLevel = level + 1;
    state.upgradeLevels[id] = newLevel;
    def.apply(state, newLevel);

    this.ctx.events.emit("upgrade:purchased", { id, level: newLevel, price });
    this.ctx.events.emit("money:changed", {
      money: state.money,
      totalEarned: state.totalMoneyEarned,
    });
    this.ctx.events.emit("audio:play", { sound: "purchase" });
    return true;
  }

  private readonly handleZombieKilled = (payload: GameEvents["zombie:killed"]): void => {
    const state = this.ctx.state;
    state.money += payload.reward;
    state.totalMoneyEarned += payload.reward;
    state.totalKills += 1;

    this.ctx.events.emit("money:changed", {
      money: state.money,
      totalEarned: state.totalMoneyEarned,
    });
    this.ctx.events.emit("kills:changed", { totalKills: state.totalKills });
  };

  private readonly handleWaveCompleted = (payload: GameEvents["wave:completed"]): void => {
    const state = this.ctx.state;
    state.money += payload.reward;
    state.totalMoneyEarned += payload.reward;

    this.ctx.events.emit("money:changed", {
      money: state.money,
      totalEarned: state.totalMoneyEarned,
    });
  };

  private readonly handleRestarted = (): void => {
    const state = this.ctx.state;
    this.ctx.events.emit("money:changed", {
      money: state.money,
      totalEarned: state.totalMoneyEarned,
    });
    this.ctx.events.emit("kills:changed", { totalKills: state.totalKills });
  };
}
