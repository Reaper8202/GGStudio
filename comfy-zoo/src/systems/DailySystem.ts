/**
 * Daily loop (plan §7): a calendar-day login streak gift and one rare "Daily
 * Visitor" that appears once per day.
 */
import type { GameContext } from '../core/GameContext';
import type { EconomySystem } from './EconomySystem';
import type { SpawnSystem } from './SpawnSystem';
import { ANIMALS, BALANCE } from '../core/data';
import { randomPointInZone } from '../world/layout';

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export class DailySystem {
  constructor(
    private ctx: GameContext,
    private economy: EconomySystem,
    private spawner: SpawnSystem,
  ) {}

  check(): void {
    const today = dateKey(new Date());

    if (this.ctx.state.lastDailyKey !== today) {
      const yesterday = dateKey(new Date(Date.now() - 86400000));
      if (this.ctx.state.lastDailyKey === yesterday) {
        this.ctx.state.streakCount = Math.min(
          this.ctx.state.streakCount + 1,
          BALANCE.dailyGiftCoinsByStreak.length - 1,
        );
      } else {
        this.ctx.state.streakCount = 0;
      }
      this.ctx.state.lastDailyKey = today;
      const coins = BALANCE.dailyGiftCoinsByStreak[this.ctx.state.streakCount];
      this.economy.add(coins, 'daily');
      this.ctx.bus.emit('daily:gift', {
        day: this.ctx.state.streakCount + 1,
        coins,
      });
    }

    if (this.ctx.state.lastVisitorKey !== today) {
      this.ctx.state.lastVisitorKey = today;
      this.spawnVisitor();
    }
  }

  private spawnVisitor(): void {
    const pool = ANIMALS.filter((a) => !a.adGated && (a.tier === 'rare' || a.tier === 'uncommon'));
    if (pool.length === 0) return;
    const def = pool[Math.floor(Math.random() * pool.length)];
    const p = randomPointInZone('meadow');
    this.spawner.spawn(def, p.x, p.z);
  }
}
