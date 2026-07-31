import {
  GAS_PUFF_EMIT_WINDOW_SECONDS,
  GAS_PUFF_INTERVAL_SECONDS,
  GAS_TRAIL_DAMAGE_PER_SECOND,
  GAS_TRAIL_HEIGHT_M,
  GAS_TRAIL_LIFETIME_SECONDS,
  GAS_TRAIL_POOL_SIZE,
  GAS_TRAIL_WIDTH_M,
} from './zombieConfig.ts';

interface GasSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  life: number;
  totalLife: number;
  /** Countdown to this segment's next smoke puff. */
  puffTimer: number;
  active: boolean;
}

/** Where a puff of smoke should be spawned; wired to `VfxSystem.bossGasWisp`. */
export type GasPuffEmitter = (x: number, y: number, z: number) => void;

const HALF_WIDTH = GAS_TRAIL_WIDTH_M / 2;
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
 * The vial boss's toxic wake, laid one connected segment at a time as it moves
 * (the same chain shape `IceTrail` uses for the Zamboni). Nothing is drawn on
 * the ground — this class owns no geometry at all. Its segments are an
 * invisible hazard region; what the player actually sees is smoke, vented as
 * VFX puffs along whichever segments are still young enough to be venting, so
 * the cloud pours out of the boss and then hangs and thins behind it rather
 * than reading as painted rectangles on the floor.
 *
 * No Rapier body; `dpsAt` is a plain spatial query, the same shape as
 * `AcidPuddles.muAt` and `IceTrail.muAt`.
 */
export class GasTrail {
  private readonly pool: GasSegment[] = [];
  private emitPuff: GasPuffEmitter | null = null;
  private disposed = false;

  constructor() {
    for (let i = 0; i < GAS_TRAIL_POOL_SIZE; i++) {
      this.pool.push({
        x1: 0,
        z1: 0,
        x2: 0,
        z2: 0,
        life: 0,
        totalLife: 1,
        puffTimer: 0,
        active: false,
      });
    }
  }

  /** Hook up the particle sink. Without one the trail is still dangerous, just invisible. */
  setPuffEmitter(emit: GasPuffEmitter | null): void {
    this.emitPuff = emit;
  }

  /** Lay a fresh segment from (x1,z1) to (x2,z2), recycling the oldest when full. */
  drop(x1: number, z1: number, x2: number, z2: number): void {
    if (this.disposed) return;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    if (length < MIN_SEGMENT_LENGTH_M) return;

    let slot: GasSegment | null = null;
    for (const segment of this.pool) {
      if (!segment.active) {
        slot = segment;
        break;
      }
      if (!slot || segment.life < slot.life) slot = segment;
    }
    if (!slot) return;

    slot.x1 = x1;
    slot.z1 = z1;
    slot.x2 = x2;
    slot.z2 = z2;
    slot.life = GAS_TRAIL_LIFETIME_SECONDS;
    slot.totalLife = GAS_TRAIL_LIFETIME_SECONDS;
    slot.puffTimer = GAS_PUFF_INTERVAL_SECONDS * Math.random();
    slot.active = true;
    // One puff immediately, so a segment is smoking from the frame it lands
    // rather than after its first interval — otherwise a boss moving fast
    // outruns its own cloud.
    this.puff(slot);
  }

  /** Age every segment and keep the young ones venting smoke. */
  update(dt: number): void {
    if (this.disposed) return;
    for (const segment of this.pool) {
      if (!segment.active) continue;
      segment.life -= dt;
      if (segment.life <= 0) {
        segment.active = false;
        continue;
      }
      const age = segment.totalLife - segment.life;
      if (age > GAS_PUFF_EMIT_WINDOW_SECONDS) continue;
      segment.puffTimer -= dt;
      if (segment.puffTimer <= 0) {
        segment.puffTimer = GAS_PUFF_INTERVAL_SECONDS * (0.7 + Math.random() * 0.6);
        this.puff(segment);
      }
    }
  }

  /**
   * Poison damage/second from any gas segment under this ground point, 0
   * outside every active segment. Where segments overlap the strongest single
   * one wins — the same overlap rule `ZombieSystem.tickAcidPoison` already
   * applies across hazards.
   */
  dpsAt(x: number, z: number): number {
    for (const segment of this.pool) {
      if (!segment.active) continue;
      if (
        distanceToSegmentSq(x, z, segment.x1, segment.z1, segment.x2, segment.z2) <=
        HALF_WIDTH_SQ
      ) {
        return GAS_TRAIL_DAMAGE_PER_SECOND;
      }
    }
    return 0;
  }

  despawnAll(): void {
    for (const segment of this.pool) segment.active = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.emitPuff = null;
    this.pool.length = 0;
  }

  /** Vents one puff at a random point along the segment, jittered across its width. */
  private puff(segment: GasSegment): void {
    const emit = this.emitPuff;
    if (emit === null) return;
    const t = Math.random();
    const x = segment.x1 + (segment.x2 - segment.x1) * t;
    const z = segment.z1 + (segment.z2 - segment.z1) * t;
    const spread = HALF_WIDTH * 0.9;
    emit(
      x + (Math.random() * 2 - 1) * spread,
      GAS_TRAIL_HEIGHT_M + Math.random() * 0.4,
      z + (Math.random() * 2 - 1) * spread,
    );
  }
}
