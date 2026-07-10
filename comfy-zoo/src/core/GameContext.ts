/**
 * The shared mutable game context. main.ts constructs it and hands it to every
 * system; GameQuery reads from it. Keeping one container avoids threading a dozen
 * references through every constructor and gives the save system one place to look.
 */
import type * as THREE from 'three';
import type { EventBus } from './EventBus';
import type { PlatformAdapter } from '../platform/PlatformAdapter';
import type { JoystickState } from './EventBus';
import type { ResourceKind, ZoneId, QuestDef } from '../data/types';
import type { AssetManager } from './AssetManager';
import type { TileGrid } from '../world/TileGrid';
import type { SpatialHash } from './SpatialHash';
import type { Player } from '../entities/Player';
import type { Animal } from '../entities/Animal';
import type { Shelter } from '../entities/Shelter';
import type { ResourceNode } from '../world/ResourceNode';
import type { Fx } from '../entities/Fx';

export interface RuntimeState {
  coins: number;
  resources: Record<ResourceKind, number>;
  followersMax: number;
  /** consecutive-day login streak (0-based index into dailyGiftCoinsByStreak) */
  streakCount: number;
  /** 'YYYY-MM-DD' of last claimed daily gift */
  lastDailyKey: string | null;
  /** 'YYYY-MM-DD' the daily visitor last spawned */
  lastVisitorKey: string | null;
  unlockedZones: ZoneId[];
  unlockedSpecies: string[];
  /** sim-seconds timestamp until which double-harvest is active (0 = off) */
  doubleHarvestUntil: number;
  /** wall-clock ms of last save (for offline progress) */
  lastSaveAt: number;
}

export interface ZoopediaRecord {
  caught: boolean;
  count: number;
  ownedSkins: string[];
  activeSkin: string | null;
}

export interface QuestRuntime {
  uid: string;
  def: QuestDef;
  current: number;
}

export interface GameContext {
  bus: EventBus;
  adapter: PlatformAdapter;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  assets: AssetManager;
  grid: TileGrid;
  hash: SpatialHash;
  fx: Fx;
  joystick: JoystickState;

  player: Player;
  animals: Animal[];
  shelters: Shelter[];
  resourceNodes: ResourceNode[];

  state: RuntimeState;
  zoopedia: Map<string, ZoopediaRecord>;
  activeQuests: QuestRuntime[];

  /** monotonic sim clock in seconds (pauses with the game) */
  now: number;
  paused: boolean;

  /** action button / E key hold state, driven by input + bus */
  actionHeld: boolean;

  /** counter for unique entity ids */
  nextUid: number;

  /** systems register a save request; SaveSystem debounces/persists */
  requestSave: (reason: string) => void;
}

export function makeUid(ctx: GameContext, prefix: string): string {
  return `${prefix}_${ctx.nextUid++}`;
}
