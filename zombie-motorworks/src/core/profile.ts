import { isBiomeId, type BiomeId } from './biomes.ts';
import { PART_CATALOG } from './parts.ts';

export interface PlayerProfile {
  schemaVersion: 1;
  money: number;
  unlockedDefIds: string[];
  /** Purchased, unplaced garage parts keyed by catalog definition id. */
  inventory?: Record<string, number>;
  /**
   * Block types the player put on the build bar, in slot order. Undefined
   * means they have never curated one and it should be seeded from inventory.
   */
  hotbarDefIds?: string[];
  currentBlueprintName?: string;
  /**
   * Map the player last chose on the title screen. It seeds the next run only;
   * a run already in flight keeps the biome recorded on its checkpoint.
   */
  preferredBiomeId?: BiomeId;
  /** Highest wave the player has ever fully cleared. */
  highestWaveCleared?: number;
  /** Lifetime Phone Addict kills; gates the EMP module. */
  phoneAddictsKilled?: number;
}

export const STARTER_UNLOCKS = [
  'chassis-core',
  'frame-box',
  'wheel-standard',
  'engine-small',
  'fuel-tank',
  'turret',
  'spike-ram',
  'sawblade',
  'armour-plate',
  // Flamethrower is one of the three weapons the new-game prompt offers, so
  // it needs to be buyable at just its shelf price with no separate unlock
  // fee from turn one — see WeaponPromptPreview.
  'flamethrower',
] as const;

export const DEFAULT_MONEY = 200;

/** Wave clear that unlocks the Mine Sweeper for purchase. */
export const MINE_SWEEPER_UNLOCK_WAVE = 7;

export function defaultProfile(): PlayerProfile {
  return {
    schemaVersion: 1,
    money: DEFAULT_MONEY,
    unlockedDefIds: [...STARTER_UNLOCKS],
    // A new garage starts bare: every block is bought from the store, so the
    // build bar starts empty too.
    inventory: {},
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
  hotbarDefIds?: unknown;
  currentBlueprintName?: string;
  preferredBiomeId?: unknown;
  highestWaveCleared?: unknown;
  phoneAddictsKilled?: unknown;
} {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1 || typeof value.money !== 'number')
    return false;
  if (!Array.isArray(value.unlockedDefIds)) return false;
  if (!value.unlockedDefIds.every((id) => typeof id === 'string')) return false;
  if (value.inventory !== undefined && !isRecord(value.inventory)) return false;
  return (
    value.currentBlueprintName === undefined ||
    typeof value.currentBlueprintName === 'string'
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
  if (Array.isArray(parsed.hotbarDefIds)) {
    // An empty saved bar is a real choice, so it survives decoding; only a
    // missing field falls back to seeding from inventory.
    profile.hotbarDefIds = parsed.hotbarDefIds.filter(
      (id): id is string =>
        typeof id === 'string' && PART_CATALOG[id] !== undefined,
    );
  }
  if (parsed.currentBlueprintName !== undefined) {
    profile.currentBlueprintName = parsed.currentBlueprintName;
  }
  if (isBiomeId(parsed.preferredBiomeId)) {
    profile.preferredBiomeId = parsed.preferredBiomeId;
  }
  if (isNonNegativeSafeInteger(parsed.highestWaveCleared)) {
    profile.highestWaveCleared = parsed.highestWaveCleared;
  }
  if (isNonNegativeSafeInteger(parsed.phoneAddictsKilled)) {
    profile.phoneAddictsKilled = parsed.phoneAddictsKilled;
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
    ...(profile.hotbarDefIds === undefined
      ? {}
      : { hotbarDefIds: profile.hotbarDefIds }),
    ...(profile.currentBlueprintName === undefined
      ? {}
      : { currentBlueprintName: profile.currentBlueprintName }),
    ...(profile.preferredBiomeId === undefined
      ? {}
      : { preferredBiomeId: profile.preferredBiomeId }),
    ...(profile.highestWaveCleared !== undefined &&
    profile.highestWaveCleared > 0
      ? { highestWaveCleared: profile.highestWaveCleared }
      : {}),
    ...(profile.phoneAddictsKilled !== undefined &&
    profile.phoneAddictsKilled > 0
      ? { phoneAddictsKilled: profile.phoneAddictsKilled }
      : {}),
  });
}
