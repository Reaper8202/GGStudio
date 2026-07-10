/**
 * Capture roll (plan §4). Chance = base captureChance + retryBonus·priorFails on
 * the SAME individual + dietMatchBonus if the player carries matching food, clamped
 * to [0,1]. Legendary/mythic have base 1.0 (guaranteed). Failure never despawns —
 * the animal simply spooks and flees, and its pity accumulates so bad luck can't
 * stall a session.
 */
import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import type { Animal } from '../entities/Animal';
import type { HerdingSystem } from './HerdingSystem';
import { BALANCE } from '../core/data';

export class CaptureSystem {
  /** per-individual accumulated failures ("it's warming up to you") */
  private pity = new Map<string, number>();
  private tmp = new THREE.Vector3();

  constructor(
    private ctx: GameContext,
    private herding: HerdingSystem,
  ) {}

  /** Chance the next attempt on this animal would succeed (for UI/telegraph). */
  chanceFor(animal: Animal): number {
    const fails = this.pity.get(animal.uid) ?? 0;
    const match = this.ctx.state.resources[animal.def.diet] > 0 ? BALANCE.dietMatchBonus : 0;
    return Math.min(1, animal.def.captureChance + fails * BALANCE.captureRetryBonus + match);
  }

  attempt(animal: Animal): void {
    const chance = this.chanceFor(animal);
    this.ctx.bus.emit('animal:captureAttempt', {
      animalUid: animal.uid,
      speciesId: animal.def.id,
      chance,
    });

    if (Math.random() < chance) {
      this.succeed(animal);
    } else {
      this.fail(animal);
    }
  }

  private succeed(animal: Animal): void {
    this.pity.delete(animal.uid);
    const rec = this.ctx.zoopedia.get(animal.def.id);
    const isNew = !rec?.caught;
    if (rec) rec.caught = true;

    this.ctx.bus.emit('animal:captured', {
      animalUid: animal.uid,
      speciesId: animal.def.id,
      tier: animal.def.tier,
      isNewSpecies: isNew,
    });
    this.ctx.bus.emit('zoopedia:updated', { speciesId: animal.def.id, caught: true });

    this.ctx.fx.heartBurst(this.tmp.set(animal.x, 1.2, animal.z));
    this.ctx.adapter.happyTime();

    this.herding.addFollower(animal);
    this.ctx.requestSave('capture');
  }

  private fail(animal: Animal): void {
    const fails = (this.pity.get(animal.uid) ?? 0) + 1;
    this.pity.set(animal.uid, fails);
    const match = this.ctx.state.resources[animal.def.diet] > 0 ? BALANCE.dietMatchBonus : 0;
    const nextChance = Math.min(
      1,
      animal.def.captureChance + fails * BALANCE.captureRetryBonus + match,
    );
    this.ctx.bus.emit('animal:captureFailed', {
      animalUid: animal.uid,
      speciesId: animal.def.id,
      nextChance,
    });
    animal.brain.spook(this.ctx);
  }
}
