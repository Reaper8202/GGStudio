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
