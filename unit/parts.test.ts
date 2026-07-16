import { describe, expect, it } from 'vitest';
import type { Face, Vec3i } from '../src/core/types.ts';
import { ALL_FACES, cellKey, orientationFromSteps, rotateVec } from '../src/core/grid.ts';
import { PART_CATALOG } from '../src/core/parts.ts';
import {
  buildArmourFaces,
  buildOccupancy,
  createEmptyBlueprint,
  findRoot,
  hasControl,
  hasEngine,
  nextPartId,
  withPartAdded,
  withPartRemoved,
  withPartUpdated,
} from '../src/core/blueprint.ts';

const UNIT_AXES = new Set(['1,0,0', '-1,0,0', '0,1,0', '0,-1,0', '0,0,1', '0,0,-1']);

function vecKey(v: Vec3i): string {
  return `${v.x},${v.y},${v.z}`;
}

describe('part catalog integrity', () => {
  it('has matching ids, positive mass, valid sockets, and exactly one root', () => {
    let rootCount = 0;
    for (const [id, def] of Object.entries(PART_CATALOG)) {
      expect(def.id).toBe(id);
      expect(def.massKg).toBeGreaterThan(0);
      if (def.isRoot) rootCount += 1;

      const occupied = new Set(def.cells.map(cellKey));
      for (const socket of def.sockets) {
        expect(ALL_FACES).toContain(socket.face);
        if (def.armour?.faceMounted) {
          expect(def.cells).toHaveLength(0);
        } else {
          expect(occupied.has(cellKey(socket.cell))).toBe(true);
        }
      }
    }
    expect(rootCount).toBe(1);
  });

  it('defines complete wheel and engine payloads', () => {
    for (const def of Object.values(PART_CATALOG)) {
      if (def.wheel) {
        expect(UNIT_AXES.has(vecKey(def.wheel.axleAxis))).toBe(true);
        expect(UNIT_AXES.has(vecKey(def.wheel.suspensionDir))).toBe(true);
        expect(def.allowedOrientations).toBeUndefined();
        expect(def.wheel.suspension.restLength).toBeGreaterThan(0);
        expect(def.wheel.suspension.travel).toBeGreaterThan(0);
        expect(def.wheel.suspension.stiffness).toBeGreaterThan(0);
        expect(def.wheel.suspension.damping).toBeGreaterThan(0);
        expect(def.wheel.suspension.maxLoad).toBeGreaterThan(0);
      }

      if (def.engine) {
        for (let i = 1; i < def.engine.torqueCurve.length; i++) {
          expect(def.engine.torqueCurve[i][0]).toBeGreaterThan(def.engine.torqueCurve[i - 1][0]);
        }
      }
    }
  });
});

describe('blueprint helpers', () => {
  it('adds, updates, and removes parts immutably while keeping monotonic ids', () => {
    const bp = createEmptyBlueprint('test rig');
    const part = { id: nextPartId(bp), defId: 'chassis-core', pos: { x: 0, y: 0, z: 0 }, orient: 0, config: {} };
    const withPart = withPartAdded(bp, part);
    const updated = withPartUpdated(withPart, 'p1', { pos: { x: 1, y: 0, z: 0 } });
    const removed = withPartRemoved(updated, 'p1');

    expect(bp.parts).toHaveLength(0);
    expect(withPart.parts[0]).toEqual(part);
    expect(updated.parts[0].pos).toEqual({ x: 1, y: 0, z: 0 });
    expect(withPart.parts[0].pos).toEqual({ x: 0, y: 0, z: 0 });
    expect(removed.parts).toHaveLength(0);
    expect(nextPartId(withPart)).toBe('p2');
  });

  it('builds occupancy for a rotated beam', () => {
    const orient = orientationFromSteps(0, 1, 0);
    const bp = withPartAdded(createEmptyBlueprint('beam rig'), {
      id: 'p1',
      defId: 'beam-long',
      pos: { x: 2, y: 0, z: 2 },
      orient,
      config: {},
    });

    expect(buildOccupancy(bp)).toEqual(
      new Map([
        ['2,0,2', 'p1'],
        ['3,0,2', 'p1'],
        ['4,0,2', 'p1'],
      ]),
    );
  });

  it('builds armour face occupancy from rotated armour sockets', () => {
    const orient = orientationFromSteps(0, 1, 0);
    const coveredFace: Face = rotateVec(orient, { x: 0, y: 0, z: 1 }).x === 1 ? 'px' : 'pz';
    const bp = withPartAdded(createEmptyBlueprint('armour rig'), {
      id: 'p1',
      defId: 'armour-panel',
      pos: { x: 0, y: 0, z: 0 },
      orient,
      config: {},
    });

    expect(buildArmourFaces(bp)).toEqual(new Map([[`0,0,0|${coveredFace}`, 'p1']]));
  });

  it('queries root, control, and engine presence', () => {
    let bp = createEmptyBlueprint('query rig');
    bp = withPartAdded(bp, { id: 'p1', defId: 'chassis-core', pos: { x: 0, y: 0, z: 0 }, orient: 0, config: {} });
    bp = withPartAdded(bp, { id: 'p2', defId: 'driver-seat', pos: { x: 0, y: 1, z: 0 }, orient: 0, config: {} });
    bp = withPartAdded(bp, { id: 'p3', defId: 'engine-small', pos: { x: 0, y: 2, z: 0 }, orient: 0, config: {} });

    expect(findRoot(bp)?.id).toBe('p1');
    expect(hasControl(bp)).toBe(true);
    expect(hasEngine(bp)).toBe(true);
  });
});
