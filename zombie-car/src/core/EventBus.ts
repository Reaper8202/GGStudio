/**
 * Typed event bus (orchestrator-owned, FROZEN during parallel implementation).
 */
import type { EventBus, EventKey, GameEvents } from "../types";

type Handler = (payload: never) => void;

export class TypedEventBus implements EventBus {
  private handlers = new Map<EventKey, Set<Handler>>();

  on<K extends EventKey>(
    event: K,
    handler: (payload: GameEvents[K]) => void
  ): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler);
    return () => this.off(event, handler);
  }

  off<K extends EventKey>(
    event: K,
    handler: (payload: GameEvents[K]) => void
  ): void {
    this.handlers.get(event)?.delete(handler as Handler);
  }

  emit<K extends EventKey>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      (handler as (payload: GameEvents[K]) => void)(payload);
    }
  }
}
