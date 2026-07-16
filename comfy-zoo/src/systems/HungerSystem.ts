/**
 * Softened hunger (plan §4 — no death, comfy brand). Troughs drain per occupant
 * every hungerTickSeconds. When empty: occupants become Hungry → after
 * sadGraceMinutes Sad → after a further wanderOffMinutes they wander back to the
 * wild (recapturable). Feeding refills the trough and cheers everyone up.
 */
import type { GameContext } from '../core/GameContext';
import type { Shelter } from '../entities/Shelter';
import type { ResourceKind } from '../data/types';
import { BALANCE, getAnimal } from '../core/data';

interface HungerRecord {
  hungrySince: number | null;
  sadSince: number | null;
}

export class HungerSystem {
  private records = new Map<string, HungerRecord>();
  private drainTimer = 0;

  constructor(private ctx: GameContext) {}

  private rec(uid: string): HungerRecord {
    let r = this.records.get(uid);
    if (!r) {
      r = { hungrySince: null, sadSince: null };
      this.records.set(uid, r);
    }
    return r;
  }

  /** Deposit matching food into a shelter's trough. Returns units deposited. */
  feed(shelter: Shelter): number {
    if (shelter.foodMax === 0 || shelter.food >= shelter.foodMax) return 0;
    const diets = new Set<ResourceKind>(shelter.def.species.map((id) => getAnimal(id).diet));
    for (const kind of diets) {
      const have = this.ctx.state.resources[kind];
      if (have > 0) {
        const amt = Math.min(have, shelter.foodMax - shelter.food);
        shelter.food += amt;
        this.ctx.state.resources[kind] -= amt;
        shelter.setFoodVisual();
        this.ctx.bus.emit('shelter:troughChanged', {
          shelterUid: shelter.uid,
          food: shelter.food,
          foodMax: shelter.foodMax,
        });
        this.ctx.bus.emit('resource:inventoryChanged', {
          kind,
          total: this.ctx.state.resources[kind],
        });
        this.ctx.requestSave('feed');
        return amt;
      }
    }
    return 0;
  }

  update(dt: number): void {
    this.drainTimer += dt;
    if (this.drainTimer >= BALANCE.hungerTickSeconds) {
      this.drainTimer -= BALANCE.hungerTickSeconds;
      for (const shelter of this.ctx.shelters) {
        if (shelter.food > 0 && shelter.occupants.length > 0) {
          shelter.food = Math.max(0, shelter.food - shelter.occupants.length);
          shelter.setFoodVisual();
          this.ctx.bus.emit('shelter:troughChanged', {
            shelterUid: shelter.uid,
            food: shelter.food,
            foodMax: shelter.foodMax,
          });
        }
      }
    }

    const now = this.ctx.now;
    const sadGrace = BALANCE.sadGraceMinutes * 60;
    const wanderOff = BALANCE.wanderOffMinutes * 60;

    for (const shelter of this.ctx.shelters) {
      const fed = shelter.food > 0;
      for (const uid of [...shelter.occupants]) {
        const animal = this.ctx.animals.find((a) => a.uid === uid);
        if (!animal) continue;
        const r = this.rec(uid);

        if (fed) {
          if (r.hungrySince !== null || r.sadSince !== null) {
            r.hungrySince = null;
            r.sadSince = null;
            animal.brain.setHungry(false);
            animal.brain.setSad(false);
            this.ctx.bus.emit('animal:cheeredUp', {
              animalUid: uid,
              shelterUid: shelter.uid,
            });
          }
          continue;
        }

        // unfed
        if (r.hungrySince === null) {
          r.hungrySince = now;
          animal.brain.setHungry(true);
          this.ctx.bus.emit('animal:hungry', {
            animalUid: uid,
            speciesId: animal.def.id,
            shelterUid: shelter.uid,
            food: animal.def.diet,
          });
          continue;
        }

        const hungryElapsed = now - r.hungrySince;
        if (hungryElapsed >= sadGrace && r.sadSince === null) {
          r.sadSince = now;
          animal.brain.setSad(true);
          this.ctx.bus.emit('animal:sad', {
            animalUid: uid,
            speciesId: animal.def.id,
            shelterUid: shelter.uid,
          });
        }
        if (r.sadSince !== null && now - r.sadSince >= wanderOff) {
          // wander back to the wild
          shelter.removeOccupant(uid);
          this.records.delete(uid);
          animal.brain.returnToWild(this.ctx);
          const rec = this.ctx.zoopedia.get(animal.def.id);
          if (rec && rec.count > 0) rec.count--;
          this.ctx.bus.emit('animal:wanderedOff', {
            animalUid: uid,
            speciesId: animal.def.id,
            shelterUid: shelter.uid,
          });
          this.ctx.requestSave('wanderedOff');
        }
      }
    }
  }
}
