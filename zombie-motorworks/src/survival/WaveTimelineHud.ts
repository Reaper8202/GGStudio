import './WaveTimelineHud.css';
import {
  THREAT_LABELS,
  waveIcon,
  type TimelineNode,
  type TimelineNodeState,
  type WaveIconKind,
  type WaveTimeline,
} from '../core/waveTimeline.ts';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * One icon per wave: a zombie head for an ordinary wave, a hazard sign for the
 * wave that introduces a new zombie type, a skull for a boss wave. Numbers are
 * deliberately absent — the head reads "WAVE 7", and the rail only has to say
 * what is coming, which a driver can take in without reading.
 *
 * All three are 9x9 pixel grids rather than curves so they match the blocky UI,
 * and they are drawn as SVG — never emoji, which render per-platform.
 */
const WAVE_ART: Readonly<Record<WaveIconKind, readonly string[]>> = {
  zombie: [
    '.#######.',
    '#########',
    '#.#####.#',
    '#.#####.#',
    '#########',
    '#.#.#.#.#',
    '#########',
    '.#######.',
    '...###...',
  ],
  boss: [
    '..#####..',
    '.#######.',
    '#########',
    '#..###..#',
    '#..###..#',
    '#########',
    '.###.###.',
    '..#####..',
    '..#.#.#..',
  ],
  threat: [
    '....#....',
    '...#.#...',
    '...#.#...',
    '..##.##..',
    '..##.##..',
    '.###.###.',
    '.#######.',
    '####.####',
    '#########',
  ],
};

const ICON_CLASSES: Readonly<Record<WaveIconKind, string>> = {
  zombie: 'wave-timeline__slot--zombie',
  threat: 'wave-timeline__slot--threat',
  boss: 'wave-timeline__slot--boss',
};

const STATE_CLASSES: Readonly<Record<TimelineNodeState, string>> = {
  past: 'wave-timeline__slot--past',
  current: 'wave-timeline__slot--current',
  future: 'wave-timeline__slot--future',
};

interface WaveSlot {
  readonly root: HTMLDivElement;
  readonly mark: HTMLSpanElement;
  icon: WaveIconKind | null;
  state: TimelineNodeState | null;
}

/**
 * Top-centre wave strip: which wave is running, how much of it is left, the run
 * score, and what is coming. The rail is an even CSS grid with its connector
 * drawn from each slot — no measuring, no resize bookkeeping — so the whole
 * component is layout-free.
 */
export class WaveTimelineHud {
  readonly root: HTMLElement;

  private readonly waveLabel: HTMLSpanElement;
  private readonly clearedLabel: HTMLSpanElement;
  private readonly scoreValue: HTMLSpanElement;
  private readonly bar: HTMLDivElement;
  private readonly fill: HTMLSpanElement;
  private readonly rail: HTMLDivElement;
  private readonly slots: WaveSlot[] = [];
  private waves: number[] = [];
  private lastWave = Number.NaN;
  private lastKilled = Number.NaN;
  private lastTotal = Number.NaN;
  private lastScore = Number.NaN;

  constructor() {
    this.root = element('section', 'wave-timeline');
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Wave progress');

    this.waveLabel = element('span', 'wave-timeline__wave');
    this.clearedLabel = element('span', 'wave-timeline__cleared');
    const waveGroup = element('div', 'wave-timeline__group');
    waveGroup.append(this.waveLabel, this.clearedLabel);

    this.scoreValue = element('span', 'wave-timeline__score');
    this.scoreValue.textContent = '0';
    const scoreCaption = element('span', 'wave-timeline__caption');
    scoreCaption.textContent = 'Score';
    const scoreGroup = element(
      'div',
      'wave-timeline__group wave-timeline__group--end',
    );
    scoreGroup.append(this.scoreValue, scoreCaption);

    const head = element('div', 'wave-timeline__head');
    head.append(waveGroup, scoreGroup);

    this.fill = element('span', 'wave-timeline__fill');
    this.fill.setAttribute('aria-hidden', 'true');
    this.bar = element('div', 'wave-timeline__bar');
    this.bar.setAttribute('role', 'progressbar');
    this.bar.setAttribute('aria-label', 'Wave kills cleared');
    this.bar.setAttribute('aria-valuemin', '0');
    this.bar.appendChild(this.fill);

    this.rail = element('div', 'wave-timeline__rail');
    this.root.append(head, this.bar, this.rail);
  }

  /** The rail is rebuilt only when its wave numbers move; the rest is diffed. */
  update(timeline: WaveTimeline): void {
    if (wavesChanged(this.waves, timeline.nodes)) {
      this.rebuildRail(timeline.nodes);
    }
    for (let index = 0; index < timeline.nodes.length; index += 1) {
      this.updateSlot(this.slots[index], timeline.nodes[index]);
    }

    const total = wholeNumber(timeline.totalThisWave);
    const killed = Math.min(wholeNumber(timeline.killedThisWave), total);
    this.updateHead(timeline.currentWave, killed, total);
  }

  setScore(score: number): void {
    const value = wholeNumber(score);
    if (Object.is(value, this.lastScore)) return;
    this.lastScore = value;
    this.scoreValue.textContent = value.toLocaleString();
  }

  /**
   * Hides just the icon rail — the wave/score head and the kill-progress bar
   * stay up — so a boss health bar can take the rail's place without also
   * covering the score.
   */
  setRailHidden(hidden: boolean): void {
    if (this.rail.hidden === hidden) return;
    this.rail.hidden = hidden;
  }

  dispose(): void {
    this.root.remove();
    this.root.replaceChildren();
    this.slots.length = 0;
    this.waves.length = 0;
  }

  private rebuildRail(nodes: readonly TimelineNode[]): void {
    this.rail.replaceChildren();
    this.slots.length = 0;
    this.waves = nodes.map((node) => node.wave);

    // Slots are identical scaffolding; `updateSlot` paints the wave onto them.
    for (let index = 0; index < nodes.length; index += 1) {
      const root = element('div', 'wave-timeline__slot');
      root.setAttribute('role', 'img');
      const mark = element('span', 'wave-timeline__mark');
      root.appendChild(mark);
      this.rail.appendChild(root);
      this.slots.push({ root, mark, icon: null, state: null });
    }
  }

  private updateSlot(slot: WaveSlot, node: TimelineNode): void {
    const icon = waveIcon(node);
    if (slot.icon === icon && slot.state === node.state) return;

    if (slot.icon !== icon) {
      for (const kind of Object.keys(ICON_CLASSES) as WaveIconKind[]) {
        slot.root.classList.toggle(ICON_CLASSES[kind], kind === icon);
      }
      slot.mark.replaceChildren(pixelIcon(WAVE_ART[icon]));
      slot.icon = icon;
    }
    for (const state of Object.keys(STATE_CLASSES) as TimelineNodeState[]) {
      slot.root.classList.toggle(STATE_CLASSES[state], state === node.state);
    }
    if (node.state === 'current') {
      slot.root.setAttribute('aria-current', 'step');
    } else {
      slot.root.removeAttribute('aria-current');
    }
    slot.state = node.state;

    // The rail carries no digits, so the wave number lives on the label.
    const label = slotLabel(node, icon);
    slot.root.setAttribute('aria-label', label);
    slot.root.title = label;
  }

  private updateHead(wave: number, killed: number, total: number): void {
    if (!Object.is(wave, this.lastWave)) {
      this.lastWave = wave;
      this.waveLabel.textContent = `Wave ${wave}`;
    }
    if (
      Object.is(killed, this.lastKilled) &&
      Object.is(total, this.lastTotal)
    ) {
      return;
    }

    this.lastKilled = killed;
    this.lastTotal = total;
    this.clearedLabel.textContent = `${killed} / ${total} cleared`;
    this.bar.setAttribute('aria-valuemax', String(total));
    this.bar.setAttribute('aria-valuenow', String(killed));
    const progress = total > 0 ? killed / total : 0;
    this.fill.style.width = `${progress * 100}%`;
  }
}

function wavesChanged(
  previous: readonly number[],
  nodes: readonly TimelineNode[],
): boolean {
  return (
    previous.length !== nodes.length ||
    nodes.some((node, index) => node.wave !== previous[index])
  );
}

function slotLabel(node: TimelineNode, icon: WaveIconKind): string {
  return `Wave ${node.wave} — ${iconLabel(node, icon)}, ${stateLabel(node.state)}`;
}

function iconLabel(node: TimelineNode, icon: WaveIconKind): string {
  switch (icon) {
    case 'boss':
      return `boss: ${threatLabels(node.threats)}`;
    case 'threat':
      return `new threat: ${threatLabels(node.threats)}`;
    case 'zombie':
      return 'zombie wave';
  }
}

function stateLabel(state: TimelineNodeState): string {
  switch (state) {
    case 'past':
      return 'cleared';
    case 'current':
      return 'in progress';
    case 'future':
      return 'upcoming';
  }
}

function threatLabels(threats: readonly string[]): string {
  return threats
    .map((threat) => THREAT_LABELS[threat] ?? 'specialist threat')
    .join(', ');
}

function wholeNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** Draws a pixel grid as merged horizontal runs, one rect per run. */
function pixelIcon(rows: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', `0 0 ${rows[0].length} ${rows.length}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y];
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== '#') continue;
      let run = 1;
      while (row[x + run] === '#') run += 1;
      const rect = document.createElementNS(SVG_NAMESPACE, 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(run));
      rect.setAttribute('height', '1');
      rect.setAttribute('fill', 'currentColor');
      svg.appendChild(rect);
      x += run - 1;
    }
  }
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
