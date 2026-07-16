import { describe, expect, it } from 'vitest';
import {
  ALL_FACES,
  ORIENTATIONS,
  ORIENTATION_COUNT,
  cellInBounds,
  composeOrientations,
  inverseOrientation,
  mirrorCellX,
  mirrorOrientationX,
  oppositeFace,
  orientationFromSteps,
  rotateFace,
  rotateVec,
  worldCells,
} from '../src/core/grid.ts';

describe('orientations', () => {
  it('has exactly 24 unique orientations with identity at 0', () => {
    expect(ORIENTATION_COUNT).toBe(24);
    expect(rotateVec(0, { x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 });
    const keys = new Set(ORIENTATIONS.map((m) => m.join(',')));
    expect(keys.size).toBe(24);
  });

  it('every orientation has determinant +1 (no reflections)', () => {
    for (const m of ORIENTATIONS) {
      const det =
        m[0] * (m[4] * m[8] - m[5] * m[7]) -
        m[1] * (m[3] * m[8] - m[5] * m[6]) +
        m[2] * (m[3] * m[7] - m[4] * m[6]);
      expect(det).toBe(1);
    }
  });

  it('inverse composes to identity', () => {
    for (let o = 0; o < ORIENTATION_COUNT; o++) {
      expect(composeOrientations(o, inverseOrientation(o))).toBe(0);
      expect(composeOrientations(inverseOrientation(o), o)).toBe(0);
    }
  });

  it('yaw steps rotate forward correctly', () => {
    const yaw90 = orientationFromSteps(0, 1, 0);
    // +90° about Y sends +Z (forward) to +X.
    expect(rotateVec(yaw90, { x: 0, y: 0, z: 1 })).toEqual({ x: 1, y: 0, z: 0 });
    expect(rotateFace(yaw90, 'pz')).toBe('px');
  });

  it('four yaw steps return to identity', () => {
    const yaw90 = orientationFromSteps(0, 1, 0);
    let o = 0;
    for (let i = 0; i < 4; i++) o = composeOrientations(yaw90, o);
    expect(o).toBe(0);
  });
});

describe('faces', () => {
  it('opposite faces are symmetric', () => {
    for (const f of ALL_FACES) expect(oppositeFace(oppositeFace(f))).toBe(f);
  });
});

describe('footprints', () => {
  it('rotates a 2-cell footprint around Y', () => {
    const cells = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ];
    const yaw90 = orientationFromSteps(0, 1, 0);
    expect(worldCells(cells, { x: 2, y: 0, z: 2 }, yaw90)).toEqual([
      { x: 2, y: 0, z: 2 },
      { x: 3, y: 0, z: 2 },
    ]);
  });

  it('bounds checking', () => {
    expect(cellInBounds({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(cellInBounds({ x: 0, y: -1, z: 0 })).toBe(false);
    expect(cellInBounds({ x: 99, y: 0, z: 0 })).toBe(false);
  });
});

describe('mirroring', () => {
  it('mirroring twice is identity', () => {
    for (let o = 0; o < ORIENTATION_COUNT; o++) {
      expect(mirrorOrientationX(mirrorOrientationX(o))).toBe(o);
    }
    expect(mirrorCellX(mirrorCellX({ x: 3, y: 1, z: -2 }))).toEqual({ x: 3, y: 1, z: -2 });
  });

  it('mirrored orientation mirrors rotated vectors', () => {
    for (let o = 0; o < ORIENTATION_COUNT; o++) {
      const v = { x: 1, y: 2, z: 3 };
      const a = mirrorCellX(rotateVec(o, mirrorCellX(v)));
      const b = rotateVec(mirrorOrientationX(o), v);
      expect(a).toEqual(b);
    }
  });
});
