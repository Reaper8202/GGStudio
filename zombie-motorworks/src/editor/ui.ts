/** DOM overlay UI for the editor: build palette, build card, and toolbars. */

import { KID_LABELS, SIMPLE_PART_IDS } from '../core/tutorial.ts';
import { PAINT_COLORS, type PartDefinition, type ValidationIssue } from '../core/types.ts';

export interface EditorUIHandlers {
  onArmPart(defId: string): void;
  onToggleErase(): void;
  onCancelTool(): void;
  onSave(): void;
  onLoad(slot: string): void;
  onNew(): void;
  onRename(name: string): void;
  onUndo(): void;
  onRedo(): void;
  onSymmetryToggle(on: boolean): void;
  onView(view: 'persp' | 'front' | 'rear' | 'side' | 'top'): void;
  onLayerChange(layer: number): void;
  onTestDrive(): void;
  onFightZombies(): void;
  onStartTutorial(): void;
  onConfigChange(partId: string, key: string, value: boolean | string): void;
  onDeleteSelected(): void;
  onRotateSelected(axis: 'y' | 'x'): void;
}

export interface EditorUI {
  root: HTMLElement;
  setBlueprintName(name: string): void;
  setSlots(slots: string[], current: string | null): void;
  setUndoRedo(canUndo: boolean, canRedo: boolean): void;
  setBuildSummary(weightKg: number, rolloverRisk: string, errors: ValidationIssue[], warnings: ValidationIssue[]): void;
  setTestDriveEnabled(enabled: boolean, blockedBy: string[]): void;
  setSelectedPart(
    def: PartDefinition | null,
    partId?: string,
    level?: number,
    effectiveDef?: PartDefinition,
  ): void;
  setArmedPart(defId: string | null): void;
  highlightPaletteButton(defId: string | null): void;
  setStatus(text: string): void;
  ghostTip: HTMLDivElement;
}

export function buildEditorUI(
  container: HTMLElement,
  catalog: Record<string, PartDefinition>,
  handlers: EditorUIHandlers,
): EditorUI {
  const root = document.createElement('div');
  root.className = 'ui-layer';
  container.appendChild(root);

  const btn = (label: string, fn: () => void, title = ''): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', fn);
    return b;
  };

  const top = document.createElement('div');
  top.className = 'topbar';
  root.appendChild(top);
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.style.width = '140px';
  nameInput.title = 'Build name';
  nameInput.addEventListener('change', () => handlers.onRename(nameInput.value));
  const slotSelect = document.createElement('select');
  slotSelect.title = 'Saved builds';
  top.append(
    nameInput,
    slotSelect,
    btn('Save', handlers.onSave),
    btn('Load', () => handlers.onLoad(slotSelect.value)),
    btn('New', handlers.onNew),
  );
  const undoBtn = btn('↩ Undo', handlers.onUndo, 'Ctrl+Z');
  const redoBtn = btn('↪ Redo', handlers.onRedo, 'Ctrl+Shift+Z');
  top.append(undoBtn, redoBtn);
  let symmetry = false;
  const symmetryBtn = btn('Build both sides', () => {
    symmetry = !symmetry;
    symmetryBtn.classList.toggle('active', symmetry);
    handlers.onSymmetryToggle(symmetry);
  });
  top.appendChild(symmetryBtn);
  const viewSelect = document.createElement('select');
  viewSelect.title = 'View (keys 1–5)';
  for (const [label, value] of [['3D', 'persp'], ['Front', 'front'], ['Rear', 'rear'], ['Side', 'side'], ['Top', 'top']] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    viewSelect.appendChild(option);
  }
  viewSelect.addEventListener('change', () => handlers.onView(viewSelect.value as 'persp' | 'front' | 'rear' | 'side' | 'top'));
  top.append(viewSelect, btn('🎓 Tutorial', handlers.onStartTutorial), btn('? Help', () => toggleHelp()));
  const testBtn = btn('▶ TEST DRIVE', handlers.onTestDrive);
  testBtn.className = 'primary';
  const fightBtn = btn('Fight Zombies', handlers.onFightZombies);
  fightBtn.className = 'primary';
  top.append(testBtn, fightBtn);

  const palette = document.createElement('div');
  palette.className = 'palette panel';
  root.appendChild(palette);
  const paletteContent = document.createElement('div');
  paletteContent.className = 'palette-content';
  palette.appendChild(paletteContent);
  const partButtons = new Map<string, HTMLButtonElement>();
  let armed: string | null = null;
  let highlighted: string | null = null;
  for (const id of SIMPLE_PART_IDS) {
    const def = catalog[id];
    if (!def) continue;
    const partButton = document.createElement('button');
    partButton.className = 'part-btn';
    const name = document.createElement('strong');
    name.textContent = KID_LABELS[id]?.name ?? def.name;
    const blurb = document.createElement('small');
    blurb.textContent = KID_LABELS[id]?.blurb ?? def.description;
    partButton.append(name, blurb);
    partButton.title = def.description;
    partButton.addEventListener('click', () => armed === id ? handlers.onCancelTool() : handlers.onArmPart(id));
    paletteContent.appendChild(partButton);
    partButtons.set(id, partButton);
  }
  const eraseButton = btn('🧽 Erase', handlers.onToggleErase, 'Delete a part with the next click');
  eraseButton.className = 'erase-btn';
  palette.appendChild(eraseButton);
  const cancelButton = btn('× Cancel', handlers.onCancelTool);
  cancelButton.className = 'cancel-tool';
  cancelButton.style.display = 'none';
  palette.appendChild(cancelButton);

  const buildCard = document.createElement('div');
  buildCard.className = 'panel build-card';
  root.appendChild(buildCard);

  const selectedToolbar = document.createElement('div');
  selectedToolbar.className = 'panel selected-toolbar';
  selectedToolbar.style.display = 'none';
  root.appendChild(selectedToolbar);

  const bottom = document.createElement('div');
  bottom.className = 'bottombar';
  root.appendChild(bottom);
  const layerLabel = document.createElement('span');
  layerLabel.textContent = 'Build height: All';
  const layerSlider = document.createElement('input');
  layerSlider.type = 'range';
  layerSlider.min = '-1';
  layerSlider.max = '8';
  layerSlider.value = '-1';
  layerSlider.addEventListener('input', () => {
    const layer = Number(layerSlider.value);
    layerLabel.textContent = layer < 0 ? 'Build height: All' : `Build height: ${layer}`;
    handlers.onLayerChange(layer);
  });
  const status = document.createElement('span');
  status.className = 'status';
  bottom.append(layerLabel, layerSlider, status);

  const ghostTip = document.createElement('div');
  ghostTip.className = 'ghost-tip';
  ghostTip.style.display = 'none';
  root.appendChild(ghostTip);

  const help = buildHelpOverlay();
  help.style.display = 'none';
  root.appendChild(help);
  const HELP_SEEN_KEY = 'scraprig.help-seen';
  const toggleHelp = (): void => {
    const showing = help.style.display !== 'none';
    help.style.display = showing ? 'none' : 'block';
    if (!showing) localStorage.setItem(HELP_SEEN_KEY, '1');
  };
  help.querySelector('button')?.addEventListener('click', toggleHelp);
  const debugMode = new URLSearchParams(location.search).get('debug') === '1';
  const WELCOME_SEEN_KEY = 'scraprig.welcome-seen';
  const TUTORIAL_DONE_KEY = 'scraprig.tutorial-done';
  if (!debugMode && !localStorage.getItem(TUTORIAL_DONE_KEY) && !localStorage.getItem(HELP_SEEN_KEY) && !localStorage.getItem(WELCOME_SEEN_KEY)) {
    const welcome = buildWelcomeDialog(
      () => { localStorage.setItem(WELCOME_SEEN_KEY, '1'); welcome.remove(); handlers.onStartTutorial(); },
      () => { localStorage.setItem(WELCOME_SEEN_KEY, '1'); welcome.remove(); },
    );
    root.appendChild(welcome);
  }

  return {
    root,
    ghostTip,
    setBlueprintName: (name) => { nameInput.value = name; },
    setSlots: (slots, current) => {
      slotSelect.replaceChildren();
      for (const slot of slots) {
        const option = document.createElement('option');
        option.value = slot;
        option.textContent = slot;
        option.selected = slot === current;
        slotSelect.appendChild(option);
      }
    },
    setUndoRedo: (canUndo, canRedo) => { undoBtn.disabled = !canUndo; redoBtn.disabled = !canRedo; },
    setBuildSummary: (weightKg, rolloverRisk, errors, warnings) => {
      const stability: Record<string, string> = { low: '😀 Great', medium: '🙂 Okay', high: '😟 Tippy', extreme: '🛑 Will tip' };
      buildCard.replaceChildren();
      const weight = document.createElement('div');
      weight.textContent = `Weight: ${weightKg.toFixed(0)} kg`;
      const balance = document.createElement('div');
      balance.textContent = `Stability: ${stability[rolloverRisk] ?? '🙂 Okay'}`;
      buildCard.append(weight, balance);
      const tips = errors.length > 0 ? errors.slice(0, 2) : warnings.length > 0 ? warnings.slice(0, 1) : [];
      if (tips.length === 0) {
        const ready = document.createElement('div');
        ready.className = 'ready';
        ready.textContent = '✅ Ready to drive';
        buildCard.appendChild(ready);
      } else {
        for (const tip of tips) {
          const line = document.createElement('div');
          line.className = tip.severity === 'error' ? 'issue-error' : 'issue-warning';
          line.textContent = tip.message;
          buildCard.appendChild(line);
        }
      }
    },
    setTestDriveEnabled: (enabled, blockedBy) => {
      const blockedTitle = `Blocked: ${blockedBy.join('; ')}`;
      testBtn.disabled = !enabled;
      testBtn.title = enabled ? 'Enter the test chamber' : blockedTitle;
      fightBtn.disabled = !enabled;
      fightBtn.title = enabled ? 'Fight zombies' : blockedTitle;
    },
    setSelectedPart: (def, partId, level = 1, effectiveDef = def ?? undefined) => {
      selectedToolbar.replaceChildren();
      if (!def || !partId) { selectedToolbar.style.display = 'none'; return; }
      selectedToolbar.style.display = 'flex';
      const title = document.createElement('strong');
      title.textContent = def.name;
      selectedToolbar.appendChild(title);
      const levelAndStats = document.createElement('span');
      levelAndStats.className = 'selected-stats';
      const maxLevel = def.upgrade?.maxLevel;
      const levelLabel = maxLevel === undefined
        ? `Level ${level}`
        : `Level ${level}/${maxLevel}`;
      const stats = def.upgrade && effectiveDef
        ? effectiveStatLabels(effectiveDef)
        : [];
      levelAndStats.textContent = [levelLabel, ...stats].join(' · ');
      selectedToolbar.appendChild(levelAndStats);
      if (!def.isRoot) {
        selectedToolbar.append(btn('Turn', () => handlers.onRotateSelected('y'), 'R'), btn('Flip', () => handlers.onRotateSelected('x'), 'F'));
      }
      const swatches = document.createElement('span');
      swatches.className = 'paint-swatches';
      for (const [paint, color] of Object.entries(PAINT_COLORS)) {
        const swatch = document.createElement('button');
        swatch.className = 'paint-swatch';
        swatch.style.background = `#${color.toString(16).padStart(6, '0')}`;
        swatch.title = `Paint ${paint}`;
        swatch.addEventListener('click', () => handlers.onConfigChange(partId, 'paint', paint));
        swatches.appendChild(swatch);
      }
      selectedToolbar.appendChild(swatches);
      if (!def.isRoot) selectedToolbar.appendChild(btn('Delete', handlers.onDeleteSelected, 'Del'));
    },
    setArmedPart: (defId) => {
      if (armed) (armed === 'erase' ? eraseButton : partButtons.get(armed))?.classList.remove('active');
      armed = defId;
      if (armed) (armed === 'erase' ? eraseButton : partButtons.get(armed))?.classList.add('active');
      cancelButton.style.display = armed ? 'block' : 'none';
    },
    highlightPaletteButton: (defId) => {
      if (highlighted) partButtons.get(highlighted)?.classList.remove('tutorial-glow');
      highlighted = defId;
      if (highlighted) partButtons.get(highlighted)?.classList.add('tutorial-glow');
    },
    setStatus: (text) => { status.textContent = text; },
  };
}

function effectiveStatLabels(def: PartDefinition): string[] {
  const labels = [`HP ${formatStat(def.health)}`];
  if (def.engine) {
    const peakTorque = Math.max(
      0,
      ...def.engine.torqueCurve.map(([, torque]) => torque),
    );
    labels.push(
      `${formatStat(def.engine.maxPowerKw)} kW`,
      `${formatStat(peakTorque)} N·m`,
    );
  }
  if (def.wheel) {
    labels.push(
      `grip ${def.wheel.frictionLong.toFixed(2)}/${def.wheel.frictionLat.toFixed(2)}`,
    );
  }
  if (def.weapon) {
    labels.push(
      `${formatStat(def.weapon.damage)} damage`,
      `${formatStat(def.weapon.fireRate)} shots/s`,
    );
  }
  if (def.armour) {
    labels.push(`${formatStat(def.armour.protection)} protection`);
  }
  return labels;
}

function formatStat(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function buildWelcomeDialog(onStartTutorial: () => void, onClose: () => void): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'panel welcome-panel';
  wrap.innerHTML = '<div>🚗 Want to learn how to build a truck?</div>';
  const actions = document.createElement('div');
  actions.className = 'welcome-actions';
  const tutorial = document.createElement('button');
  tutorial.className = 'primary';
  tutorial.textContent = '🎓 Show me how!';
  tutorial.addEventListener('click', onStartTutorial);
  const close = document.createElement('button');
  close.textContent = "🔧 I'll figure it out";
  close.addEventListener('click', onClose);
  actions.append(tutorial, close);
  wrap.appendChild(actions);
  return wrap;
}

function buildHelpOverlay(): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'panel';
  wrap.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(620px,92vw);max-height:84vh;overflow-y:auto;padding:18px 22px;z-index:20;line-height:1.5';
  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:17px">How to build a vehicle</b><button>✕ Close</button></div>
    <div class="cat-title">quick start</div>
    <ol style="margin-left:18px"><li>Pick a part from the palette. Green means it can place; red explains why it cannot. Each placement is one at a time.</li>
    <li>Build blocks around the orange Truck Heart. Everything needs to connect face-to-face.</li>
    <li>Wheels snap onto the sides of blocks, engines on top. Add a Driver Seat, Engine, Fuel Tank, and four wheels.</li>
    <li>Click a part to Turn or Flip it, change its paint, or delete it. Right-click erases a part; paint swatches change its colour.</li>
    <li>Press <b>▶ TEST DRIVE</b> when ready.</li></ol>
    <div class="cat-title">controls</div>
    <table style="width:100%;font-size:13px"><tr><td>Orbit / zoom</td><td>left-drag / mouse wheel · keys <b>1–5</b> choose views</td></tr>
    <tr><td>Rotate selected / held part</td><td><b>R</b> turn · <b>F</b> flip</td></tr>
    <tr><td>Erase</td><td>right-click, Erase tool, or <b>Del</b> on a selected part</td></tr>
    <tr><td>Undo / redo</td><td>Ctrl+Z / Ctrl+Shift+Z</td></tr><tr><td>Layers</td><td>bottom slider slices the build by height</td></tr></table>`;
  return wrap;
}
