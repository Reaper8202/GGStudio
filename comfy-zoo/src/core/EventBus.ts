/**
 * Shared contract — typed pub/sub bus decoupling game systems from UI and platform hooks.
 * DO NOT EDIT outside orchestrator review. Both core and ui agents code against this file.
 */

import type { AnimalTier, ResourceKind, ZoneId } from '../data/types';

/** Every event that crosses a system boundary. Payloads are plain serializable data. */
export interface EventMap {
  // --- animals ---
  'animal:spotted': { animalUid: string; speciesId: string; tier: AnimalTier };
  'animal:spooked': { animalUid: string; speciesId: string };
  'animal:captureAttempt': { animalUid: string; speciesId: string; chance: number };
  'animal:captured': { animalUid: string; speciesId: string; tier: AnimalTier; isNewSpecies: boolean };
  'animal:captureFailed': { animalUid: string; speciesId: string; nextChance: number };
  'animal:housed': { animalUid: string; speciesId: string; shelterUid: string; coins: number };
  'animal:hungry': { animalUid: string; speciesId: string; shelterUid: string; food: ResourceKind };
  'animal:sad': { animalUid: string; speciesId: string; shelterUid: string };
  'animal:cheeredUp': { animalUid: string; shelterUid: string };
  'animal:wanderedOff': { animalUid: string; speciesId: string; shelterUid: string };
  'follower:added': { animalUid: string; count: number; max: number };
  'follower:removed': { animalUid: string; count: number; max: number };

  // --- world / building ---
  'shelter:placed': { shelterUid: string; shelterId: string; cost: number };
  'shelter:upgraded': { shelterUid: string; shelterId: string; newLevel: number; cost: number };
  'shelter:troughChanged': { shelterUid: string; food: number; foodMax: number };
  'build:ghostValidity': { valid: boolean };
  'build:mode': { active: boolean; shelterId: string | null };
  'resource:collected': { kind: ResourceKind; amount: number; total: number };
  'resource:inventoryChanged': { kind: ResourceKind; total: number };
  'zone:unlocked': { zoneId: ZoneId };
  'species:unlocked': { speciesId: string };

  // --- economy / progression ---
  'coins:changed': { coins: number; delta: number; reason: string };
  'coins:insufficient': { needed: number; have: number };
  'quest:progress': { questUid: string; current: number; target: number };
  'quest:completed': { questUid: string; rewardCoins: number };
  'quest:new': { questUid: string; text: string };
  'zoopedia:updated': { speciesId: string; caught: boolean };
  'offline:summary': { coins: number; awaySeconds: number };
  'daily:gift': { day: number; coins: number };

  // --- ads / platform (all opt-in placements, routed through PlatformAdapter) ---
  'ad:offer': { placement: AdPlacement; payload?: string };
  'ad:accepted': { placement: AdPlacement };
  'ad:rewardGranted': { placement: AdPlacement; payload?: string };
  'ad:unavailable': { placement: AdPlacement; cooldownSeconds: number };
  'encounter:legendary': { speciesId: string };
  'encounter:mythicEgg': { speciesId: string };

  // --- lifecycle / meta ---
  'game:ready': Record<string, never>;
  'game:pause': Record<string, never>;
  'game:resume': Record<string, never>;
  'save:completed': { at: number };
  'assets:phaseLoaded': { phase: 'boot' | 'main' | 'dinos' };

  // --- ui intents (UI → core; the only direction UI emits) ---
  'ui:requestBuild': { shelterId: string };
  'ui:confirmBuild': Record<string, never>;
  'ui:cancelBuild': Record<string, never>;
  'ui:requestUpgrade': { shelterUid: string };
  'ui:requestAd': { placement: AdPlacement; payload?: string };
  'ui:requestSkin': { speciesId: string; skinId: string };
  'ui:menuOpened': { menu: 'build' | 'zoopedia' | 'settings' };
  'ui:menuClosed': { menu: 'build' | 'zoopedia' | 'settings' };
  'ui:settingChanged': { key: 'sfx' | 'music'; value: boolean };
  /** Context-sensitive action button (and `E` key parity handled core-side). */
  'ui:actionPressed': Record<string, never>;
  'ui:actionReleased': Record<string, never>;
}

/**
 * Continuous input the UI overlay owns (virtual joystick). UI mutates this
 * object every frame; core reads it in its fixed-timestep update. Keyboard
 * (WASD/arrows/E) is read by core directly from the window.
 */
export interface JoystickState {
  /** normalized -1..1 */
  x: number;
  y: number;
  active: boolean;
}

export type AdPlacement =
  | 'rescue'
  | 'legendary'
  | 'mythicEgg'
  | 'skin'
  | 'doubleHarvest'
  | 'instantBuild';

export type EventKey = keyof EventMap;
export type Handler<K extends EventKey> = (payload: EventMap[K]) => void;

export class EventBus {
  private handlers = new Map<EventKey, Set<Handler<EventKey>>>();

  on<K extends EventKey>(key: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(fn as Handler<EventKey>);
    return () => set.delete(fn as Handler<EventKey>);
  }

  once<K extends EventKey>(key: K, fn: Handler<K>): () => void {
    const off = this.on(key, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  emit<K extends EventKey>(key: K, payload: EventMap[K]): void {
    const set = this.handlers.get(key);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }
}

// ---------------------------------------------------------------------------
// Read-only query surface the core exposes to the UI for render-time data.
// Core implements this; UI polls it (never mutates through it).
// ---------------------------------------------------------------------------

export interface ZooPediaEntry {
  speciesId: string;
  name: string;
  tier: AnimalTier;
  caught: boolean;
  count: number;
  captureChancePct: number;
  diet: ResourceKind;
  skins: { skinId: string; name: string; owned: boolean; adLocked: boolean }[];
  activeSkinId: string | null;
}

export interface ShelterInfo {
  shelterUid: string;
  shelterId: string;
  name: string;
  level: number;
  occupants: number;
  capacity: number;
  food: number;
  foodMax: number;
  upgradeCost: number | null; // null = max level
  hasSadAnimal: boolean;
}

export interface BuildCatalogEntry {
  shelterId: string;
  name: string;
  cost: number;
  capacity: number;
  species: string[]; // speciesIds it accepts
  unlocked: boolean;
  lockHint: string | null; // e.g. "House 6 animals"
  modelPath: string; // for live 3D thumbnail
}

export interface GameQuery {
  coins(): number;
  resources(): Record<ResourceKind, number>;
  followerCount(): { current: number; max: number };
  activeQuests(): { questUid: string; text: string; current: number; target: number }[];
  zoopedia(): ZooPediaEntry[];
  zoopediaCompletionPct(): number;
  buildCatalog(): BuildCatalogEntry[];
  shelters(): ShelterInfo[];
  totalHoused(): number;
  currentZone(): ZoneId;
  /** Context for the action button: what pressing "action" would do right now. */
  actionContext(): 'capture' | 'collect' | 'build' | 'deposit' | 'none';
}
