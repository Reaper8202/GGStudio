/**
 * Synchronous key-value save storage for the whole game. Outside YouTube
 * Playables this is a thin localStorage wrapper. Inside Playables all keys
 * live in one JSON document: hydrated once from ytgame.game.loadData() at
 * boot (before the App constructs), and pushed back through a debounced
 * ytgame.game.saveData() — YouTube stores a single string, capped at 3 MiB.
 */

import { playables } from './playables.ts';

const PUSH_DEBOUNCE_MS = 1_000;

interface Backend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function localBackend(): Backend | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

class PlayablesBackend implements Backend {
  private pushTimer: number | undefined;

  constructor(private readonly data: Map<string, string>) {}

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
    this.schedulePush();
  }

  removeItem(key: string): void {
    if (this.data.delete(key)) this.schedulePush();
  }

  flush(): void {
    if (this.pushTimer === undefined) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = undefined;
    this.push();
  }

  private schedulePush(): void {
    if (this.pushTimer !== undefined) return;
    this.pushTimer = window.setTimeout(() => {
      this.pushTimer = undefined;
      this.push();
    }, PUSH_DEBOUNCE_MS);
  }

  private push(): void {
    const doc = JSON.stringify(Object.fromEntries(this.data));
    playables.saveData(doc).catch((err: unknown) => {
      console.warn('Playables saveData failed', err);
    });
  }
}

let backend: Backend | null = localBackend();
let playablesBackend: PlayablesBackend | null = null;

/** Must complete before anything reads or writes saves. No-op outside YouTube. */
export async function initGameStorage(): Promise<void> {
  if (!playables.active) return;
  const data = new Map<string, string>();
  try {
    const raw = await playables.loadData();
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string') data.set(key, value);
        }
      }
    }
  } catch {
    // Absent or corrupt cloud save — start fresh rather than fail the boot.
  }
  playablesBackend = new PlayablesBackend(data);
  backend = playablesBackend;
}

/** Push any pending Playables write immediately (pause/pagehide). */
export function flushGameStorage(): void {
  playablesBackend?.flush();
}

export const gameStorage = {
  getItem(key: string): string | null {
    try {
      return backend?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },

  /** Throws when no storage is available, like localStorage.setItem on quota. */
  setItem(key: string, value: string): void {
    if (backend === null) throw new Error('Save storage unavailable');
    backend.setItem(key, value);
  },

  removeItem(key: string): void {
    try {
      backend?.removeItem(key);
    } catch {
      // Removal is best-effort; a stale key never blocks a fresh game.
    }
  },
};
