import { describe, expect, it } from 'vitest';
import { orientationFromSteps } from '../src/core/grid.ts';
import {
  computeIslands,
  deriveConnections,
  disconnectedParts,
  reachableFromRoot,
} from '../src/core/structural.ts';
import type { Face, PartDefinition, VehicleBlueprint } from '../src/core/types.ts';

const faces: Face[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

function fixtures(): Record<string, PartDefinition> {
  const cubeSockets = (type: 'frame' | 'wheel-mount' = 'frame') =>
    faces.map((face) => ({ id: `${type}-${face}`, cell: { x: 0, y: 0, z: 0 }, face, type }));
  const base = (id: string, overrides: Partial<PartDefinition> = {}): PartDefinition => ({
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
    root: base('root', { isRoot: true, providesControl: true, reinforcement: 0.5 }),
    frame: base('frame'),
    mount: base('mount', {
      sockets: [
        { id: 'mount-px', cell: { x: 0, y: 0, z: 0 }, face: 'px', type: 'wheel-mount' },
        { id: 'mount-nx', cell: { x: 0, y: 0, z: 0 }, face: 'nx', type: 'wheel-mount' },
      ],
    }),
    wheel: base('wheel', {
      category: 'movement',
      sockets: [{ id: 'wheel-px', cell: { x: 0, y: 0, z: 0 }, face: 'px', type: 'wheel-mount' }],
      clearanceCells: [{ x: 0, y: -1, z: 0 }],
      requiresMount: 'wheel-mount',
    }),
    armour: base('armour', {
      category: 'protection',
      cells: [],
      sockets: [{ id: 'armour-pz', cell: { x: 0, y: 0, z: 0 }, face: 'pz', type: 'armour' }],
    }),
    unique: base('unique', { unique: true }),
    beam: base('beam', {
      cells: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      sockets: [{ id: 'beam-end', cell: { x: 1, y: 0, z: 0 }, face: 'px', type: 'frame' }],
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
  return { schemaVersion: 2, id: 'test', name: 'test', parts };
}

describe('structural graph', () => {
  it('connects adjacent frame cubes and scales strength by the lower reinforcement', () => {
    const connections = deriveConnections(
      blueprint([
        { id: 'root', defId: 'root', pos: { x: 0, y: 0, z: 0 }, orient: 0, config: {} },
        { id: 'frame', defId: 'frame', pos: { x: 1, y: 0, z: 0 }, orient: 0, config: {} },
      ]),
      catalog(),
    );
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ maxForce: 15000, maxTorque: 4000, health: 1 });
  });

  it('uses the rotated touching beam cell when deriving connections', () => {
    const connections = deriveConnections(
      blueprint([
        { id: 'beam', defId: 'beam', pos: { x: 0, y: 0, z: 0 }, orient: orientationFromSteps(0, 1, 0), config: {} },
        { id: 'frame', defId: 'frame', pos: { x: 0, y: 0, z: -2 }, orient: 0, config: {} },
      ]),
      catalog(),
    );
    expect(connections).toHaveLength(1);
    expect(connections[0].aSocketId === 'beam-end' || connections[0].bSocketId === 'beam-end').toBe(true);
  });

  it('does not connect incompatible touching socket types', () => {
    const connections = deriveConnections(
      blueprint([
        { id: 'mount', defId: 'mount', pos: { x: 0, y: 0, z: 0 }, orient: 0, config: {} },
        { id: 'frame', defId: 'frame', pos: { x: 1, y: 0, z: 0 }, orient: 0, config: {} },
      ]),
      catalog(),
    );
    expect(connections).toEqual([]);
  });

  it('connects face-mounted armour to its host socket', () => {
    const connections = deriveConnections(
      blueprint([
        { id: 'frame', defId: 'frame', pos: { x: 0, y: 0, z: 0 }, orient: 0, config: {} },
        { id: 'armour', defId: 'armour', pos: { x: 0, y: 0, z: 0 }, orient: 0, config: {} },
      ]),
      catalog(),
    );
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ maxForce: 9000, maxTorque: 2000 });
  });

  it('computes split and singleton islands after a chain connection is removed', () => {
    const connections = deriveConnections(
      blueprint([
        { id: 'root', defId: 'root', pos: { x: 0, y: 0, z: 0 }, orient: 0, config: {} },
        { id: 'middle', defId: 'frame', pos: { x: 1, y: 0, z: 0 }, orient: 0, config: {} },
        { id: 'far', defId: 'frame', pos: { x: 2, y: 0, z: 0 }, orient: 0, config: {} },
      ]),
      catalog(),
    );
    const withoutMiddleEdge = connections.filter((connection) => !(connection.aId === 'far' || connection.bId === 'far'));
    expect(computeIslands(['root', 'middle', 'far', 'single'], withoutMiddleEdge)).toEqual([
      ['root', 'middle'],
      ['far'],
      ['single'],
    ]);
  });

  it('excludes a floating part from root reachability and reports it disconnected', () => {
    const bp = blueprint([
      { id: 'root', defId: 'root', pos: { x: 0, y: 0, z: 0 }, orient: 0, config: {} },
      { id: 'floating', defId: 'frame', pos: { x: 4, y: 0, z: 0 }, orient: 0, config: {} },
    ]);
    const getDef = catalog();
    const connections = deriveConnections(bp, getDef);
    expect(reachableFromRoot(bp, connections, getDef)).toEqual(new Set(['root']));
    expect(disconnectedParts(bp, connections, getDef)).toEqual(['floating']);
  });
});
