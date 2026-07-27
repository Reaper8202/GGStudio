import { describe, expect, it } from 'vitest';
import { NEUTRAL_ENVIRONMENT, type PropScatter } from '../src/core/biomes.ts';
import { makeRng } from '../src/core/rng.ts';
import { sampleScatterPositions } from '../src/survival/arena/placement.ts';
import { GRAVEYARD } from '../src/survival/arena/recipes/graveyard.ts';

describe('graveyard arena recipe', () => {
  it('keeps authored fixtures valid and collider dimensions explicit', () => {
    const fixtures = GRAVEYARD.layout.fixtures ?? [];
    expect(fixtures).toHaveLength(340);

    for (const fixture of fixtures) {
      expect(fixture.asset.trim()).not.toBe('');
      if (fixture.scale !== undefined) expect(fixture.scale).toBeGreaterThan(0);
      if (fixture.scaleY !== undefined)
        expect(fixture.scaleY).toBeGreaterThan(0);
      if (fixture.collider === 'box' || fixture.collider === 'cylinder') {
        expect(fixture.colliderSize).toBeDefined();
      }
    }
  });

  it('retains neutral asphalt handling with no active hazard', () => {
    expect(GRAVEYARD.layout.baseSurface).toBe('asphalt');
    expect(GRAVEYARD.layout.roadSurface).toBe('asphalt');
    expect(GRAVEYARD.layout.patches).toEqual([]);
    expect(GRAVEYARD.layout.scatters).toEqual([]);
    expect(GRAVEYARD.drive).toEqual(NEUTRAL_ENVIRONMENT);
    expect(GRAVEYARD.hazard.kind).toBe('none');
  });
});

describe('sampleScatterPositions', () => {
  const scatter: PropScatter = {
    table: [{ asset: 'prop', weight: 1 }],
    count: [20, 20],
    minSpacing: 3,
    keepClearRadius: 5,
  };
  const bounds = { minX: -20, maxX: 20, minZ: -18, maxZ: 18 };

  it('is deterministic per seed and satisfies spatial constraints', () => {
    const first = sampleScatterPositions(scatter, bounds, makeRng(481516));
    const second = sampleScatterPositions(scatter, bounds, makeRng(481516));

    expect(first).toEqual(second);
    expect(first).toHaveLength(20);
    for (let i = 0; i < first.length; i++) {
      const point = first[i]!;
      expect(point.x).toBeGreaterThanOrEqual(bounds.minX);
      expect(point.x).toBeLessThan(bounds.maxX);
      expect(point.z).toBeGreaterThanOrEqual(bounds.minZ);
      expect(point.z).toBeLessThan(bounds.maxZ);
      expect(Math.hypot(point.x, point.z)).toBeGreaterThanOrEqual(
        scatter.keepClearRadius,
      );

      for (let j = i + 1; j < first.length; j++) {
        const other = first[j]!;
        expect(
          Math.hypot(point.x - other.x, point.z - other.z),
        ).toBeGreaterThanOrEqual(scatter.minSpacing);
      }
    }
  });
});
