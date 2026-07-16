import type { PartConfig, PlacedPart, Vec3i, VehicleBlueprint } from './types.ts';
import { BLUEPRINT_SCHEMA_VERSION } from './types.ts';
import { ORIENTATION_COUNT, orientationFromSteps } from './grid.ts';
import { getPartDef } from './parts.ts';

export const CURRENT_SCHEMA_VERSION = BLUEPRINT_SCHEMA_VERSION;

export class BlueprintFormatError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'BlueprintFormatError';
  }
}

type RawRecord = Record<string, unknown>;

export const MIGRATIONS: Record<number, (raw: unknown) => unknown> = {
  1: (raw: unknown): unknown => {
    const bp = requireRecord(raw, 'blueprint');
    const rawParts = requireArray(bp.parts, 'parts');
    return {
      ...bp,
      schemaVersion: 2,
      parts: rawParts.map((partRaw, index) => {
        const part = requireRecord(partRaw, `parts[${index}]`);
        const rotation = requireRecord(part.rotation, `parts[${index}].rotation`);
        return {
          id: part.id,
          defId: part.type,
          pos: part.pos,
          orient: orientationFromSteps(
            requireNumber(rotation.rx, `parts[${index}].rotation.rx`),
            requireNumber(rotation.ry, `parts[${index}].rotation.ry`),
            requireNumber(rotation.rz, `parts[${index}].rotation.rz`),
          ),
          config: part.config ?? {},
        };
      }),
    };
  },
};

export function serializeBlueprint(bp: VehicleBlueprint): string {
  validateBlueprint(bp);
  return JSON.stringify(bp);
}

export function deserializeBlueprint(json: string): VehicleBlueprint {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new BlueprintFormatError('invalid JSON');
  }

  raw = migrateToCurrent(raw);
  return validateBlueprint(raw);
}

function migrateToCurrent(raw: unknown): unknown {
  let current = raw;
  let version = requireSchemaVersion(current);
  while (version < CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS[version];
    if (migration === undefined) throw new BlueprintFormatError(`missing migration from schema version ${version}`);
    current = migration(current);
    version = requireSchemaVersion(current);
  }
  if (version !== CURRENT_SCHEMA_VERSION) throw new BlueprintFormatError(`unsupported schema version ${version}`);
  return current;
}

function validateBlueprint(raw: unknown): VehicleBlueprint {
  const bp = requireRecord(raw, 'blueprint');
  const schemaVersion = requireSchemaVersion(bp);
  if (schemaVersion !== CURRENT_SCHEMA_VERSION) throw new BlueprintFormatError(`unsupported schema version ${schemaVersion}`);
  const id = requireString(bp.id, 'id');
  const name = requireString(bp.name, 'name');
  const partsRaw = requireArray(bp.parts, 'parts');
  const seenIds = new Set<string>();
  const parts: PlacedPart[] = partsRaw.map((partRaw, index) => validatePart(partRaw, index, seenIds));
  return { schemaVersion, id, name, parts };
}

function validatePart(raw: unknown, index: number, seenIds: Set<string>): PlacedPart {
  const prefix = `parts[${index}]`;
  const part = requireRecord(raw, prefix);
  const id = requireString(part.id, `${prefix}.id`);
  if (seenIds.has(id)) throw new BlueprintFormatError(`duplicate part id: ${id}`);
  seenIds.add(id);

  const defId = requireString(part.defId, `${prefix}.defId`);
  try {
    getPartDef(defId);
  } catch {
    throw new BlueprintFormatError(`unknown defId: ${defId}`);
  }

  const pos = requireVec3i(part.pos, `${prefix}.pos`);
  const orient = requireNumber(part.orient, `${prefix}.orient`);
  if (!Number.isInteger(orient) || orient < 0 || orient >= ORIENTATION_COUNT) {
    throw new BlueprintFormatError(`orient outside 0..23: ${id}`);
  }

  const config = validateConfig(part.config, `${prefix}.config`);
  return { id, defId, pos, orient, config };
}

function validateConfig(raw: unknown, path: string): PartConfig {
  if (raw === undefined) return {};
  const config = requireRecord(raw, path);
  return { ...config } as PartConfig;
}

function requireSchemaVersion(raw: unknown): number {
  const bp = requireRecord(raw, 'blueprint');
  const version = requireNumber(bp.schemaVersion, 'schemaVersion');
  if (!Number.isInteger(version)) throw new BlueprintFormatError('schemaVersion must be an integer');
  return version;
}

function requireVec3i(raw: unknown, path: string): Vec3i {
  const vec = requireRecord(raw, path);
  const out = {
    x: requireNumber(vec.x, `${path}.x`),
    y: requireNumber(vec.y, `${path}.y`),
    z: requireNumber(vec.z, `${path}.z`),
  };
  if (!Number.isInteger(out.x) || !Number.isInteger(out.y) || !Number.isInteger(out.z)) {
    throw new BlueprintFormatError(`non-integer position: ${path}`);
  }
  return out;
}

function requireRecord(raw: unknown, path: string): RawRecord {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BlueprintFormatError(`missing fields: ${path}`);
  }
  return raw as RawRecord;
}

function requireArray(raw: unknown, path: string): unknown[] {
  if (!Array.isArray(raw)) throw new BlueprintFormatError(`missing fields: ${path}`);
  return raw;
}

function requireString(raw: unknown, path: string): string {
  if (typeof raw !== 'string') throw new BlueprintFormatError(`missing fields: ${path}`);
  return raw;
}

function requireNumber(raw: unknown, path: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new BlueprintFormatError(`missing fields: ${path}`);
  return raw;
}
