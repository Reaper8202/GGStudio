import {
  decodeSavedRun,
  encodeSavedRun,
  type SavedRun,
} from '../core/runSave.ts';

export const RUN_SAVE_STORAGE_KEY = 'scraprig.run.v1';

export interface RunSaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): RunSaveStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Cached run persistence at the application boundary. */
export class RunSaveStore {
  private cached: SavedRun | null | undefined;

  constructor(
    private readonly storage: RunSaveStorage | null = browserStorage(),
  ) {}

  load(): SavedRun | null {
    if (this.cached !== undefined) return this.cached;

    let json: string | null = null;
    try {
      json = this.storage?.getItem(RUN_SAVE_STORAGE_KEY) ?? null;
    } catch {
      // Storage access can fail in privacy mode or under a restrictive origin.
    }
    this.cached = decodeSavedRun(json);
    return this.cached;
  }

  save(run: SavedRun): void {
    const normalized = decodeSavedRun(encodeSavedRun(run));
    if (normalized === null) throw new Error('Invalid run save');
    if (this.storage === null) throw new Error('Run storage unavailable');
    this.storage.setItem(RUN_SAVE_STORAGE_KEY, encodeSavedRun(normalized));
    this.cached = normalized;
  }

  clear(): void {
    this.cached = null;
    try {
      this.storage?.removeItem(RUN_SAVE_STORAGE_KEY);
    } catch {
      // Finishing a run must not fail because persisted state is unavailable.
    }
  }

  has(): boolean {
    return this.load() !== null;
  }
}

export const runSaveStore = new RunSaveStore();
