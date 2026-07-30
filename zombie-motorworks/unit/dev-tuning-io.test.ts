import { afterEach, describe, expect, it } from 'vitest';
import {
  devTuning,
  exportTuningJSON,
  importTuningJSON,
  resetTuning,
} from '../src/survival/devtuning/DevTuning.ts';

afterEach(() => {
  resetTuning();
});

describe('tuning snapshots', () => {
  it('round-trips a changed tuning', () => {
    devTuning.wave.composition.walker.cap = 34;
    devTuning.types.thrower.healthMult = 2.5;
    devTuning.wave.maxActiveCap = 64;
    const snapshot = exportTuningJSON();

    resetTuning();
    expect(devTuning.wave.composition.walker.cap).toBe(70);

    expect(importTuningJSON(snapshot)).toBe(true);
    expect(devTuning.wave.composition.walker.cap).toBe(34);
    expect(devTuning.types.thrower.healthMult).toBe(2.5);
    expect(devTuning.wave.maxActiveCap).toBe(64);
  });

  it('applies a partial snapshot and leaves the rest alone', () => {
    const before = devTuning.types.worker.reward;
    expect(
      importTuningJSON('{"wave":{"composition":{"walker":{"cap":40}}}}'),
    ).toBe(true);
    expect(devTuning.wave.composition.walker.cap).toBe(40);
    expect(devTuning.types.worker.reward).toBe(before);
  });

  it('restores a pinned count to the wave formula', () => {
    devTuning.types.walker.countOverride = 12;
    expect(
      importTuningJSON('{"types":{"walker":{"countOverride":null}}}'),
    ).toBe(true);
    expect(devTuning.types.walker.countOverride).toBeNull();
  });

  it('accepts a pinned count', () => {
    expect(importTuningJSON('{"types":{"walker":{"countOverride":12}}}')).toBe(
      true,
    );
    expect(devTuning.types.walker.countOverride).toBe(12);
  });

  it('rejects text that is not JSON, without touching the tuning', () => {
    const before = devTuning.wave.composition.walker.cap;
    expect(importTuningJSON('not json at all')).toBe(false);
    expect(devTuning.wave.composition.walker.cap).toBe(before);
  });

  it('rejects JSON that is not an object', () => {
    expect(importTuningJSON('[1,2,3]')).toBe(false);
    expect(importTuningJSON('42')).toBe(false);
  });

  it('ignores keys the tuning does not have', () => {
    expect(importTuningJSON('{"wave":{"nonsense":1},"bogus":{"x":2}}')).toBe(
      true,
    );
    expect('nonsense' in devTuning.wave).toBe(false);
    expect('bogus' in devTuning).toBe(false);
  });

  it('ignores values of the wrong type rather than corrupting the state', () => {
    const before = devTuning.wave.composition.walker.cap;
    expect(
      importTuningJSON('{"wave":{"composition":{"walker":{"cap":"lots"}}}}'),
    ).toBe(true);
    expect(devTuning.wave.composition.walker.cap).toBe(before);
  });

  it('ignores non-finite numbers, which would break every curve downstream', () => {
    const before = devTuning.wave.health.perWave;
    // JSON has no Infinity literal, so 1e999 is how it arrives in practice.
    expect(importTuningJSON('{"wave":{"health":{"perWave":1e999}}}')).toBe(
      true,
    );
    expect(devTuning.wave.health.perWave).toBe(before);
  });

  it('never reads cheats out of a snapshot', () => {
    expect(exportTuningJSON()).not.toContain('cheat');
  });
});
