import { describe, expect, it } from 'vitest';
import { buildStarterBlueprint } from '../src/app/App.ts';
import { createEmptyBlueprint } from '../src/core/blueprint.ts';
import { getPartDef } from '../src/core/parts.ts';
import { canPlacePart, validateBlueprint } from '../src/core/placement.ts';

describe('starter blueprint', () => {
  it('includes a deck turret and remains valid', () => {
    const blueprint = buildStarterBlueprint();

    expect(blueprint.parts).toHaveLength(23);
    expect(blueprint.parts).toContainEqual(
      expect.objectContaining({
        defId: 'turret',
        pos: { x: 0, y: 2, z: 1 },
      }),
    );
    expect(validateBlueprint(blueprint, getPartDef).errors).toEqual([]);
  });

  it('allows both new palette parts to mount on the chassis', () => {
    const blueprint = {
      ...createEmptyBlueprint('palette-parts'),
      parts: [
        {
          id: 'p1',
          defId: 'chassis-core',
          pos: { x: 0, y: 1, z: 0 },
          orient: 0,
          config: {},
        },
      ],
    };

    expect(
      canPlacePart(
        blueprint,
        getPartDef,
        'armour-plate',
        { x: 1, y: 1, z: 0 },
        0,
      ).ok,
    ).toBe(true);
    expect(
      canPlacePart(
        blueprint,
        getPartDef,
        'cannon-heavy',
        { x: 0, y: 2, z: 0 },
        0,
      ).ok,
    ).toBe(true);
  });
});
