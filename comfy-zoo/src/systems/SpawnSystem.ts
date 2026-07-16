/**
 * Maintains the wild population. Every spawn tick, tops up each unlocked zone
 * toward its cap with unlocked, non-ad-gated species native to that zone.
 */
import type { GameContext } from '../core/GameContext';
import type { AnimalDef, ZoneId } from '../data/types';
import { Animal } from '../entities/Animal';
import { ANIMALS } from '../core/data';
import { makeUid } from '../core/GameContext';
import { randomPointInZone } from '../world/layout';

const ZONE_CAP: Record<ZoneId, number> = {
  meadow: 8,
  pineForest: 6,
  palmOasis: 4,
};
const SPAWN_INTERVAL = 4;

export class SpawnSystem {
  private timer = SPAWN_INTERVAL;

  constructor(private ctx: GameContext) {}

  private wildCount(zone: ZoneId): number {
    let n = 0;
    for (const a of this.ctx.animals) {
      if (a.mode === 'wild' && a.def.zone === zone && !a.def.adGated) n++;
    }
    return n;
  }

  private eligible(zone: ZoneId): AnimalDef[] {
    return ANIMALS.filter(
      (a) =>
        !a.adGated &&
        a.zone === zone &&
        this.ctx.state.unlockedSpecies.includes(a.id),
    );
  }

  /** Cell is on the map and not occupied by a shelter/pen/building. */
  private cellFree(x: number, z: number): boolean {
    const c = this.ctx.grid.worldToCell(x, z);
    return this.ctx.grid.inBounds(c.cx, c.cz) && !this.ctx.grid.isOccupied(c.cx, c.cz);
  }

  /** Find a spawn point outside any occupied (shelter/pen) footprint. */
  private findSpawnPoint(zone: ZoneId): { x: number; z: number } {
    let p = randomPointInZone(zone);
    for (let i = 0; i < 10 && !this.cellFree(p.x, p.z); i++) {
      p = randomPointInZone(zone);
    }
    return p;
  }

  /** Spawn one wild animal of a given def at a point (defaults to its zone). */
  spawn(def: AnimalDef, x?: number, z?: number): Animal {
    const p = x !== undefined && z !== undefined ? { x, z } : this.findSpawnPoint(def.zone);
    const animal = new Animal(makeUid(this.ctx, 'wild'), def, this.ctx);
    animal.setHome(p.x, p.z);
    animal.setPosition(p.x, p.z);
    this.ctx.scene.add(animal.group);
    this.ctx.animals.push(animal);
    return animal;
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = SPAWN_INTERVAL;

    for (const zone of this.ctx.state.unlockedZones) {
      if (this.wildCount(zone) >= ZONE_CAP[zone]) continue;
      const pool = this.eligible(zone);
      if (pool.length === 0) continue;
      const def = pool[Math.floor(Math.random() * pool.length)];
      this.spawn(def);
    }
  }
}
