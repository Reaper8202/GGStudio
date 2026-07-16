/**
 * Hand-authored cozy valley: vertex-colored ground plane, three zones (Meadow
 * center/south, Pine Forest north, Palm Oasis east with the Dino Grove), all
 * vegetation and gate fences as InstancedMesh, soft zone gates with signs, and
 * scattered resource nodes. Locked zones are visible but fenced off until
 * 'zone:unlocked'.
 */
import * as THREE from 'three';
import type { ZoneId } from '../data/types';
import type { GameContext } from '../core/GameContext';
import type { ObstacleHandle } from '../core/SpatialHash';
import { RESOURCES } from '../core/data';
import { ResourceNode } from './ResourceNode';
import { WORLD_SIZE, HALF, zoneOfPoint, randomPointInZone, DINO_GROVE } from './layout';

interface Scatter {
  /** model paths to try, first available wins */
  models: string[];
  zone: ZoneId;
  count: number;
  minScale: number;
  maxScale: number;
  /** blocks movement (registered in the spatial hash) */
  collides: boolean;
  colliderRadius?: number;
  /** fallback primitive if the model isn't loaded yet */
  fallback: 'tree' | 'pine' | 'palm' | 'grass' | 'flower' | 'rock' | 'dead';
}

const SCATTERS: Scatter[] = [
  // Meadow: birch + maple + grass + flowers
  { models: n('BirchTree', 5), zone: 'meadow', count: 26, minScale: 0.8, maxScale: 1.3, collides: true, colliderRadius: 0.45, fallback: 'tree' },
  { models: n('MapleTree', 5), zone: 'meadow', count: 22, minScale: 0.8, maxScale: 1.3, collides: true, colliderRadius: 0.5, fallback: 'tree' },
  { models: ['models/nature/Grass_Small.glb', 'models/nature/Grass_Large.glb'], zone: 'meadow', count: 320, minScale: 0.7, maxScale: 1.4, collides: false, fallback: 'grass' },
  { models: n('Flower', 5, '_Clump'), zone: 'meadow', count: 120, minScale: 0.8, maxScale: 1.2, collides: false, fallback: 'flower' },
  // Pine forest: pines + rocks
  { models: n('PineTree', 5), zone: 'pineForest', count: 60, minScale: 0.9, maxScale: 1.5, collides: true, colliderRadius: 0.5, fallback: 'pine' },
  { models: n('Rock', 5), zone: 'pineForest', count: 24, minScale: 0.6, maxScale: 1.4, collides: true, colliderRadius: 0.6, fallback: 'rock' },
  { models: ['models/nature/Grass_Small.glb'], zone: 'pineForest', count: 110, minScale: 0.7, maxScale: 1.2, collides: false, fallback: 'grass' },
  // Palm oasis: palms (+ dead trees clustered in the Dino Grove below)
  { models: n('PalmTree', 5), zone: 'palmOasis', count: 34, minScale: 0.9, maxScale: 1.4, collides: true, colliderRadius: 0.45, fallback: 'palm' },
  { models: ['models/nature/Grass_Large.glb'], zone: 'palmOasis', count: 70, minScale: 0.7, maxScale: 1.2, collides: false, fallback: 'grass' },
];

function n(base: string, count: number, suffix = ''): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) out.push(`models/nature/${base}_${i}${suffix}.glb`);
  return out;
}

const ZONE_GROUND: Record<ZoneId, THREE.Color> = {
  meadow: new THREE.Color('#8fbf6e'),
  pineForest: new THREE.Color('#5f8f54'),
  palmOasis: new THREE.Color('#d9c789'),
};

export class WorldGen {
  private gates = new Map<ZoneId, THREE.Group>();

  constructor(private ctx: GameContext) {
    ctx.bus.on('zone:unlocked', (p) => this.openGate(p.zoneId));
  }

  buildAll(): void {
    this.buildGround();
    this.paintGridZones();
    this.scatterVegetation();
    this.buildGates();
    this.scatterResources();
    this.buildBounds();
  }

  private buildGround(): void {
    const segs = 64;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const zone = zoneOfPoint(x, z);
      c.copy(ZONE_GROUND[zone]);
      // gentle variation so the plane doesn't read flat
      const v = (Math.sin(x * 0.8) * Math.cos(z * 0.7) + Math.sin(x * 0.13 + z * 0.21) * 2) * 0.02;
      c.offsetHSL(0, 0, v);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: false });
    const ground = new THREE.Mesh(geo, mat);
    ground.name = 'ground';
    this.ctx.scene.add(ground);
  }

  private paintGridZones(): void {
    const grid = this.ctx.grid;
    for (let cx = 0; cx < grid.cols; cx++) {
      for (let cz = 0; cz < grid.cols; cz++) {
        const w = grid.cellToWorld(cx, cz);
        grid.setZone(cx, cz, zoneOfPoint(w.x, w.z));
      }
    }
  }

  private scatterVegetation(): void {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (const scatter of SCATTERS) {
      // one placement list per scatter, split across available model variants
      const points: { x: number; z: number; rot: number; scale: number }[] = [];
      for (let i = 0; i < scatter.count; i++) {
        const pt = randomPointInZone(scatter.zone, 2);
        // keep a clearing near spawn / around the tutorial barn
        if (Math.hypot(pt.x, pt.z) < 7) continue;
        points.push({
          x: pt.x,
          z: pt.z,
          rot: Math.random() * Math.PI * 2,
          scale: scatter.minScale + Math.random() * (scatter.maxScale - scatter.minScale),
        });
      }

      const available = scatter.models.filter((m) => this.ctx.assets.has(m));
      const variants = available.length > 0 ? available : [null];
      const perVariant = Math.ceil(points.length / variants.length);

      variants.forEach((model, vi) => {
        const chunk = points.slice(vi * perVariant, (vi + 1) * perVariant);
        if (chunk.length === 0) return;
        const sources = model
          ? this.ctx.assets.geometrySources(model)
          : [this.fallbackSource(scatter.fallback)];
        for (const src of sources) {
          const im = new THREE.InstancedMesh(src.geometry, src.material, chunk.length);
          chunk.forEach((pt, i) => {
            p.set(pt.x, 0, pt.z);
            q.setFromAxisAngle(up, pt.rot);
            s.setScalar(pt.scale);
            m4.compose(p, q, s);
            im.setMatrixAt(i, m4);
          });
          im.instanceMatrix.needsUpdate = true;
          this.ctx.scene.add(im);
        }
        if (scatter.collides) {
          for (const pt of chunk) {
            this.ctx.hash.addCircle(pt.x, pt.z, (scatter.colliderRadius ?? 0.5) * pt.scale);
            const cell = this.ctx.grid.worldToCell(pt.x, pt.z);
            this.ctx.grid.setBuildable(cell.cx, cell.cz, false);
          }
        }
      });
    }

    // Dino Grove dead trees
    this.scatterDeadTrees();
  }

  private scatterDeadTrees(): void {
    const models = n('DeadTree', 10).filter((m) => this.ctx.assets.has(m));
    const count = 16;
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i < count; i++) {
      pts.push({
        x: DINO_GROVE.minX + Math.random() * (DINO_GROVE.maxX - DINO_GROVE.minX),
        z: DINO_GROVE.minZ + Math.random() * (DINO_GROVE.maxZ - DINO_GROVE.minZ),
      });
    }
    const m4 = new THREE.Matrix4();
    const sources =
      models.length > 0
        ? this.ctx.assets.geometrySources(models[0])
        : [this.fallbackSource('dead')];
    for (const src of sources) {
      const im = new THREE.InstancedMesh(src.geometry, src.material, pts.length);
      pts.forEach((pt, i) => {
        m4.makeRotationY(Math.random() * Math.PI * 2);
        m4.setPosition(pt.x, 0, pt.z);
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      this.ctx.scene.add(im);
    }
    for (const pt of pts) this.ctx.hash.addCircle(pt.x, pt.z, 0.4);
  }

  private fallbackGeoCache = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material }>();

  private fallbackSource(kind: Scatter['fallback']): {
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
  } {
    let cached = this.fallbackGeoCache.get(kind);
    if (cached) return cached;
    let geometry: THREE.BufferGeometry;
    let color: number;
    switch (kind) {
      case 'tree':
        geometry = new THREE.ConeGeometry(0.9, 2.6, 7).translate(0, 1.5, 0);
        color = 0x7fb069;
        break;
      case 'pine':
        geometry = new THREE.ConeGeometry(0.7, 3.2, 6).translate(0, 1.8, 0);
        color = 0x4f7a48;
        break;
      case 'palm':
        geometry = new THREE.CylinderGeometry(0.12, 0.2, 2.6, 5).translate(0, 1.3, 0);
        color = 0x8a6b4d;
        break;
      case 'grass':
        geometry = new THREE.ConeGeometry(0.16, 0.5, 4).translate(0, 0.25, 0);
        color = 0x6fae62;
        break;
      case 'flower':
        geometry = new THREE.SphereGeometry(0.14, 6, 5).translate(0, 0.2, 0);
        color = 0xe9a7c1;
        break;
      case 'rock':
        geometry = new THREE.DodecahedronGeometry(0.5, 0).translate(0, 0.3, 0);
        color = 0x9a9a94;
        break;
      case 'dead':
        geometry = new THREE.CylinderGeometry(0.1, 0.22, 2.2, 5).translate(0, 1.1, 0);
        color = 0x6e5b48;
        break;
    }
    const material = new THREE.MeshStandardMaterial({ color, flatShading: true });
    cached = { geometry, material };
    this.fallbackGeoCache.set(kind, cached);
    return cached;
  }

  // --- soft zone gates -----------------------------------------------------

  private buildGates(): void {
    // pine forest gate: fence line along z = -6, meadow side
    this.buildGate('pineForest', (g) => this.fenceLine(g, -HALF + 2, 12, -6, true));
    // palm oasis gate: fence line along x = 12
    this.buildGate('palmOasis', (g) => this.fenceLine(g, -HALF + 2, HALF - 2, 12, false));
    // apply current unlock state
    for (const z of this.ctx.state.unlockedZones) this.openGate(z);
  }

  private buildGate(zone: ZoneId, build: (g: THREE.Group) => void): void {
    const group = new THREE.Group();
    build(group);
    this.ctx.scene.add(group);
    this.gates.set(zone, group);
  }

  /** A friendly hedge/fence line with a wooden sign, plus colliders. */
  private fenceLine(
    group: THREE.Group,
    from: number,
    to: number,
    at: number,
    horizontal: boolean,
  ): void {
    const step = 1.2;
    const count = Math.floor((to - from) / step);
    const geo = new THREE.SphereGeometry(0.7, 7, 5);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5f8f54, flatShading: true });
    const im = new THREE.InstancedMesh(geo, mat, count);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const t = from + i * step;
      const x = horizontal ? t : at;
      const z = horizontal ? at : t;
      m4.makeScale(1, 0.8 + Math.sin(i * 1.7) * 0.15, 1);
      m4.setPosition(x, 0.45, z);
      im.setMatrixAt(i, m4);
    }
    im.instanceMatrix.needsUpdate = true;
    group.add(im);

    // colliders (removed when the gate opens by rebuilding the hash — simpler:
    // gate colliders live in their own hash entries which we cannot remove, so
    // instead block via grid cells and a keep-out check in the group's userData)
    const colliders: { x: number; z: number }[] = [];
    for (let i = 0; i < count; i++) {
      const t = from + i * step;
      colliders.push({ x: horizontal ? t : at, z: horizontal ? at : t });
    }
    group.userData.colliders = colliders;

    // sign at the midpoint
    const mid = (from + to) / 2;
    const sx = horizontal ? mid : at;
    const sz = horizontal ? at : mid;
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 1.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x8a6b4d, flatShading: true }),
    );
    post.position.set(sx, 0.7, sz);
    group.add(post);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.7, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xf6eedd, flatShading: true }),
    );
    board.position.set(sx, 1.3, sz);
    if (!horizontal) board.rotation.y = Math.PI / 2;
    group.add(board);
  }

  /** Register gate colliders for all still-locked zones (call once after build). */
  applyGateColliders(): void {
    for (const [zone, group] of this.gates) {
      if (this.ctx.state.unlockedZones.includes(zone)) continue;
      const colliders = group.userData.colliders as { x: number; z: number }[] | undefined;
      if (!colliders) continue;
      group.userData.handles = colliders.map((c) =>
        this.ctx.hash.addCircle(c.x, c.z, 0.75),
      );
    }
  }

  private openGate(zone: ZoneId): void {
    const group = this.gates.get(zone);
    if (!group || group.userData.open) return;
    group.userData.open = true;
    group.visible = false;
    const handles = (group.userData.handles ?? []) as ObstacleHandle[];
    for (const h of handles) this.ctx.hash.remove(h);
    group.userData.handles = [];
    if (group.children.length > 0) {
      this.ctx.fx.poof(
        new THREE.Vector3().setFromMatrixPosition(group.children[0].matrixWorld),
      );
    }
  }

  private buildBounds(): void {
    // world-edge colliders so nobody walks off the map
    const h = HALF;
    this.ctx.hash.addAABB(0, -h - 1, h + 2, 1);
    this.ctx.hash.addAABB(0, h + 1, h + 2, 1);
    this.ctx.hash.addAABB(-h - 1, 0, 1, h + 2);
    this.ctx.hash.addAABB(h + 1, 0, 1, h + 2);
  }

  private scatterResources(): void {
    for (const def of RESOURCES) {
      if (def.kind === 'water') continue; // water comes from placed wells
      const count = def.kind === 'hay' ? 10 : def.kind === 'berry' ? 9 : 8;
      for (let i = 0; i < count; i++) {
        const p = randomPointInZone(def.zone, 3);
        if (Math.hypot(p.x, p.z) < 5) continue;
        const node = new ResourceNode(def, p.x, p.z, this.ctx.assets);
        this.ctx.scene.add(node.group);
        this.ctx.resourceNodes.push(node);
      }
    }
  }
}
