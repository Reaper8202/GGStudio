import { isBiomeId, type BiomeId } from './biomes.ts';
import { ORIENTATION_COUNT } from './grid.ts';
import { getPartDef } from './parts.ts';
import { randomSeed } from './rng.ts';
import { deserializeBlueprint } from './serialize.ts';
import { SUSPENSION_PRESET_MULTIPLIERS, PAINT_COLORS } from './types.ts';
import type { PartConfig, PlacedPart, VehicleBlueprint } from './types.ts';
import { BENCHED_ABILITY_SLOT, MAX_ABILITY_SLOTS } from './abilities.ts';

/** Persisted wave-start checkpoint for a survival run. */
export interface SavedRun {
  schemaVersion: 6;
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
  /** Parts destroyed in a prior wave, not yet bought back. 0 on saves written before Rebuild Car. */
  missingParts: PlacedPart[];
  /** Epoch ms, for display on the title screen. */
  savedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface RawSavedRun {
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6;
  score: unknown;
  wave: number;
  kills: number;
  biomeId: unknown;
  seed: unknown;
  bankedEarnings: number;
  elapsedSeconds: unknown;
  blueprint: Record<string, unknown>;
  partHp: Record<string, unknown>;
  missingParts: unknown;
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
      value.schemaVersion !== 5 &&
      value.schemaVersion !== 6) ||
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
    // Added after schema 5 shipped, so saves written before it simply omit it.
    missingParts: value.schemaVersion >= 6 ? value.missingParts : [],
    savedAt: value.savedAt,
    phase: value.schemaVersion >= 5 ? value.phase : 'wave',
    activeWave: value.schemaVersion >= 5 ? value.activeWave : value.wave,
  };
}

const DEFAULT_BIOME_ID: BiomeId = 'graveyard';

function normalizeBiomeId(value: unknown): BiomeId {
  return isBiomeId(value) ? value : DEFAULT_BIOME_ID;
}

function sanitizeMissingPartConfig(
  raw: unknown,
  maxLevel: number | undefined,
): PartConfig {
  if (!isRecord(raw)) return {};
  const config: PartConfig = {};
  const level = raw.level;
  if (
    typeof level === 'number' &&
    Number.isInteger(level) &&
    level >= 1
  ) {
    config.level = Math.min(level, maxLevel ?? 1);
  }
  for (const key of [
    'driven',
    'steering',
    'steerInverted',
    'braking',
    'activeAbility',
  ] as const) {
    if (typeof raw[key] === 'boolean') config[key] = raw[key];
  }
  const abilitySlot = raw.abilitySlot;
  if (
    typeof abilitySlot === 'number' &&
    Number.isInteger(abilitySlot) &&
    abilitySlot >= BENCHED_ABILITY_SLOT &&
    abilitySlot < MAX_ABILITY_SLOTS
  ) {
    config.abilitySlot = abilitySlot;
  }
  if (
    typeof raw.suspensionPreset === 'string' &&
    raw.suspensionPreset in SUSPENSION_PRESET_MULTIPLIERS
  ) {
    config.suspensionPreset =
      raw.suspensionPreset as PartConfig['suspensionPreset'];
  }
  if (typeof raw.paint === 'string' && raw.paint in PAINT_COLORS) {
    config.paint = raw.paint as PartConfig['paint'];
  }
  return config;
}

/**
 * Drops any entry that is malformed, references an unknown catalog part, or
 * collides with a part id already present on the live blueprint — a
 * "missing" part can only describe a gap, never an occupied slot.
 */
function sanitizeMissingParts(
  raw: unknown,
  liveIds: ReadonlySet<string>,
): PlacedPart[] {
  if (!Array.isArray(raw)) return [];
  const seenIds = new Set<string>();
  const parts: PlacedPart[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { id, defId, pos, orient } = entry;
    if (typeof id !== 'string' || liveIds.has(id) || seenIds.has(id)) continue;
    if (typeof defId !== 'string') continue;
    let def: ReturnType<typeof getPartDef>;
    try {
      def = getPartDef(defId);
    } catch {
      continue;
    }
    if (!isRecord(pos)) continue;
    const { x, y, z } = pos;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof z !== 'number' ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      !Number.isInteger(z)
    ) {
      continue;
    }
    if (
      typeof orient !== 'number' ||
      !Number.isInteger(orient) ||
      orient < 0 ||
      orient >= ORIENTATION_COUNT
    ) {
      continue;
    }
    seenIds.add(id);
    parts.push({
      id,
      defId,
      pos: { x, y, z },
      orient,
      config: sanitizeMissingPartConfig(entry.config, def.upgrade?.maxLevel),
    });
  }
  return parts;
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
  const missingParts = sanitizeMissingParts(normalized.missingParts, partIds);

  return {
    schemaVersion: 6,
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
    missingParts,
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
    missingParts: run.missingParts,
    savedAt: run.savedAt,
  });
}
