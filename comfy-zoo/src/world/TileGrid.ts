/**
 * Placement grid over the ground plane. 2m cells across a ~64m valley. Tracks
 * occupancy, buildable plots and per-cell zone for soft-gating and validity checks.
 */
import type { ZoneId } from '../data/types';

export interface Cell {
  cx: number;
  cz: number;
}

export class TileGrid {
  readonly cellSize: number;
  readonly cols: number;
  readonly half: number;
  private occupied: Uint8Array;
  private buildable: Uint8Array;
  private zone: Uint8Array; // 0 meadow, 1 pineForest, 2 palmOasis
  private zoneIds: ZoneId[] = ['meadow', 'pineForest', 'palmOasis'];

  constructor(worldSize = 64, cellSize = 2) {
    this.cellSize = cellSize;
    this.cols = Math.floor(worldSize / cellSize);
    this.half = worldSize / 2;
    const n = this.cols * this.cols;
    this.occupied = new Uint8Array(n);
    this.buildable = new Uint8Array(n).fill(1);
    this.zone = new Uint8Array(n);
  }

  private idx(cx: number, cz: number): number {
    return cz * this.cols + cx;
  }

  inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.cols && cz < this.cols;
  }

  worldToCell(x: number, z: number): Cell {
    return {
      cx: Math.floor((x + this.half) / this.cellSize),
      cz: Math.floor((z + this.half) / this.cellSize),
    };
  }

  /** Center of a cell in world coordinates. */
  cellToWorld(cx: number, cz: number): { x: number; z: number } {
    return {
      x: (cx + 0.5) * this.cellSize - this.half,
      z: (cz + 0.5) * this.cellSize - this.half,
    };
  }

  /** Center of a w×h footprint whose anchor cell is (cx,cz). */
  footprintCenter(cx: number, cz: number, w: number, h: number): { x: number; z: number } {
    return {
      x: (cx + w / 2) * this.cellSize - this.half,
      z: (cz + h / 2) * this.cellSize - this.half,
    };
  }

  setZone(cx: number, cz: number, zone: ZoneId): void {
    if (this.inBounds(cx, cz)) this.zone[this.idx(cx, cz)] = this.zoneIds.indexOf(zone);
  }

  zoneAt(x: number, z: number): ZoneId {
    const { cx, cz } = this.worldToCell(x, z);
    if (!this.inBounds(cx, cz)) return 'meadow';
    return this.zoneIds[this.zone[this.idx(cx, cz)]];
  }

  setBuildable(cx: number, cz: number, val: boolean): void {
    if (this.inBounds(cx, cz)) this.buildable[this.idx(cx, cz)] = val ? 1 : 0;
  }

  isOccupied(cx: number, cz: number): boolean {
    return this.inBounds(cx, cz) && this.occupied[this.idx(cx, cz)] === 1;
  }

  /** Is a w×h footprint anchored at (cx,cz) valid to build on? */
  footprintValid(cx: number, cz: number, w: number, h: number): boolean {
    for (let dz = 0; dz < h; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (!this.inBounds(x, z)) return false;
        const i = this.idx(x, z);
        if (this.occupied[i] === 1 || this.buildable[i] === 0) return false;
      }
    }
    return true;
  }

  occupy(cx: number, cz: number, w: number, h: number, val: boolean): void {
    for (let dz = 0; dz < h; dz++) {
      for (let dx = 0; dx < w; dx++) {
        if (this.inBounds(cx + dx, cz + dz)) {
          this.occupied[this.idx(cx + dx, cz + dz)] = val ? 1 : 0;
        }
      }
    }
  }

  /** Snap a world position to the anchor cell of a w×h footprint centered there. */
  snapFootprint(x: number, z: number, w: number, h: number): Cell {
    const c = this.worldToCell(x, z);
    return { cx: c.cx - Math.floor(w / 2), cz: c.cz - Math.floor(h / 2) };
  }
}
