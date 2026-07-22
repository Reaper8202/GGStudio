import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MINIMAP_REDRAW_HZ,
  Minimap,
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

    const northEdge = worldToMinimap(road.minX, road.maxZ, BOUNDS, sizePx);
    const southEdge = worldToMinimap(road.minX, road.minZ, BOUNDS, sizePx);

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

describe('Minimap mine markers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { document?: Document }).document;
    delete (globalThis as { window?: Window & typeof globalThis }).window;
  });

  it('draws mine markers when revealed mines are passed', () => {
    const harness = installMinimapDom();
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const minimap = new Minimap(harness.parent, BOUNDS);
    const foreground = harness.contexts[0];
    foreground.operations.length = 0;

    minimap.update(20, 10, 0, [], [{ x: 10, z: 0, revealed: true }]);

    expect(foreground.operations).toContain('fillStyle:#ffae3d');
    expect(foreground.operations).toContain('lineTo:107.40,112.80');
    minimap.dispose();
  });

  it('does not draw markers for unrevealed mines', () => {
    const harness = installMinimapDom();
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const minimap = new Minimap(harness.parent, BOUNDS);
    const foreground = harness.contexts[0];
    foreground.operations.length = 0;

    minimap.update(20, 10, 0, [], [{ x: 10, z: 0, revealed: false }]);

    expect(foreground.operations).toContain('fillStyle:#ffae3d');
    expect(foreground.operations).not.toContain('lineTo:107.40,112.80');
    minimap.dispose();
  });

  it('does not draw mine markers when the mines argument is omitted', () => {
    const harness = installMinimapDom();
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const minimap = new Minimap(harness.parent, BOUNDS);
    const foreground = harness.contexts[0];
    foreground.operations.length = 0;

    minimap.update(20, 10, 0, [], undefined);

    expect(foreground.operations).not.toContain('fillStyle:#ffae3d');
    minimap.dispose();
  });
});

class FakeElement {
  className = '';
  readonly children: FakeElement[] = [];

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  remove(): void {}
}

class FakeCanvas extends FakeElement {
  width = 0;
  height = 0;
  clientWidth = 188;

  constructor(private readonly context: FakeContext) {
    super();
  }

  getContext(kind: '2d'): FakeContext | null {
    return kind === '2d' ? this.context : null;
  }
}

class FakeContext {
  readonly operations: string[] = [];
  private currentFillStyle = '';
  private currentStrokeStyle = '';
  private currentLineWidth = 0;
  private currentShadowColor = '';
  private currentShadowBlur = 0;
  private currentLineJoin = '';

  set fillStyle(value: string | CanvasGradient | CanvasPattern) {
    this.currentFillStyle = String(value);
    this.operations.push(`fillStyle:${this.currentFillStyle}`);
  }

  get fillStyle(): string | CanvasGradient | CanvasPattern {
    return this.currentFillStyle;
  }

  set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
    this.currentStrokeStyle = String(value);
  }

  get strokeStyle(): string | CanvasGradient | CanvasPattern {
    return this.currentStrokeStyle;
  }

  set lineWidth(value: number) {
    this.currentLineWidth = value;
  }

  get lineWidth(): number {
    return this.currentLineWidth;
  }

  set shadowColor(value: string) {
    this.currentShadowColor = value;
  }

  get shadowColor(): string {
    return this.currentShadowColor;
  }

  set shadowBlur(value: number) {
    this.currentShadowBlur = value;
  }

  get shadowBlur(): number {
    return this.currentShadowBlur;
  }

  set lineJoin(value: CanvasLineJoin) {
    this.currentLineJoin = value;
  }

  get lineJoin(): CanvasLineJoin {
    return this.currentLineJoin as CanvasLineJoin;
  }

  setTransform(): void {}
  clearRect(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  drawImage(): void {}
  beginPath(): void {}
  closePath(): void {}
  fill(): void {}
  stroke(): void {}
  arc(): void {}

  moveTo(x: number, y: number): void {
    this.operations.push(`moveTo:${x.toFixed(2)},${y.toFixed(2)}`);
  }

  lineTo(x: number, y: number): void {
    this.operations.push(`lineTo:${x.toFixed(2)},${y.toFixed(2)}`);
  }
}

function installMinimapDom(): {
  parent: HTMLElement;
  contexts: FakeContext[];
} {
  const contexts: FakeContext[] = [];
  const documentStub = {
    createElement(tagName: string): FakeElement {
      if (tagName === 'canvas') {
        const context = new FakeContext();
        contexts.push(context);
        return new FakeCanvas(context);
      }
      return new FakeElement();
    },
  };
  (globalThis as { document: Document }).document =
    documentStub as unknown as Document;
  (globalThis as { window: Window & typeof globalThis }).window = {
    devicePixelRatio: 1,
  } as Window & typeof globalThis;

  return {
    parent: new FakeElement() as unknown as HTMLElement,
    contexts,
  };
}
