import type {
  PartConfig,
  PartDefinition,
  PlacementResult,
  PlacedPart,
  ValidationIssue,
  ValidationReport,
  VehicleBlueprint,
  Vec3i,
} from './types.ts';
import {
  cellInBounds,
  cellKey,
  ORIENTATION_COUNT,
  worldCells,
} from './grid.ts';
import { deriveConnections } from './structural.ts';

type Catalog = (defId: string) => PartDefinition;

function getDefinition(
  getDef: Catalog,
  defId: string,
): PartDefinition | undefined {
  try {
    return getDef(defId);
  } catch {
    return undefined;
  }
}

function issue(
  code: string,
  message: string,
  partIds: string[] = [],
  cells: Vec3i[] = [],
  suggestion?: string,
  severity: ValidationIssue['severity'] = 'error',
): ValidationIssue {
  return {
    severity,
    code,
    message,
    partIds,
    cells,
    ...(suggestion === undefined ? {} : { suggestion }),
  };
}

function usableOrientation(part: PlacedPart): number {
  return Number.isInteger(part.orient) &&
    part.orient >= 0 &&
    part.orient < ORIENTATION_COUNT
    ? part.orient
    : 0;
}

function occupiedCells(def: PartDefinition, part: PlacedPart): Vec3i[] {
  return worldCells(def.cells, part.pos, usableOrientation(part));
}

function clearanceCells(def: PartDefinition, part: PlacedPart): Vec3i[] {
  return worldCells(def.clearanceCells, part.pos, usableOrientation(part));
}

function cellsForBounds(def: PartDefinition, part: PlacedPart): Vec3i[] {
  const cells = occupiedCells(def, part);
  return cells.length === 0 ? [part.pos] : cells;
}

function buildOccupancy(
  bp: VehicleBlueprint,
  getDef: Catalog,
): Map<string, string[]> {
  const occupancy = new Map<string, string[]>();
  for (const part of bp.parts) {
    const def = getDefinition(getDef, part.defId);
    if (def === undefined) continue;
    for (const cell of occupiedCells(def, part)) {
      const key = cellKey(cell);
      const ids = occupancy.get(key) ?? [];
      ids.push(part.id);
      occupancy.set(key, ids);
    }
  }
  return occupancy;
}

function existingClearance(
  bp: VehicleBlueprint,
  getDef: Catalog,
): Map<string, string[]> {
  const clearance = new Map<string, string[]>();
  for (const part of bp.parts) {
    const def = getDefinition(getDef, part.defId);
    if (def === undefined) continue;
    for (const cell of clearanceCells(def, part)) {
      const key = cellKey(cell);
      const ids = clearance.get(key) ?? [];
      ids.push(part.id);
      clearance.set(key, ids);
    }
  }
  return clearance;
}

function candidateId(bp: VehicleBlueprint): string {
  let id = '__placement_candidate__';
  while (bp.parts.some((part) => part.id === id)) id = `_${id}`;
  return id;
}

function result(issues: ValidationIssue[]): PlacementResult {
  return { ok: !issues.some((entry) => entry.severity === 'error'), issues };
}

export function canPlacePart(
  bp: VehicleBlueprint,
  getDef: Catalog,
  defId: string,
  pos: Vec3i,
  orient: number,
  config: PartConfig = {},
): PlacementResult {
  const def = getDefinition(getDef, defId);
  if (def === undefined) {
    return result([
      issue(
        'INVALID_DEF',
        `Unknown part definition "${defId}".`,
        [],
        [pos],
        'Choose a part from the catalog.',
      ),
    ]);
  }
  const candidate: PlacedPart = {
    id: candidateId(bp),
    defId,
    pos,
    orient,
    config,
  };
  const issues: ValidationIssue[] = [];
  const validOrientation =
    Number.isInteger(orient) && orient >= 0 && orient < ORIENTATION_COUNT;

  if (
    !validOrientation ||
    (def.allowedOrientations !== undefined &&
      !def.allowedOrientations.includes(orient))
  ) {
    issues.push(
      issue(
        'ORIENTATION_NOT_ALLOWED',
        'This part cannot use that orientation.',
        [],
        [pos],
        'Rotate the part to an allowed orientation.',
      ),
    );
  }

  const candidateCells = occupiedCells(def, candidate);
  const boundsCells = cellsForBounds(def, candidate);
  const outOfBounds = boundsCells.filter((cell) => !cellInBounds(cell));
  if (outOfBounds.length > 0) {
    issues.push(
      issue(
        'OUT_OF_BOUNDS',
        'Part extends outside the build grid.',
        [],
        outOfBounds,
        'Move the part inside the grid bounds.',
      ),
    );
  }

  const occupancy = buildOccupancy(bp, getDef);
  const overlapCells = candidateCells.filter((cell) =>
    occupancy.has(cellKey(cell)),
  );
  if (overlapCells.length > 0) {
    const ids = [
      ...new Set(
        overlapCells.flatMap((cell) => occupancy.get(cellKey(cell)) ?? []),
      ),
    ];
    issues.push(
      issue(
        'OVERLAP',
        'Part overlaps an occupied grid cell.',
        ids,
        overlapCells,
        'Choose unoccupied cells.',
      ),
    );
  }

  if (def.unique && bp.parts.some((part) => part.defId === defId)) {
    issues.push(
      issue(
        'UNIQUE_VIOLATION',
        'Only one instance of this part is allowed.',
        [],
        [],
        'Remove the existing unique part first.',
      ),
    );
  }
  if (
    def.isRoot &&
    bp.parts.some((part) => getDefinition(getDef, part.defId)?.isRoot)
  ) {
    issues.push(
      issue(
        'ROOT_DUPLICATE',
        'A vehicle can have only one root chassis.',
        [],
        [],
        'Remove the existing root chassis first.',
      ),
    );
  }

  const candidateClearance = clearanceCells(def, candidate);
  const blockedClearance = candidateClearance.filter((cell) =>
    occupancy.has(cellKey(cell)),
  );
  if (blockedClearance.length > 0) {
    const ids = [
      ...new Set(
        blockedClearance.flatMap((cell) => occupancy.get(cellKey(cell)) ?? []),
      ),
    ];
    issues.push(
      issue(
        'CLEARANCE_BLOCKED',
        'Required clearance volume is occupied.',
        ids,
        blockedClearance,
        'Clear the required clearance cells.',
      ),
    );
  }
  const clearance = existingClearance(bp, getDef);
  const clearanceViolations = candidateCells.filter((cell) =>
    clearance.has(cellKey(cell)),
  );
  if (clearanceViolations.length > 0) {
    const ids = [
      ...new Set(
        clearanceViolations.flatMap(
          (cell) => clearance.get(cellKey(cell)) ?? [],
        ),
      ),
    ];
    issues.push(
      issue(
        'CLEARANCE_VIOLATION',
        'Part occupies another part’s required clearance volume.',
        ids,
        clearanceViolations,
        'Move the part outside that clearance volume.',
      ),
    );
  }

  const hypothetical: VehicleBlueprint = {
    ...bp,
    parts: [...bp.parts, candidate],
  };
  const connections = deriveConnections(hypothetical, getDef);
  const candidateConnections = connections.filter(
    (connection) =>
      connection.aId === candidate.id || connection.bId === candidate.id,
  );
  if (
    !(def.isRoot && bp.parts.length === 0) &&
    candidateConnections.length === 0
  ) {
    issues.push(
      issue(
        'NO_CONNECTION',
        'Part does not form a structural connection.',
        [],
        boundsCells,
        'Attach a compatible socket to the vehicle.',
      ),
    );
  }
  return result(issues);
}

export function canRemovePart(
  bp: VehicleBlueprint,
  getDef: Catalog,
  partId: string,
): PlacementResult {
  const part = bp.parts.find((candidate) => candidate.id === partId);
  const def =
    part === undefined ? undefined : getDefinition(getDef, part.defId);
  if (part !== undefined && def?.isRoot) {
    return result([
      issue(
        'REMOVE_ROOT',
        'The root chassis cannot be removed.',
        [partId],
        [],
        'Remove the other parts or start a new blueprint.',
      ),
    ]);
  }
  return result([]);
}

export function validateBlueprint(
  bp: VehicleBlueprint,
  getDef: Catalog,
): ValidationReport {
  const errors: ValidationIssue[] = [];
  const knownParts: { part: PlacedPart; def: PartDefinition }[] = [];
  const occupancy = new Map<string, string[]>();

  for (const part of bp.parts) {
    const def = getDefinition(getDef, part.defId);
    if (def === undefined) {
      errors.push(
        issue(
          'INVALID_DEF',
          `Unknown part definition "${part.defId}".`,
          [part.id],
          [part.pos],
          'Choose a catalog part.',
        ),
      );
      continue;
    }
    knownParts.push({ part, def });
    const outOfBounds = cellsForBounds(def, part).filter(
      (cell) => !cellInBounds(cell),
    );
    if (outOfBounds.length > 0) {
      errors.push(
        issue(
          'OUT_OF_BOUNDS',
          'Part extends outside the build grid.',
          [part.id],
          outOfBounds,
          'Move the part inside the grid bounds.',
        ),
      );
    }
    const overlapping = occupiedCells(def, part).filter((cell) =>
      occupancy.has(cellKey(cell)),
    );
    if (overlapping.length > 0) {
      const ids = [
        ...new Set([
          part.id,
          ...overlapping.flatMap((cell) => occupancy.get(cellKey(cell)) ?? []),
        ]),
      ];
      errors.push(
        issue(
          'OVERLAP',
          'Parts overlap in the occupancy grid.',
          ids,
          overlapping,
          'Separate the overlapping parts.',
        ),
      );
    }
    for (const cell of occupiedCells(def, part)) {
      const key = cellKey(cell);
      const ids = occupancy.get(key) ?? [];
      ids.push(part.id);
      occupancy.set(key, ids);
    }
  }

  const roots = knownParts.filter(({ def }) => def.isRoot);
  if (roots.length === 0)
    errors.push(
      issue(
        'NO_ROOT',
        'Vehicle has no root chassis.',
        [],
        [],
        'Add a root chassis.',
      ),
    );
  if (!knownParts.some(({ def }) => def.providesControl)) {
    errors.push(
      issue(
        'NO_CONTROL',
        'Vehicle has no control part.',
        [],
        [],
        'Add a driver seat or cab.',
      ),
    );
  }
  if (!knownParts.some(({ def }) => def.engine !== undefined)) {
    errors.push(
      issue(
        'NO_PROPULSION',
        'Vehicle has no propulsion source.',
        [],
        [],
        'Add an engine.',
      ),
    );
  }

  const connections = deriveConnections(bp, getDef);
  if (roots.length > 0) {
    const reachable = new Set<string>([roots[0].part.id]);
    const queue = [roots[0].part.id];
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      for (const connection of connections) {
        const neighbour =
          connection.aId === id
            ? connection.bId
            : connection.bId === id
              ? connection.aId
              : undefined;
        if (neighbour !== undefined && !reachable.has(neighbour)) {
          reachable.add(neighbour);
          queue.push(neighbour);
        }
      }
    }
    const disconnected = knownParts
      .filter(({ part }) => !reachable.has(part.id))
      .map(({ part }) => part.id);
    if (disconnected.length > 0) {
      errors.push(
        issue(
          'DISCONNECTED',
          'Some parts are not connected to the root chassis.',
          disconnected,
          [],
          'Connect every part to the root chassis.',
        ),
      );
    }
  }

  return { errors, warnings: [], infos: [] };
}
