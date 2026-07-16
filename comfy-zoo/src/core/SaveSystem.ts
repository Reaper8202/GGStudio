/**
 * Versioned JSON save. Serializes the full progression state (coins, resources,
 * shelters w/ occupants+trough, housed animals, quests, zoopedia, streak) through
 * adapter.save(). Autosaves every balance.autosaveSeconds and debounced on
 * meaningful events via ctx.requestSave.
 */
import type { GameContext } from './GameContext';
import type { ResourceKind, ZoneId } from '../data/types';
import { BALANCE } from './data';

export const SAVE_VERSION = 1;

export interface SavedShelter {
  uid: string;
  shelterId: string;
  level: number;
  cx: number;
  cz: number;
  food: number;
  /** housed occupants as species ids (individual identity beyond species doesn't matter) */
  occupantSpecies: string[];
}

export interface SaveBlob {
  version: number;
  savedAt: number;
  coins: number;
  resources: Record<ResourceKind, number>;
  followersMax: number;
  streakCount: number;
  lastDailyKey: string | null;
  lastVisitorKey: string | null;
  unlockedZones: ZoneId[];
  unlockedSpecies: string[];
  shelters: SavedShelter[];
  quests: { defId: string; current: number }[];
  zoopedia: {
    speciesId: string;
    caught: boolean;
    count: number;
    ownedSkins: string[];
    activeSkin: string | null;
  }[];
  nextUid: number;
}

export class SaveSystem {
  private timer = 0;
  private dirty = false;
  private saving = false;

  constructor(private ctx: GameContext) {}

  markDirty(): void {
    this.dirty = true;
  }

  serialize(): SaveBlob {
    const ctx = this.ctx;
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      coins: ctx.state.coins,
      resources: { ...ctx.state.resources },
      followersMax: ctx.state.followersMax,
      streakCount: ctx.state.streakCount,
      lastDailyKey: ctx.state.lastDailyKey,
      lastVisitorKey: ctx.state.lastVisitorKey,
      unlockedZones: [...ctx.state.unlockedZones],
      unlockedSpecies: [...ctx.state.unlockedSpecies],
      shelters: ctx.shelters.map((s) => ({
        uid: s.uid,
        shelterId: s.def.id,
        level: s.level,
        cx: s.cx,
        cz: s.cz,
        food: s.food,
        occupantSpecies: s.occupants
          .map((uid) => ctx.animals.find((a) => a.uid === uid)?.def.id)
          .filter((id): id is string => !!id),
      })),
      quests: ctx.activeQuests.map((q) => ({ defId: q.def.id, current: q.current })),
      zoopedia: [...ctx.zoopedia.entries()].map(([speciesId, r]) => ({
        speciesId,
        caught: r.caught,
        count: r.count,
        ownedSkins: [...r.ownedSkins],
        activeSkin: r.activeSkin,
      })),
      nextUid: ctx.nextUid,
    };
  }

  /** Parse + migrate a raw save string. Returns null if unusable. */
  static parse(raw: string): SaveBlob | null {
    try {
      const data = JSON.parse(raw) as Partial<SaveBlob> & { version?: number };
      if (typeof data !== 'object' || data === null) return null;
      // migration hook: step old versions forward here
      let v = data.version ?? 0;
      while (v < SAVE_VERSION) {
        // no historical versions yet — treat unknown as fresh
        v++;
      }
      if (!data.resources || typeof data.coins !== 'number') return null;
      return data as SaveBlob;
    } catch {
      return null;
    }
  }

  async saveNow(): Promise<void> {
    if (this.saving) {
      this.dirty = true;
      return;
    }
    this.saving = true;
    this.dirty = false;
    try {
      const blob = this.serialize();
      this.ctx.state.lastSaveAt = blob.savedAt;
      await this.ctx.adapter.save(JSON.stringify(blob));
      this.ctx.bus.emit('save:completed', { at: blob.savedAt });
    } catch {
      this.dirty = true; // retry on next tick
    } finally {
      this.saving = false;
    }
  }

  update(dt: number): void {
    this.timer += dt;
    if (this.timer >= BALANCE.autosaveSeconds || (this.dirty && this.timer >= 2)) {
      this.timer = 0;
      void this.saveNow();
    }
  }
}
