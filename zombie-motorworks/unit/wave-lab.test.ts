import { afterEach, describe, expect, it } from 'vitest';
import {
  kindProfiles,
  summarize,
  waveLabRow,
  waveLabRows,
} from '../src/survival/waveLab.ts';
import { devTuning, resetTuning } from '../src/survival/devtuning/DevTuning.ts';

afterEach(() => {
  resetTuning();
});

describe('kind profiles', () => {
  it('takes toughness straight from the tuning the spawner multiplies by', () => {
    // Zombie.spawn does base.health * waveMult * types[kind].healthMult, so the
    // profile must be that field alone. Folding the zombieConfig constant in as
    // well would report a thrower as 2.56x a walker instead of 1.6x.
    expect(kindProfiles().thrower.healthMultiplier).toBe(1.6);
    expect(kindProfiles().worker.healthMultiplier).toBe(1.3);
    expect(kindProfiles()['phone-addict'].healthMultiplier).toBe(1.2);
    expect(kindProfiles().walker.healthMultiplier).toBe(1);
  });

  it('follows a dev tuning change', () => {
    devTuning.types.thrower.healthMult = 4;
    expect(kindProfiles().thrower.healthMultiplier).toBe(4);
  });
});

describe('measuring a wave', () => {
  it('agrees with the shipped wave-one composition', () => {
    const row = waveLabRow(1);
    expect(row.counts).toEqual({
      walker: 13,
      thrower: 0,
      worker: 0,
      'phone-addict': 0,
    });
    expect(row.population).toBe(13);
    // 13 walkers at 40hp, no wave multiplier yet.
    expect(row.threat).toBe(520);
    expect(row.specialistShare).toBe(0);
  });

  it('reports the cap as headroom while the wave still fits', () => {
    const row = waveLabRow(1);
    expect(row.maxActive).toBe(26);
    expect(row.overflow).toBe(0);
  });

  it('reports the surplus once the wave outgrows the cap', () => {
    const row = waveLabRow(10);
    expect(row.population).toBe(47);
    expect(row.maxActive).toBe(44);
    expect(row.overflow).toBe(3);
  });

  it('prices a wave by its own composition and clear bonus', () => {
    const row = waveLabRow(1);
    expect(row.killReward).toBe(13 * 3);
    expect(row.wavePayout).toBe(50);
    expect(row.totalPayout).toBe(89);
    expect(row.payPerThreat).toBeCloseTo(89 / 520, 6);
  });

  it('charges spawn time for a wave too big to arrive at once', () => {
    // Hordes average 11, so 47 zombies is five hordes: four waits of 1.25s.
    expect(waveLabRow(10).spawnFloorSeconds).toBeCloseTo(5, 5);
    expect(waveLabRow(1).spawnFloorSeconds).toBeCloseTo(1.45, 5);
  });
});

describe('run summary', () => {
  const rows = waveLabRows(20);

  it('finds the wave where zombies start queueing instead of appearing', () => {
    expect(summarize(rows).firstOverflowWave).toBe(10);
  });

  it('reports how far the reward curve drifts behind the difficulty curve', () => {
    // Wave 1 pays over twice as well per point of enemy health as wave 20.
    expect(summarize(rows).payDriftRatio).toBeGreaterThan(2);
  });

  it('shows walkers still dominating the deepest wave', () => {
    expect(summarize(rows).lateWalkerShare).toBeCloseTo(70 / 87, 5);
    const late = rows[19];
    expect(1 - late.specialistShare).toBeGreaterThan(0.75);
  });

  it('finds the wave after which nothing escalates', () => {
    // Health is the last multiplier still moving; it caps at wave 21.
    expect(summarize(waveLabRows(30)).lastEscalatingWave).toBe(21);
  });

  it('survives being asked for a single wave', () => {
    const summary = summarize(waveLabRows(1));
    expect(summary.lastEscalatingWave).toBeNull();
    expect(summary.payDriftRatio).toBe(1);
  });
});

describe('rows follow the live tuning', () => {
  it('re-measures after a composition change', () => {
    const before = waveLabRow(5).population;
    devTuning.wave.composition.walker.base = 40;
    expect(waveLabRow(5).population).toBeGreaterThan(before);
  });
});
