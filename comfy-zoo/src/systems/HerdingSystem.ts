/**
 * Manages the follower chain trailing the player and deposits followers into any
 * matching, non-full shelter pen they pass — housing them for coins + income.
 */
import type { GameContext } from '../core/GameContext';
import type { Animal } from '../entities/Animal';
import type { Shelter } from '../entities/Shelter';
import type { EconomySystem } from './EconomySystem';
import { getAnimal } from '../core/data';

/** extra breathing room (m) added on top of the two touching radii, so followers keep a visible gap instead of just barely not clipping */
const FOLLOW_GAP = 0.5;
/** how many followers stand abreast per row of the wedge (2 = pairs side by side, spread out instead of single-file) */
const ROW_SIZE = 2;
/** extra clearance (m) beyond the row's radius used for the sideways offset between row-mates */
const LATERAL_GAP = 0.5;
/** min player movement (m) before a new breadcrumb is recorded, bounding trail length without losing corner shape */
const TRAIL_MIN_STEP = 0.05;
/** hard cap on stored breadcrumbs; far more than any realistic follower chain needs */
const TRAIL_MAX_POINTS = 400;

export class HerdingSystem {
  private followers: Animal[] = [];
  /** breadcrumb trail of recent player positions, oldest first, used so followers trace the
   * player's actual path instead of cutting corners toward its live position */
  private trail: { x: number; z: number }[] = [];

  constructor(
    private ctx: GameContext,
    private economy: EconomySystem,
  ) {}

  /** walk backward along the trail from the player's current position to find the point `dist` meters behind */
  private pointAtDistanceBehind(dist: number): { x: number; z: number } {
    let remaining = dist;
    let curX = this.ctx.player.x;
    let curZ = this.ctx.player.z;
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const p = this.trail[i];
      const segDist = Math.hypot(curX - p.x, curZ - p.z);
      if (segDist >= remaining) {
        const t = segDist > 1e-6 ? remaining / segDist : 0;
        return { x: curX + (p.x - curX) * t, z: curZ + (p.z - curZ) * t };
      }
      remaining -= segDist;
      curX = p.x;
      curZ = p.z;
    }
    // trail doesn't reach that far back yet (e.g. just spawned) — best we can do
    return { x: curX, z: curZ };
  }

  /** unit vector pointing in the direction of travel at that point on the trail, used to find "sideways" for the wedge */
  private tangentAtDistanceBehind(dist: number): { x: number; z: number } {
    const ahead = this.pointAtDistanceBehind(Math.max(dist - 0.3, 0));
    const behind = this.pointAtDistanceBehind(dist + 0.3);
    const tx = ahead.x - behind.x;
    const tz = ahead.z - behind.z;
    const len = Math.hypot(tx, tz);
    return len < 1e-4 ? { x: 0, z: 1 } : { x: tx / len, z: tz / len };
  }

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

  /** Release every follower back to the wild where they stand (R key). */
  releaseAll(): void {
    while (this.followers.length > 0) {
      const f = this.followers[this.followers.length - 1];
      this.removeFollowerAt(this.followers.length - 1);
      f.followIndex = -1;
      f.brain.returnToWild(this.ctx);
      this.ctx.bus.emit('follower:removed', {
        animalUid: f.uid,
        count: this.followers.length,
        max: this.max,
      });
    }
  }

  update(dt: number): void {
    void dt;
    const px = this.ctx.player.x;
    const pz = this.ctx.player.z;
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(px - last.x, pz - last.z) >= TRAIL_MIN_STEP) {
      this.trail.push({ x: px, z: pz });
      if (this.trail.length > TRAIL_MAX_POINTS) this.trail.shift();
    }

    // wedge formation: followers stand in rows of ROW_SIZE abreast behind the player,
    // each row a fixed arc-length distance further back along the player's actual
    // breadcrumb trail (so turns don't get corner-cut) and offset sideways from the
    // trail's local direction of travel (so row-mates spread out instead of stacking
    // single-file and clipping into whoever's directly ahead).
    let prevRadius = this.ctx.player.radius;
    let depth = 0;
    for (let start = 0; start < this.followers.length; start += ROW_SIZE) {
      const row = this.followers.slice(start, start + ROW_SIZE);
      const rowRadius = Math.max(...row.map((f) => f.radius));
      depth += prevRadius + rowRadius + FOLLOW_GAP;

      const spine = this.pointAtDistanceBehind(depth);
      const tangent = this.tangentAtDistanceBehind(depth);
      const perp = { x: -tangent.z, z: tangent.x };
      const lateralDist = rowRadius + LATERAL_GAP;

      row.forEach((f, j) => {
        const side = row.length === 1 ? 0 : j === 0 ? -1 : 1;
        f.brain.followTargetX = spine.x + perp.x * lateralDist * side;
        f.brain.followTargetZ = spine.z + perp.z * lateralDist * side;
        f.brain.followTargetRadius = prevRadius;
      });

      prevRadius = rowRadius;
    }

    // deposit into matching pens
    for (let i = this.followers.length - 1; i >= 0; i--) {
      const f = this.followers[i];
      const near = (s: Shelter): boolean =>
        s.dist2(f.x, f.z) <= (s.penRadius + 1.2) * (s.penRadius + 1.2);
      const shelter = this.ctx.shelters.find(
        (s) => s.def.species.includes(f.def.id) && !s.isFull && near(s),
      );
      if (!shelter) {
        // standing at a pen it can't be housed in — show why, not just silence
        const blocking = this.ctx.shelters.find(
          (s) => s.isPen && s.def.species.length > 0 && near(s),
        );
        f.setBubble(
          blocking ? (blocking.def.species.includes(f.def.id) ? 'penFull' : 'wrongPen') : null,
        );
        continue;
      }
      f.setBubble(null);

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
