import { deserializeBlueprint } from './serialize.ts';
import type { VehicleBlueprint } from './types.ts';

export interface SavedRun {
  schemaVersion: 2;
  /** Wave the player resumes at (>= 1). */
  wave: number;
  kills: number;
  /** Money banked during this run so far. */
  bankedEarnings: number;
  blueprint: VehicleBlueprint;
  /** Per-part remaining HP at save time, keyed by blueprint part id. */
  partHp: Record<string, number>;
  /** Epoch ms, for display on the title screen. */
  savedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface RawSavedRun {
  schemaVersion: 1 | 2;
  wave: number;
  kills: number;
  bankedEarnings: number;
  blueprint: Record<string, unknown>;
  partHp: Record<string, unknown>;
  savedAt: number;
}

function normalizeShape(value: unknown): RawSavedRun | null {
  if (!isRecord(value)) return null;
  if (
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    typeof value.wave !== 'number' ||
    typeof value.kills !== 'number' ||
    !isRecord(value.blueprint) ||
    !isRecord(value.partHp) ||
    typeof value.savedAt !== 'number'
  ) {
    return null;
  }
  const bankedEarnings =
    value.schemaVersion === 1 ? value.moneyEarned : value.bankedEarnings;
  if (typeof bankedEarnings !== 'number') return null;
  return {
    schemaVersion: value.schemaVersion,
    wave: value.wave,
    kills: value.kills,
    bankedEarnings,
    blueprint: value.blueprint,
    partHp: value.partHp,
    savedAt: value.savedAt,
  };
}

/** Returns null rather than allowing malformed persisted data to escape. */
export function decodeSavedRun(json: string | null): SavedRun | null {
  if (json === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const normalized = normalizeShape(parsed);
  if (normalized === null) return null;
  if (
    !Number.isFinite(normalized.wave) ||
    !Number.isInteger(normalized.wave) ||
    normalized.wave < 1 ||
    !Number.isFinite(normalized.savedAt) ||
    normalized.savedAt < 0
  ) {
    return null;
  }

  let blueprint: VehicleBlueprint;
  try {
    blueprint = deserializeBlueprint(JSON.stringify(normalized.blueprint));
  } catch {
    return null;
  }

  const partIds = new Set(blueprint.parts.map((part) => part.id));
  const partHp = Object.fromEntries(
    Object.entries(normalized.partHp).filter(
      ([id, hp]) =>
        partIds.has(id) &&
        typeof hp === 'number' &&
        Number.isFinite(hp) &&
        hp >= 0,
    ),
  ) as Record<string, number>;

  return {
    schemaVersion: 2,
    wave: normalized.wave,
    kills:
      Number.isFinite(normalized.kills) && normalized.kills >= 0
        ? normalized.kills
        : 0,
    bankedEarnings:
      Number.isFinite(normalized.bankedEarnings) && normalized.bankedEarnings >= 0
        ? normalized.bankedEarnings
        : 0,
    blueprint,
    partHp,
    savedAt: normalized.savedAt,
  };
}

/** Serializes only the supported saved-run schema fields. */
export function encodeSavedRun(run: SavedRun): string {
  return JSON.stringify({
    schemaVersion: run.schemaVersion,
    wave: run.wave,
    kills: run.kills,
    bankedEarnings: run.bankedEarnings,
    blueprint: run.blueprint,
    partHp: run.partHp,
    savedAt: run.savedAt,
  });
}
