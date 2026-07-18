import { PART_CATALOG } from './parts.ts';

export interface PlayerProfile {
  schemaVersion: 1;
  money: number;
  unlockedDefIds: string[];
  /** Purchased, unplaced garage parts keyed by catalog definition id. */
  inventory?: Record<string, number>;
  currentBlueprintName?: string;
}

export const STARTER_UNLOCKS = [
  'chassis-core',
  'frame-box',
  'wheel-standard',
  'driver-seat',
  'engine-small',
  'fuel-tank',
  'turret',
] as const;

export const DEFAULT_MONEY = 200;

export function defaultProfile(): PlayerProfile {
  return {
    schemaVersion: 1,
    money: DEFAULT_MONEY,
    unlockedDefIds: [...STARTER_UNLOCKS],
    inventory: {
      'frame-box': 4,
      'wheel-standard': 4,
      'driver-seat': 1,
      'engine-small': 1,
      'fuel-tank': 1,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasValidShape(value: unknown): value is {
  schemaVersion: 1;
  money: number;
  unlockedDefIds: string[];
  inventory?: Record<string, unknown>;
  currentBlueprintName?: string;
} {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1 || typeof value.money !== 'number') return false;
  if (!Array.isArray(value.unlockedDefIds)) return false;
  if (!value.unlockedDefIds.every((id) => typeof id === 'string')) return false;
  if (value.inventory !== undefined && !isRecord(value.inventory)) return false;
  return (
    value.currentBlueprintName === undefined ||
    typeof value.currentBlueprintName === 'string'
  );
}

/** Decodes persisted profile JSON without allowing malformed storage to escape. */
export function decodeProfile(json: string | null | undefined): PlayerProfile {
  if (json === null || json === undefined) return defaultProfile();

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return defaultProfile();
  }

  if (!hasValidShape(parsed) || !Number.isSafeInteger(parsed.money)) {
    return defaultProfile();
  }

  const profile: PlayerProfile = {
    schemaVersion: 1,
    money: Math.max(0, parsed.money),
    unlockedDefIds: [
      ...new Set([
        ...STARTER_UNLOCKS,
        ...parsed.unlockedDefIds.filter((id) => PART_CATALOG[id] !== undefined),
      ]),
    ],
    inventory: Object.fromEntries(
      Object.entries(parsed.inventory ?? {}).filter(
        ([id, count]) =>
          PART_CATALOG[id] !== undefined &&
          typeof count === 'number' &&
          Number.isSafeInteger(count) &&
          count > 0,
      ),
    ) as Record<string, number>,
  };
  if (parsed.currentBlueprintName !== undefined) {
    profile.currentBlueprintName = parsed.currentBlueprintName;
  }
  return profile;
}

/** Serializes only the supported profile schema fields. */
export function encodeProfile(profile: PlayerProfile): string {
  return JSON.stringify({
    schemaVersion: profile.schemaVersion,
    money: profile.money,
    unlockedDefIds: profile.unlockedDefIds,
    inventory: profile.inventory ?? {},
    ...(profile.currentBlueprintName === undefined
      ? {}
      : { currentBlueprintName: profile.currentBlueprintName }),
  });
}
