import { describe, expect, it } from 'vitest';
import { orientationFromSteps } from '../src/core/grid.ts';
import {
  CONNECTION_STRENGTH,
  SOCKET_COMPAT,
  computeIslands,
  deriveConnections,
  disconnectedParts,
  reachableFromRoot,
  socketsCompatible,
} from '../src/core/structural.ts';
import { BLUEPRINT_SCHEMA_VERSION } from '../src/core/types.ts';
import type {
  Face,
  PartDefinition,
  VehicleBlueprint,
} from '../src/core/types.ts';

const faces: Face[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

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
    root: base('root', {
      isRoot: true,
      reinforcement: 0.5,
    }),
    frame: base('frame'),
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
    span: base('span', {
      cells: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      sockets: [
        {
          id: 'span-end',
          cell: { x: 1, y: 0, z: 0 },
          face: 'px',
          type: 'frame',
        },
      ],
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
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    id: 'test',
    name: 'test',
    parts,
  };
}

describe('structural graph', () => {
  it('supports only frame-to-frame sockets at the retuned strength', () => {
    expect(SOCKET_COMPAT).toEqual([['frame', 'frame']]);
    expect(CONNECTION_STRENGTH).toEqual({
      'frame-frame': { maxForce: 120000, maxTorque: 32000 },
    });
    expect(socketsCompatible('frame', 'frame')).toBe(true);
    expect(socketsCompatible('frame', 'wheel-mount')).toBe(false);
    expect(socketsCompatible('frame', 'armour')).toBe(false);
  });

  it('connects adjacent frame cubes and scales strength by the lower reinforcement', () => {
    const connections = deriveConnections(
      blueprint([
        {
          id: 'root',
          defId: 'root',
          pos: { x: 0, y: 0, z: 0 },
          orient: 0,
          config: {},
        },
        {
          id: 'frame',
          defId: 'frame',
          pos: { x: 1, y: 0, z: 0 },
          orient: 0,
          config: {},
        },
      ]),
      catalog(),
    );
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      maxForce: 60000,
      maxTorque: 16000,
      health: 1,
    });
  });

  it('uses the rotated touching cell of a multi-cell structural part', () => {
    const connections = deriveConnections(
      blueprint([
        {
          id: 'span',
          defId: 'span',
          pos: { x: 0, y: 0, z: 0 },
          orient: orientationFromSteps(0, 1, 0),
          config: {},
        },
        {
          id: 'frame',
          defId: 'frame',
          pos: { x: 0, y: 0, z: -2 },
          orient: 0,
          config: {},
        },
      ]),
      catalog(),
    );
    expect(connections).toHaveLength(1);
    expect(
      connections[0].aSocketId === 'span-end' ||
        connections[0].bSocketId === 'span-end',
    ).toBe(true);
  });

  it('connects a wheel directly to an adjacent frame socket', () => {
    const connections = deriveConnections(
      blueprint([
        {
          id: 'frame',
          defId: 'frame',
          pos: { x: 0, y: 1, z: 0 },
          orient: 0,
          config: {},
        },
        {
          id: 'wheel',
          defId: 'wheel',
          pos: { x: -1, y: 1, z: 0 },
          orient: 0,
          config: {},
        },
      ]),
      catalog(),
    );
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      maxForce: 120000,
      maxTorque: 32000,
    });
    expect([connections[0].aSocketId, connections[0].bSocketId]).toContain(
      'wheel-px',
    );
  });

  it('computes split and singleton islands after a chain connection is removed', () => {
    const connections = deriveConnections(
      blueprint([
        {
          id: 'root',
          defId: 'root',
          pos: { x: 0, y: 0, z: 0 },
          orient: 0,
          config: {},
        },
        {
          id: 'middle',
          defId: 'frame',
          pos: { x: 1, y: 0, z: 0 },
          orient: 0,
          config: {},
        },
        {
          id: 'far',
          defId: 'frame',
          pos: { x: 2, y: 0, z: 0 },
          orient: 0,
          config: {},
        },
      ]),
      catalog(),
    );
    const withoutMiddleEdge = connections.filter(
      (connection) => !(connection.aId === 'far' || connection.bId === 'far'),
    );
    expect(
      computeIslands(['root', 'middle', 'far', 'single'], withoutMiddleEdge),
    ).toEqual([['root', 'middle'], ['far'], ['single']]);
  });

  it('excludes a floating part from root reachability and reports it disconnected', () => {
    const bp = blueprint([
      {
        id: 'root',
        defId: 'root',
        pos: { x: 0, y: 0, z: 0 },
        orient: 0,
        config: {},
      },
      {
        id: 'floating',
        defId: 'frame',
        pos: { x: 4, y: 0, z: 0 },
        orient: 0,
        config: {},
      },
    ]);
    const getDef = catalog();
    const connections = deriveConnections(bp, getDef);
    expect(reachableFromRoot(bp, connections, getDef)).toEqual(
      new Set(['root']),
    );
    expect(disconnectedParts(bp, connections, getDef)).toEqual(['floating']);
  });
});
