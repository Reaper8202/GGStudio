/**
 * A placed shelter: level-specific building model, an auto-generated instanced
 * fence pen around its footprint, a trough whose hay-mound scales with fill, and
 * a small wooden occupancy sign ("2/4"). Assigned species come from shelters.json.
 */
import * as THREE from 'three';
import type { ShelterDef } from '../data/types';
import type { GameContext } from '../core/GameContext';
import { makeBlobShadow } from './Fx';

export class Shelter {
  readonly uid: string;
  readonly def: ShelterDef;
  readonly group = new THREE.Group();
  level: number;
  readonly cx: number;
  readonly cz: number;
  centerX = 0;
  centerZ = 0;
  penRadius = 2;

  occupants: string[] = [];
  food = 0;

  private building: THREE.Object3D | null = null;
  private trough: THREE.Mesh | null = null;
  private sign: THREE.Mesh | null = null;
  private signCtx: CanvasRenderingContext2D | null = null;
  private signTex: THREE.CanvasTexture | null = null;
  private ctx: GameContext;

  constructor(
    uid: string,
    def: ShelterDef,
    level: number,
    anchorCx: number,
    anchorCz: number,
    ctx: GameContext,
  ) {
    this.uid = uid;
    this.def = def;
    this.level = level;
    this.cx = anchorCx;
    this.cz = anchorCz;
    this.ctx = ctx;

    const { w, h } = def.footprint;
    const c = ctx.grid.footprintCenter(anchorCx, anchorCz, w, h);
    this.centerX = c.x;
    this.centerZ = c.z;
    this.group.position.set(c.x, 0, c.z);
    this.penRadius = (Math.min(w, h) * ctx.grid.cellSize) / 2 + 0.3;

    ctx.grid.occupy(anchorCx, anchorCz, w, h, true);
    // building collider (inner half so pen annulus stays walkable)
    const halfW = (w * ctx.grid.cellSize) / 2;
    const halfH = (h * ctx.grid.cellSize) / 2;
    ctx.hash.addAABB(c.x, c.z, halfW * 0.5, halfH * 0.5);

    this.build();
  }

  private build(): void {
    // clear previous building (on upgrade)
    if (this.building) this.group.remove(this.building);
    const modelPath = this.def.levels[this.level].model;
    const inst = this.ctx.assets.instance(modelPath, { scale: 1 });
    if (inst) {
      this.building = inst.object;
      this.normalizeToFootprint(this.building);
    } else {
      this.building = this.fallbackBuilding();
    }
    this.group.add(this.building);
    this.group.add(makeBlobShadow(Math.max(this.def.footprint.w, this.def.footprint.h) * 0.9));

    if (this.def.species.length > 0) {
      this.buildFence();
      this.buildTrough();
      this.buildSign();
      this.updateSign();
      this.setFoodVisual();
    }
  }

  /**
   * The building packs are authored at inconsistent scales — normalize each
   * shelter model so its bounding-box footprint fits its shelters.json footprint
   * (w×h grid cells, ~2 m/cell), uniformly scaled, grounded, and centered.
   */
  private normalizeToFootprint(building: THREE.Object3D): void {
    building.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(building);
    if (box.isEmpty()) return;
    const bw = box.max.x - box.min.x;
    const bd = box.max.z - box.min.z;
    if (bw <= 1e-3 || bd <= 1e-3) return;
    const cs = this.ctx.grid.cellSize;
    const targetW = this.def.footprint.w * cs * 0.9;
    const targetD = this.def.footprint.h * cs * 0.9;
    const factor = Math.min(targetW / bw, targetD / bd);
    building.scale.multiplyScalar(factor);
    building.position.y -= box.min.y * factor;
    building.position.x -= ((box.min.x + box.max.x) / 2) * factor;
    building.position.z -= ((box.min.z + box.max.z) / 2) * factor;
  }

  private fallbackBuilding(): THREE.Object3D {
    const g = new THREE.Group();
    const w = this.def.footprint.w * this.ctx.grid.cellSize * 0.5;
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(w, 1.4, w),
      new THREE.MeshStandardMaterial({ color: 0x8a6b4d, flatShading: true }),
    );
    base.position.y = 0.7;
    g.add(base);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(w * 0.85, 0.9, 4),
      new THREE.MeshStandardMaterial({ color: 0xc96f6f, flatShading: true }),
    );
    roof.position.y = 1.85;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    return g;
  }

  private buildFence(): void {
    const { w, h } = this.def.footprint;
    const cs = this.ctx.grid.cellSize;
    const halfW = (w * cs) / 2;
    const halfH = (h * cs) / 2;
    const posts: THREE.Vector3[] = [];
    const step = 1;
    for (let x = -halfW; x <= halfW; x += step) {
      posts.push(new THREE.Vector3(x, 0, -halfH));
      posts.push(new THREE.Vector3(x, 0, halfH));
    }
    for (let z = -halfH + step; z < halfH; z += step) {
      posts.push(new THREE.Vector3(-halfW, 0, z));
      posts.push(new THREE.Vector3(halfW, 0, z));
    }

    const sources = this.ctx.assets.geometrySources('models/nature/Fence.glb').length
      ? this.ctx.assets.geometrySources('models/nature/Fence.glb')
      : this.ctx.assets.geometrySources('models/buildings/Fence.glb');

    if (sources.length > 0) {
      for (const src of sources) {
        const im = new THREE.InstancedMesh(src.geometry, src.material, posts.length);
        const m = new THREE.Matrix4();
        posts.forEach((p, i) => {
          m.makeTranslation(p.x, p.y, p.z);
          im.setMatrixAt(i, m);
        });
        im.instanceMatrix.needsUpdate = true;
        this.group.add(im);
      }
    } else {
      const geo = new THREE.CylinderGeometry(0.05, 0.06, 0.6, 5);
      const mat = new THREE.MeshStandardMaterial({ color: 0x6b4f34, flatShading: true });
      const im = new THREE.InstancedMesh(geo, mat, posts.length);
      const m = new THREE.Matrix4();
      posts.forEach((p, i) => {
        m.makeTranslation(p.x, 0.3, p.z);
        im.setMatrixAt(i, m);
      });
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
    }
  }

  private buildTrough(): void {
    const cs = this.ctx.grid.cellSize;
    const halfH = (this.def.footprint.h * cs) / 2;
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.3, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x6b4f34, flatShading: true }),
    );
    base.position.set(0, 0.15, halfH - 0.5);
    this.group.add(base);
    this.trough = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.4, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xd8b45a, flatShading: true }),
    );
    this.trough.position.set(0, 0.35, halfH - 0.5);
    this.group.add(this.trough);
  }

  private buildSign(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 96;
    this.signCtx = canvas.getContext('2d');
    this.signTex = new THREE.CanvasTexture(canvas);
    this.signTex.colorSpace = THREE.SRGBColorSpace;
    const cs = this.ctx.grid.cellSize;
    const halfW = (this.def.footprint.w * cs) / 2;
    const halfH = (this.def.footprint.h * cs) / 2;
    this.sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.6),
      new THREE.MeshBasicMaterial({ map: this.signTex, transparent: true }),
    );
    this.sign.position.set(halfW - 0.3, 1.0, halfH - 0.2);
    this.group.add(this.sign);
  }

  updateSign(): void {
    if (!this.signCtx || !this.signTex) return;
    const c = this.signCtx;
    c.clearRect(0, 0, 128, 96);
    c.fillStyle = '#8a6b4d';
    roundRect(c, 4, 4, 120, 88, 14);
    c.fill();
    c.fillStyle = '#f6eedd';
    roundRect(c, 12, 12, 104, 72, 10);
    c.fill();
    c.fillStyle = '#8a6b4d';
    c.font = 'bold 44px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(`${this.occupants.length}/${this.capacity}`, 64, 50);
    this.signTex.needsUpdate = true;
  }

  setFoodVisual(): void {
    if (!this.trough) return;
    const frac = this.foodMax > 0 ? this.food / this.foodMax : 0;
    this.trough.scale.y = Math.max(0.05, frac);
    this.trough.position.y = 0.15 + (0.4 * this.trough.scale.y) / 2;
    (this.trough.material as THREE.MeshStandardMaterial).color.setHex(
      frac > 0.05 ? 0xd8b45a : 0x9c8552,
    );
  }

  get capacity(): number {
    return this.def.levels[this.level].capacity;
  }

  get foodMax(): number {
    return this.def.levels[this.level].foodMax;
  }

  get isFull(): boolean {
    return this.occupants.length >= this.capacity;
  }

  addOccupant(uid: string): void {
    this.occupants.push(uid);
    this.updateSign();
  }

  removeOccupant(uid: string): void {
    const i = this.occupants.indexOf(uid);
    if (i >= 0) this.occupants.splice(i, 1);
    this.updateSign();
  }

  /** A roam target inside the pen for a housed animal. */
  penPoint(): { x: number; z: number; r: number } {
    return { x: this.centerX, z: this.centerZ, r: this.penRadius };
  }

  upgrade(): void {
    if (this.level < this.def.levels.length - 1) {
      this.level++;
      this.build();
    }
  }

  dist2(x: number, z: number): number {
    const dx = x - this.centerX;
    const dz = z - this.centerZ;
    return dx * dx + dz * dz;
  }
}

function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
