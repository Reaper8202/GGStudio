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
    expect(newThreatsForWave(10)).toEqual(['phone-addict']);
    expect(newThreatsForWave(11)).toEqual([]);
  });

  it('flags the wave-10 Phone Addict and garage EMP recommendation after wave 9', () => {
    expect(threatWarningsForWave(10)).toEqual([
      'Shielded Phone Addicts next — bring EMP. Buy EMP in the garage before wave 10.',
    ]);
  });

  it('formats exact wave composition while omitting zero-count kinds', () => {
    expect(formatWaveComposition(zombieCompositionForWave(1))).toBe(
      '13 walkers / 1 gunslinger',
    );
    expect(formatWaveComposition(zombieCompositionForWave(3))).toBe(
      '19 walkers / 1 gunslinger / 1 thrower',
    );
    expect(formatWaveComposition(zombieCompositionForWave(10))).toBe(
      '40 walkers / 4 gunslingers / 1 necromancer / 4 throwers / 2 workers / 1 phone-addict / 5 kamikazes',
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

    expect(summary).toEqual({
      partCount: 2,
      investment: 400,
      refund: 200,
      forfeited: 200,
    });
  });
});
