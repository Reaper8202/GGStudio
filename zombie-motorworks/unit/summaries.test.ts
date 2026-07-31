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
    expect(newThreatsForWave(10)).toEqual(['phone-addict']);
    expect(newThreatsForWave(11)).toEqual([]);
  });

  it('flags the wave-10 Phone Addict and garage EMP recommendation after wave 9', () => {
    expect(threatWarningsForWave(10)).toEqual([
      'Shielded Phone Addicts next — bring EMP. Buy EMP in the garage before wave 10.',
    ]);
  });

  it('flags the wave-8 Behemoth boss introduction', () => {
    expect(threatWarningsForWave(8)).toEqual([
      'Behemoths incoming — they hit like a wrecking ball. Watch the red ring and keep moving.',
    ]);
  });

  it('formats exact wave composition while omitting zero-count kinds', () => {
    expect(formatWaveComposition(zombieCompositionForWave(1))).toBe(
      '18 walkers',
    );
    expect(formatWaveComposition(zombieCompositionForWave(3))).toBe(
      '19 walkers / 1 gunslinger / 1 thrower',
    );
    expect(formatWaveComposition(zombieCompositionForWave(10))).toBe(
      '40 walkers / 10 gunslingers / 1 necromancer / 4 throwers / 2 workers / 1 phone-addict / 5 kamikazes / 1 behemoth / 1 zamboni',
    );
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
