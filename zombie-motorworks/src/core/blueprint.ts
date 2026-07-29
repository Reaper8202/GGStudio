import type { OrientationIndex, PlacedPart, VehicleBlueprint } from './types.ts';
import { BLUEPRINT_SCHEMA_VERSION } from './types.ts';
import { cellKey, rotateFace, worldCells } from './grid.ts';
import { getPartDef } from './parts.ts';

let blueprintCounter = 0;

export function createEmptyBlueprint(name: string): VehicleBlueprint {
  blueprintCounter += 1;
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    id: `bp-${Date.now()}-${blueprintCounter}`,
    name,
    parts: [],
  };
}

export function nextPartId(bp: VehicleBlueprint): string {
  let max = 0;
  for (const part of bp.parts) {
    const match = /^p(\d+)$/.exec(part.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `p${max + 1}`;
}

export function withPartAdded(bp: VehicleBlueprint, part: PlacedPart): VehicleBlueprint {
  return { ...bp, parts: [...bp.parts, { ...part, pos: { ...part.pos }, config: { ...part.config } }] };
}

export function withPartRemoved(bp: VehicleBlueprint, id: string): VehicleBlueprint {
  return { ...bp, parts: bp.parts.filter((part) => part.id !== id) };
}

/** Keeps only parts reported as surviving a runtime wave. */
export function pruneBlueprintToSurvivors(
  bp: VehicleBlueprint,
  survivingPartIds: Iterable<string>,
): VehicleBlueprint {
  const survivors = new Set(survivingPartIds);
  return {
    ...bp,
    parts: bp.parts
      .filter((part) => survivors.has(part.id))
      .map((part) => ({
        ...part,
        pos: { ...part.pos },
        config: { ...part.config },
      })),
  };
}

export function withPartUpdated(
  bp: VehicleBlueprint,
  id: string,
  update: Partial<PlacedPart> | ((part: PlacedPart) => PlacedPart),
): VehicleBlueprint {
  return {
    ...bp,
    parts: bp.parts.map((part) => {
      if (part.id !== id) return part;
      const next = typeof update === 'function' ? update(part) : { ...part, ...update };
      return { ...next, pos: { ...next.pos }, config: { ...next.config } };
    }),
  };
}

export function getPart(bp: VehicleBlueprint, id: string): PlacedPart | undefined {
  return bp.parts.find((part) => part.id === id);
}

export function buildOccupancy(bp: VehicleBlueprint): Map<string, string> {
  const occupancy = new Map<string, string>();
  for (const part of bp.parts) {
    const def = getPartDef(part.defId);
    for (const cell of worldCells(def.cells, part.pos, part.orient)) {
      occupancy.set(cellKey(cell), part.id);
    }
  }
  return occupancy;
}

export function buildArmourFaces(bp: VehicleBlueprint): Map<string, string> {
  const faces = new Map<string, string>();
  for (const part of bp.parts) {
    const def = getPartDef(part.defId);
    if (def.armour?.faceMounted !== true) continue;
    for (const socket of def.sockets) {
      if (socket.type !== 'armour') continue;
      const face = rotateFace(part.orient as OrientationIndex, socket.face);
      faces.set(`${cellKey(part.pos)}|${face}`, part.id);
    }
  }
  return faces;
}

export function findRoot(bp: VehicleBlueprint): PlacedPart | undefined {
  return bp.parts.find((part) => getPartDef(part.defId).isRoot === true);
}

export function hasEngine(bp: VehicleBlueprint): boolean {
  return bp.parts.some((part) => getPartDef(part.defId).engine !== undefined);
}
