import { isBiomeId, type BiomeId } from './biomes.ts';
import { randomSeed } from './rng.ts';
import { deserializeBlueprint } from './serialize.ts';
import type { VehicleBlueprint } from './types.ts';

/** Persisted wave-start checkpoint for a survival run. */
export interface SavedRun {
  schemaVersion: 5;
  phase: 'wave' | 'build';
  activeWave: number;
  /** Arcade score accumulated across the run. */
  score: number;
  /** Wave the player resumes at (>= 1). */
  wave: number;
  kills: number;
  biomeId: BiomeId;
  seed: number;
  /** Money banked during this run so far. */
  bankedEarnings: number;
  /** Arena seconds played so far. 0 on saves written before run timing. */
  elapsedSeconds: number;
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
  schemaVersion: 1 | 2 | 3 | 4 | 5;
  score: unknown;
  wave: number;
  kills: number;
  biomeId: unknown;
  seed: unknown;
  bankedEarnings: number;
  elapsedSeconds: unknown;
  blueprint: Record<string, unknown>;
  partHp: Record<string, unknown>;
  savedAt: number;
  phase: unknown;
  activeWave: unknown;
}

function normalizeShape(value: unknown): RawSavedRun | null {
  if (!isRecord(value)) return null;
  if (
    (value.schemaVersion !== 1 &&
      value.schemaVersion !== 2 &&
      value.schemaVersion !== 3 &&
      value.schemaVersion !== 4 &&
      value.schemaVersion !== 5) ||
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
    score: value.schemaVersion >= 3 ? value.score : 0,
    wave: value.wave,
    kills: value.kills,
    biomeId: value.schemaVersion >= 4 ? value.biomeId : undefined,
    seed: value.schemaVersion >= 4 ? value.seed : undefined,
    bankedEarnings,
    // Added after schema 4 shipped, so saves written before it simply omit it.
    elapsedSeconds: value.elapsedSeconds,
    blueprint: value.blueprint,
    partHp: value.partHp,
    savedAt: value.savedAt,
    phase: value.schemaVersion === 5 ? value.phase : 'wave',
    activeWave: value.schemaVersion === 5 ? value.activeWave : value.wave,
  };
}

const DEFAULT_BIOME_ID: BiomeId = 'graveyard';

function normalizeBiomeId(value: unknown): BiomeId {
  return isBiomeId(value) ? value : DEFAULT_BIOME_ID;
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
    schemaVersion: 5,
    phase: normalized.phase === 'build' ? 'build' : 'wave',
    activeWave:
      typeof normalized.activeWave === 'number' &&
      Number.isFinite(normalized.activeWave) &&
      Number.isInteger(normalized.activeWave) &&
      normalized.activeWave >= 1
        ? normalized.activeWave
        : normalized.wave,
    score:
      typeof normalized.score === 'number' &&
      Number.isSafeInteger(normalized.score) &&
      normalized.score >= 0
        ? normalized.score
        : 0,
    wave: normalized.wave,
    kills:
      Number.isFinite(normalized.kills) && normalized.kills >= 0
        ? normalized.kills
        : 0,
    biomeId: normalizeBiomeId(normalized.biomeId),
    seed:
      typeof normalized.seed === 'number' &&
      Number.isFinite(normalized.seed)
        ? normalized.seed
        : randomSeed(),
    bankedEarnings:
      Number.isFinite(normalized.bankedEarnings) &&
      normalized.bankedEarnings >= 0
        ? normalized.bankedEarnings
        : 0,
    elapsedSeconds:
      typeof normalized.elapsedSeconds === 'number' &&
      Number.isFinite(normalized.elapsedSeconds) &&
      normalized.elapsedSeconds >= 0
        ? normalized.elapsedSeconds
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
    phase: run.phase,
    activeWave: run.activeWave,
    score: run.score,
    wave: run.wave,
    kills: run.kills,
    biomeId: run.biomeId,
    seed: run.seed,
    bankedEarnings: run.bankedEarnings,
    elapsedSeconds: run.elapsedSeconds,
    blueprint: run.blueprint,
    partHp: run.partHp,
    savedAt: run.savedAt,
  });
}
