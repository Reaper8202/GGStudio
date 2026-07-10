/**
 * Animal FSM (plan §4):
 *   Wild    → Wander | Flee
 *   Herded  → Follow
 *   Housed  → Idle | Eat | Sleep | Hungry | Sad
 * Systems drive mode transitions (capture → follower, herding → housed, hunger →
 * hungry/sad/wandered-off); this brain runs the moment-to-moment behavior.
 */
import type { Animal } from './Animal';
import type { GameContext } from '../core/GameContext';
import { BALANCE } from '../core/data';

export type AnimalState =
  | 'wander'
  | 'flee'
  | 'follow'
  | 'idle'
  | 'eat'
  | 'sleep'
  | 'hungry'
  | 'sad';

const WANDER_RADIUS = 7;
const SPOOK_RATE = 0.9; // per-second base chance when inside flee radius

export class AnimalBrain {
  state: AnimalState = 'wander';

  private timer = 0;
  private targetX = 0;
  private targetZ = 0;
  private fleeTimer = 0;
  private spookBubbleTimer = 0;

  /** set by HerdingSystem each frame while following */
  followTargetX = 0;
  followTargetZ = 0;

  /** pen assignment while housed */
  private penX = 0;
  private penZ = 0;
  private penR = 2;
  private inPen = false;

  private hungry = false;
  private sad = false;

  constructor(private a: Animal) {
    this.pickWanderTarget();
  }

  private pickWanderTarget(): void {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * WANDER_RADIUS;
    this.targetX = this.a.homeX + Math.cos(ang) * r;
    this.targetZ = this.a.homeZ + Math.sin(ang) * r;
    this.timer = 1.5 + Math.random() * 2.5;
  }

  // ---- transitions driven by systems ----

  becomeFollower(): void {
    this.a.mode = 'herded';
    this.state = 'follow';
    this.a.setBubble(null);
  }

  house(penX: number, penZ: number, penR: number): void {
    this.a.mode = 'housed';
    this.penX = penX;
    this.penZ = penZ;
    this.penR = penR;
    this.inPen = false;
    this.state = 'idle';
    this.a.setBubble(null);
  }

  returnToWild(): void {
    this.a.mode = 'wild';
    this.a.shelterUid = null;
    this.hungry = false;
    this.sad = false;
    this.state = 'wander';
    this.a.setHome(this.a.x, this.a.z);
    this.a.setBubble(null);
    this.pickWanderTarget();
  }

  spook(ctx: GameContext): void {
    if (this.a.mode !== 'wild' || this.state === 'flee') return;
    this.state = 'flee';
    this.fleeTimer = BALANCE.fleeCalmSeconds;
    this.spookBubbleTimer = 1;
    this.a.setBubble('spook');
    ctx.bus.emit('animal:spooked', { animalUid: this.a.uid, speciesId: this.a.def.id });
  }

  setHungry(on: boolean): void {
    this.hungry = on;
    if (on) this.sad = false;
  }

  setSad(on: boolean): void {
    this.sad = on;
    if (on) this.hungry = false;
  }

  // ---- per-frame update ----

  update(dt: number, ctx: GameContext): void {
    switch (this.a.mode) {
      case 'wild':
        this.updateWild(dt, ctx);
        break;
      case 'herded':
        this.updateFollow(dt, ctx);
        break;
      case 'housed':
        this.updateHoused(dt, ctx);
        break;
    }
  }

  private updateWild(dt: number, ctx: GameContext): void {
    const px = ctx.player.x;
    const pz = ctx.player.z;
    if (this.state === 'flee') {
      this.fleeTimer -= dt;
      this.spookBubbleTimer -= dt;
      if (this.spookBubbleTimer <= 0) this.a.setBubble(null);
      const dx = this.a.x - px;
      const dz = this.a.z - pz;
      const d = Math.hypot(dx, dz) || 1;
      this.a.moveToward(
        this.a.x + (dx / d) * 3,
        this.a.z + (dz / d) * 3,
        this.a.def.fleeSpeed,
        dt,
        ctx,
      );
      if (this.fleeTimer <= 0) {
        this.state = 'wander';
        this.a.setBubble(null);
        this.pickWanderTarget();
      }
      return;
    }

    // wander + spook check
    if (this.a.def.fleeRadius > 0) {
      const dist = Math.hypot(this.a.x - px, this.a.z - pz);
      if (dist < this.a.def.fleeRadius && Math.random() < SPOOK_RATE * dt) {
        this.spook(ctx);
        return;
      }
    }

    this.timer -= dt;
    const arrived = this.a.moveToward(
      this.targetX,
      this.targetZ,
      this.a.def.walkSpeed,
      dt,
      ctx,
    );
    if (arrived || this.timer <= 0) {
      if (Math.random() < 0.4) {
        this.a.playClip('eat');
        this.timer = 1 + Math.random() * 2;
      } else {
        this.pickWanderTarget();
      }
    }
  }

  private updateFollow(dt: number, ctx: GameContext): void {
    const speed = Math.max(this.a.def.walkSpeed * 2, BALANCE.playerSpeed * 0.98);
    const dx = this.followTargetX - this.a.x;
    const dz = this.followTargetZ - this.a.z;
    if (Math.hypot(dx, dz) < 0.8) {
      this.a.playClip('idle');
    } else {
      this.a.moveToward(this.followTargetX, this.followTargetZ, speed, dt, ctx);
    }
  }

  private updateHoused(dt: number, ctx: GameContext): void {
    // hop into pen first
    if (!this.inPen) {
      const arrived = this.a.moveToward(this.penX, this.penZ, this.a.def.walkSpeed * 1.5, dt, ctx);
      if (arrived) {
        this.inPen = true;
        this.state = 'idle';
        this.timer = 1 + Math.random() * 2;
      }
      return;
    }

    // reflect mood in bubble
    if (this.sad) {
      this.a.setBubble('zzz');
    } else if (this.hungry) {
      this.a.setBubble(this.a.def.diet === 'water' ? 'water' : (this.a.def.diet as 'hay' | 'berry' | 'forage'));
    } else {
      this.a.setBubble(null);
    }

    this.timer -= dt;
    if (this.state === 'idle' || this.state === 'eat' || this.state === 'sleep') {
      // gentle idle loop within the pen
      const dx = this.targetX - this.a.x;
      const dz = this.targetZ - this.a.z;
      if (Math.hypot(dx, dz) > 0.3) {
        this.a.moveToward(this.targetX, this.targetZ, this.a.def.walkSpeed * 0.5, dt, ctx);
      } else {
        this.a.playClip(this.sad ? 'idle' : this.state === 'eat' ? 'eat' : 'idle');
      }
      if (this.timer <= 0) {
        // pick a new gentle target inside the pen and cycle sub-state
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * this.penR * 0.7;
        this.targetX = this.penX + Math.cos(ang) * r;
        this.targetZ = this.penZ + Math.sin(ang) * r;
        this.timer = 2 + Math.random() * 3;
        const roll = Math.random();
        this.state = this.sad ? 'sad' : roll < 0.5 ? 'idle' : roll < 0.8 ? 'eat' : 'sleep';
      }
    } else if (this.state === 'sad') {
      this.a.playClip('idle');
      if (this.timer <= 0) {
        this.state = this.sad ? 'sad' : 'idle';
        this.timer = 3;
      }
    } else if (this.state === 'hungry') {
      this.a.playClip('idle');
      if (this.timer <= 0) this.timer = 2;
    }
  }
}
