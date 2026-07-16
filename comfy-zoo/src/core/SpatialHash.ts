/**
 * Tiny broad-phase spatial hash for top-down collision. No physics engine —
 * we only need circle-vs-circle and circle-vs-AABB resolution against static
 * obstacles (shelters, trees, fences). Deterministic and allocation-light.
 */

export interface CircleCollider {
  x: number;
  z: number;
  r: number;
}

export interface AABBCollider {
  /** center */
  x: number;
  z: number;
  /** half extents */
  hw: number;
  hh: number;
}

type Obstacle =
  | ({ kind: 'circle' } & CircleCollider)
  | ({ kind: 'aabb' } & AABBCollider);

/** Opaque handle returned by add*; pass to remove() to unregister (e.g. zone gates). */
export type ObstacleHandle = object;

export class SpatialHash {
  private readonly cell: number;
  private buckets = new Map<number, Obstacle[]>();

  constructor(cellSize = 4) {
    this.cell = cellSize;
  }

  clear(): void {
    this.buckets.clear();
  }

  private key(cx: number, cz: number): number {
    // Cantor-ish pack; grid is small so collisions are fine.
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  private insert(o: Obstacle, minx: number, minz: number, maxx: number, maxz: number): void {
    const c = this.cell;
    const x0 = Math.floor(minx / c);
    const z0 = Math.floor(minz / c);
    const x1 = Math.floor(maxx / c);
    const z1 = Math.floor(maxz / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let arr = this.buckets.get(k);
        if (!arr) {
          arr = [];
          this.buckets.set(k, arr);
        }
        arr.push(o);
      }
    }
  }

  addCircle(x: number, z: number, r: number): ObstacleHandle {
    const o: Obstacle = { kind: 'circle', x, z, r };
    this.insert(o, x - r, z - r, x + r, z + r);
    return o;
  }

  addAABB(x: number, z: number, hw: number, hh: number): ObstacleHandle {
    const o: Obstacle = { kind: 'aabb', x, z, hw, hh };
    this.insert(o, x - hw, z - hh, x + hw, z + hh);
    return o;
  }

  /** Unregister an obstacle previously returned by addCircle/addAABB. */
  remove(handle: ObstacleHandle): void {
    for (const arr of this.buckets.values()) {
      const i = arr.indexOf(handle as Obstacle);
      if (i >= 0) arr.splice(i, 1);
    }
  }

  private nearby(x: number, z: number, r: number, out: Obstacle[]): void {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c);
    const z0 = Math.floor((z - r) / c);
    const x1 = Math.floor((x + r) / c);
    const z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.buckets.get(this.key(cx, cz));
        if (arr) for (const o of arr) if (!out.includes(o)) out.push(o);
      }
    }
  }

  private scratch: Obstacle[] = [];

  /**
   * Resolve a moving circle against all static obstacles by pushing it out of
   * penetration. Mutates and returns { x, z }.
   */
  resolveCircle(x: number, z: number, r: number): { x: number; z: number } {
    this.nearby(x, z, r + 2, this.scratch);
    for (const o of this.scratch) {
      if (o.kind === 'circle') {
        let dx = x - o.x;
        let dz = z - o.z;
        const minDist = r + o.r;
        let d2 = dx * dx + dz * dz;
        if (d2 < minDist * minDist && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (minDist - d) / d;
          x += dx * push;
          z += dz * push;
        } else if (d2 <= 1e-6) {
          x += minDist;
        }
      } else {
        // circle vs AABB
        const nx = Math.max(o.x - o.hw, Math.min(x, o.x + o.hw));
        const nz = Math.max(o.z - o.hh, Math.min(z, o.z + o.hh));
        let dx = x - nx;
        let dz = z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = (r - d) / d;
            x += dx * push;
            z += dz * push;
          } else {
            // center inside box: push along shortest axis
            const px = o.hw - Math.abs(x - o.x);
            const pz = o.hh - Math.abs(z - o.z);
            if (px < pz) x += (x < o.x ? -1 : 1) * (px + r);
            else z += (z < o.z ? -1 : 1) * (pz + r);
          }
        }
      }
    }
    return { x, z };
  }
}
