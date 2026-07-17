import { describe, expect, it } from 'vitest';
import { orientationFromSteps } from '../src/core/grid.ts';
import {
  canPlacePart,
  canRemovePart,
  validateBlueprint,
} from '../src/core/placement.ts';
import type {
  Face,
  PartDefinition,
  VehicleBlueprint,
} from '../src/core/types.ts';

const faces: Face[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
const wheelOrientation = orientationFromSteps(0, 2, 0);

function fixtures(): Record<string, PartDefinition> {
  const cubeSockets = () =>
    faces.map((face) => ({
      id: `frame-${face}`,
      cell: { x: 0, y: 0, z: 0 },
      face,
      type: 'frame' as const,
    }));
  const base = (
    id: string,
    overrides: Partial<PartDefinition> = {},
  ): PartDefinition => ({
    id,
    name: id,
    category: 'structural',
    description: id,
    cells: [{ x: 0, y: 0, z: 0 }],
    clearanceCells: [],
    sockets: cubeSockets(),
    massKg: 10,
    health: 100,
    cost: 10,
    reinforcement: 1,
    ...overrides,
  });
  return {
    root: base('root', { isRoot: true, unique: true, providesControl: true }),
    controlLessRoot: base('controlLessRoot', { isRoot: true, unique: true }),
    frame: base('frame'),
    locked: base('locked', { allowedOrientations: [0] }),
    wheel: base('wheel', {
      category: 'movement',
      sockets: [
        {
          id: 'wheel-px',
          cell: { x: 0, y: 0, z: 0 },
          face: 'px',
          type: 'frame',
        },
      ],
      clearanceCells: [{ x: 0, y: -1, z: 0 }],
    }),
    unique: base('unique', { unique: true }),
    beam: base('beam', {
      cells: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      sockets: [
        {
          id: 'beam-end',
          cell: { x: 1, y: 0, z: 0 },
          face: 'px',
          type: 'frame',
        },
      ],
    }),
    engine: base('engine', {
      category: 'functional',
      engine: {
        torqueCurve: [[1000, 100]],
        maxRpm: 5000,
        idleRpm: 800,
        maxPowerKw: 50,
        fuelPerSecondAtFull: 0.01,
      },
    }),
  };
}

function catalog(): (id: string) => PartDefinition {
  const defs = fixtures();
  return (id) => {
    const def = defs[id];
    if (def === undefined) throw new Error(`unknown definition: ${id}`);
    return def;
  };
}

function blueprint(parts: VehicleBlueprint['parts']): VehicleBlueprint {
  return { schemaVersion: 3, id: 'test', name: 'test', parts };
}

function part(
  id: string,
  defId: string,
  x: number,
  y = 0,
  z = 0,
  orient = 0,
): VehicleBlueprint['parts'][number] {
  return { id, defId, pos: { x, y, z }, orient, config: {} };
}

function codes(result: { issues: { code: string }[] }): string[] {
  return result.issues.map((entry) => entry.code);
}

describe('canPlacePart', () => {
  it('accepts an initial root and rejects a forbidden orientation', () => {
    const getDef = catalog();
    expect(
      canPlacePart(blueprint([]), getDef, 'root', { x: 0, y: 0, z: 0 }, 0).ok,
    ).toBe(true);
    expect(
      codes(
        canPlacePart(
          blueprint([part('root', 'root', 0)]),
          getDef,
          'locked',
          { x: 1, y: 0, z: 0 },
          1,
        ),
      ),
    ).toContain('ORIENTATION_NOT_ALLOWED');
  });

  it('reports bounds and overlap violations while allowing a non-overlapping adjacent frame', () => {
    const getDef = catalog();
    const bp = blueprint([part('root', 'root', 0)]);
    expect(canPlacePart(bp, getDef, 'frame', { x: 1, y: 0, z: 0 }, 0).ok).toBe(
      true,
    );
    expect(
      codes(canPlacePart(bp, getDef, 'frame', { x: 7, y: 0, z: 0 }, 0)),
    ).toContain('OUT_OF_BOUNDS');
    expect(
      codes(canPlacePart(bp, getDef, 'frame', { x: 0, y: 0, z: 0 }, 0)),
    ).toContain('OVERLAP');
  });

  it('enforces unique and root singleton rules', () => {
    const getDef = catalog();
    const withUnique = blueprint([
      part('root', 'root', 0),
      part('unique', 'unique', 1),
    ]);
    expect(
      codes(
        canPlacePart(withUnique, getDef, 'unique', { x: -1, y: 0, z: 0 }, 0),
      ),
    ).toContain('UNIQUE_VIOLATION');
    expect(
      codes(
        canPlacePart(
          blueprint([part('root', 'root', 0)]),
          getDef,
          'root',
          { x: 1, y: 0, z: 0 },
          0,
        ),
      ),
    ).toContain('ROOT_DUPLICATE');
  });

  it('requires free clearance on both the new and existing parts', () => {
    const getDef = catalog();
    const frame = blueprint([part('frame', 'frame', 0, 1)]);
    expect(
      canPlacePart(
        frame,
        getDef,
        'wheel',
        { x: 1, y: 1, z: 0 },
        wheelOrientation,
      ).ok,
    ).toBe(true);
    const clearanceBlocked = blueprint([
      part('frame', 'frame', 0, 1),
      part('blocker', 'frame', 1, 0),
    ]);
    expect(
      codes(
        canPlacePart(
          clearanceBlocked,
          getDef,
          'wheel',
          { x: 1, y: 1, z: 0 },
          wheelOrientation,
        ),
      ),
    ).toContain('CLEARANCE_BLOCKED');
    const existingWheel = blueprint([
      part('frame', 'frame', 0, 1),
      part('wheel', 'wheel', 1, 1, 0, wheelOrientation),
    ]);
    expect(
      codes(
        canPlacePart(existingWheel, getDef, 'frame', { x: 1, y: 0, z: 0 }, 0),
      ),
    ).toContain('CLEARANCE_VIOLATION');
  });

  it('requires structural attachment and lets a wheel connect directly to a frame', () => {
    const getDef = catalog();
    expect(
      codes(
        canPlacePart(blueprint([]), getDef, 'frame', { x: 0, y: 0, z: 0 }, 0),
      ),
    ).toContain('NO_CONNECTION');
    expect(
      codes(
        canPlacePart(
          blueprint([]),
          getDef,
          'wheel',
          { x: 1, y: 1, z: 0 },
          wheelOrientation,
        ),
      ),
    ).toContain('NO_CONNECTION');
    expect(
      canPlacePart(
        blueprint([part('frame', 'frame', 0, 1)]),
        getDef,
        'wheel',
        { x: 1, y: 1, z: 0 },
        wheelOrientation,
      ).ok,
    ).toBe(true);
  });

  it('prevents root removal but permits non-root removal', () => {
    const getDef = catalog();
    const bp = blueprint([part('root', 'root', 0), part('frame', 'frame', 1)]);
    expect(codes(canRemovePart(bp, getDef, 'root'))).toContain('REMOVE_ROOT');
    expect(canRemovePart(bp, getDef, 'frame').ok).toBe(true);
  });
});

describe('validateBlueprint', () => {
  it('returns no hard errors for a connected controlled vehicle with propulsion', () => {
    const report = validateBlueprint(
      blueprint([part('root', 'root', 0), part('engine', 'engine', 1)]),
      catalog(),
    );
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.infos).toEqual([]);
  });

  it('reports missing root, control, propulsion, and root connectivity independently', () => {
    const getDef = catalog();
    expect(
      codes({
        issues: validateBlueprint(
          blueprint([part('frame', 'frame', 0)]),
          getDef,
        ).errors,
      }),
    ).toContain('NO_ROOT');
    expect(
      codes({
        issues: validateBlueprint(
          blueprint([
            part('root', 'controlLessRoot', 0),
            part('engine', 'engine', 1),
          ]),
          getDef,
        ).errors,
      }),
    ).toContain('NO_CONTROL');
    expect(
      codes({
        issues: validateBlueprint(blueprint([part('root', 'root', 0)]), getDef)
          .errors,
      }),
    ).toContain('NO_PROPULSION');
    expect(
      codes({
        issues: validateBlueprint(
          blueprint([
            part('root', 'root', 0),
            part('engine', 'engine', 1),
            part('far', 'frame', 4),
          ]),
          getDef,
        ).errors,
      }),
    ).toContain('DISCONNECTED');
  });

  it('reports invalid definitions, bounds, and overlap as hard errors', () => {
    const report = validateBlueprint(
      blueprint([
        part('root', 'root', 0),
        part('engine', 'engine', 1),
        part('unknown', 'not-in-catalog', 2),
        part('overlap', 'frame', 0),
        part('outside', 'frame', 7),
        part('wheel', 'wheel', 4, 1, 0, wheelOrientation),
      ]),
      catalog(),
    );
    const reportCodes = report.errors.map((entry) => entry.code);
    expect(reportCodes).toEqual(
      expect.arrayContaining(['INVALID_DEF', 'OUT_OF_BOUNDS', 'OVERLAP']),
    );
  });
});
