/**
 * Shared context handed to every UI component. Components read game state via
 * `query`, listen to `bus`, emit only `ui:*` intents, and play cues via `sfx`.
 */

import type { EventBus, GameQuery } from '../core/EventBus';
import type { PlatformAdapter } from '../platform/PlatformAdapter';
import type { Sfx } from './Sfx';
import type { Thumbnails } from './Thumbnails';
import animalsData from '../data/animals.json';

export interface UIContext {
  bus: EventBus;
  adapter: PlatformAdapter;
  query: GameQuery;
  sfx: Sfx;
  thumbs: Thumbnails;
  /** #ui-root; components append their own layers here. */
  root: HTMLElement;
  /** True once any touch input has been seen (joystick + action button enable). */
  isTouch(): boolean;
}

interface AnimalRow {
  id: string;
  name: string;
  model: string;
  tier: string;
}

const ANIMALS = animalsData as AnimalRow[];
const BY_ID = new Map(ANIMALS.map((a) => [a.id, a]));

/** Manifest-relative model path for a species (for ZooPedia thumbnails). */
export function animalModelPath(speciesId: string): string | null {
  return BY_ID.get(speciesId)?.model ?? null;
}

/** Rarity tier → 1..5 blossom-star count. */
export function tierStars(tier: string): number {
  switch (tier) {
    case 'common':
      return 1;
    case 'uncommon':
      return 2;
    case 'rare':
      return 3;
    case 'epic':
      return 4;
    case 'legendary':
      return 5;
    case 'mythic':
      return 5;
    default:
      return 1;
  }
}
