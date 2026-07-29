import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = {
  load: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  has: vi.fn(),
};

vi.mock('../src/app/runSaveStore.ts', () => ({
  RUN_SAVE_STORAGE_KEY: 'scraprig.run.v1',
  runSaveStore: store,
}));

const { App } = await import('../src/app/App.ts');
const { BLUEPRINT_SCHEMA_VERSION } = await import('../src/core/types.ts');

import type { SavedRun } from '../src/core/runSave.ts';
import type { VehicleBlueprint } from '../src/core/types.ts';

function rig(id: string): VehicleBlueprint {
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    id,
    name: id,
    parts: [
      {
        id: 'core',
        defId: 'chassis-core',
        pos: { x: 0, y: 0, z: 0 },
        orient: 0,
        config: {},
      },
    ],
  };
}

const CHECKPOINT_RIG = rig('checkpoint-rig');
const GARAGE_RIG = rig('garage-rig');

function savedRun(overrides: Partial<SavedRun> = {}): SavedRun {
  return {
    schemaVersion: 5,
    phase: 'wave',
    activeWave: 6,
    score: 800,
    wave: 6,
    kills: 30,
    biomeId: 'graveyard',
    seed: 1234,
    bankedEarnings: 275,
    elapsedSeconds: 240,
    blueprint: CHECKPOINT_RIG,
    partHp: { core: 90 },
    savedAt: 1_800_000_000_000,
    ...overrides,
  };
}

/**
 * `App` owns a WebGL renderer and DOM, so the routing decision is exercised on
 * a bare prototype with the mode transitions stubbed. Only the branch under
 * test is real.
 */
function appUnderTest(blueprintLoad: unknown = {
  kind: 'loaded',
  blueprint: GARAGE_RIG,
}): {
  app: InstanceType<typeof App>;
  enterSurvival: ReturnType<typeof vi.fn>;
  openEditor: ReturnType<typeof vi.fn>;
  state: Record<string, unknown>;
} {
  const enterSurvival = vi.fn();
  const openEditor = vi.fn();
  const app = Object.create(App.prototype) as InstanceType<typeof App>;
  const state = {
    editor: null,
    title: null,
    activeRun: null,
    checkpoint: null,
    inBuildPhase: false,
    bp: rig('stale-rig'),
    runMoneyEarned: 0,
    disposeTitle: () => undefined,
    clearSessionState: () => undefined,
    loadCurrentBlueprint: () => blueprintLoad,
    enterSurvival,
    openEditor,
  };
  Object.assign(app, state);
  return { app, enterSurvival, openEditor, state: app as never };
}

describe('resuming a saved run', () => {
  beforeEach(() => {
    store.load.mockReset();
    store.save.mockReset();
  });

  it('reports no run to resume when nothing is stored', () => {
    store.load.mockReturnValue(null);
    const { app, enterSurvival, openEditor } = appUnderTest();

    expect(app.resumeSavedRun()).toBe(false);
    expect(enterSurvival).not.toHaveBeenCalled();
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('drops an arena save straight back into its wave', () => {
    store.load.mockReturnValue(savedRun({ phase: 'wave', wave: 6 }));
    const { app, enterSurvival, openEditor, state } = appUnderTest();

    expect(app.resumeSavedRun()).toBe(true);
    expect(openEditor).not.toHaveBeenCalled();
    expect(enterSurvival).toHaveBeenCalledTimes(1);
    expect(enterSurvival.mock.calls[0]?.[1]).toMatchObject({
      wave: 6,
      kills: 30,
      score: 800,
      partHp: { core: 90 },
      elapsedSeconds: 240,
    });
    expect(state.inBuildPhase).toBe(false);
    expect(state.activeRun).toEqual({ wave: 6 });
    expect(state.runMoneyEarned).toBe(275);
  });

  it('returns a Garage save to the Garage on the wave it was showing', () => {
    // Quitting from the Build Phase: wave 7 was cleared, wave 8 is next.
    store.load.mockReturnValue(
      savedRun({ phase: 'build', wave: 8, activeWave: 7 }),
    );
    const { app, enterSurvival, openEditor, state } = appUnderTest();

    expect(app.resumeSavedRun()).toBe(true);
    expect(enterSurvival).not.toHaveBeenCalled();
    expect(openEditor).toHaveBeenCalledTimes(1);
    expect(state.inBuildPhase).toBe(true);
    // The banner reads "Next: Wave 8" off activeRun.wave + 1.
    expect(state.activeRun).toEqual({ wave: 7 });
    expect((state.checkpoint as { wave: number }).wave).toBe(8);
  });

  it('keeps parts bought during the interrupted Garage trip', () => {
    store.load.mockReturnValue(savedRun({ phase: 'build' }));
    const { app, state } = appUnderTest();

    app.resumeSavedRun();

    expect(state.bp).toBe(GARAGE_RIG);
  });

  it('falls back to the checkpoint vehicle when the garage slot is unreadable', () => {
    store.load.mockReturnValue(savedRun({ phase: 'build' }));
    const { app, state } = appUnderTest({ kind: 'failed', name: 'garage-rig' });

    app.resumeSavedRun();

    expect(state.bp).toBe(CHECKPOINT_RIG);
  });
});

describe('saving and quitting from the Garage', () => {
  beforeEach(() => {
    store.load.mockReset();
    store.save.mockReset();
  });

  function garageApp(): {
    app: InstanceType<typeof App>;
    dispose: ReturnType<typeof vi.fn>;
    showTitle: ReturnType<typeof vi.fn>;
    state: Record<string, unknown>;
  } {
    const dispose = vi.fn();
    const showTitle = vi.fn();
    const app = Object.create(App.prototype) as InstanceType<typeof App>;
    Object.assign(app, {
      editor: {
        blueprint: () => GARAGE_RIG,
        persistGarage: () => undefined,
        dispose,
      },
      activeRun: { wave: 7 },
      inBuildPhase: true,
      checkpoint: {
        wave: 8,
        blueprint: CHECKPOINT_RIG,
        partHp: { core: 90 },
        kills: 30,
        biomeId: 'graveyard',
        seed: 1234,
        score: 800,
        bankedEarnings: 275,
        elapsedSeconds: 240,
      },
      bp: rig('stale-rig'),
      flushProfile: () => undefined,
      clearSessionState: () => undefined,
      showTitle,
    });
    return { app, dispose, showTitle, state: app as never };
  }

  it('banks the next wave and the wave the HUD was showing', () => {
    const { app, showTitle } = garageApp();

    app.saveAndQuitFromGarage();

    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save.mock.calls[0]?.[0]).toMatchObject({
      schemaVersion: 5,
      phase: 'build',
      wave: 8,
      activeWave: 7,
      kills: 30,
      score: 800,
      bankedEarnings: 275,
    });
    expect(showTitle).toHaveBeenCalledTimes(1);
  });

  it('releases the editor so it cannot repaint over the title screen', () => {
    const { app, dispose, state } = garageApp();

    app.saveAndQuitFromGarage();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(state.editor).toBeNull();
  });

  it('stays in the Garage when the save cannot be written', () => {
    const { app, dispose, showTitle } = garageApp();
    store.save.mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    Object.assign(app, { notifySaveFailure: vi.fn() });

    app.saveAndQuitFromGarage();

    expect(dispose).not.toHaveBeenCalled();
    expect(showTitle).not.toHaveBeenCalled();
  });

  it('does nothing outside a run', () => {
    const { app, showTitle } = garageApp();
    Object.assign(app, { checkpoint: null });

    app.saveAndQuitFromGarage();

    expect(store.save).not.toHaveBeenCalled();
    expect(showTitle).not.toHaveBeenCalled();
  });
});
