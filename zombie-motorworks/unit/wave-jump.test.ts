import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  setDevModeForTesting,
  waveJumpTarget,
} from '../src/survival/devtuning/devMode.ts';
import { App } from '../src/app/App.ts';
import { BLUEPRINT_SCHEMA_VERSION } from '../src/core/types.ts';
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

/** `waveJumpTarget` reads the real URL, which a node test has to stand in for. */
function withSearch(search: string, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    value: { search },
    configurable: true,
    writable: true,
  });
  try {
    run();
  } finally {
    if (original === undefined)
      delete (globalThis as { location?: unknown }).location;
    else Object.defineProperty(globalThis, 'location', original);
  }
}

afterEach(() => {
  setDevModeForTesting(null);
});

describe('reading the jump target from the URL', () => {
  it('reads a wave when dev mode is on', () => {
    setDevModeForTesting(true);
    withSearch('?dev=1&wave=12', () => {
      expect(waveJumpTarget()).toBe(12);
    });
  });

  it('refuses to jump in the public build', () => {
    // A shipped game honouring ?wave=20 would be a leaderboard exploit.
    setDevModeForTesting(false);
    withSearch('?wave=12', () => {
      expect(waveJumpTarget()).toBeNull();
    });
  });

  it('is absent when no wave is asked for', () => {
    setDevModeForTesting(true);
    withSearch('?dev=1', () => {
      expect(waveJumpTarget()).toBeNull();
    });
  });

  it.each(['0', '-3', '2.5', 'twelve', ''])(
    'rejects %j rather than jumping somewhere arbitrary',
    (value) => {
      setDevModeForTesting(true);
      withSearch(`?dev=1&wave=${value}`, () => {
        expect(waveJumpTarget()).toBeNull();
      });
    },
  );
});

describe('jumping into a wave', () => {
  function appUnderTest(): {
    app: InstanceType<typeof App>;
    openEditor: ReturnType<typeof vi.fn>;
    changeMoney: ReturnType<typeof vi.fn>;
    state: Record<string, unknown>;
  } {
    const openEditor = vi.fn();
    const changeMoney = vi.fn();
    const app = Object.create(App.prototype) as InstanceType<typeof App>;
    Object.assign(app, {
      profile: { money: 200, unlockedDefIds: ['chassis-core'], inventory: {} },
      bp: rig('garage-rig'),
      preferredBiomeId: 'graveyard',
      checkpoint: null,
      activeRun: null,
      inBuildPhase: false,
      runMoneyEarned: 999,
      runSummary: { placeholder: true },
      committedDestroyedPartNames: ['stale'],
      changeMoney,
      markProfileDirty: () => undefined,
      disposeTitle: () => undefined,
      loadCurrentBlueprint: () => ({ kind: 'missing' }),
      openEditor,
    });
    return { app, openEditor, changeMoney, state: app as never };
  }

  it('opens the Garage with the run primed at the requested wave', () => {
    setDevModeForTesting(true);
    const { app, openEditor, state } = appUnderTest();

    expect(app.devWaveJump(12)).toBe(true);
    expect(openEditor).toHaveBeenCalledTimes(1);
    expect(state.inBuildPhase).toBe(true);
    expect((state.checkpoint as { wave: number }).wave).toBe(12);
    // The Garage banner reads "Next: Wave 12" off activeRun.wave + 1.
    expect(state.activeRun).toEqual({ wave: 11 });
  });

  it('grants the parts a player would have unlocked by then', () => {
    setDevModeForTesting(true);
    const { app, state } = appUnderTest();

    app.devWaveJump(12);

    const profile = state.profile as {
      highestWaveCleared: number;
      unlockedDefIds: string[];
    };
    expect(profile.highestWaveCleared).toBe(11);
    // The Mine Sweeper unlocks on wave 7, so wave 12 must already have it.
    expect(profile.unlockedDefIds).toContain('mine-sweeper');
  });

  it('grants money to build with', () => {
    setDevModeForTesting(true);
    const { app, changeMoney } = appUnderTest();

    app.devWaveJump(12);

    expect(changeMoney).toHaveBeenCalledTimes(1);
    expect(changeMoney.mock.calls[0]?.[0]).toBeGreaterThan(0);
  });

  it('clears the leftovers of any previous run', () => {
    setDevModeForTesting(true);
    const { app, state } = appUnderTest();

    app.devWaveJump(12);

    expect(state.runMoneyEarned).toBe(0);
    expect(state.runSummary).toBeUndefined();
    expect(state.committedDestroyedPartNames).toEqual([]);
  });

  it('prefers the saved garage rig over whatever was in memory', () => {
    setDevModeForTesting(true);
    const { app, state } = appUnderTest();
    const saved = rig('saved-rig');
    Object.assign(app, {
      loadCurrentBlueprint: () => ({ kind: 'loaded', blueprint: saved }),
    });

    app.devWaveJump(12);

    expect(state.bp).toBe(saved);
  });

  it('does nothing in the public build', () => {
    setDevModeForTesting(false);
    const { app, openEditor } = appUnderTest();

    expect(app.devWaveJump(12)).toBe(false);
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('declines wave 1, which a normal new run already starts on', () => {
    setDevModeForTesting(true);
    const { app, openEditor, changeMoney } = appUnderTest();

    expect(app.devWaveJump(1)).toBe(false);
    expect(openEditor).not.toHaveBeenCalled();
    expect(changeMoney).not.toHaveBeenCalled();
  });
});
