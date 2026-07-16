/**
 * "While you were away…" — grants coins for happy (housed + fed) animals over the
 * time since the last save, capped at offlineCapHours. Emits offline:summary.
 */
import type { GameContext } from '../core/GameContext';
import type { EconomySystem } from './EconomySystem';
import { BALANCE } from '../core/data';

export class OfflineProgress {
  constructor(
    private ctx: GameContext,
    private economy: EconomySystem,
  ) {}

  apply(): void {
    const awaySeconds = (Date.now() - this.ctx.state.lastSaveAt) / 1000;
    if (awaySeconds < 60) return;

    let happy = 0;
    for (const shelter of this.ctx.shelters) {
      if (shelter.food > 0) happy += shelter.occupants.length;
    }
    if (happy === 0) {
      this.ctx.bus.emit('offline:summary', { coins: 0, awaySeconds });
      return;
    }

    const cappedHours = Math.min(awaySeconds / 3600, BALANCE.offlineCapHours);
    const coins = Math.round(
      happy * BALANCE.offlineCoinsPerHappyAnimalPerHour * cappedHours,
    );
    if (coins > 0) this.economy.add(coins, 'offline');
    this.ctx.bus.emit('offline:summary', { coins, awaySeconds });
  }
}
