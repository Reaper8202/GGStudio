/**
 * Context-sensitive action orchestrator (plan §6 — one action button). Determines
 * what pressing action does right now (capture / collect / deposit / build), runs
 * hold-to-collect and capture-roll timing with in-world progress rings, and shows
 * the interact-zone glow. Backs GameQuery.actionContext().
 */
import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import type { Animal } from '../entities/Animal';
import type { Shelter } from '../entities/Shelter';
import type { ResourceNode } from '../world/ResourceNode';
import type { ResourceKind } from '../data/types';
import type { CaptureSystem } from './CaptureSystem';
import type { HerdingSystem } from './HerdingSystem';
import type { HungerSystem } from './HungerSystem';
import type { QuestSystem } from './QuestSystem';
import type { BuildSystem } from './BuildSystem';
import { BALANCE, getAnimal, getResource } from '../core/data';

type ActionCtx = 'capture' | 'collect' | 'build' | 'deposit' | 'none';

interface Target {
  kind: ActionCtx;
  x: number;
  z: number;
  animal?: Animal;
  node?: ResourceNode;
  well?: Shelter;
  shelter?: Shelter;
}

interface ActiveHold {
  target: Target;
  t: number;
  dur: number;
}

const CAPTURE_ROLL_SECONDS = 0.6;
const RING_ID = 'action';

export class InteractionSystem {
  context: ActionCtx = 'none';
  private spotted = new Set<string>();
  private active: ActiveHold | null = null;
  private consumed = false;
  private prevHeld = false;
  private tmp = new THREE.Vector3();

  constructor(
    private ctx: GameContext,
    private capture: CaptureSystem,
    private herding: HerdingSystem,
    private hunger: HungerSystem,
    private quests: QuestSystem,
    private build: BuildSystem,
  ) {}

  private pickTarget(): Target | null {
    const px = this.ctx.player.x;
    const pz = this.ctx.player.z;

    // capture: nearest wild animal within its interact radius (needs a free slot)
    if (this.herding.hasFreeSlot()) {
      let best: Animal | null = null;
      let bestD = Infinity;
      for (const a of this.ctx.animals) {
        if (a.mode !== 'wild') continue;
        const d = Math.hypot(a.x - px, a.z - pz);
        // spotted telegraph
        if (d < Math.max(a.def.fleeRadius, 3) + 2 && !this.spotted.has(a.uid)) {
          this.spotted.add(a.uid);
          this.ctx.bus.emit('animal:spotted', {
            animalUid: a.uid,
            speciesId: a.def.id,
            tier: a.def.tier,
          });
        }
        if (d <= a.def.interactRadius && d < bestD) {
          best = a;
          bestD = d;
        }
      }
      if (best) return { kind: 'capture', animal: best, x: best.x, z: best.z };
    }

    // deposit: nearest matching, feedable shelter
    let depositShelter: Shelter | null = null;
    let depositD = Infinity;
    for (const s of this.ctx.shelters) {
      if (s.def.species.length === 0 || s.food >= s.foodMax) continue;
      const d2 = s.dist2(px, pz);
      const range = s.penRadius + 1.5;
      if (d2 > range * range) continue;
      const diets = new Set<ResourceKind>(s.def.species.map((id) => getAnimal(id).diet));
      const hasFood = [...diets].some((k) => this.ctx.state.resources[k] > 0);
      if (hasFood && d2 < depositD) {
        depositShelter = s;
        depositD = d2;
      }
    }
    if (depositShelter) {
      return {
        kind: 'deposit',
        shelter: depositShelter,
        x: depositShelter.centerX,
        z: depositShelter.centerZ,
      };
    }

    // collect: nearest ready resource node
    const ir = BALANCE.playerInteractRadius;
    let node: ResourceNode | null = null;
    let nodeD = Infinity;
    for (const n of this.ctx.resourceNodes) {
      if (!n.isReady) continue;
      const d2 = n.dist2(px, pz);
      if (d2 <= ir * ir && d2 < nodeD) {
        node = n;
        nodeD = d2;
      }
    }
    if (node) return { kind: 'collect', node, x: node.x, z: node.z };

    // collect water at a Well
    for (const s of this.ctx.shelters) {
      if (s.def.id !== 'well') continue;
      if (s.dist2(px, pz) <= (ir + 1) * (ir + 1)) {
        return { kind: 'collect', well: s, x: s.centerX, z: s.centerZ };
      }
    }

    return null;
  }

  update(dt: number): void {
    const held = this.ctx.actionHeld;
    const target = this.pickTarget();
    this.context = this.build.active ? 'build' : (target?.kind ?? 'none');

    // interact-zone glow near shelters / nodes
    if (target && (target.kind === 'collect' || target.kind === 'deposit')) {
      this.ctx.fx.showGlow(this.tmp.set(target.x, 0, target.z));
    } else {
      this.ctx.fx.hideGlow();
    }

    if (this.build.active) {
      this.cancel();
      this.prevHeld = held;
      return;
    }

    if (!held) {
      this.cancel();
      this.consumed = false;
      this.prevHeld = held;
      return;
    }

    if (this.consumed) {
      this.prevHeld = held;
      return;
    }

    // begin a hold on the current target
    if (!this.active) {
      if (!target) {
        this.prevHeld = held;
        return;
      }
      if (target.kind === 'deposit') {
        this.doDeposit(target.shelter!);
        this.consumed = true;
        this.prevHeld = held;
        return;
      }
      const dur =
        target.kind === 'capture'
          ? CAPTURE_ROLL_SECONDS
          : target.node
            ? target.node.def.collectSeconds
            : getResource('water').collectSeconds;
      this.active = { target, t: 0, dur };
    }

    // advance the active hold
    if (this.active) {
      this.active.t += dt;
      const frac = Math.min(1, this.active.t / this.active.dur);
      const ringPos =
        this.active.target.kind === 'capture'
          ? this.tmp.set(this.ctx.player.x, 0, this.ctx.player.z)
          : this.tmp.set(this.active.target.x, 0, this.active.target.z);
      this.ctx.fx.showRing(RING_ID, ringPos, 1.2, frac);
      if (frac >= 1) {
        this.complete(this.active.target);
        this.ctx.fx.hideRing(RING_ID);
        this.active = null;
        this.consumed = true;
      }
    }

    this.prevHeld = held;
  }

  private cancel(): void {
    if (this.active) {
      this.ctx.fx.hideRing(RING_ID);
      this.active = null;
    }
  }

  private complete(target: Target): void {
    if (target.kind === 'capture' && target.animal) {
      this.capture.attempt(target.animal);
    } else if (target.kind === 'collect' && target.node) {
      const base = target.node.collect(this.ctx.now);
      if (base > 0) this.grantResource(target.node.kind, base);
    } else if (target.kind === 'collect' && target.well) {
      this.grantResource('water', getResource('water').yield);
    }
  }

  private grantResource(kind: ResourceKind, base: number): void {
    const mult = this.ctx.state.doubleHarvestUntil > this.ctx.now ? 2 : 1;
    const amount = base * mult;
    this.ctx.state.resources[kind] += amount;
    const total = this.ctx.state.resources[kind];
    this.ctx.bus.emit('resource:collected', { kind, amount, total });
    this.ctx.bus.emit('resource:inventoryChanged', { kind, total });
    this.ctx.requestSave('collect');
  }

  private doDeposit(shelter: Shelter): void {
    const fed = this.hunger.feed(shelter);
    if (fed > 0) this.quests.onFeed();
  }
}
