import { afterEach, describe, expect, it } from 'vitest';
import {
  kindProfiles,
  summarize,
  waveLabRow,
  waveLabRows,
} from '../src/survival/waveLab.ts';
import { devTuning, resetTuning } from '../src/survival/devtuning/DevTuning.ts';
import { zombieCompositionForWave } from '../src/survival/WaveManager.ts';
import { bossForWave } from '../src/survival/zombies/bossConfig.ts';

afterEach(() => {
  resetTuning();
});

describe('kind profiles', () => {
  it('takes toughness straight from the tuning the spawner multiplies by', () => {
    // Zombie.spawn does base.health * waveMult * types[kind].healthMult, so the
    // profile must be that field alone. Folding the zombieConfig constant in as
    // well would report a thrower as 2.56x a walker instead of 1.6x.
    expect(kindProfiles(1).thrower.healthMultiplier).toBe(1.6);
    expect(kindProfiles(1).worker.healthMultiplier).toBe(1.3);
    expect(kindProfiles(1)['phone-addict'].healthMultiplier).toBe(1.2);
    expect(kindProfiles(1).walker.healthMultiplier).toBe(1);
  });

  it('follows a dev tuning change', () => {
    devTuning.types.thrower.healthMult = 4;
    expect(kindProfiles(1).thrower.healthMultiplier).toBe(4);
  });

  it('profiles every kind any wave actually fields', () => {
    // waveThreat skips kinds it has no profile for, so a kind missing here does
    // not fail — it silently scores as zero threat and reports the wave as
    // easier than it is. This is what a hand-written kind list gets wrong the
    // moment a new zombie ships, and what it got wrong when bosses landed.
    for (let wave = 1; wave <= 30; wave += 1) {
      const profiles = kindProfiles(wave);
      for (const [kind, count] of Object.entries(
        zombieCompositionForWave(wave),
      )) {
        if (count === 0) continue;
        expect(
          profiles[kind],
          `wave ${wave} has no profile for ${kind}`,
        ).toBeDefined();
      }
    }
  });

  it('prices a boss off its own sheet, not the per-kind sliders', () => {
    // A boss ignores devTuning.types entirely: Zombie.spawn gives it
    // bossDef.baseHealth * waveMultiplier. Reading healthMult (which is 1) would
    // score a 900hp boss as a 40hp walker.
    const boss = bossForWave(5);
    expect(boss).not.toBeNull();
    const profile = kindProfiles(5).boss;
    expect(profile.reward).toBe(boss!.reward);
    expect(profile.healthMultiplier * devTuning.base.health).toBe(
      boss!.baseHealth,
    );
  });

  it('has no boss profile on an ordinary horde wave', () => {
    expect(kindProfiles(4).boss).toBeUndefined();
  });
});

describe('measuring a wave', () => {
  it('agrees with the shipped wave-one composition', () => {
    const row = waveLabRow(1);
    // Asserted kind by kind rather than against the whole object, so shipping a
    // new zombie that wave one does not use cannot fail this.
    expect(row.counts.walker).toBe(18);
    expect(row.population).toBe(18);
    // 18 walkers at 40hp, no wave multiplier yet.
    expect(row.threat).toBe(720);
    expect(row.specialistShare).toBe(0);
    expect(row.isBossWave).toBe(false);
  });

  it('reports the cap as headroom while the wave still fits', () => {
    const row = waveLabRow(1);
    expect(row.maxActive).toBe(26);
    expect(row.overflow).toBe(0);
  });

  it('reports the surplus once the wave outgrows the cap', () => {
    const row = waveLabRow(11);
    expect(row.population).toBe(70);
    expect(row.maxActive).toBe(46);
    expect(row.overflow).toBe(24);
  });

  it('measures a boss wave as the duel it is', () => {
    const row = waveLabRow(5);
    expect(row.isBossWave).toBe(true);
    expect(row.population).toBe(1);
    // One enemy is never a queue, however much health it carries.
    expect(row.overflow).toBe(0);
    expect(row.spawnFloorSeconds).toBe(0);
    // And it is emphatically not a walker, which SPECIALIST_KINDS has to say
    // out loud because `boss` is deliberately absent from KIND_ORDER.
    expect(row.specialistShare).toBe(1);
    expect(row.threat).toBeGreaterThan(1000);
  });

  it('prices a wave by its own composition and clear bonus', () => {
    const row = waveLabRow(1);
    expect(row.killReward).toBe(18 * 3);
    expect(row.wavePayout).toBe(50);
    expect(row.totalPayout).toBe(104);
    expect(row.payPerThreat).toBeCloseTo(104 / 720, 6);
  });

  it('charges spawn time for a wave too big to arrive at once', () => {
    // Hordes average 11, so 70 zombies is seven hordes: six waits of 1.25s.
    expect(waveLabRow(11).spawnFloorSeconds).toBeCloseTo(7.5, 5);
    // 18 fits in two hordes: one wait, at the early 1.45s tempo.
    expect(waveLabRow(1).spawnFloorSeconds).toBeCloseTo(1.45, 5);
  });
});

describe('run summary', () => {
  const rows = waveLabRows(20);

  it('finds the wave where zombies start queueing instead of appearing', () => {
    expect(summarize(rows).firstOverflowWave).toBe(6);
  });

  it('reports how far the reward curve drifts behind the difficulty curve', () => {
    // Wave 1 pays roughly twice as well per point of enemy health as wave 19.
    expect(summarize(rows).payDriftRatio).toBeGreaterThan(1.5);
  });

  it('measures the drift between horde waves, not against a boss', () => {
    // Wave 20 is a boss: one hand-priced enemy paying ~0.099/hp against wave
    // 19's 0.072. Ending the measurement there would report the reward curve
    // recovering, when what actually happened is the wave changed shape.
    const throughBoss = summarize(waveLabRows(20)).payDriftRatio;
    const throughHorde = summarize(waveLabRows(19)).payDriftRatio;
    expect(throughBoss).toBeCloseTo(throughHorde, 10);
  });

  it('shows walkers still the majority of the deepest horde wave', () => {
    const late = rows[18];
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
    const before = waveLabRow(4).population;
    devTuning.wave.composition.walker.base = 40;
    expect(waveLabRow(4).population).toBeGreaterThan(before);
  });
});
