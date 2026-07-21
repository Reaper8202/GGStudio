import { deserializeBlueprint } from './serialize.ts';
import type { VehicleBlueprint } from './types.ts';

export interface SavedRun {
  schemaVersion: 1;
  /** Wave the player resumes at (>= 1). */
  wave: number;
  kills: number;
  /** Money banked during this run so far. */
  moneyEarned: number;
  blueprint: VehicleBlueprint;
  /** Per-part remaining HP at save time, keyed by blueprint part id. */
  partHp: Record<string, number>;
  /** Epoch ms, for display on the title screen. */
  savedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasValidShape(value: unknown): value is {
  schemaVersion: 1;
  wave: number;
  kills: number;
  moneyEarned: number;
  blueprint: Record<string, unknown>;
  partHp: Record<string, unknown>;
  savedAt: number;
} {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1 || typeof value.wave !== 'number') return false;
  if (
    typeof value.kills !== 'number' ||
    typeof value.moneyEarned !== 'number'
  ) {
    return false;
  }
  if (!isRecord(value.blueprint) || !isRecord(value.partHp)) return false;
  return typeof value.savedAt === 'number';
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

  if (!hasValidShape(parsed)) return null;
  if (
    !Number.isFinite(parsed.wave) ||
    !Number.isInteger(parsed.wave) ||
    parsed.wave < 1 ||
    !Number.isFinite(parsed.savedAt) ||
    parsed.savedAt < 0
  ) {
    return null;
  }

  let blueprint: VehicleBlueprint;
  try {
    blueprint = deserializeBlueprint(JSON.stringify(parsed.blueprint));
  } catch {
    return null;
  }

  const partIds = new Set(blueprint.parts.map((part) => part.id));
  const partHp = Object.fromEntries(
    Object.entries(parsed.partHp).filter(
      ([id, hp]) =>
        partIds.has(id) &&
        typeof hp === 'number' &&
        Number.isFinite(hp) &&
        hp >= 0,
    ),
  ) as Record<string, number>;

  return {
    schemaVersion: 1,
    wave: parsed.wave,
    kills:
      Number.isFinite(parsed.kills) && parsed.kills >= 0 ? parsed.kills : 0,
    moneyEarned:
      Number.isFinite(parsed.moneyEarned) && parsed.moneyEarned >= 0
        ? parsed.moneyEarned
        : 0,
    blueprint,
    partHp,
    savedAt: parsed.savedAt,
  };
}

/** Serializes only the supported saved-run schema fields. */
export function encodeSavedRun(run: SavedRun): string {
  return JSON.stringify({
    schemaVersion: run.schemaVersion,
    wave: run.wave,
    kills: run.kills,
    moneyEarned: run.moneyEarned,
    blueprint: run.blueprint,
    partHp: run.partHp,
    savedAt: run.savedAt,
  });
}
