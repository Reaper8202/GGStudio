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

/**
 * The first boss wave that summons the given encounter style. Searched rather
 * than hard-coded so reordering BOSS_ROTATION — or adding a boss to it — moves
 * these tests along with it instead of silently testing the wrong style.
 */
function firstWaveWithStyle(style: 'classic' | 'elite'): number {
  for (let wave = 5; wave <= 100; wave += 5) {
    if (bossForWave(wave)?.style === style) return wave;
  }
  throw new Error(`no boss wave uses the ${style} style`);
}

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

  it('prices a classic boss off its own sheet, not the per-kind sliders', () => {
    // A classic boss ignores devTuning.types entirely: Zombie.spawn gives it
    // definition.baseHealth * waveMultiplier. Reading healthMult (which is 1)
    // would score a 900hp boss as a 40hp walker.
    const wave = firstWaveWithStyle('classic');
    const boss = bossForWave(wave);
    expect(boss?.style).toBe('classic');
    const definition = boss!.style === 'classic' ? boss!.definition : null;
    const profile = kindProfiles(wave).boss;
    expect(profile.reward).toBe(definition!.reward);
    expect(profile.healthMultiplier * devTuning.base.health).toBe(
      definition!.baseHealth,
    );
  });

  it('stacks an elite boss on top of the kind it actually spawns as', () => {
    // An elite is a real pool kind spawned hot, so Zombie.spawn keeps that
    // kind's own healthMult and multiplies the elite factor on top. Pricing it
    // like a classic boss would ignore the behemoth slider entirely.
    const wave = firstWaveWithStyle('elite');
    const boss = bossForWave(wave);
    expect(boss?.style).toBe('elite');
    const elite = boss!.style === 'elite' ? boss!.elite : null;
    const profile = kindProfiles(wave).boss;
    expect(profile.reward).toBe(elite!.reward);
    expect(profile.healthMultiplier).toBe(
      devTuning.types[elite!.kind].healthMult * elite!.healthMultiplier,
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
    expect(row.counts.walker).toBe(30);
    expect(row.population).toBe(30);
    // 30 walkers at the walker slider's 0.7x of the 40hp base, no wave
    // multiplier yet.
    expect(row.threat).toBe(840);
    expect(row.specialistShare).toBe(0);
    expect(row.isBossWave).toBe(false);
  });

  it('reports the cap as headroom while the wave still fits', () => {
    // Wave 4 is the lull before the first boss: the cap has climbed past what
    // the wave asks for, so nothing queues.
    const row = waveLabRow(4);
    expect(row.maxActive).toBe(32);
    expect(row.population).toBeLessThanOrEqual(row.maxActive);
    expect(row.overflow).toBe(0);
  });

  it('reports the surplus once the wave outgrows the cap', () => {
    const row = waveLabRow(11);
    expect(row.population).toBe(73);
    expect(row.maxActive).toBe(46);
    expect(row.overflow).toBe(27);
  });

  it('counts the boss as a specialist on top of its wave', () => {
    // A boss wave is a boss fought inside a horde, not a duel, so the row still
    // measures a full population. What it must not do is file the boss under
    // walkers: `boss` is deliberately absent from KIND_ORDER, so SPECIALIST_KINDS
    // has to name it or the wave reads as pure chaff.
    const row = waveLabRow(5);
    expect(row.isBossWave).toBe(true);
    expect(row.counts.boss).toBe(1);
    expect(row.specialistShare).toBeCloseTo(
      (row.counts.gunslinger + row.counts.boss) / row.population,
      6,
    );
    // And the boss's own health sheet is priced in: wave 5 fields the same
    // handful of bodies as wave 4 and still scores half again as hard, which
    // only happens if the boss is measured off its sheet rather than as chaff.
    const hordeOnly = waveLabRow(4);
    expect(row.population).toBe(hordeOnly.population);
    expect(row.threat).toBeGreaterThan(hordeOnly.threat * 1.5);
  });

  it('prices a wave by its own composition and clear bonus', () => {
    const row = waveLabRow(1);
    expect(row.killReward).toBe(30 * 3);
    expect(row.wavePayout).toBe(50);
    expect(row.totalPayout).toBe(140);
    expect(row.payPerThreat).toBeCloseTo(140 / 840, 6);
  });

  it('charges spawn time for a wave too big to arrive at once', () => {
    // Hordes average 11, so 73 zombies is seven hordes: six waits of 1.25s.
    expect(waveLabRow(11).spawnFloorSeconds).toBeCloseTo(7.5, 5);
    // 30 takes three hordes: two waits, at the early 1.45s tempo.
    expect(waveLabRow(1).spawnFloorSeconds).toBeCloseTo(2.9, 5);
  });
});

describe('run summary', () => {
  const rows = waveLabRows(20);

  it('finds the wave where zombies start queueing instead of appearing', () => {
    // Wave one already asks for more bodies than the cap allows, so the queue
    // is there from the first wave rather than opening up later in the run.
    expect(summarize(rows).firstOverflowWave).toBe(1);
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
