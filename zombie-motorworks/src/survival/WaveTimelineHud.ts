import './WaveTimelineHud.css';
import {
  THREAT_LABELS,
  waveMarker,
  type TimelineNode,
  type TimelineNodeState,
  type WaveMarkerKind,
  type WaveTimeline,
} from '../core/waveTimeline.ts';

const MAX_SEGMENT_COUNT = 40;
const HUD_MAX_WIDTH = 470;
const HUD_VIEWPORT_INSET = 16;
const HUD_WIDE_HORIZONTAL_PADDING = 36;
const HUD_NARROW_HORIZONTAL_PADDING = 28;
const HUD_NARROW_BREAKPOINT = 420;
const HUD_RAIL_INSET = 4;
const MAX_TILE_SIZE = 62;
const CURRENT_TILE_BOUNDING_SCALE = 1.17;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const WAVE_MARKER_KINDS = [
  'cleared',
  'current',
  'wave',
  'milestone',
  'boss',
] as const;
const WAVE_MARKER_CLASSES: Readonly<Record<WaveMarkerKind, string>> = {
  cleared: 'wave-timeline__node--marker-cleared',
  current: 'wave-timeline__node--marker-current',
  wave: 'wave-timeline__node--marker-wave',
  milestone: 'wave-timeline__node--marker-milestone',
  boss: 'wave-timeline__node--marker-boss',
};

type KillSegmentState = 'cleared' | 'next' | 'remaining';

interface TimelineNodeElements {
  readonly root: HTMLDivElement;
  readonly number: HTMLSpanElement;
  readonly check: SVGSVGElement;
  readonly star: SVGSVGElement;
  readonly burst: SVGSVGElement;
  state: TimelineNodeState | null;
  marker: WaveMarkerKind | null;
}

export class WaveTimelineHud {
  readonly root: HTMLElement;

  private readonly killBar: HTMLDivElement;
  private readonly track: HTMLDivElement;
  private readonly waveLabel: HTMLDivElement;
  private readonly clearedLabel: HTMLDivElement;
  private readonly nodeElements: TimelineNodeElements[] = [];
  private readonly killSegments: HTMLSpanElement[] = [];
  private readonly killSegmentStates: (KillSegmentState | null)[] = [];
  private waveNumbers: number[] = [];
  private killFill: HTMLSpanElement | null = null;
  private viewportWidth = viewportWidth();
  private nodeRevision = 0;
  private lastAlignedTotal = Number.NaN;
  private lastAlignedNodeRevision = -1;
  private lastAlignedViewportWidth = Number.NaN;
  private killBarTotal = Number.NaN;
  private killBarUsesContinuousFill = false;
  private lastKillProgress = Number.NaN;
  private lastKilled = Number.NaN;
  private lastTotal = Number.NaN;
  private lastWave = Number.NaN;
  private lastSummaryKilled = Number.NaN;
  private lastSummaryTotal = Number.NaN;
  private disposed = false;
  private readonly onResize = (): void => {
    const nextViewportWidth = viewportWidth();
    if (nextViewportWidth === this.viewportWidth) return;

    this.viewportWidth = nextViewportWidth;
    this.syncTrackGeometry(this.killBarTotal);
  };

  constructor() {
    this.root = element('section', 'wave-timeline');
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Wave progress');

    this.waveLabel = element('div', 'wave-timeline__wave-label');
    this.clearedLabel = element('div', 'wave-timeline__cleared');
    const summary = element('div', 'wave-timeline__summary');
    summary.append(this.waveLabel, this.clearedLabel);

    this.killBar = element('div', 'wave-timeline__kill-bar');
    this.killBar.setAttribute('role', 'progressbar');
    this.killBar.setAttribute('aria-label', 'Wave kills cleared');
    this.killBar.setAttribute('aria-valuemin', '0');

    this.track = element('div', 'wave-timeline__track');
    const progress = element('div', 'wave-timeline__progress');
    progress.append(this.killBar, this.track);
    this.root.append(summary, progress);
    window.addEventListener('resize', this.onResize, { passive: true });
  }

  /** The node scaffold is stable across frames; volatile values are diffed. */
  update(timeline: WaveTimeline): void {
    if (this.disposed) return;

    if (waveNumbersChanged(this.waveNumbers, timeline.nodes)) {
      this.rebuildNodes(timeline.nodes);
    }

    for (let index = 0; index < timeline.nodes.length; index += 1) {
      this.updateNode(this.nodeElements[index], timeline.nodes[index]);
    }

    const total = nonNegativeInteger(timeline.totalThisWave);
    const killed = clamp(nonNegativeInteger(timeline.killedThisWave), 0, total);
    this.syncTrackGeometry(total);
    this.updateKillBar(killed, total);
    this.updateSummary(timeline.currentWave, killed, total);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
    this.root.replaceChildren();
    this.nodeElements.length = 0;
    this.waveNumbers.length = 0;
    this.killSegments.length = 0;
    this.killSegmentStates.length = 0;
    this.killFill = null;
  }

  private rebuildNodes(nodes: readonly TimelineNode[]): void {
    this.track.replaceChildren();
    this.nodeElements.length = 0;
    this.waveNumbers = nodes.map((node) => node.wave);
    this.nodeRevision += 1;

    for (const node of nodes) {
      const root = element('div', 'wave-timeline__node');
      root.setAttribute('role', 'img');

      const tile = element('span', 'wave-timeline__tile');
      tile.setAttribute('aria-hidden', 'true');
      const content = element('span', 'wave-timeline__tile-content');
      const check = markerSvg(
        'wave-timeline__glyph wave-timeline__glyph--check',
        'M9.2 18.2 4.4 13.4 6.5 11.3 9.2 14 17.5 5.7 19.6 7.8Z',
      );
      const star = markerSvg(
        'wave-timeline__glyph wave-timeline__glyph--star',
        'M12 2.2 14.9 8.1 21.4 9 16.7 13.6 17.8 20.1 12 17.1 6.2 20.1 7.3 13.6 2.6 9 9.1 8.1Z',
      );
      const burst = markerSvg(
        'wave-timeline__glyph wave-timeline__glyph--burst',
        'M12 1.5 14.6 9.4 22.5 12 14.6 14.6 12 22.5 9.4 14.6 1.5 12 9.4 9.4Z',
      );
      const number = element('span', 'wave-timeline__number');
      number.textContent = String(node.wave);
      content.append(check, star, burst, number);
      tile.appendChild(content);
      root.appendChild(tile);
      this.track.appendChild(root);
      this.nodeElements.push({
        root,
        number,
        check,
        star,
        burst,
        state: null,
        marker: null,
      });
    }
  }

  /**
   * The bar owns the progress geometry, so tiles follow its interior gaps
   * instead of trying to imitate flex distribution with decorative spacing.
   */
  private syncTrackGeometry(total: number): void {
    if (this.nodeElements.length === 0 || !Number.isFinite(total)) return;
    if (
      Object.is(total, this.lastAlignedTotal) &&
      this.nodeRevision === this.lastAlignedNodeRevision &&
      this.viewportWidth === this.lastAlignedViewportWidth
    ) {
      return;
    }

    const tileCount = this.nodeElements.length;
    const railWidth = this.railWidth();
    const useEvenTileSpacing = total <= 1 || total > MAX_SEGMENT_COUNT;
    let previousPosition = 0;
    let smallestSpan = Number.POSITIVE_INFINITY;

    for (let index = 0; index < tileCount; index += 1) {
      const position = useEvenTileSpacing
        ? (index + 0.5) / tileCount
        : clamp(
            Math.round(((index + 0.5) * total) / tileCount),
            1,
            total - 1,
          ) / total;
      const centre = position * railWidth;

      if (index === 0) {
        smallestSpan = centre * 2;
      } else {
        smallestSpan = Math.min(smallestSpan, centre - previousPosition);
      }
      if (index === tileCount - 1) {
        smallestSpan = Math.min(smallestSpan, (railWidth - centre) * 2);
      }

      this.nodeElements[index].root.style.left = `${position * 100}%`;
      previousPosition = centre;
    }

    // A rotated current tile is wider than its square slot, so reserve its
    // footprint for every position as the current wave shifts through the row.
    const tileSize = Math.max(
      0,
      Math.min(MAX_TILE_SIZE, smallestSpan / CURRENT_TILE_BOUNDING_SCALE),
    );
    this.track.style.setProperty('--wave-timeline-node-size', `${tileSize}px`);
    this.track.style.setProperty(
      '--wave-timeline-node-footprint',
      `${tileSize * CURRENT_TILE_BOUNDING_SCALE}px`,
    );
    this.track.style.setProperty(
      '--wave-timeline-number-size',
      `${Math.min(22, Math.max(0, tileSize * 0.38))}px`,
    );
    this.lastAlignedTotal = total;
    this.lastAlignedNodeRevision = this.nodeRevision;
    this.lastAlignedViewportWidth = this.viewportWidth;
  }

  private railWidth(): number {
    const panelWidth = Math.min(
      HUD_MAX_WIDTH,
      Math.max(0, this.viewportWidth - HUD_VIEWPORT_INSET),
    );
    const horizontalPadding =
      this.viewportWidth <= HUD_NARROW_BREAKPOINT
        ? HUD_NARROW_HORIZONTAL_PADDING
        : HUD_WIDE_HORIZONTAL_PADDING;
    return Math.max(0, panelWidth - horizontalPadding - HUD_RAIL_INSET);
  }

  private updateNode(elements: TimelineNodeElements, node: TimelineNode): void {
    let changed = false;
    if (elements.state !== node.state) {
      elements.root.classList.toggle(
        'wave-timeline__node--past',
        node.state === 'past',
      );
      elements.root.classList.toggle(
        'wave-timeline__node--current',
        node.state === 'current',
      );
      elements.root.classList.toggle(
        'wave-timeline__node--future',
        node.state === 'future',
      );
      if (node.state === 'current') {
        elements.root.setAttribute('aria-current', 'step');
      } else {
        elements.root.removeAttribute('aria-current');
      }
      elements.state = node.state;
      changed = true;
    }

    const marker = waveMarker(node);
    if (elements.marker !== marker) {
      for (const kind of WAVE_MARKER_KINDS) {
        elements.root.classList.toggle(
          WAVE_MARKER_CLASSES[kind],
          marker === kind,
        );
      }
      elements.marker = marker;
      changed = true;
    }

    if (changed) {
      const label = markerLabel(node, marker);
      elements.root.setAttribute('aria-label', label);
      elements.root.title = label;
    }
  }

  private updateKillBar(killed: number, total: number): void {
    this.ensureKillBar(total);

    if (!Object.is(total, this.lastTotal)) {
      this.killBar.setAttribute('aria-valuemax', String(total));
      this.lastTotal = total;
    }
    if (!Object.is(killed, this.lastKilled)) {
      this.killBar.setAttribute('aria-valuenow', String(killed));
      this.lastKilled = killed;
    }

    if (this.killBarUsesContinuousFill) {
      const progress = total > 0 ? killed / total : 0;
      if (!Object.is(progress, this.lastKillProgress)) {
        this.killFill?.style.setProperty(
          '--wave-timeline-kill-progress',
          `${progress * 100}%`,
        );
        this.lastKillProgress = progress;
      }
      return;
    }

    for (let index = 0; index < this.killSegments.length; index += 1) {
      const state: KillSegmentState =
        index < killed ? 'cleared' : index === killed ? 'next' : 'remaining';
      if (this.killSegmentStates[index] === state) continue;
      const segment = this.killSegments[index];
      segment.classList.toggle(
        'wave-timeline__kill-segment--cleared',
        state === 'cleared',
      );
      segment.classList.toggle(
        'wave-timeline__kill-segment--next',
        state === 'next',
      );
      segment.classList.toggle(
        'wave-timeline__kill-segment--remaining',
        state === 'remaining',
      );
      this.killSegmentStates[index] = state;
    }
  }

  private ensureKillBar(total: number): void {
    const useContinuousFill = total > MAX_SEGMENT_COUNT;
    if (
      Object.is(this.killBarTotal, total) &&
      this.killBarUsesContinuousFill === useContinuousFill
    ) {
      return;
    }

    this.killBar.replaceChildren();
    this.killSegments.length = 0;
    this.killSegmentStates.length = 0;
    this.killFill = null;
    this.killBarTotal = total;
    this.killBarUsesContinuousFill = useContinuousFill;
    this.lastKillProgress = Number.NaN;
    this.lastKilled = Number.NaN;
    this.lastTotal = Number.NaN;
    this.killBar.classList.toggle(
      'wave-timeline__kill-bar--continuous',
      useContinuousFill,
    );

    if (useContinuousFill) {
      const fill = element('span', 'wave-timeline__kill-fill');
      fill.setAttribute('aria-hidden', 'true');
      this.killBar.appendChild(fill);
      this.killFill = fill;
      return;
    }

    for (let index = 0; index < total; index += 1) {
      const segment = element('span', 'wave-timeline__kill-segment');
      segment.setAttribute('aria-hidden', 'true');
      this.killBar.appendChild(segment);
      this.killSegments.push(segment);
      this.killSegmentStates.push(null);
    }
  }

  private updateSummary(wave: number, killed: number, total: number): void {
    if (!Object.is(wave, this.lastWave)) {
      this.waveLabel.textContent = `WAVE ${wave}`;
      this.lastWave = wave;
    }
    if (
      !Object.is(killed, this.lastSummaryKilled) ||
      !Object.is(total, this.lastSummaryTotal)
    ) {
      this.clearedLabel.textContent = `${killed}/${total} CLEARED`;
      this.lastSummaryKilled = killed;
      this.lastSummaryTotal = total;
    }
  }
}

function waveNumbersChanged(
  previous: readonly number[],
  nodes: readonly TimelineNode[],
): boolean {
  if (previous.length !== nodes.length) return true;
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].wave !== previous[index]) return true;
  }
  return false;
}

function markerLabel(node: TimelineNode, marker: WaveMarkerKind): string {
  switch (marker) {
    case 'cleared':
      return `Wave ${node.wave} — cleared`;
    case 'current':
      return `Wave ${node.wave} — current wave`;
    case 'milestone':
      return `Wave ${node.wave} — milestone: ${threatLabels(node.threats)}`;
    case 'boss':
      return `Wave ${node.wave} — boss: ${threatLabels(node.threats)}`;
    case 'wave':
      return `Wave ${node.wave} — upcoming wave`;
  }
}

function threatLabels(threats: readonly string[]): string {
  return threats
    .map((threat) => THREAT_LABELS[threat] ?? 'specialist threat')
    .join(', ');
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function viewportWidth(): number {
  return Math.max(0, window.innerWidth);
}

function markerSvg(className: string, pathData: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.classList.add(...className.split(' '));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', pathData);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
