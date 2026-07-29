import { describe, expect, it } from 'vitest';
import {
  SCORE_PER_KILL,
  addScore,
  killScore,
  waveClearScore,
  waveScoreMultiplier,
  type ScoreZombieKind,
} from '../src/core/score.ts';
import type { ZombieKind } from '../src/survival/zombies/Zombie.ts';

const _scoreKindCheck: ScoreZombieKind = null as unknown as ZombieKind;
const _zombieKindCheck: ZombieKind = null as unknown as ScoreZombieKind;
void _scoreKindCheck;
void _zombieKindCheck;

describe('run score', () => {
  it('awards the base kill table on wave 1', () => {
    expect(SCORE_PER_KILL).toEqual({
      walker: 10,
      gunslinger: 20,
      necromancer: 45,
      worker: 25,
      thrower: 30,
      'phone-addict': 20,
      kamikaze: 15,
    });

    for (const [kind, baseScore] of Object.entries(SCORE_PER_KILL)) {
      expect(killScore(kind as ScoreZombieKind, 1)).toBe(baseScore);
    }
  });

  it('awards exactly twice the base kill score on wave 11', () => {
    expect(waveScoreMultiplier(11)).toBe(2);

    for (const [kind, baseScore] of Object.entries(SCORE_PER_KILL)) {
      expect(killScore(kind as ScoreZombieKind, 11)).toBe(baseScore * 2);
    }
  });

  it('always returns an integer kill score and rejects unknown kinds', () => {
    for (const kind of Object.keys(SCORE_PER_KILL) as ScoreZombieKind[]) {
      expect(Number.isInteger(killScore(kind, 7.25))).toBe(true);
    }
    expect(killScore('unknown' as ScoreZombieKind, 4)).toBe(0);
  });

  it('treats invalid multiplier waves as wave 1', () => {
    expect(waveScoreMultiplier(0)).toBe(1);
    expect(waveScoreMultiplier(Number.NaN)).toBe(1);
    expect(waveScoreMultiplier(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('awards the wave-clear bonus', () => {
    expect(waveClearScore(1)).toBe(100);
    expect(waveClearScore(12)).toBe(1_200);
    expect(waveClearScore(0)).toBe(0);
  });

  it('refuses invalid or overflowing accumulated totals', () => {
    expect(addScore(100, 25)).toBe(125);
    expect(addScore(100, Number.NaN)).toBe(100);
    expect(addScore(100, Number.POSITIVE_INFINITY)).toBe(100);
    expect(addScore(5, -6)).toBe(5);
    expect(addScore(Number.MAX_SAFE_INTEGER, 1)).toBe(Number.MAX_SAFE_INTEGER);
  });
});
