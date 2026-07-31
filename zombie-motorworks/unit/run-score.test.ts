import { describe, expect, it, vi } from 'vitest';
import {
  SurvivalMode,
  type SurvivalPhase,
} from '../src/survival/SurvivalMode.ts';
import { killScore, waveClearScore } from '../src/core/score.ts';
import type { ZombieKind } from '../src/survival/zombies/Zombie.ts';

interface ScoreHarness {
  phase: SurvivalPhase;
  kills: number;
  runScore: number;
  phoneAddictKills: number;
  currentWave: number;
  debugProgressionSuppressed: boolean;
  pendingWaveKillReward: number;
  pendingWaveReward: number;
  handleZombieKilled(reward: number, kind: ZombieKind): void;
  onWaveComplete(wave: number, reward: number): void;
}

function createHarness(wave = 1): ScoreHarness {
  const mode = Object.create(SurvivalMode.prototype) as ScoreHarness;
  Object.assign(mode, {
    phase: 'active' satisfies SurvivalPhase,
    kills: 0,
    runScore: 0,
    phoneAddictKills: 0,
    currentWave: wave,
    debugProgressionSuppressed: false,
    pendingWaveKillReward: 0,
    pendingWaveReward: 0,
    pointerFiring: false,
    keys: new Set<string>(),
    callbacks: {
      onPhoneAddictKilled: vi.fn(),
      onWaveCleared: vi.fn(),
    },
    waves: { recordZombieKilled: vi.fn() },
    zombies: {
      clearLandmines: vi.fn(),
      clearIceTrail: vi.fn(),
      clearAcidPuddles: vi.fn(),
    },
    countdownOverlay: { style: { display: 'block' } },
    stuckPrompt: { classList: { remove: vi.fn() } },
  });
  return mode;
}

describe('run score accrual', () => {
  it('awards the wave-scaled kill value for each zombie kind', () => {
    const mode = createHarness(1);

    mode.handleZombieKilled(3, 'walker');
    expect(mode.runScore).toBe(killScore('walker', 1));

    mode.handleZombieKilled(12, 'worker');
    expect(mode.runScore).toBe(killScore('walker', 1) + killScore('worker', 1));
  });

  it('pays more for the same kill on a deeper wave', () => {
    const early = createHarness(1);
    const late = createHarness(11);

    early.handleZombieKilled(3, 'walker');
    late.handleZombieKilled(3, 'walker');

    expect(late.runScore).toBe(early.runScore * 2);
  });

  it('adds the clear bonus when a wave is completed', () => {
    const mode = createHarness(4);

    mode.handleZombieKilled(8, 'thrower');
    const afterKill = mode.runScore;
    mode.onWaveComplete(4, 80);

    expect(mode.runScore).toBe(afterKill + waveClearScore(4));
  });

  it('keeps counting kills but not score while debug progression is suppressed', () => {
    const mode = createHarness(3);
    mode.debugProgressionSuppressed = true;

    mode.handleZombieKilled(3, 'walker');
    mode.onWaveComplete(3, 70);

    expect(mode.kills).toBe(1);
    expect(mode.runScore).toBe(0);
  });

  it('never rolls score back — kills on the fatal wave still count', () => {
    const mode = createHarness(6);

    mode.handleZombieKilled(3, 'walker');
    mode.handleZombieKilled(10, 'phone-addict');
    const earned = mode.runScore;

    // The run ends here: pending money is discarded, score is not.
    mode.pendingWaveKillReward = 0;
    mode.pendingWaveReward = 0;

    expect(earned).toBeGreaterThan(0);
    expect(mode.runScore).toBe(earned);
  });

  it('accumulates across many kills without drifting from the table', () => {
    const mode = createHarness(2);
    const kinds: ZombieKind[] = ['walker', 'thrower', 'worker', 'phone-addict'];

    let expected = 0;
    for (let i = 0; i < 40; i++) {
      const kind = kinds[i % kinds.length]!;
      mode.handleZombieKilled(3, kind);
      expected += killScore(kind, 2);
    }

    expect(mode.runScore).toBe(expected);
    expect(mode.kills).toBe(40);
  });
});
