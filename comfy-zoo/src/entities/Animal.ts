/**
 * A single animal instance. Owns its 3D model (SkeletonUtils-cloned skinned mesh
 * or a primitive fallback), animation mixer, floating indicator bubble, and blob
 * shadow. Behavior lives in AnimalBrain (the FSM per plan §4); this class handles
 * presentation and exposes movement/clip helpers the brain drives.
 */
import * as THREE from 'three';
import type { AnimalDef } from '../data/types';
import type { GameContext } from '../core/GameContext';
import { AnimalBrain } from './AnimalBrain';
import { Bubble, makeBlobShadow, type BubbleKind } from './Fx';
import type { AssetManager } from '../core/AssetManager';
import { tryAnimal } from '../core/data';

export type AnimalMode = 'wild' | 'herded' | 'housed';

function tryVariantTint(skinId: string): { tint?: string; emissive?: string } | null {
  if (skinId === 'default') return null;
  const v = tryAnimal(skinId);
  return v ? { tint: v.tint, emissive: v.emissive } : null;
}

const TIER_COLOR: Record<string, number> = {
  common: 0xc9a66b,
  uncommon: 0xb0885a,
  rare: 0xe08a4b,
  epic: 0x8a6bb0,
  legendary: 0xf2c14e,
  mythic: 0x7fb069,
};

export class Animal {
  readonly uid: string;
  readonly def: AnimalDef;
  readonly group = new THREE.Group();
  readonly brain: AnimalBrain;

  x = 0;
  z = 0;
  facing = 0;
  readonly radius = 0.5;
  /** biome wander anchor */
  homeX = 0;
  homeZ = 0;

  mode: AnimalMode = 'wild';
  shelterUid: string | null = null;
  /** follower ordering; -1 when not following */
  followIndex = -1;

  private body: THREE.Object3D;
  private mixer: THREE.AnimationMixer | null;
  private clips: THREE.AnimationClip[];
  private currentAction: THREE.AnimationAction | null = null;
  private currentClipName = '';
  private bubble: Bubble;
  private assets: AssetManager;
  private bobT = 0;

  constructor(uid: string, def: AnimalDef, ctx: GameContext) {
    this.uid = uid;
    this.def = def;
    this.assets = ctx.assets;

    // resolve active cosmetic skin: a base species may wear an owned variant's
    // tint (variants are separate species that reuse this rig).
    const rec = ctx.zoopedia.get(def.id);
    const skin = rec?.activeSkin ? ctx.assets && tryVariantTint(rec.activeSkin) : null;
    const tint = skin?.tint ?? def.tint;
    const emissive = skin?.emissive ?? def.emissive;

    const inst = this.assets.instance(def.model, {
      scale: def.scale,
      tint,
      emissive,
    });
    if (inst) {
      this.body = inst.object;
      this.mixer = inst.mixer;
      this.clips = inst.clips;
    } else {
      this.body = this.fallbackBody(def);
      this.mixer = null;
      this.clips = [];
    }
    this.group.add(makeBlobShadow(0.6 * def.scale));
    this.group.add(this.body);

    this.bubble = ctx.fx.makeBubble();
    this.bubble.sprite.position.y = 1.6 * def.scale;
    this.group.add(this.bubble.sprite);

    this.brain = new AnimalBrain(this);
    this.playClip('idle');
  }

  private fallbackBody(def: AnimalDef): THREE.Object3D {
    const g = new THREE.Group();
    const color = TIER_COLOR[def.tier] ?? 0xc9a66b;
    const mat = new THREE.MeshStandardMaterial({
      color: def.tint ? new THREE.Color(def.tint).getHex() : color,
      emissive: def.emissive ? new THREE.Color(def.emissive) : new THREE.Color(0, 0, 0),
      flatShading: true,
    });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.6, 4, 8), mat);
    torso.rotation.z = Math.PI / 2;
    torso.position.y = 0.55;
    g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mat);
    head.position.set(0.6, 0.7, 0);
    g.add(head);
    for (const [fx, fz] of [
      [0.35, 0.2],
      [0.35, -0.2],
      [-0.35, 0.2],
      [-0.35, -0.2],
    ]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 6), mat);
      leg.position.set(fx, 0.2, fz);
      g.add(leg);
    }
    g.scale.setScalar(def.scale);
    return g;
  }

  setPosition(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.group.position.set(x, 0, z);
  }

  setHome(x: number, z: number): void {
    this.homeX = x;
    this.homeZ = z;
  }

  setBubble(kind: BubbleKind | null): void {
    this.bubble.set(kind);
  }

  /** Move toward a target, resolving collisions; returns true when arrived. */
  moveToward(tx: number, tz: number, speed: number, dt: number, ctx: GameContext): boolean {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) {
      this.playClip('idle');
      return true;
    }
    const step = Math.min(speed * dt, d);
    const nx = this.x + (dx / d) * step;
    const nz = this.z + (dz / d) * step;
    const r = ctx.hash.resolveCircle(nx, nz, this.radius);
    this.x = r.x;
    this.z = r.z;
    this.facing = Math.atan2(dx, dz);
    this.bobT += dt * 8;
    this.playClip(speed > this.def.walkSpeed + 0.1 ? 'run' : 'walk');
    return false;
  }

  playClip(preferred: string): void {
    if (!this.mixer || this.clips.length === 0) return;
    const clip = this.assets.clipFor(this.clips, preferred);
    if (!clip || clip.name === this.currentClipName) return;
    const next = this.mixer.clipAction(clip);
    next.reset().fadeIn(0.2).play();
    if (this.currentAction && this.currentAction !== next) {
      this.currentAction.fadeOut(0.2);
    }
    this.currentAction = next;
    this.currentClipName = clip.name;
  }

  update(dt: number, ctx: GameContext): void {
    this.brain.update(dt, ctx);
    this.group.position.set(this.x, 0, this.z);
    this.body.rotation.y = this.facing;
    if (this.mixer) this.mixer.update(dt);
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
