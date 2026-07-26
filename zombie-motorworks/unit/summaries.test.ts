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
    expect(newThreatsForWave(3)).toEqual(['thrower']);
    expect(newThreatsForWave(7)).toEqual(['worker']);
    // Wave 10 is a boss wave and fields no phone-addicts, so the first wave
    // that actually brings them — and therefore warns about them — is 11.
    expect(newThreatsForWave(10)).toEqual([]);
    expect(newThreatsForWave(11)).toEqual(['phone-addict']);
    expect(newThreatsForWave(12)).toEqual([]);
  });

  it('flags the Phone Addict and garage EMP recommendation the wave before', () => {
    expect(threatWarningsForWave(11)).toEqual([
      'Shielded Phone Addicts next — bring EMP. Buy EMP in the garage now.',
    ]);
  });

  it('announces the boss ahead of every fifth wave', () => {
    expect(threatWarningsForWave(5)).toEqual([
      'BOSS WAVE — The Sledge. Slow but brutal: stay out of the hammer ring.',
    ]);
    expect(threatWarningsForWave(6)).toEqual([]);
  });

  it('formats exact wave composition while omitting zero-count kinds', () => {
    expect(formatWaveComposition(zombieCompositionForWave(1))).toBe(
      '13 walkers',
    );
    expect(formatWaveComposition(zombieCompositionForWave(3))).toBe(
      '19 walkers / 1 thrower',
    );
    expect(formatWaveComposition(zombieCompositionForWave(11))).toBe(
      '43 walkers / 5 throwers / 2 workers / 1 phone-addict',
    );
    expect(formatWaveComposition(zombieCompositionForWave(5))).toBe('1 boss');
  });

  it('totals New Garage investment, per-part refunds, and forfeited value', () => {
    const summary = newGarageDisposalSummary(
      [
        placed('core', 'chassis-core', { level: 3 }),
        placed('frame', 'frame-box', { level: 2 }),
        placed('turret', 'turret', {
          level: 3,
          empLevel: 2,
          piercingLevel: 1,
        }),
      ],
      getPartDef,
    );

    expect(summary).toEqual({
      partCount: 2,
      investment: 800,
      refund: 400,
      forfeited: 400,
    });
  });
});
