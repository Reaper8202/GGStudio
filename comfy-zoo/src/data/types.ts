/**
 * Shared contract — TypeScript shapes of the data-driven tuning files in src/data/*.json.
 * DO NOT EDIT outside orchestrator review.
 */

export type AnimalTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
export type ResourceKind = 'berry' | 'hay' | 'forage' | 'water';
export type ZoneId = 'meadow' | 'pineForest' | 'palmOasis';

export interface AnimalSkinDef {
  skinId: string;
  name: string;
  /** hex tint multiplied into base material colors */
  tint: string;
  /** optional emissive hex for aura-style skins */
  emissive?: string;
  adLocked: boolean;
}

export interface AnimalDef {
  id: string;
  name: string;
  tier: AnimalTier;
  /** manifest-relative model path, e.g. "models/animals/Cow.glb" */
  model: string;
  /** present for tinted variants (Golden Stag etc.) that reuse another species' rig */
  variantOf?: string;
  tint?: string;
  emissive?: string;
  scale: number;
  /** m/s */
  walkSpeed: number;
  fleeSpeed: number;
  /** entering this radius may spook (m) */
  fleeRadius: number;
  interactRadius: number;
  /** base capture probability 0..1; legendary/mythic are ad-gated guaranteed captures */
  captureChance: number;
  diet: ResourceKind;
  /** shelterId this species can live in */
  shelter: string;
  zone: ZoneId;
  /** coins earned per happy income tick while housed and fed */
  coinsPerTick: number;
  adGated: boolean;
  /** mythic-only: position in the dino unlock order (1-based) */
  mythicOrder?: number;
}

export interface ShelterLevelDef {
  /** manifest-relative model path for this level */
  model: string;
  capacity: number;
  /** cost to buy (level 1) or upgrade into this level */
  cost: number;
  /** trough size in food units */
  foodMax: number;
}

export interface ShelterDef {
  id: string;
  name: string;
  species: string[];
  levels: ShelterLevelDef[];
  /** tile footprint (grid cells) */
  footprint: { w: number; h: number };
  /** total-housed count required before this appears unlocked in the build menu */
  unlockAtHoused: number;
  lockHint: string | null;
}

export interface ResourceDef {
  kind: ResourceKind;
  name: string;
  /** manifest-relative model path of the world node */
  nodeModel: string;
  /** seconds a depleted node takes to respawn */
  respawnSeconds: number;
  /** units granted per collect */
  yield: number;
  /** hold-to-collect duration in seconds */
  collectSeconds: number;
  zone: ZoneId;
}

export interface QuestDef {
  id: string;
  /** template text; {n} replaced with target */
  text: string;
  kind: 'capture' | 'house' | 'collect' | 'place' | 'upgrade' | 'feed';
  /** speciesId, tier, resource kind, or shelterId depending on kind; null = any */
  filter: string | null;
  target: number;
  rewardCoins: number;
  /** minimum totalHoused before this quest can roll */
  minHoused: number;
}

export interface ZoneDef {
  id: ZoneId;
  name: string;
  /** total animals housed required to unlock */
  unlockAtHoused: number;
}

export interface BalanceDef {
  hungerTickSeconds: number;
  sadGraceMinutes: number;
  wanderOffMinutes: number;
  incomeTickSeconds: number;
  captureRetryBonus: number;
  dietMatchBonus: number;
  maxFollowersBase: number;
  followerUpgradeCosts: number[];
  fleeCalmSeconds: number;
  autosaveSeconds: number;
  offlineCapHours: number;
  offlineCoinsPerHappyAnimalPerHour: number;
  interstitialMinIntervalSeconds: number;
  legendaryEncountersPerSession: number;
  doubleHarvestMinutes: number;
  dailyGiftCoinsByStreak: number[];
  zones: ZoneDef[];
  playerSpeed: number;
  playerInteractRadius: number;
}
