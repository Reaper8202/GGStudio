/**
 * Three rotating quests (plan §7). Rolled from quests.json filtered by minHoused,
 * progressed by bus events, and on completion pay coins, fire quest:completed, and
 * roll a replacement.
 */
import type { GameContext, QuestRuntime } from '../core/GameContext';
import type { QuestDef } from '../data/types';
import type { EconomySystem } from './EconomySystem';
import { QUESTS } from '../core/data';

const ACTIVE_COUNT = 3;

export class QuestSystem {
  constructor(
    private ctx: GameContext,
    private economy: EconomySystem,
  ) {}

  init(): void {
    if (this.ctx.activeQuests.length === 0) {
      for (let i = 0; i < ACTIVE_COUNT; i++) this.rollNew(false);
    }

    this.ctx.bus.on('animal:captured', (p) => {
      this.progress('capture', (f) => f === null || f === p.speciesId || f === p.tier);
    });
    this.ctx.bus.on('animal:housed', (p) => {
      this.progress('house', (f) => f === null || f === p.speciesId);
    });
    this.ctx.bus.on('resource:collected', (p) => {
      this.progress('collect', (f) => f === null || f === p.kind);
    });
    this.ctx.bus.on('shelter:placed', (p) => {
      this.progress('place', (f) => f === null || f === p.shelterId);
    });
    this.ctx.bus.on('shelter:upgraded', () => {
      this.progress('upgrade', () => true);
    });
  }

  /** Called by the interaction/feed path (no dedicated feed event exists). */
  onFeed(): void {
    this.progress('feed', () => true);
  }

  private totalHoused(): number {
    return this.ctx.shelters.reduce((n, s) => n + s.occupants.length, 0);
  }

  private progress(kind: QuestDef['kind'], match: (filter: string | null) => boolean): void {
    for (const q of this.ctx.activeQuests) {
      if (q.def.kind !== kind || !match(q.def.filter)) continue;
      if (q.current >= q.def.target) continue;
      q.current++;
      this.ctx.bus.emit('quest:progress', {
        questUid: q.uid,
        current: q.current,
        target: q.def.target,
      });
      if (q.current >= q.def.target) this.complete(q);
    }
    this.ctx.requestSave('quest');
  }

  private complete(q: QuestRuntime): void {
    this.economy.add(q.def.rewardCoins, 'quest');
    this.ctx.bus.emit('quest:completed', {
      questUid: q.uid,
      rewardCoins: q.def.rewardCoins,
    });
    const idx = this.ctx.activeQuests.indexOf(q);
    if (idx >= 0) this.ctx.activeQuests.splice(idx, 1);
    this.rollNew(true);
  }

  private rollNew(announce: boolean): void {
    const housed = this.totalHoused();
    const activeDefIds = new Set(this.ctx.activeQuests.map((q) => q.def.id));
    const pool = QUESTS.filter((d) => d.minHoused <= housed && !activeDefIds.has(d.id));
    if (pool.length === 0) return;
    const def = pool[Math.floor(Math.random() * pool.length)];
    const quest: QuestRuntime = {
      uid: `quest_${def.id}_${this.ctx.nextUid++}`,
      def,
      current: 0,
    };
    this.ctx.activeQuests.push(quest);
    if (announce) {
      this.ctx.bus.emit('quest:new', {
        questUid: quest.uid,
        text: this.formatText(def),
      });
    }
  }

  formatText(def: QuestDef): string {
    return def.text.replace('{n}', String(def.target));
  }
}
