import './DevTunerPanel.css';
import {
  attackDamageMultiplierForWave,
  healthMultiplierForWave,
  speedMultiplierForWave,
  zombieCompositionForWave,
} from '../WaveManager.ts';
import { formatWaveComposition } from '../waveBalance.ts';
import type { ZombieKind } from '../zombies/Zombie.ts';
import {
  KIND_ORDER,
  devTuning,
  exportTuningJSON,
  notifyTuningChanged,
  resetTuning,
} from './DevTuning.ts';

/** What the panel needs from the running SurvivalMode. */
export interface DevTunerHost {
  currentWave(): number;
  aliveCount(): number;
  /** Push a tuning edit onto living zombies + the running wave. */
  applyLiveTuning(): void;
  restartWave(): void;
  skipToWave(wave: number): void;
  spawnOneOfEach(): void;
  killAllZombies(): void;
  grantInfiniteMoney(): void;
}

const KIND_LABELS: Record<ZombieKind, string> = {
  walker: 'Walker',
  gunslinger: 'Gunslinger',
  necromancer: 'Necromancer',
  thrower: 'Thrower',
  worker: 'Worker',
  'phone-addict': 'Phone Addict',
  kamikaze: 'Kamikaze',
};

interface FieldSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  get(): number;
  set(value: number): void;
  /** Optional grey annotation, e.g. the underlying ×multiplier. */
  note?(): string;
  decimals?: number;
}

export class DevTunerPanel {
  private readonly rootEl: HTMLDivElement;
  private readonly refreshers: (() => void)[] = [];
  private readonly waveNumEl: HTMLSpanElement;
  private readonly aliveEl: HTMLSpanElement;
  private readonly previewEl: HTMLPreElement;

  constructor(
    parent: HTMLElement,
    private readonly host: DevTunerHost,
  ) {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'dev-tuner';
    this.rootEl.dataset.open = 'false';

    const tab = el('button', 'dev-tuner__tab');
    tab.textContent = '⚙ DEV TUNER';
    tab.addEventListener('click', () => this.setOpen(true));
    this.rootEl.appendChild(tab);

    const panel = el('div', 'dev-tuner__panel');
    this.rootEl.appendChild(panel);

    // Header
    const head = el('div', 'dev-tuner__head');
    const title = el('span', 'dev-tuner__title');
    title.textContent = 'DEV TUNER';
    const live = el('span', 'dev-tuner__live');
    live.textContent = 'live ●';
    const resetBtn = el('button', 'dev-tuner__iconbtn');
    resetBtn.textContent = 'reset';
    resetBtn.title = 'Reset all balance to shipped defaults';
    resetBtn.addEventListener('click', () => {
      resetTuning();
      this.host.applyLiveTuning();
      this.refresh();
    });
    const closeBtn = el('button', 'dev-tuner__iconbtn');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.setOpen(false));
    head.append(title, live, resetBtn, closeBtn);
    panel.appendChild(head);

    // Tab strip
    const tabs = el('div', 'dev-tuner__tabs');
    const body = el('div', 'dev-tuner__body');
    const tabNames = ['BASE', ...KIND_ORDER.map((k) => KIND_LABELS[k]), 'WAVES'];
    const sections = new Map<string, HTMLDivElement>();
    for (const name of tabNames) {
      const btn = el('button', 'dev-tuner__tabbtn');
      btn.textContent = name.toUpperCase();
      btn.addEventListener('click', () => this.selectTab(name, tabs, sections));
      tabs.appendChild(btn);
      const section = el('div', 'dev-tuner__section');
      section.dataset.tab = name;
      sections.set(name, section);
      body.appendChild(section);
    }
    panel.append(tabs, body);

    this.buildBaseTab(sections.get('BASE')!);
    for (const kind of KIND_ORDER) {
      this.buildKindTab(sections.get(KIND_LABELS[kind])!, kind);
    }
    this.buildWavesTab(sections.get('WAVES')!);

    // Footer
    const foot = el('div', 'dev-tuner__foot');
    const nav = el('div', 'dev-tuner__wavenav');
    const prev = el('button', 'dev-btn');
    prev.textContent = '◀';
    prev.addEventListener('click', () =>
      this.host.skipToWave(Math.max(1, this.host.currentWave() - 1)),
    );
    this.waveNumEl = el('span', 'dev-tuner__wavenum');
    const next = el('button', 'dev-btn');
    next.textContent = '▶';
    next.addEventListener('click', () =>
      this.host.skipToWave(this.host.currentWave() + 1),
    );
    const restart = el('button', 'dev-btn');
    restart.textContent = 'Restart';
    restart.addEventListener('click', () => this.host.restartWave());
    this.aliveEl = el('span', 'dev-tuner__live');
    nav.append(prev, this.waveNumEl, next, restart, this.aliveEl);
    foot.appendChild(nav);

    const cheats = el('div', 'dev-tuner__cheats');
    cheats.appendChild(
      checkbox('God mode', () => devTuning.cheats.godMode, (v) => {
        devTuning.cheats.godMode = v;
      }),
    );
    cheats.appendChild(
      checkbox('Freeze spawns', () => devTuning.cheats.freezeSpawns, (v) => {
        devTuning.cheats.freezeSpawns = v;
      }),
    );
    foot.appendChild(cheats);

    const slow = this.makeField({
      label: 'Time scale',
      min: 0.1,
      max: 2,
      step: 0.05,
      decimals: 2,
      get: () => devTuning.cheats.timeScale,
      set: (v) => {
        devTuning.cheats.timeScale = v;
      },
      note: () => `${devTuning.cheats.timeScale.toFixed(2)}×`,
    });
    foot.appendChild(slow);

    const actions = el('div', 'dev-tuner__btnrow');
    const spawnBtn = el('button', 'dev-btn');
    spawnBtn.textContent = 'Spawn 1 of each';
    spawnBtn.addEventListener('click', () => this.host.spawnOneOfEach());
    const killBtn = el('button', 'dev-btn dev-btn--danger');
    killBtn.textContent = 'Kill all';
    killBtn.addEventListener('click', () => this.host.killAllZombies());
    const moneyBtn = el('button', 'dev-btn');
    moneyBtn.textContent = '$ Infinite';
    moneyBtn.addEventListener('click', () => this.host.grantInfiniteMoney());
    const copyBtn = el('button', 'dev-btn');
    copyBtn.textContent = 'Copy JSON';
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard?.writeText(exportTuningJSON());
      copyBtn.textContent = 'Copied ✓';
      window.setTimeout(() => (copyBtn.textContent = 'Copy JSON'), 1200);
    });
    actions.append(spawnBtn, killBtn, moneyBtn, copyBtn);
    foot.appendChild(actions);

    this.previewEl = el('pre', 'dev-tuner__preview') as HTMLPreElement;
    foot.appendChild(this.previewEl);
    panel.appendChild(foot);

    parent.appendChild(this.rootEl);
    this.selectTab('BASE', tabs, sections);
    window.addEventListener('keydown', this.onKeyToggle);
    this.refresh();
  }

  // ---- tab builders -------------------------------------------------------

  private buildBaseTab(section: HTMLDivElement): void {
    section.appendChild(groupLabel('Global base stats (all kinds derive from these)'));
    section.appendChild(
      this.makeField({
        label: 'Base health',
        min: 1,
        max: 400,
        step: 1,
        get: () => devTuning.base.health,
        set: (v) => (devTuning.base.health = v),
      }),
    );
    section.appendChild(
      this.makeField({
        label: 'Base speed (m/s)',
        min: 0.5,
        max: 12,
        step: 0.1,
        decimals: 1,
        get: () => devTuning.base.speed,
        set: (v) => (devTuning.base.speed = v),
      }),
    );
    section.appendChild(
      this.makeField({
        label: 'Base attack dmg',
        min: 0,
        max: 60,
        step: 0.5,
        decimals: 1,
        get: () => devTuning.base.attackDamage,
        set: (v) => (devTuning.base.attackDamage = v),
      }),
    );
  }

  private buildKindTab(section: HTMLDivElement, kind: ZombieKind): void {
    const t = () => devTuning.types[kind];
    const base = () => devTuning.base;
    section.appendChild(groupLabel('Effective stats (× multiplier in grey)'));
    // Health shown as absolute wave-1 value; setter re-derives the multiplier.
    section.appendChild(
      this.makeField({
        label: 'Health',
        min: 1,
        max: 600,
        step: 1,
        get: () => base().health * t().healthMult,
        set: (v) => (t().healthMult = v / Math.max(1e-6, base().health)),
        note: () => `×${t().healthMult.toFixed(2)}`,
      }),
    );
    section.appendChild(
      this.makeField({
        label: 'Speed (m/s)',
        min: 0,
        max: 14,
        step: 0.1,
        decimals: 1,
        get: () => base().speed * t().speedMult,
        set: (v) => (t().speedMult = v / Math.max(1e-6, base().speed)),
        note: () => `×${t().speedMult.toFixed(2)}`,
      }),
    );
    section.appendChild(
      this.makeField({
        label: 'Attack dmg',
        min: 0,
        max: 80,
        step: 0.5,
        decimals: 1,
        get: () => base().attackDamage * t().damageMult,
        set: (v) => (t().damageMult = v / Math.max(1e-6, base().attackDamage)),
        note: () => `×${t().damageMult.toFixed(2)}`,
      }),
    );
    section.appendChild(
      this.makeField({
        label: 'Attack every (s)',
        min: 0.2,
        max: 5,
        step: 0.1,
        decimals: 1,
        get: () => t().attackInterval,
        set: (v) => (t().attackInterval = v),
      }),
    );
    section.appendChild(
      this.makeField({
        label: 'Reward $',
        min: 0,
        max: 100,
        step: 1,
        get: () => t().reward,
        set: (v) => (t().reward = v),
      }),
    );

    // Count this wave, with an auto/override checkbox.
    section.appendChild(groupLabel('Spawn count this wave'));
    const countField = this.makeField({
      label: 'Count',
      min: 0,
      max: 80,
      step: 1,
      get: () =>
        t().countOverride ??
        zombieCompositionForWave(this.host.currentWave())[kind],
      set: (v) => (t().countOverride = v),
    });
    const auto = checkbox(
      'Auto (wave formula)',
      () => t().countOverride === null,
      (v) => (t().countOverride = v ? null : zombieCompositionForWave(this.host.currentWave())[kind]),
    );
    section.append(countField, auto);

    // Specialist knobs.
    if (kind === 'gunslinger') {
      section.appendChild(groupLabel('Gunslinger specials'));
      section.appendChild(
        this.makeField({
          label: 'Attack range (m)',
          min: 3,
          max: 25,
          step: 0.5,
          decimals: 1,
          get: () => devTuning.specialist.gunslingerAttackRange,
          set: (v) => (devTuning.specialist.gunslingerAttackRange = v),
        }),
      );
    } else if (kind === 'necromancer') {
      section.appendChild(groupLabel('Necromancer summons'));
      section.appendChild(
        this.makeField({
          label: 'Summon range (m)',
          min: 4,
          max: 40,
          step: 0.5,
          decimals: 1,
          get: () => devTuning.specialist.necromancerSummonRange,
          set: (v) => (devTuning.specialist.necromancerSummonRange = v),
        }),
      );
      section.appendChild(
        this.makeField({
          label: 'Channel time (s)',
          min: 0.5,
          max: 12,
          step: 0.25,
          decimals: 2,
          get: () => devTuning.specialist.necromancerSummonSeconds,
          set: (v) => (devTuning.specialist.necromancerSummonSeconds = v),
        }),
      );
      section.appendChild(
        this.makeField({
          label: 'Walkers raised',
          min: 0,
          max: 10,
          step: 1,
          decimals: 0,
          get: () => devTuning.specialist.necromancerSummonCount,
          set: (v) => (devTuning.specialist.necromancerSummonCount = v),
        }),
      );
    } else if (kind === 'thrower') {
      section.appendChild(groupLabel('Thrower specials'));
      section.appendChild(
        this.makeField({
          label: 'Attack range (m)',
          min: 3,
          max: 30,
          step: 0.5,
          decimals: 1,
          get: () => devTuning.specialist.throwerAttackRange,
          set: (v) => (devTuning.specialist.throwerAttackRange = v),
        }),
      );
      section.appendChild(
        this.makeField({
          label: 'Projectile dmg',
          min: 0,
          max: 60,
          step: 0.5,
          decimals: 1,
          get: () => devTuning.specialist.projectileDamage,
          set: (v) => (devTuning.specialist.projectileDamage = v),
        }),
      );
    } else if (kind === 'worker') {
      section.appendChild(groupLabel('Worker / mine specials'));
      section.appendChild(
        this.makeField({
          label: 'Plant range (m)',
          min: 2,
          max: 30,
          step: 0.5,
          decimals: 1,
          get: () => devTuning.specialist.workerPlantRange,
          set: (v) => (devTuning.specialist.workerPlantRange = v),
        }),
      );
      section.appendChild(
        this.makeField({
          label: 'Plant time (s)',
          min: 0.5,
          max: 12,
          step: 0.25,
          decimals: 2,
          get: () => devTuning.specialist.workerPlantSeconds,
          set: (v) => (devTuning.specialist.workerPlantSeconds = v),
        }),
      );
      section.appendChild(
        this.makeField({
          label: 'Mine damage',
          min: 0,
          max: 120,
          step: 1,
          get: () => devTuning.specialist.landmineDamage,
          set: (v) => (devTuning.specialist.landmineDamage = v),
        }),
      );
    } else if (kind === 'kamikaze') {
      section.appendChild(groupLabel('Kamikaze detonation'));
      section.appendChild(
        this.makeField({
          label: 'Detonate range (m)',
          min: 0.5,
          max: 6,
          step: 0.1,
          decimals: 1,
          get: () => devTuning.specialist.kamikazeDetonateRange,
          set: (v) => (devTuning.specialist.kamikazeDetonateRange = v),
        }),
      );
      section.appendChild(
        this.makeField({
          label: 'Blast damage',
          min: 0,
          max: 150,
          step: 1,
          get: () => devTuning.specialist.kamikazeExplosionDamage,
          set: (v) => (devTuning.specialist.kamikazeExplosionDamage = v),
        }),
      );
      section.appendChild(
        this.makeField({
          label: 'Blast radius (m)',
          min: 0.5,
          max: 10,
          step: 0.1,
          decimals: 1,
          get: () => devTuning.specialist.kamikazeExplosionRadius,
          set: (v) => (devTuning.specialist.kamikazeExplosionRadius = v),
        }),
      );
    }
  }

  private buildWavesTab(section: HTMLDivElement): void {
    section.appendChild(groupLabel('Difficulty ramps (per wave, capped)'));
    const ramp = (
      label: string,
      curve: () => { perWave: number; cap: number },
      capMax: number,
    ): void => {
      section.appendChild(
        this.makeField({
          label: `${label} +/wave`,
          min: 0,
          max: 0.3,
          step: 0.005,
          decimals: 3,
          get: () => curve().perWave,
          set: (v) => (curve().perWave = v),
        }),
      );
      section.appendChild(
        this.makeField({
          label: `${label} cap ×`,
          min: 1,
          max: capMax,
          step: 0.05,
          decimals: 2,
          get: () => curve().cap,
          set: (v) => (curve().cap = v),
        }),
      );
    };
    ramp('Health', () => devTuning.wave.health, 6);
    ramp('Speed', () => devTuning.wave.speed, 4);
    ramp('Damage', () => devTuning.wave.damage, 6);

    section.appendChild(groupLabel('Composition curve (per kind)'));
    section.appendChild(this.buildCompositionGrid());

    section.appendChild(groupLabel('Spawn cadence'));
    section.appendChild(
      this.makeField({
        label: 'Horde interval (s)',
        min: 0.4,
        max: 3,
        step: 0.05,
        decimals: 2,
        get: () => devTuning.wave.hordeInterval,
        set: (v) => (devTuning.wave.hordeInterval = v),
      }),
    );
    section.appendChild(
      this.makeField({
        label: 'Horde size min',
        min: 1,
        max: 40,
        step: 1,
        get: () => devTuning.wave.hordeSizeMin,
        set: (v) => (devTuning.wave.hordeSizeMin = v),
      }),
    );
    section.appendChild(
      this.makeField({
        label: 'Horde size max',
        min: 1,
        max: 60,
        step: 1,
        get: () => devTuning.wave.hordeSizeMax,
        set: (v) => (devTuning.wave.hordeSizeMax = v),
      }),
    );
    section.appendChild(
      this.makeField({
        label: 'Max active cap',
        min: 4,
        max: 120,
        step: 1,
        get: () => devTuning.wave.maxActiveCap,
        set: (v) => (devTuning.wave.maxActiveCap = v),
      }),
    );
  }

  private buildCompositionGrid(): HTMLDivElement {
    const grid = el('div', 'dev-grid');
    const heads = ['kind', 'start', 'base', '+', 'every', 'cap'];
    for (const h of heads) {
      const c = el('span', 'dev-grid__head');
      c.textContent = h;
      grid.appendChild(c);
    }
    const cols: [keyof (typeof devTuning.wave.composition)['walker'], number, number][] = [
      ['startWave', 1, 40],
      ['base', 0, 90],
      ['perStep', 0, 20],
      ['every', 1, 10],
      ['cap', 0, 90],
    ];
    for (const kind of KIND_ORDER) {
      const rowLabel = el('span', 'dev-grid__rowlabel');
      rowLabel.textContent = KIND_LABELS[kind];
      grid.appendChild(rowLabel);
      for (const [key, min, max] of cols) {
        grid.appendChild(
          this.makeNumberCell(
            () => devTuning.wave.composition[kind][key],
            (v) => (devTuning.wave.composition[kind][key] = v),
            min,
            max,
          ),
        );
      }
    }
    return grid;
  }

  // ---- control factories --------------------------------------------------

  private makeField(spec: FieldSpec): HTMLDivElement {
    const field = el('div', 'dev-field');
    const label = el('span', 'dev-field__label');
    label.textContent = spec.label;
    const value = el('span', 'dev-field__value');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    const decimals = spec.decimals ?? 0;
    const render = (): void => {
      const v = spec.get();
      input.value = String(v);
      const noteHtml = spec.note ? ` <small>${spec.note()}</small>` : '';
      value.innerHTML = `${v.toFixed(decimals)}${noteHtml}`;
    };
    input.addEventListener('input', () => {
      spec.set(clamp(parseFloat(input.value), spec.min, spec.max));
      this.commit();
    });
    field.append(label, value, input);
    this.refreshers.push(render);
    return field;
  }

  private makeNumberCell(
    get: () => number,
    set: (v: number) => void,
    min: number,
    max: number,
  ): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    const render = (): void => {
      if (document.activeElement !== input) input.value = String(get());
    };
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) {
        set(clamp(Math.round(v), min, max));
        this.commit();
      }
    });
    this.refreshers.push(render);
    return input;
  }

  // ---- lifecycle ----------------------------------------------------------

  /** A control changed: apply to the live game, then refresh dependent readouts. */
  private commit(): void {
    notifyTuningChanged();
    this.refresh();
  }

  /** Recompute every control's displayed value + the wave preview. */
  refresh(): void {
    for (const r of this.refreshers) r();
    this.updatePreview();
  }

  /** Cheap per-frame update of just the volatile readouts. */
  refreshReadout(): void {
    const wave = this.host.currentWave();
    this.waveNumEl.textContent = `Wave ${wave}`;
    this.aliveEl.textContent = `${this.host.aliveCount()} alive`;
  }

  private updatePreview(): void {
    const wave = this.host.currentWave();
    const hp = healthMultiplierForWave(wave).toFixed(2);
    const spd = speedMultiplierForWave(wave).toFixed(2);
    const dmg = attackDamageMultiplierForWave(wave).toFixed(2);
    const comp = formatWaveComposition(zombieCompositionForWave(wave));
    this.previewEl.textContent =
      `Wave ${wave}: HP ×${hp}  Spd ×${spd}  Dmg ×${dmg}\n${comp}`;
    this.refreshReadout();
  }

  private selectTab(
    name: string,
    tabs: HTMLElement,
    sections: Map<string, HTMLDivElement>,
  ): void {
    const buttons = tabs.querySelectorAll<HTMLButtonElement>('.dev-tuner__tabbtn');
    buttons.forEach((b) => {
      b.dataset.active = String(b.textContent === name.toUpperCase());
    });
    for (const [key, section] of sections) {
      section.dataset.active = String(key === name);
    }
  }

  private setOpen(open: boolean): void {
    this.rootEl.dataset.open = String(open);
    if (open) this.refresh();
  }

  private readonly onKeyToggle = (event: KeyboardEvent): void => {
    if (event.key !== '`' && event.key !== '~') return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
    event.preventDefault();
    this.setOpen(this.rootEl.dataset.open !== 'true');
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyToggle);
    this.rootEl.remove();
    this.refreshers.length = 0;
  }
}

// ---- small DOM helpers ----------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function groupLabel(text: string): HTMLDivElement {
  const d = el('div', 'dev-tuner__grouplabel');
  d.textContent = text;
  return d;
}

function checkbox(
  label: string,
  get: () => boolean,
  set: (v: boolean) => void,
): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'dev-inline';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = get();
  input.addEventListener('change', () => set(input.checked));
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(input, span);
  return wrap;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
