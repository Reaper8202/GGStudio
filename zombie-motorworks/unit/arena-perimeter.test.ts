import { describe, expect, it } from 'vitest';
import { BIOMES } from '../src/survival/arena/recipes/index.ts';
import { perimeterWalls } from '../src/survival/arena/placement.ts';

/**
 * Regression cover for the fall-through bug: the snowfield and desert shipped
 * with no boundary at all, because walls were authored as graveyard fixtures
 * rather than derived from the arena. The cosmetic ground tiles overhang the
 * ground collider, so the player drove onto ground that visibly existed and
 * fell through it.
 */
describe('arena perimeter', () => {
  it('walls every edge of every biome', () => {
    for (const biome of Object.values(BIOMES)) {
      const { halfSize } = biome.layout;
      const walls = perimeterWalls(halfSize);
      expect(walls).toHaveLength(4);

      // One wall centred on each edge, and none missing or duplicated.
      const centres = walls.map((w) => `${w.pos[0]},${w.pos[2]}`).sort();
      expect(centres).toEqual(
        [
          `0,${-halfSize}`,
          `0,${halfSize}`,
          `${-halfSize},0`,
          `${halfSize},0`,
        ].sort(),
      );
    }
  });

  it('overlaps the corners so nothing can slip between two walls', () => {
    for (const biome of Object.values(BIOMES)) {
      const { halfSize } = biome.layout;
      for (const wall of perimeterWalls(halfSize)) {
        const alongX = wall.size[0] > wall.size[2];
        const halfLength = alongX ? wall.size[0] : wall.size[2];
        expect(halfLength).toBeGreaterThan(halfSize);
      }
    }
  });

  it('encloses the cosmetic ground overhang, not just the ground collider', () => {
    for (const biome of Object.values(BIOMES)) {
      const { halfSize } = biome.layout;
      for (const wall of perimeterWalls(halfSize)) {
        const onXEdge = Math.abs(wall.pos[0]) === halfSize;
        const onZEdge = Math.abs(wall.pos[2]) === halfSize;
        expect(onXEdge || onZEdge).toBe(true);
      }
    }
  });

  it('stands tall enough and above ground to stop a driving vehicle', () => {
    for (const biome of Object.values(BIOMES)) {
      for (const wall of perimeterWalls(biome.layout.halfSize)) {
        const halfHeight = wall.size[1];
        expect(halfHeight).toBeGreaterThanOrEqual(2);
        // Centre sits a half-height up, so the wall spans ground level upward
        // rather than being buried under the map.
        expect(wall.pos[1]).toBeCloseTo(halfHeight, 5);
      }
    }
  });

  it('scales with the arena rather than assuming the graveyard size', () => {
    const small = perimeterWalls(10);
    const large = perimeterWalls(200);
    expect(small.map((w) => w.pos[2])).not.toEqual(
      large.map((w) => w.pos[2]),
    );
    for (const wall of large) {
      const halfLength = Math.max(wall.size[0], wall.size[2]);
      expect(halfLength).toBeGreaterThan(200);
    }
  });
});
