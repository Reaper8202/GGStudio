/**
 * A collectible resource node (berry bush / hay patch / forage). Scattered per
 * zone from resources.json. Visibly squashes when depleted and respawns on a timer.
 * Water is not scattered — it comes from placed Well / WaterTower shelters.
 */
import * as THREE from 'three';
import type { ResourceDef, ResourceKind } from '../data/types';
import type { AssetManager } from '../core/AssetManager';

export class ResourceNode {
  readonly group = new THREE.Group();
  readonly kind: ResourceKind;
  readonly def: ResourceDef;
  readonly x: number;
  readonly z: number;
  private depleted = false;
  private respawnAt = 0;
  private visual: THREE.Object3D;

  constructor(def: ResourceDef, x: number, z: number, assets: AssetManager) {
    this.def = def;
    this.kind = def.kind;
    this.x = x;
    this.z = z;
    this.group.position.set(x, 0, z);
    const inst = assets.instance(def.nodeModel, { scale: 1 });
    this.visual = inst ? inst.object : this.fallback();
    this.visual.rotation.y = Math.random() * Math.PI * 2;
    this.group.add(this.visual);
  }

  private fallback(): THREE.Object3D {
    const color =
      this.kind === 'berry' ? 0xc96f6f : this.kind === 'hay' ? 0xd8b45a : 0x7fb069;
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.5, 0),
      new THREE.MeshStandardMaterial({ color, flatShading: true }),
    );
    mesh.position.y = 0.5;
    return mesh;
  }

  get isReady(): boolean {
    return !this.depleted;
  }

  /** Distance squared to a world point (cheap proximity test). */
  dist2(x: number, z: number): number {
    const dx = x - this.x;
    const dz = z - this.z;
    return dx * dx + dz * dz;
  }

  collect(now: number): number {
    if (this.depleted) return 0;
    this.depleted = true;
    this.respawnAt = now + this.def.respawnSeconds;
    this.visual.scale.set(1, 0.2, 1);
    this.visual.visible = this.def.respawnSeconds > 0 ? true : false;
    return this.def.yield;
  }

  update(now: number): void {
    if (this.depleted && now >= this.respawnAt) {
      this.depleted = false;
      this.visual.scale.set(1, 1, 1);
      this.visual.visible = true;
    }
  }
}
