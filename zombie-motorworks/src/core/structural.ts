import type {
  PartDefinition,
  SocketType,
  StructuralConnection,
  VehicleBlueprint,
  Vec3i,
} from './types.ts';
import {
  addVec,
  cellKey,
  oppositeFace,
  rotateFace,
  rotateVec,
  worldCells,
} from './grid.ts';
import { FACE_VECTORS } from './grid.ts';

export const SOCKET_COMPAT: readonly [SocketType, SocketType][] = [
  ['frame', 'frame'],
];

export const CONNECTION_STRENGTH: Record<
  string,
  { maxForce: number; maxTorque: number }
> = {
  'frame-frame': { maxForce: 120000, maxTorque: 32000 },
};

export function socketsCompatible(a: SocketType, b: SocketType): boolean {
  return SOCKET_COMPAT.some(
    ([left, right]) =>
      (left === a && right === b) || (left === b && right === a),
  );
}

function definitionFor(
  getDef: (defId: string) => PartDefinition,
  defId: string,
): PartDefinition | undefined {
  try {
    return getDef(defId);
  } catch {
    return undefined;
  }
}

function strengthFor(
  a: SocketType,
  b: SocketType,
): { maxForce: number; maxTorque: number } | undefined {
  const pair = SOCKET_COMPAT.find(
    ([left, right]) =>
      (left === a && right === b) || (left === b && right === a),
  );
  return pair === undefined
    ? undefined
    : CONNECTION_STRENGTH[`${pair[0]}-${pair[1]}`];
}

function sameCell(a: Vec3i, b: Vec3i): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** Derives all compatible socket-to-socket structural edges for a blueprint. */
export function deriveConnections(
  bp: VehicleBlueprint,
  getDef: (defId: string) => PartDefinition,
): StructuralConnection[] {
  const entries = bp.parts.flatMap((part) => {
    const def = definitionFor(getDef, part.defId);
    return def === undefined ? [] : [{ part, def }];
  });
  const occupants = new Map<string, typeof entries>();
  for (const entry of entries) {
    for (const cell of worldCells(
      entry.def.cells,
      entry.part.pos,
      entry.part.orient,
    )) {
      const key = cellKey(cell);
      const atCell = occupants.get(key) ?? [];
      atCell.push(entry);
      occupants.set(key, atCell);
    }
  }

  const connections: StructuralConnection[] = [];
  const seen = new Set<string>();
  const addConnection = (
    left: (typeof entries)[number],
    leftSocket: PartDefinition['sockets'][number],
    right: (typeof entries)[number],
    rightSocket: PartDefinition['sockets'][number],
  ) => {
    if (
      left.part.id === right.part.id ||
      !socketsCompatible(leftSocket.type, rightSocket.type)
    )
      return;
    const strength = strengthFor(leftSocket.type, rightSocket.type);
    if (strength === undefined) return;
    const leftFirst = left.part.id < right.part.id;
    const a = leftFirst ? left : right;
    const b = leftFirst ? right : left;
    const aSocket = leftFirst ? leftSocket : rightSocket;
    const bSocket = leftFirst ? rightSocket : leftSocket;
    const key = `${a.part.id}\u0000${aSocket.id}\u0000${b.part.id}\u0000${bSocket.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const reinforcement = Math.min(
      left.def.reinforcement,
      right.def.reinforcement,
    );
    connections.push({
      aId: a.part.id,
      bId: b.part.id,
      aSocketId: aSocket.id,
      bSocketId: bSocket.id,
      maxForce: strength.maxForce * reinforcement,
      maxTorque: strength.maxTorque * reinforcement,
      health: 1,
    });
  };

  for (const entry of entries) {
    const isFaceMounted = entry.def.cells.length === 0;
    for (const socket of entry.def.sockets) {
      const socketCell = addVec(
        entry.part.pos,
        rotateVec(entry.part.orient, socket.cell),
      );
      const socketFace = rotateFace(entry.part.orient, socket.face);

      if (isFaceMounted) {
        for (const host of occupants.get(cellKey(entry.part.pos)) ?? []) {
          for (const hostSocket of host.def.sockets) {
            const hostCell = addVec(
              host.part.pos,
              rotateVec(host.part.orient, hostSocket.cell),
            );
            if (
              sameCell(hostCell, entry.part.pos) &&
              rotateFace(host.part.orient, hostSocket.face) === socketFace
            ) {
              addConnection(entry, socket, host, hostSocket);
            }
          }
        }
        continue;
      }

      const targetCell = addVec(socketCell, FACE_VECTORS[socketFace]);
      for (const target of occupants.get(cellKey(targetCell)) ?? []) {
        for (const targetSocket of target.def.sockets) {
          const targetSocketCell = addVec(
            target.part.pos,
            rotateVec(target.part.orient, targetSocket.cell),
          );
          if (
            sameCell(targetSocketCell, targetCell) &&
            rotateFace(target.part.orient, targetSocket.face) ===
              oppositeFace(socketFace)
          ) {
            addConnection(entry, socket, target, targetSocket);
          }
        }
      }
    }
  }
  return connections;
}

export function buildAdjacency(
  connections: readonly StructuralConnection[],
): Map<string, StructuralConnection[]> {
  const adjacency = new Map<string, StructuralConnection[]>();
  for (const connection of connections) {
    const aConnections = adjacency.get(connection.aId) ?? [];
    aConnections.push(connection);
    adjacency.set(connection.aId, aConnections);
    const bConnections = adjacency.get(connection.bId) ?? [];
    bConnections.push(connection);
    adjacency.set(connection.bId, bConnections);
  }
  return adjacency;
}

export function reachableFromRoot(
  bp: VehicleBlueprint,
  connections: readonly StructuralConnection[],
  getDef: (defId: string) => PartDefinition,
): Set<string> {
  const root = bp.parts.find(
    (part) => definitionFor(getDef, part.defId)?.isRoot,
  );
  if (root === undefined) return new Set();
  const adjacency = buildAdjacency(connections);
  const reachable = new Set([root.id]);
  const queue = [root.id];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const connection of adjacency.get(id) ?? []) {
      const neighbour = connection.aId === id ? connection.bId : connection.aId;
      if (!reachable.has(neighbour)) {
        reachable.add(neighbour);
        queue.push(neighbour);
      }
    }
  }
  return reachable;
}

export function computeIslands(
  partIds: string[],
  connections: readonly StructuralConnection[],
): string[][] {
  const parent = new Map(partIds.map((id) => [id, id]));
  const find = (id: string): string => {
    const current = parent.get(id);
    if (current === undefined || current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const join = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  for (const connection of connections) {
    if (parent.has(connection.aId) && parent.has(connection.bId))
      join(connection.aId, connection.bId);
  }
  const islands = new Map<string, string[]>();
  for (const id of partIds) {
    const root = find(id);
    const island = islands.get(root) ?? [];
    island.push(id);
    islands.set(root, island);
  }
  return [...islands.values()];
}

export function disconnectedParts(
  bp: VehicleBlueprint,
  connections: readonly StructuralConnection[],
  getDef: (defId: string) => PartDefinition,
): string[] {
  const reachable = reachableFromRoot(bp, connections, getDef);
  return bp.parts
    .filter((part) => !reachable.has(part.id))
    .map((part) => part.id);
}
