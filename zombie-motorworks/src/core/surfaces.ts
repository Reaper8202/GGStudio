/** Per-surface friction parameters. Extensible (snow, ice, metal...). */

export type SurfaceKind =
  | 'asphalt'
  | 'dirt'
  | 'mud'
  | 'rubble'
  | 'gravel'
  | 'snow'
  | 'ice'
  | 'sand'
  | 'hardpan';

/** Debris a wheel throws on this surface. Omitted = throws nothing. */
export interface SpraySpec {
  /** Particle tint, hex. */
  color: number;
  /** Particles per second per wheel at full slip intensity. */
  rate: number;
  /** Particle lifetime, seconds. */
  lifetime: number;
  /** Particle world size, metres. */
  size: number;
  /** 0 = sprays flat behind the wheel, 1 = plumes straight up. */
  upwardBias: number;
}

export interface SurfaceParams {
  muLong: number;
  muLat: number;
  rollingResistance: number;
  /**
   * Soft-ground sinkage. Rolling drag gains an extra term proportional to how
   * hard the wheel is loaded relative to its rating, so heavy builds bog down.
   * 0 = firm ground, the drag term vanishes.
   */
  sinkage: number;
  spray?: SpraySpec;
}

export const SURFACES: Record<SurfaceKind, SurfaceParams> = {
  asphalt: {
    muLong: 1.0,
    muLat: 1.0,
    rollingResistance: 0.015,
    sinkage: 0,
  },
  dirt: {
    muLong: 0.72,
    muLat: 0.68,
    rollingResistance: 0.035,
    sinkage: 0.05,
    spray: {
      color: 0x6b5a42,
      rate: 34,
      lifetime: 0.5,
      size: 0.1,
      upwardBias: 0.3,
    },
  },
  mud: {
    muLong: 0.4,
    muLat: 0.35,
    rollingResistance: 0.09,
    sinkage: 0.35,
    spray: {
      color: 0x40352a,
      rate: 46,
      lifetime: 0.7,
      size: 0.13,
      upwardBias: 0.25,
    },
  },
  rubble: {
    muLong: 0.6,
    muLat: 0.55,
    rollingResistance: 0.06,
    sinkage: 0.08,
    spray: {
      color: 0x7d7b74,
      rate: 26,
      lifetime: 0.4,
      size: 0.09,
      upwardBias: 0.35,
    },
  },
  gravel: {
    muLong: 0.68,
    muLat: 0.6,
    rollingResistance: 0.05,
    sinkage: 0.06,
    spray: {
      color: 0x8b8880,
      rate: 30,
      lifetime: 0.45,
      size: 0.09,
      upwardBias: 0.35,
    },
  },
  snow: {
    // Braking on tarmac is limited by brake torque, not grip, so trimming grip
    // a little barely lengthens a stop. These are set low enough that snow is
    // grip-limited well before the brakes are — that is what makes it scary.
    muLong: 0.34,
    muLat: 0.24,
    rollingResistance: 0.05,
    sinkage: 0.3,
    spray: {
      color: 0xeef4ff,
      rate: 60,
      lifetime: 0.9,
      size: 0.16,
      upwardBias: 0.55,
    },
  },
  ice: {
    muLong: 0.16,
    muLat: 0.1,
    rollingResistance: 0.012,
    sinkage: 0,
  },
  sand: {
    muLong: 0.75,
    muLat: 0.58,
    rollingResistance: 0.13,
    sinkage: 0.55,
    spray: {
      color: 0xd8b981,
      rate: 54,
      lifetime: 1.1,
      size: 0.18,
      upwardBias: 0.45,
    },
  },
  hardpan: {
    muLong: 0.9,
    muLat: 0.85,
    rollingResistance: 0.02,
    sinkage: 0.02,
    spray: {
      color: 0xc2a884,
      rate: 16,
      lifetime: 0.5,
      size: 0.08,
      upwardBias: 0.3,
    },
  },
};
