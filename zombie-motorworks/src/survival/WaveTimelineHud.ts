import './WaveTimelineHud.css';
import {
  waveIcon,
  type TimelineNode,
  type TimelineNodeState,
  type WaveIconKind,
  type WaveTimeline,
} from '../core/waveTimeline.ts';

const WAVE_ICON_KINDS = ['walker', 'horde', 'threat', 'milestone'] as const;

interface TimelineNodeElements {
  readonly connector: HTMLDivElement;
  readonly root: HTMLDivElement;
  readonly number: HTMLSpanElement;
  readonly icon: HTMLSpanElement;
  state: TimelineNodeState | null;
  iconKind: WaveIconKind | null;
  iconSignature: string;
}

export class WaveTimelineHud {
  readonly root: HTMLElement;

  private readonly track: HTMLDivElement;
  private readonly waveLabel: HTMLDivElement;
  private readonly clearedLabel: HTMLDivElement;
  private readonly nodeElements: TimelineNodeElements[] = [];
  private waveNumbers: number[] = [];
  private progressConnector: HTMLDivElement | null = null;
  private lastProgress = Number.NaN;
  private lastProgressMax = Number.NaN;
  private lastProgressNow = Number.NaN;
  private disposed = false;

  constructor() {
    this.root = element('section', 'wave-timeline');
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Wave progress');

    this.track = element('div', 'wave-timeline__track');
    this.waveLabel = element('div', 'wave-timeline__wave-label');
    this.clearedLabel = element('div', 'wave-timeline__cleared');

    const summary = element('div', 'wave-timeline__summary');
    summary.append(this.waveLabel, this.clearedLabel);
    this.root.append(this.track, summary);
  }

  /** The node scaffold is stable across frames; volatile values are diffed. */
  update(timeline: WaveTimeline): void {
    if (this.disposed) return;

    if (waveNumbersChanged(this.waveNumbers, timeline.nodes)) {
      this.rebuildNodes(timeline.nodes);
    }

    let nextProgressConnector: HTMLDivElement | null = null;
    for (let index = 0; index < timeline.nodes.length; index += 1) {
      const node = timeline.nodes[index];
      const elements = this.nodeElements[index];
      this.updateNode(elements, node);
      if (node.state === 'current') {
        nextProgressConnector = elements.connector;
      }
    }
    this.setProgressConnector(nextProgressConnector);

    const progress = clamp(timeline.progress, 0, 1);
    if (
      this.progressConnector !== null &&
      !Object.is(progress, this.lastProgress)
    ) {
      this.progressConnector.style.setProperty(
        '--wave-timeline-progress',
        `${progress * 100}%`,
      );
      this.lastProgress = progress;
    }

    const total = Math.max(0, timeline.totalThisWave);
    const killed = clamp(timeline.killedThisWave, 0, total);
    if (this.progressConnector !== null) {
      if (!Object.is(total, this.lastProgressMax)) {
        this.progressConnector.setAttribute('aria-valuemax', String(total));
        this.lastProgressMax = total;
      }
      if (!Object.is(killed, this.lastProgressNow)) {
        this.progressConnector.setAttribute('aria-valuenow', String(killed));
        this.lastProgressNow = killed;
      }
    }

    setTextIfChanged(this.waveLabel, `WAVE ${timeline.currentWave}`);
    setTextIfChanged(
      this.clearedLabel,
      `${timeline.killedThisWave} / ${timeline.totalThisWave} cleared`,
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.remove();
    this.root.replaceChildren();
    this.nodeElements.length = 0;
    this.waveNumbers.length = 0;
    this.progressConnector = null;
  }

  private rebuildNodes(nodes: readonly TimelineNode[]): void {
    this.track.replaceChildren();
    this.nodeElements.length = 0;
    this.waveNumbers = nodes.map((node) => node.wave);
    this.progressConnector = null;
    this.lastProgress = Number.NaN;
    this.lastProgressMax = Number.NaN;
    this.lastProgressNow = Number.NaN;

    nodes.forEach((node, index) => {
      const connector = element('div', 'wave-timeline__connector');
      connector.classList.toggle('wave-timeline__connector--lead', index === 0);
      connector.setAttribute('aria-hidden', 'true');
      connector.appendChild(element('span', 'wave-timeline__connector-fill'));

      const root = element('div', 'wave-timeline__node');
      const rig = element('span', 'wave-timeline__rig');
      rig.setAttribute('aria-hidden', 'true');
      rig.textContent = '🚙';
      const marker = element('span', 'wave-timeline__marker');
      const icon = element('span', 'wave-timeline__icon');
      icon.setAttribute('role', 'img');
      marker.appendChild(icon);
      const number = element('span', 'wave-timeline__number');
      setTextIfChanged(number, String(node.wave));
      root.append(rig, marker, number);

      this.track.append(connector, root);
      this.nodeElements.push({
        connector,
        root,
        number,
        icon,
        state: null,
        iconKind: null,
        iconSignature: '',
      });
    });
  }

  private updateNode(elements: TimelineNodeElements, node: TimelineNode): void {
    if (elements.state !== node.state) {
      for (const state of ['past', 'current', 'future'] as const) {
        elements.root.classList.toggle(
          `wave-timeline__node--${state}`,
          node.state === state,
        );
        elements.connector.classList.toggle(
          `wave-timeline__connector--${state}`,
          node.state === state,
        );
      }
      if (node.state === 'current') {
        elements.root.setAttribute('aria-current', 'step');
      } else {
        elements.root.removeAttribute('aria-current');
      }
      elements.state = node.state;
    }

    const icon = waveIcon(node.wave, node.threats);
    if (elements.iconKind !== icon.kind) {
      for (const kind of WAVE_ICON_KINDS) {
        elements.root.classList.toggle(
          `wave-timeline__node--icon-${kind}`,
          icon.kind === kind,
        );
      }
      elements.iconKind = icon.kind;
    }

    setTextIfChanged(elements.number, String(node.wave));
    const iconSignature = `${icon.kind}\u0000${icon.icon}\u0000${icon.label}`;
    if (elements.iconSignature !== iconSignature) {
      elements.icon.setAttribute('aria-label', icon.label);
      setTextIfChanged(elements.icon, icon.icon);
      elements.iconSignature = iconSignature;
    }
  }

  private setProgressConnector(connector: HTMLDivElement | null): void {
    if (this.progressConnector === connector) return;

    if (this.progressConnector !== null) {
      this.progressConnector.removeAttribute('role');
      this.progressConnector.removeAttribute('aria-valuemin');
      this.progressConnector.removeAttribute('aria-valuemax');
      this.progressConnector.removeAttribute('aria-valuenow');
      this.progressConnector.setAttribute('aria-hidden', 'true');
    }

    this.progressConnector = connector;
    this.lastProgress = Number.NaN;
    this.lastProgressMax = Number.NaN;
    this.lastProgressNow = Number.NaN;

    if (connector !== null) {
      connector.removeAttribute('aria-hidden');
      connector.setAttribute('role', 'progressbar');
      connector.setAttribute('aria-valuemin', '0');
    }
  }
}

function waveNumbersChanged(
  previous: readonly number[],
  nodes: readonly TimelineNode[],
): boolean {
  if (previous.length !== nodes.length) return true;
  return nodes.some((node, index) => node.wave !== previous[index]);
}

function setTextIfChanged(element: Node, value: string): void {
  if (element.textContent !== value) {
    element.textContent = value;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
