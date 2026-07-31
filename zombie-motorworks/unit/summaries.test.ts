import { describe, expect, it } from 'vitest';
import { newGarageDisposalSummary } from '../src/editor/EditorMode.ts';
import { getPartDef } from '../src/core/parts.ts';
import type { PlacedPart } from '../src/core/types.ts';
import { zombieCompositionForWave } from '../src/survival/WaveManager.ts';
import {
  formatWaveComposition,
  newThreatsForWave,
  threatWarningsForWave,
} from '../src/survival/waveBalance.ts';

function placed(
  id: string,
  defId: string,
  config: PlacedPart['config'] = {},
): PlacedPart {
  return {
    id,
    defId,
    pos: { x: 0, y: 0, z: 0 },
    orient: 0,
    config,
  };
}

describe('legible consequence summaries', () => {
  it('reports each specialist only on the wave where it first appears', () => {
    expect(newThreatsForWave(2)).toEqual([]);
    expect(newThreatsForWave(3)).toEqual(['gunslinger', 'thrower']);
    expect(newThreatsForWave(7)).toEqual(['worker']);
    expect(newThreatsForWave(8)).toEqual(['behemoth']);
    // The Phone Addict curve opens on wave 10, but wave 10 is a boss duel with
    // no horde at all, so the first one the player actually meets is on 11. The
    // look-back in newThreatsForWave skips boss waves, which is what makes the
    // introduction slide instead of being swallowed.
    expect(newThreatsForWave(10)).toEqual([]);
    expect(newThreatsForWave(11)).toEqual(['phone-addict']);
    expect(newThreatsForWave(12)).toEqual([]);
  });

  it('announces the boss instead of a specialist on a boss wave', () => {
    expect(threatWarningsForWave(5)).toEqual([
      'BOSS WAVE — The Sledge. Slow but brutal: stay out of the hammer ring.',
    ]);
    expect(threatWarningsForWave(10)).toEqual([
      'BOSS WAVE — The Alchemist. It kites and lobs acid vials: stay out of the puddles they leave behind.',
    ]);
    // An ordinary wave may still warn about a specialist, but never about a boss.
    for (const wave of [6, 7, 11]) {
      for (const warning of threatWarningsForWave(wave)) {
        expect(warning).not.toContain('BOSS WAVE');
      }
    }
  });

  it('flags the Phone Addict and garage EMP recommendation on wave 11', () => {
    // No wave number in the copy: the boss wave shifted this by one, and it will
    // shift again for anything the boss interval displaces later.
    expect(threatWarningsForWave(11)).toEqual([
      'Shielded Phone Addicts next — bring EMP. Buy EMP in the garage now.',
    ]);
  });

  it('flags the wave-8 Behemoth boss introduction', () => {
    expect(threatWarningsForWave(8)).toEqual([
      'Behemoths incoming — they hit like a wrecking ball. Watch the red ring and keep moving.',
    ]);
  });

  it('formats exact wave composition while omitting zero-count kinds', () => {
    expect(formatWaveComposition(zombieCompositionForWave(1))).toBe(
      '13 walkers',
    );
    expect(formatWaveComposition(zombieCompositionForWave(3))).toBe(
      '19 walkers / 1 gunslinger / 1 thrower',
    );
    // Wave 11, not 10: wave 10 is a boss duel, asserted separately below.
    expect(formatWaveComposition(zombieCompositionForWave(11))).toBe(
      '43 walkers / 10 gunslingers / 2 necromancers / 5 throwers / 2 workers / 1 phone-addict / 5 kamikazes / 1 behemoth',
    );
    // A boss wave replaces the whole horde, both times it comes round.
    expect(formatWaveComposition(zombieCompositionForWave(5))).toBe('1 boss');
    expect(formatWaveComposition(zombieCompositionForWave(10))).toBe('1 boss');
  });

  it('totals New Garage investment, per-part refunds, and forfeited value', () => {
    const summary = newGarageDisposalSummary(
      [
        placed('core', 'chassis-core', { level: 3 }),
        placed('frame', 'frame-box', { level: 2 }),
        placed('turret', 'turret', { level: 3 }),
      ],
      getPartDef,
    );

    // Concrete totals, not the same helpers re-run: recomputing the expectation
    // with partInvestment/sellRefund would reimplement the production sum in
    // the test and compare it against itself. The root chassis is excluded from
    // the count and the totals, which is what partCount 2 is asserting.
    // frame-box L2 = 16, turret L6 = 1573.
    expect(summary).toEqual({
      partCount: 2,
      investment: 400,
      refund: 200,
      forfeited: 200,
    });
  });
});
