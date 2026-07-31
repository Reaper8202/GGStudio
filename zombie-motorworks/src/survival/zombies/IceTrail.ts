import * as THREE from 'three';
import {
  ICE_TRAIL_COLOR,
  ICE_TRAIL_GRIP_MULTIPLIER,
  ICE_TRAIL_HEIGHT_M,
  ICE_TRAIL_POOL_SIZE,
  ICE_TRAIL_WIDTH_M,
} from './zombieConfig.ts';

interface IceSegment {
  readonly mesh: THREE.Mesh;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** Insertion order only — segments never fade or expire on their own. */
  age: number;
  active: boolean;
}

const OPACITY = 0.55;
const HALF_WIDTH = ICE_TRAIL_WIDTH_M / 2;
const HALF_WIDTH_SQ = HALF_WIDTH * HALF_WIDTH;
const MIN_SEGMENT_LENGTH_M = 0.05;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Squared distance from point (px,pz) to the segment (x1,z1)-(x2,z2). */
function distanceToSegmentSq(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < 1e-6) {
    const ddx = px - x1;
    const ddz = pz - z1;
    return ddx * ddx + ddz * ddz;
  }
  const t = clamp01(((px - x1) * dx + (pz - z1) * dz) / lengthSq);
  const cx = x1 + t * dx;
  const cz = z1 + t * dz;
  const ddx = px - cx;
  const ddz = pz - cz;
  return ddx * ddx + ddz * ddz;
}

/**
 * Pooled ground hazard trail: a continuous thick line of joined segments a
 * Zamboni Zombie lays behind itself, one segment per `ICE_TRAIL_EMIT_DISTANCE_M`
 * of movement, each connecting to its predecessor's endpoint. Segments are
 * permanent for the wave — the pool only recycles its single oldest slot when
 * every slot is in use, and everything is cleared at wave-clear or run reset,
 * the same lifecycle `Landmines` uses. No Rapier body — `muAt` is a plain
 * spatial query the runtime wheel step calls per contact point, the same
 * shape as `Arena.surfaceOf`.
 */
export class IceTrail {
  private readonly pool: IceSegment[] = [];
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private nextAge = 0;
  private disposed = false;

  constructor(private readonly scene: THREE.Scene) {
    // Local +Z is the "forward"/length axis (the same convention Zombie
    // facing uses), local X the width axis — scaled per instance in `drop`.
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.MeshBasicMaterial({
      color: ICE_TRAIL_COLOR,
      transparent: true,
      opacity: OPACITY,
      depthWrite: false,
    });
    for (let i = 0; i < ICE_TRAIL_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.visible = false;
      this.scene.add(mesh);
      this.pool.push({ mesh, x1: 0, z1: 0, x2: 0, z2: 0, age: 0, active: false });
    }
  }

  /** Lay a fresh segment from (x1,z1) to (x2,z2), recycling the oldest when full. */
  drop(x1: number, z1: number, x2: number, z2: number): void {
    if (this.disposed) return;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    if (length < MIN_SEGMENT_LENGTH_M) return;

    let slot: IceSegment | null = null;
    for (const segment of this.pool) {
      if (!segment.active) {
        slot = segment;
        break;
      }
      if (!slot || segment.age < slot.age) slot = segment;
    }
    if (!slot) return;

    slot.x1 = x1;
    slot.z1 = z1;
    slot.x2 = x2;
    slot.z2 = z2;
    slot.age = this.nextAge++;
    slot.active = true;
    slot.mesh.position.set((x1 + x2) / 2, ICE_TRAIL_HEIGHT_M, (z1 + z2) / 2);
    slot.mesh.rotation.y = Math.atan2(dx, dz);
    slot.mesh.scale.set(ICE_TRAIL_WIDTH_M, 1, length);
    slot.mesh.visible = true;
  }

  /**
   * Grip multiplier (0..1) from any ice segment under this ground point; null
   * when the point sits outside every active segment. The strongest (lowest)
   * multiplier wins where segments overlap — currently the same flat value,
   * since segments no longer weaken with age.
   */
  muAt(x: number, z: number): number | null {
    for (const segment of this.pool) {
      if (!segment.active) continue;
      if (
        distanceToSegmentSq(x, z, segment.x1, segment.z1, segment.x2, segment.z2) <=
        HALF_WIDTH_SQ
      )
        return ICE_TRAIL_GRIP_MULTIPLIER;
    }
    return null;
  }

  despawnAll(): void {
    for (const segment of this.pool) {
      segment.active = false;
      segment.mesh.visible = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const segment of this.pool) this.scene.remove(segment.mesh);
    this.pool.length = 0;
    this.geometry.dispose();
    this.material.dispose();
  }
}
