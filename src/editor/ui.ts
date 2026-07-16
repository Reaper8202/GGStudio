/** DOM overlay UI for the editor: palette, inspector, top/bottom bars. */

import type { PartCategory, PartDefinition, ValidationIssue } from '../core/types.ts';

export interface EditorUIHandlers {
  onArmPart(defId: string): void;
  onSave(): void;
  onLoad(slot: string): void;
  onNew(): void;
  onRename(name: string): void;
  onDuplicateBlueprint(): void;
  onUndo(): void;
  onRedo(): void;
  onSymmetryToggle(on: boolean): void;
  onView(view: 'persp' | 'front' | 'rear' | 'side' | 'top'): void;
  onLayerChange(layer: number): void;
  onViewMode(mode: 'normal' | 'xray' | 'structure', hideArmour: boolean, hideShell: boolean): void;
  onOverlayToggle(key: string, on: boolean): void;
  onTestDrive(): void;
  onConfigChange(partId: string, key: string, value: boolean | string): void;
  onDeleteSelected(): void;
  onMirrorSelected(): void;
  onDuplicateSelected(): void;
  onRotateSelected(axis: 'y' | 'x'): void;
}

export interface EditorUI {
  root: HTMLElement;
  setBlueprintName(name: string): void;
  setSlots(slots: string[], current: string | null): void;
  setUndoRedo(canUndo: boolean, canRedo: boolean): void;
  setStats(rows: [string, string][]): void;
  setIssues(errors: ValidationIssue[], warnings: ValidationIssue[]): void;
  setTestDriveEnabled(enabled: boolean, blockedBy: string[]): void;
  setInspector(html: HTMLElement | null): void;
  setArmedPart(defId: string | null): void;
  setStatus(text: string): void;
  ghostTip: HTMLDivElement;
}

const CATEGORY_ORDER: PartCategory[] = ['structural', 'functional', 'movement', 'protection', 'weapon'];

export function buildEditorUI(
  container: HTMLElement,
  catalog: Record<string, PartDefinition>,
  handlers: EditorUIHandlers,
): EditorUI {
  const root = document.createElement('div');
  root.className = 'ui-layer';
  container.appendChild(root);

  // --- Top bar ---
  const top = document.createElement('div');
  top.className = 'topbar';
  root.appendChild(top);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.style.width = '140px';
  nameInput.title = 'Blueprint name';
  nameInput.addEventListener('change', () => handlers.onRename(nameInput.value));
  top.appendChild(nameInput);

  const btn = (label: string, fn: () => void, title = ''): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', fn);
    return b;
  };

  const slotSelect = document.createElement('select');
  slotSelect.title = 'Saved blueprints';
  top.appendChild(slotSelect);
  top.appendChild(btn('Save', handlers.onSave, 'Save blueprint'));
  top.appendChild(btn('Load', () => handlers.onLoad(slotSelect.value), 'Load selected blueprint'));
  top.appendChild(btn('New', handlers.onNew));
  top.appendChild(btn('Duplicate', handlers.onDuplicateBlueprint, 'Duplicate current blueprint'));

  const undoBtn = btn('↩ Undo', handlers.onUndo, 'Ctrl+Z');
  const redoBtn = btn('↪ Redo', handlers.onRedo, 'Ctrl+Shift+Z');
  top.appendChild(undoBtn);
  top.appendChild(redoBtn);

  const symBtn = btn('Symmetry: off', () => {
    symOn = !symOn;
    symBtn.textContent = symOn ? 'Symmetry: ON' : 'Symmetry: off';
    symBtn.classList.toggle('active', symOn);
    handlers.onSymmetryToggle(symOn);
  }, 'Mirror placements across the centreline (X)');
  let symOn = false;
  top.appendChild(symBtn);

  for (const [label, view] of [
    ['Persp', 'persp'],
    ['Front', 'front'],
    ['Rear', 'rear'],
    ['Side', 'side'],
    ['Top', 'top'],
  ] as const) {
    top.appendChild(btn(label, () => handlers.onView(view), `View: ${label} (keys 1-5)`));
  }

  const testBtn = btn('▶ TEST DRIVE', handlers.onTestDrive);
  testBtn.className = 'primary';
  top.appendChild(testBtn);

  const helpBtn = btn('? Help', () => toggleHelp(), 'How to build a vehicle');
  top.appendChild(helpBtn);

  // --- Palette ---
  const palette = document.createElement('div');
  palette.className = 'palette panel';
  root.appendChild(palette);
  const partButtons = new Map<string, HTMLButtonElement>();
  for (const cat of CATEGORY_ORDER) {
    const title = document.createElement('div');
    title.className = 'cat-title';
    title.textContent = cat;
    palette.appendChild(title);
    for (const def of Object.values(catalog).filter((d) => d.category === cat)) {
      const b = document.createElement('button');
      b.className = 'part-btn';
      b.innerHTML = `${def.name}<small>${def.massKg} kg · $${def.cost}</small>`;
      b.title = def.description;
      b.addEventListener('click', () => handlers.onArmPart(def.id));
      palette.appendChild(b);
      partButtons.set(def.id, b);
    }
  }

  // --- Inspector + analysis ---
  const inspector = document.createElement('div');
  inspector.className = 'inspector';
  root.appendChild(inspector);

  const inspectorBody = document.createElement('div');
  inspectorBody.className = 'panel';
  inspectorBody.innerHTML = '<div class="cat-title">selection</div><div>Nothing selected</div>';
  inspector.appendChild(inspectorBody);

  const statsPanel = document.createElement('div');
  statsPanel.className = 'panel';
  inspector.appendChild(statsPanel);

  const issuesPanel = document.createElement('div');
  issuesPanel.className = 'panel';
  inspector.appendChild(issuesPanel);

  // --- Bottom bar ---
  const bottom = document.createElement('div');
  bottom.className = 'bottombar';
  root.appendChild(bottom);

  const layerLabel = document.createElement('span');
  layerLabel.textContent = 'Layer: all';
  const layerSlider = document.createElement('input');
  layerSlider.type = 'range';
  layerSlider.min = '-1';
  layerSlider.max = '8';
  layerSlider.value = '-1';
  layerSlider.title = 'Height layer slicing (-1 = all)';
  layerSlider.addEventListener('input', () => {
    const v = Number(layerSlider.value);
    layerLabel.textContent = v < 0 ? 'Layer: all' : `Layer: ${v}`;
    handlers.onLayerChange(v);
  });
  bottom.appendChild(layerLabel);
  bottom.appendChild(layerSlider);

  let viewMode: 'normal' | 'xray' | 'structure' = 'normal';
  let hideArmour = false;
  let hideShell = false;
  const applyViewMode = () => handlers.onViewMode(viewMode, hideArmour, hideShell);
  const xrayBtn = btn('X-ray', () => {
    viewMode = viewMode === 'xray' ? 'normal' : 'xray';
    xrayBtn.classList.toggle('active', viewMode === 'xray');
    structBtn.classList.remove('active');
    applyViewMode();
  });
  const structBtn = btn('Structure', () => {
    viewMode = viewMode === 'structure' ? 'normal' : 'structure';
    structBtn.classList.toggle('active', viewMode === 'structure');
    xrayBtn.classList.remove('active');
    applyViewMode();
  }, 'Show only structural parts');
  const armourBtn = btn('Hide armour', () => {
    hideArmour = !hideArmour;
    armourBtn.classList.toggle('active', hideArmour);
    applyViewMode();
  });
  const shellBtn = btn('Hide shell', () => {
    hideShell = !hideShell;
    shellBtn.classList.toggle('active', hideShell);
    applyViewMode();
  });
  bottom.appendChild(xrayBtn);
  bottom.appendChild(structBtn);
  bottom.appendChild(armourBtn);
  bottom.appendChild(shellBtn);

  for (const [label, key, on] of [
    ['CoM', 'com', true],
    ['Contacts', 'contacts', true],
    ['Support', 'supportPolygon', true],
    ['Links', 'connections', false],
    ['Arcs', 'arcs', true],
  ] as const) {
    const b = btn(label, () => {
      const now = !b.classList.contains('active');
      b.classList.toggle('active', now);
      handlers.onOverlayToggle(key, now);
    }, `Toggle ${label} overlay`);
    b.classList.toggle('active', on);
    bottom.appendChild(b);
  }

  const status = document.createElement('span');
  status.style.marginLeft = 'auto';
  status.style.color = '#9aa4b5';
  bottom.appendChild(status);

  const ghostTip = document.createElement('div');
  ghostTip.className = 'ghost-tip';
  ghostTip.style.display = 'none';
  root.appendChild(ghostTip);

  // --- Help overlay (auto-opens on first visit) ---
  const help = buildHelpOverlay();
  help.style.display = 'none';
  root.appendChild(help);
  const HELP_SEEN_KEY = 'scraprig.help-seen';
  const toggleHelp = (): void => {
    const showing = help.style.display !== 'none';
    help.style.display = showing ? 'none' : 'block';
    if (!showing) localStorage.setItem(HELP_SEEN_KEY, '1');
  };
  help.querySelector('button')?.addEventListener('click', () => toggleHelp());
  const debugMode = new URLSearchParams(location.search).get('debug') === '1';
  if (!debugMode && !localStorage.getItem(HELP_SEEN_KEY)) toggleHelp();

  let armed: string | null = null;

  return {
    root,
    ghostTip,
    setBlueprintName: (n) => {
      nameInput.value = n;
    },
    setSlots: (slots, current) => {
      slotSelect.innerHTML = '';
      for (const s of slots) {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = s;
        if (s === current) o.selected = true;
        slotSelect.appendChild(o);
      }
    },
    setUndoRedo: (u, r) => {
      undoBtn.disabled = !u;
      redoBtn.disabled = !r;
    },
    setStats: (rows) => {
      statsPanel.innerHTML = '<div class="cat-title">analysis</div>';
      for (const [k, v] of rows) {
        const row = document.createElement('div');
        row.className = 'stat-row';
        row.innerHTML = `<span>${k}</span><span>${v}</span>`;
        statsPanel.appendChild(row);
      }
    },
    setIssues: (errors, warnings) => {
      issuesPanel.innerHTML = '<div class="cat-title">issues</div>';
      if (errors.length === 0 && warnings.length === 0) {
        issuesPanel.innerHTML += '<div style="color:#7fbf6f">No issues</div>';
      }
      for (const e of errors) {
        const d = document.createElement('div');
        d.className = 'issue-error';
        d.textContent = `✖ ${e.message}`;
        d.title = e.suggestion ?? '';
        issuesPanel.appendChild(d);
      }
      for (const w of warnings) {
        const d = document.createElement('div');
        d.className = 'issue-warning';
        d.textContent = `⚠ ${w.message}`;
        d.title = w.suggestion ?? '';
        issuesPanel.appendChild(d);
      }
    },
    setTestDriveEnabled: (enabled, blockedBy) => {
      testBtn.disabled = !enabled;
      testBtn.title = enabled ? 'Enter the test chamber' : `Blocked: ${blockedBy.join('; ')}`;
    },
    setInspector: (el) => {
      inspectorBody.innerHTML = '<div class="cat-title">selection</div>';
      if (el) inspectorBody.appendChild(el);
      else inspectorBody.innerHTML += '<div style="color:#9aa4b5">Nothing selected</div>';
    },
    setArmedPart: (defId) => {
      if (armed) partButtons.get(armed)?.classList.remove('active');
      armed = defId;
      if (defId) partButtons.get(defId)?.classList.add('active');
    },
    setStatus: (t) => {
      status.textContent = t;
    },
  };
}

/** Full-screen help overlay: quick start, controls, and the placement rules. */
function buildHelpOverlay(): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'panel';
  wrap.style.cssText =
    'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(720px,92vw);max-height:84vh;overflow-y:auto;padding:18px 22px;z-index:20;line-height:1.5';
  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <b style="font-size:17px">How to build a vehicle</b>
      <button>✕ Close</button>
    </div>
    <div class="cat-title">quick start — your first truck</div>
    <ol style="margin-left:18px">
      <li><b>Pick a part</b> from the left palette. A ghost copy follows your mouse:
        <span style="color:#7fbf6f">green = can place</span>, <span style="color:#ff7a6e">red = can't</span>
        (the tooltip tells you why). Click to place, <b>Esc</b> to put the part away.</li>
      <li><b>Build structure first.</b> Everything must connect face-to-face to your build —
        no floating parts. Shape a chassis out of <b>Frame Boxes</b> around the orange Chassis Core.</li>
      <li><b>Add the essentials.</b> A drivable vehicle needs:
        a <b>Driver Seat</b> (anywhere on the frame),
        an <b>Engine Mount</b> with an <b>Engine on top of it</b>,
        a <b>Fuel Tank</b>,
        and <b>Wheel Mounts</b> (teal) with <b>Wheels on their left/right sides</b>.</li>
      <li><b>Configure the wheels.</b> Click a wheel to select it, then in the right panel tick
        <b>driven</b> (gets engine power), <b>steering</b> (turns with A/D), <b>braking</b>,
        and pick a suspension preset. No driven wheels = the truck won't move!</li>
      <li>Press <b>▶ TEST DRIVE</b>. When you come back, your design is exactly as you left it —
        crashes in the chamber never damage the blueprint.</li>
    </ol>
    <div class="cat-title">controls</div>
    <table style="width:100%;font-size:13px">
      <tr><td>Orbit / zoom</td><td>left-drag / mouse wheel &nbsp;·&nbsp; keys <b>1–5</b> = camera presets</td></tr>
      <tr><td>Rotate part</td><td><b>R</b> (spin) / <b>F</b> (tip over) — the yellow notch marks the part's front</td></tr>
      <tr><td>Select</td><td>click &nbsp;·&nbsp; Shift+click adds &nbsp;·&nbsp; <b>Del</b> deletes</td></tr>
      <tr><td>Undo / redo</td><td>Ctrl+Z / Ctrl+Shift+Z</td></tr>
      <tr><td>Duplicate / mirror</td><td>Ctrl+D / M &nbsp;·&nbsp; the <b>Symmetry</b> button auto-mirrors placements</td></tr>
      <tr><td>Layers</td><td>bottom slider slices the build by height; X-ray / Structure filter the view</td></tr>
    </table>
    <div class="cat-title">why won't it place?</div>
    <ul style="margin-left:18px;font-size:13px">
      <li>Special parts need special mounts: wheels → <b>sides of Wheel Mounts</b>,
        engines → <b>top of Engine Mounts</b>, guns/turrets → <b>top of Hardpoints</b>.</li>
      <li>Armour and shell panels stick onto a <b>face</b> of an existing part — one panel per face.</li>
      <li>Wheels need the cell <b>below them empty</b> (suspension travel space).</li>
      <li>Some parts are one-per-vehicle (Chassis Core, Driver Seat).</li>
    </ul>
    <div class="cat-title">reading the analysis (right panel)</div>
    <ul style="margin-left:18px;font-size:13px">
      <li>The <b>yellow ball</b> is your centre of mass. Keep it <b>low and centred</b> —
        tall narrow builds tip over in corners, for real.</li>
      <li>The <b>green outline</b> on the ground is your wheel footprint. If the dashed line from
        the yellow ball lands outside it, the vehicle falls over standing still.</li>
      <li><b>Warnings are advice, not blockers</b> — you can always test drive a weird build.
        Only red errors (no engine, floating parts…) disable TEST DRIVE.</li>
    </ul>
    <div class="cat-title">in the test chamber</div>
    <div style="font-size:13px"><b>W</b> throttle · <b>S</b>/<b>Space</b> brake · <b>A/D</b> steer ·
      mouse aims turrets · <b>F</b> or click fires · scenario buttons up top · <b>Reset</b> respawns fresh.</div>
  `;
  return wrap;
}

/** Inspector widget for a selected part. */
export function buildInspectorPanel(
  def: PartDefinition,
  partId: string,
  config: Record<string, unknown>,
  handlers: Pick<
    EditorUIHandlers,
    'onConfigChange' | 'onDeleteSelected' | 'onMirrorSelected' | 'onDuplicateSelected' | 'onRotateSelected'
  >,
): HTMLElement {
  const wrap = document.createElement('div');
  const title = document.createElement('div');
  title.innerHTML = `<b>${def.name}</b> <small style="color:#9aa4b5">(${partId})</small>`;
  wrap.appendChild(title);
  const desc = document.createElement('div');
  desc.style.color = '#9aa4b5';
  desc.style.fontSize = '12px';
  desc.textContent = def.description;
  wrap.appendChild(desc);

  if (def.wheel) {
    for (const key of ['driven', 'steering', 'steerInverted', 'braking'] as const) {
      const label = document.createElement('label');
      label.style.display = 'block';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = Boolean(config[key] ?? (key === 'braking'));
      cb.addEventListener('change', () => handlers.onConfigChange(partId, key, cb.checked));
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + key));
      wrap.appendChild(label);
    }
    const presetSel = document.createElement('select');
    for (const p of ['light', 'standard', 'heavy-duty', 'off-road']) {
      const o = document.createElement('option');
      o.value = p;
      o.textContent = `suspension: ${p}`;
      if ((config.suspensionPreset ?? 'standard') === p) o.selected = true;
      presetSel.appendChild(o);
    }
    presetSel.addEventListener('change', () =>
      handlers.onConfigChange(partId, 'suspensionPreset', presetSel.value),
    );
    wrap.appendChild(presetSel);
  }

  const actions = document.createElement('div');
  actions.style.marginTop = '6px';
  actions.style.display = 'flex';
  actions.style.gap = '4px';
  actions.style.flexWrap = 'wrap';
  const mk = (label: string, fn: () => void, title = ''): void => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', fn);
    actions.appendChild(b);
  };
  mk('Rotate Y', () => handlers.onRotateSelected('y'), 'R');
  mk('Rotate X', () => handlers.onRotateSelected('x'), 'F');
  mk('Mirror', () => handlers.onMirrorSelected(), 'M');
  mk('Duplicate', () => handlers.onDuplicateSelected(), 'Ctrl+D');
  mk('Delete', () => handlers.onDeleteSelected(), 'Del');
  wrap.appendChild(actions);
  return wrap;
}
