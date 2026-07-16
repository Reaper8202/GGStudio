/**
 * Coin ledger + passive income. Housed animals whose trough has food and who are
 * not sad pay coinsPerTick every incomeTickSeconds. Also handles follower-cap upgrades.
 */
import type { GameContext } from '../core/GameContext';
import { BALANCE, getAnimal } from '../core/data';

export class EconomySystem {
  private incomeTimer = 0;

  constructor(private ctx: GameContext) {}

  get coins(): number {
    return this.ctx.state.coins;
  }

  add(amount: number, reason: string): void {
    if (amount === 0) return;
    this.ctx.state.coins += amount;
    this.ctx.bus.emit('coins:changed', {
      coins: this.ctx.state.coins,
      delta: amount,
      reason,
    });
    this.ctx.requestSave(reason);
  }

  canAfford(cost: number): boolean {
    return this.ctx.state.coins >= cost;
  }

  /** Attempt to spend; emits coins:insufficient on failure. */
  spend(cost: number, reason: string): boolean {
    if (this.ctx.state.coins < cost) {
      this.ctx.bus.emit('coins:insufficient', {
        needed: cost,
        have: this.ctx.state.coins,
      });
      return false;
    }
    this.add(-cost, reason);
    return true;
  }

  followerUpgradeCost(): number | null {
    const idx = this.ctx.state.followersMax - BALANCE.maxFollowersBase;
    if (idx >= BALANCE.followerUpgradeCosts.length) return null;
    return BALANCE.followerUpgradeCosts[idx];
  }

  upgradeFollowers(): boolean {
    const cost = this.followerUpgradeCost();
    if (cost === null) return false;
    if (!this.spend(cost, 'follower-upgrade')) return false;
    this.ctx.state.followersMax++;
    this.ctx.adapter.happyTime();
    return true;
  }

  update(dt: number): void {
    this.incomeTimer += dt;
    if (this.incomeTimer < BALANCE.incomeTickSeconds) return;
    this.incomeTimer -= BALANCE.incomeTickSeconds;

    let income = 0;
    for (const shelter of this.ctx.shelters) {
      if (shelter.food <= 0 || shelter.occupants.length === 0) continue;
      for (const uid of shelter.occupants) {
        const animal = this.ctx.animals.find((a) => a.uid === uid);
        if (!animal) continue;
        if (animal.brain.state === 'sad') continue;
        income += getAnimal(animal.def.id).coinsPerTick;
      }
    }
    if (income > 0) this.add(income, 'income');
  }
}
