import { describe, expect, it } from 'vitest';
import {
  MINIMAP_REDRAW_HZ,
  type MinimapBounds,
  worldToMinimap,
} from '../src/survival/Minimap.ts';
import type { MinimapFeature } from '../src/survival/Graveyard.ts';

const BOUNDS: MinimapBounds = {
  minX: -80,
  maxX: 120,
  minZ: -40,
  maxZ: 60,
};

describe('worldToMinimap', () => {
  it('maps the arena centre to the canvas centre', () => {
    expect(worldToMinimap(20, 10, BOUNDS, 160)).toEqual({ x: 80, y: 80 });
  });

  it('maps north upward and the x-axis from right to left', () => {
    expect(worldToMinimap(BOUNDS.minX, BOUNDS.maxZ, BOUNDS, 160)).toEqual({
      x: 160,
      y: 0,
    });
    expect(worldToMinimap(BOUNDS.maxX, BOUNDS.minZ, BOUNDS, 160)).toEqual({
      x: 0,
      y: 160,
    });
  });

  it('mirrors world X because screen-right is world -X', () => {
    const minimumX = worldToMinimap(BOUNDS.minX, 10, BOUNDS, 160);
    const maximumX = worldToMinimap(BOUNDS.maxX, 10, BOUNDS, 160);

    expect(minimumX.x).toBeCloseTo(160);
    expect(maximumX.x).toBeCloseTo(0);
    expect(minimumX.y).toBeCloseTo(maximumX.y);
  });

  it('is linear between two world points', () => {
    const first = worldToMinimap(-60, -20, BOUNDS, 160);
    const second = worldToMinimap(100, 50, BOUNDS, 160);
    const midpoint = worldToMinimap(20, 15, BOUNDS, 160);

    expect(midpoint.x).toBeCloseTo((first.x + second.x) / 2);
    expect(midpoint.y).toBeCloseTo((first.y + second.y) / 2);
  });

  it('stretches non-square bounds corner-to-corner', () => {
    const nonSquareBounds: MinimapBounds = {
      minX: -500,
      maxX: 500,
      minZ: 10,
      maxZ: 30,
    };

    expect(worldToMinimap(-500, 30, nonSquareBounds, 200)).toEqual({
      x: 200,
      y: 0,
    });
    expect(worldToMinimap(500, 10, nonSquareBounds, 200)).toEqual({
      x: 0,
      y: 200,
    });
  });

  it('agrees with the cached-scale arithmetic used by the draw loop', () => {
    const sizePx = 173;
    const worldX = 31;
    const worldZ = -7;
    const scaleX = sizePx / (BOUNDS.maxX - BOUNDS.minX);
    const scaleZ = sizePx / (BOUNDS.maxZ - BOUNDS.minZ);
    const projected = worldToMinimap(worldX, worldZ, BOUNDS, sizePx);

    expect(projected.x).toBeCloseTo((BOUNDS.maxX - worldX) * scaleX);
    expect(projected.y).toBeCloseTo((BOUNDS.maxZ - worldZ) * scaleZ);
  });

  it('projects in-bounds Graveyard feature rectangles inside the canvas', () => {
    const sizePx = 188;
    const features: readonly MinimapFeature[] = [
      {
        minX: -70,
        maxX: -40,
        minZ: -30,
        maxZ: 50,
        kind: 'road',
      },
      {
        minX: 30,
        maxX: 48,
        minZ: -12,
        maxZ: 9,
        kind: 'obstacle',
      },
    ];

    for (const feature of features) {
      const topRight = worldToMinimap(
        feature.minX,
        feature.maxZ,
        BOUNDS,
        sizePx,
      );
      const bottomLeft = worldToMinimap(
        feature.maxX,
        feature.minZ,
        BOUNDS,
        sizePx,
      );

      expect(topRight.x).toBeLessThanOrEqual(sizePx);
      expect(topRight.y).toBeGreaterThanOrEqual(0);
      expect(bottomLeft.x).toBeGreaterThanOrEqual(0);
      expect(bottomLeft.y).toBeLessThanOrEqual(sizePx);
    }
  });

  it('projects a full-height road across the canvas y range', () => {
    const sizePx = 188;
    const road: MinimapFeature = {
      minX: -8,
      maxX: -4,
      minZ: BOUNDS.minZ,
      maxZ: BOUNDS.maxZ,
      kind: 'road',
    };

    const northEdge = worldToMinimap(
      road.minX,
      road.maxZ,
      BOUNDS,
      sizePx,
    );
    const southEdge = worldToMinimap(
      road.minX,
      road.minZ,
      BOUNDS,
      sizePx,
    );

    expect(northEdge.y).toBeCloseTo(0);
    expect(southEdge.y).toBeCloseTo(sizePx);
  });
});

describe('minimap redraw rate', () => {
  it('is positive and avoids excessive canvas work', () => {
    expect(MINIMAP_REDRAW_HZ).toBeGreaterThan(0);
    expect(MINIMAP_REDRAW_HZ).toBeLessThanOrEqual(30);
  });
});
