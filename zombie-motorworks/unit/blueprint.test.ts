import { describe, expect, it } from 'vitest';
import {
  createEmptyBlueprint,
  pruneBlueprintToSurvivors,
} from '../src/core/blueprint.ts';
import type { PlacedPart, VehicleBlueprint } from '../src/core/types.ts';

function part(id: string, level = 1): PlacedPart {
  return {
    id,
    defId: 'frame-box',
    pos: { x: Number(id.slice(1)), y: 0, z: 0 },
    orient: 0,
    config: { level },
  };
}

describe('blueprint helpers', () => {
  it('immutably prunes parts to the surviving IDs in source order', () => {
    const original: VehicleBlueprint = {
      ...createEmptyBlueprint('wave survivors'),
      id: 'survivor-test',
      parts: [part('p1'), part('p2', 2), part('p3', 3)],
    };
    const before = structuredClone(original);

    const pruned = pruneBlueprintToSurvivors(
      original,
      new Set(['p3', 'unknown', 'p1']),
    );

    expect(pruned).not.toBe(original);
    expect(pruned.parts).not.toBe(original.parts);
    expect(pruned.parts.map((entry) => entry.id)).toEqual(['p1', 'p3']);
    expect(pruned.parts[1].config).toEqual({ level: 3 });
    expect(original).toEqual(before);

    pruned.parts[0].pos.x = 99;
    pruned.parts[1].config.level = 5;
    expect(original).toEqual(before);
  });
});
