import { afterEach, describe, expect, it } from 'vitest';
import {
  kindProfiles,
  summarize,
  waveLabRow,
  waveLabRows,
} from '../src/survival/waveLab.ts';
import { devTuning, resetTuning } from '../src/survival/devtuning/DevTuning.ts';
import { zombieCompositionForWave } from '../src/survival/WaveManager.ts';

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

  it('profiles every kind a wave can contain', () => {
    // waveThreat skips kinds it has no profile for, so a kind missing here does
    // not fail — it silently scores as zero threat and reports the wave as
    // easier than it is. This is what a hand-written kind list gets wrong the
    // moment a new zombie ships.
    const profiles = kindProfiles();
    for (const kind of Object.keys(zombieCompositionForWave(30))) {
      expect(profiles[kind], `no profile for ${kind}`).toBeDefined();
    }
  });
});

describe('measuring a wave', () => {
  it('agrees with the shipped wave-one composition', () => {
    const row = waveLabRow(1);
    // Asserted kind by kind rather than against the whole object, so shipping a
    // new zombie that wave one does not use cannot fail this.
    expect(row.counts.walker).toBe(13);
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
    expect(row.population).toBe(64);
    expect(row.maxActive).toBe(44);
    expect(row.overflow).toBe(20);
  });

  it('prices a wave by its own composition and clear bonus', () => {
    const row = waveLabRow(1);
    expect(row.killReward).toBe(13 * 3);
    expect(row.wavePayout).toBe(50);
    expect(row.totalPayout).toBe(89);
    expect(row.payPerThreat).toBeCloseTo(89 / 520, 6);
  });

  it('charges spawn time for a wave too big to arrive at once', () => {
    // Hordes average 11, so 64 zombies is six hordes: five waits of 1.25s.
    expect(waveLabRow(10).spawnFloorSeconds).toBeCloseTo(6.25, 5);
    // 13 fits in two hordes: one wait, at the early 1.45s tempo.
    expect(waveLabRow(1).spawnFloorSeconds).toBeCloseTo(1.45, 5);
  });
});

describe('run summary', () => {
  const rows = waveLabRows(20);

  it('finds the wave where zombies start queueing instead of appearing', () => {
    expect(summarize(rows).firstOverflowWave).toBe(6);
  });

  it('reports how far the reward curve drifts behind the difficulty curve', () => {
    // Wave 1 pays over twice as well per point of enemy health as wave 20.
    expect(summarize(rows).payDriftRatio).toBeGreaterThan(2);
  });

  it('shows walkers still the majority of the deepest wave', () => {
    const late = rows[19];
    expect(summarize(rows).lateWalkerShare).toBeCloseTo(
      late.counts.walker / late.population,
      5,
    );
    // Specialists have grown enough to be a third of a late wave, but walkers
    // are still most of what a player is shooting at wave 20.
    expect(summarize(rows).lateWalkerShare).toBeGreaterThan(0.5);
    expect(late.specialistShare).toBeGreaterThan(0.3);
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
