/**
 * Manages the follower chain trailing the player and deposits followers into any
 * matching, non-full shelter pen they pass — housing them for coins + income.
 */
import type { GameContext } from '../core/GameContext';
import type { Animal } from '../entities/Animal';
import type { EconomySystem } from './EconomySystem';
import { getAnimal } from '../core/data';

export class HerdingSystem {
  private followers: Animal[] = [];

  constructor(
    private ctx: GameContext,
    private economy: EconomySystem,
  ) {}

  get count(): number {
    return this.followers.length;
  }

  get max(): number {
    return this.ctx.state.followersMax;
  }

  hasFreeSlot(): boolean {
    return this.followers.length < this.ctx.state.followersMax;
  }

  addFollower(animal: Animal): boolean {
    if (!this.hasFreeSlot()) return false;
    animal.brain.becomeFollower();
    animal.followIndex = this.followers.length;
    this.followers.push(animal);
    this.ctx.bus.emit('follower:added', {
      animalUid: animal.uid,
      count: this.followers.length,
      max: this.max,
    });
    return true;
  }

  private removeFollowerAt(idx: number): void {
    this.followers.splice(idx, 1);
    this.followers.forEach((f, i) => (f.followIndex = i));
  }

  update(dt: number): void {
    void dt;
    // trailing chain: leader follows player, each other follows the one ahead
    for (let i = 0; i < this.followers.length; i++) {
      const f = this.followers[i];
      if (i === 0) {
        f.brain.followTargetX = this.ctx.player.x;
        f.brain.followTargetZ = this.ctx.player.z;
      } else {
        const ahead = this.followers[i - 1];
        f.brain.followTargetX = ahead.x;
        f.brain.followTargetZ = ahead.z;
      }
    }

    // deposit into matching pens
    for (let i = this.followers.length - 1; i >= 0; i--) {
      const f = this.followers[i];
      const shelter = this.ctx.shelters.find(
        (s) =>
          s.def.species.includes(f.def.id) &&
          !s.isFull &&
          s.dist2(f.x, f.z) <= (s.penRadius + 1.2) * (s.penRadius + 1.2),
      );
      if (!shelter) continue;

      this.removeFollowerAt(i);
      shelter.addOccupant(f.uid);
      f.shelterUid = shelter.uid;
      const pen = shelter.penPoint();
      f.brain.house(pen.x, pen.z, pen.r);

      const reward = getAnimal(f.def.id).coinsPerTick * 5 + 5;
      this.ctx.bus.emit('animal:housed', {
        animalUid: f.uid,
        speciesId: f.def.id,
        shelterUid: shelter.uid,
        coins: reward,
      });
      this.economy.add(reward, 'house');

      const rec = this.ctx.zoopedia.get(f.def.id);
      if (rec) rec.count++;
      this.ctx.bus.emit('follower:removed', {
        animalUid: f.uid,
        count: this.followers.length,
        max: this.max,
      });
      this.ctx.adapter.happyTime();
      this.ctx.requestSave('house');
    }
  }
}
