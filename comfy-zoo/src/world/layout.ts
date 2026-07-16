/**
 * Single source of truth for the hand-authored valley layout: zone rectangles,
 * point→zone lookup, and random point sampling. WorldGen paints vegetation and
 * the tile grid from this; SpawnSystem samples spawn points from it.
 */
import type { ZoneId } from '../data/types';

export const WORLD_SIZE = 64;
export const HALF = WORLD_SIZE / 2;

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

// Cozy valley: Pine Forest to the north (−z), Meadow center/south, Palm Oasis east.
export const ZONE_RECTS: Record<ZoneId, Rect> = {
  pineForest: { minX: -HALF, maxX: 12, minZ: -HALF, maxZ: -6 },
  meadow: { minX: -HALF, maxX: 12, minZ: -6, maxZ: HALF },
  palmOasis: { minX: 12, maxX: HALF, minZ: -HALF, maxZ: HALF },
};

export function zoneOfPoint(x: number, z: number): ZoneId {
  if (x >= 12) return 'palmOasis';
  if (z < -6) return 'pineForest';
  return 'meadow';
}

export function randomPointInZone(zone: ZoneId, margin = 3): { x: number; z: number } {
  const r = ZONE_RECTS[zone];
  return {
    x: r.minX + margin + Math.random() * (r.maxX - r.minX - margin * 2),
    z: r.minZ + margin + Math.random() * (r.maxZ - r.minZ - margin * 2),
  };
}

/** Dino Grove sub-region within the Palm Oasis (mythic encounters). */
export const DINO_GROVE: Rect = { minX: 18, maxX: HALF - 3, minZ: 4, maxZ: HALF - 3 };
