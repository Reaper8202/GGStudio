import {
  createBadge,
  createButton,
  createField,
  createKey,
  createMeter,
  createNotice,
  createPanel,
  createStat,
  createStatus,
  createTabs,
  createToggle,
} from './system.ts';
import './museum.css';

type Child = HTMLElement | string;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  for (const child of children) {
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

function copy(text: string): HTMLParagraphElement {
  return node('p', 'museum-copy', [text]);
}

function specimen(title: string, description: string, children: HTMLElement[]): HTMLElement {
  return node('article', 'museum-specimen', [
    node('header', 'museum-specimen__header', [
      node('h3', '', [title]),
      copy(description),
    ]),
    node('div', 'museum-specimen__stage', children),
  ]);
}

function section(id: string, index: string, title: string, description: string): HTMLElement {
  const wrapper = node('section', 'museum-section');
  wrapper.id = id;
  wrapper.append(
    node('header', 'museum-section__header', [
      node('span', 'museum-section__index', [index]),
      node('div', '', [node('h2', '', [title]), copy(description)]),
    ]),
  );
  return wrapper;
}

function textInput(placeholder: string, value = ''): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.value = value;
  return input;
}

function selectInput(options: string[]): HTMLSelectElement {
  const select = document.createElement('select');
  for (const label of options) {
    const option = document.createElement('option');
    option.textContent = label;
    option.value = label.toLowerCase().replaceAll(' ', '-');
    select.appendChild(option);
  }
  return select;
}

function makeSwatches(): HTMLElement {
  const colors = [
    ['Black', '--ui-black'],
    ['Ink', '--ui-ink'],
    ['Surface 1', '--ui-surface-1'],
    ['Surface 2', '--ui-surface-2'],
    ['Surface 3', '--ui-surface-3'],
    ['Ash', '--ui-text'],
    ['Signal', '--ui-signal'],
    ['Rust', '--ui-rust'],
    ['Bone', '--ui-bone'],
    ['Blood', '--ui-danger'],
  ];
  const grid = node('div', 'museum-swatches');
  for (const [label, token] of colors) {
    const color = node('span', 'museum-swatch__color');
    color.style.background = `var(${token})`;
    grid.append(
      node('div', 'museum-swatch', [
        color,
        node('span', 'museum-swatch__name', [label]),
        node('code', '', [token]),
      ]),
    );
  }
  return grid;
}

function makeTypeScale(): HTMLElement {
  const samples: [string, string, string][] = [
    ['Display / 40', 'THE LAST GARAGE', 'museum-type--40'],
    ['Title / 28', 'Vehicle destroyed', 'museum-type--28'],
    ['Heading / 20', 'Salvage inventory', 'museum-type--20'],
    ['Control / 14', 'FIGHT ZOMBIES', 'museum-type--14'],
    ['Data / 12', 'CHASSIS INTEGRITY 084%', 'museum-type--12'],
  ];
  const list = node('div', 'museum-type');
  for (const [label, text, className] of samples) {
    list.append(
      node('div', 'museum-type__row', [
        node('code', '', [label]),
        node('span', className, [text]),
      ]),
    );
  }
  return list;
}

function makeButtons(): HTMLElement {
  return node('div', 'museum-stack', [
    node('div', 'museum-row', [
      createButton({ label: 'Test drive', intent: 'primary', icon: '>' }),
      createButton({ label: 'Strip part' }),
      createButton({ label: 'Scrap rig', intent: 'danger', icon: 'X' }),
      createButton({ label: 'Locked', disabled: true }),
    ]),
    node('div', 'museum-row', [
      createButton({ label: 'Small', size: 'small' }),
      createButton({ label: 'Medium', size: 'medium' }),
      createButton({ label: 'Large action', size: 'large', intent: 'warning' }),
      createButton({ label: 'Add part', icon: '+', iconOnly: true }),
      createButton({ label: 'Grid lock', icon: '#', iconOnly: true, pressed: true }),
    ]),
  ]);
}

function makeForm(): HTMLElement {
  const notes = document.createElement('textarea');
  notes.placeholder = 'Describe the repair...';
  return node('div', 'museum-form-grid', [
    createField({
      label: 'Vehicle name',
      hint: 'Displayed in the garage ledger.',
      control: textInput('Unnamed rig', 'Grave Rattler'),
    }),
    createField({
      label: 'Drive profile',
      control: selectInput(['Rear wheel', 'All wheel', 'Crawler']),
    }),
    createField({
      label: 'Callsign',
      error: 'Already claimed by another survivor.',
      control: textInput('Enter callsign', 'Wrench'),
    }),
    createField({ label: 'Mechanic notes', hint: 'Maximum 180 characters.', control: notes }),
  ]);
}

function makeRange(): HTMLElement {
  const value = node('output', 'museum-range__value', ['64']);
  const range = document.createElement('input');
  range.className = 'museum-range';
  range.type = 'range';
  range.min = '0';
  range.max = '100';
  range.value = '64';
  range.addEventListener('input', () => { value.textContent = range.value; });
  return node('div', 'museum-range-row', [
    node('span', 'museum-control-label', ['Engine bias']),
    range,
    value,
  ]);
}

function makePartCard(): HTMLElement {
  const silhouette = node('div', 'museum-part__silhouette', [
    node('span', 'voxel-stack voxel-stack--a'),
    node('span', 'voxel-stack voxel-stack--b'),
    node('span', 'voxel-stack voxel-stack--c'),
  ]);
  return node('article', 'museum-part', [
    silhouette,
    node('div', 'museum-part__copy', [
      node('div', 'museum-part__topline', [
        node('h4', '', ['Heavy ram']),
        createBadge('Rare', 'primary'),
      ]),
      copy('Crude plate steel. High impact damage. Ruins your steering.'),
      node('div', 'museum-part__stats', [
        createStat('Mass', '240 KG'),
        createStat('Impact', '+38%'),
      ]),
    ]),
    node('footer', 'museum-part__footer', [
      node('strong', '', ['$320']),
      createButton({ label: 'Mount', intent: 'primary', size: 'small' }),
    ]),
  ]);
}

function makeLoadout(): HTMLElement {
  const vehicle = node('div', 'museum-vehicle', [
    node('span', 'museum-vehicle__wheel museum-vehicle__wheel--left'),
    node('span', 'museum-vehicle__wheel museum-vehicle__wheel--right'),
    node('span', 'museum-vehicle__body'),
    node('span', 'museum-vehicle__cab'),
    node('span', 'museum-vehicle__gun'),
  ]);
  const stats = node('div', 'museum-loadout__stats', [
    createMeter({ label: 'Hull', value: 74, detail: '740 / 1000' }),
    createMeter({ label: 'Fuel', value: 42, detail: '18 L', intent: 'fuel' }),
    createStat('Mass', '2,480 KG', 'Near the safe axle load.'),
    createStat('Top speed', '68 KM/H'),
  ]);
  return createPanel({
    eyebrow: 'Bay 03 / Active rig',
    title: 'Grave Rattler',
    description: 'Ready enough. The brakes are mostly decorative.',
    variant: 'command',
    actions: [createStatus('Roadworthy', 'online')],
    children: [node('div', 'museum-loadout', [vehicle, stats])],
  });
}

function showToast(root: HTMLElement): void {
  root.querySelector('.museum-toast')?.remove();
  const toast = node('div', 'museum-toast', [
    node('span', 'museum-toast__mark', ['+']),
    node('div', '', [node('strong', '', ['PART SALVAGED']), copy('Heavy ram added to inventory.')]),
  ]);
  root.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function showModal(root: HTMLElement): void {
  const backdrop = node('div', 'museum-modal-backdrop');
  const close = (): void => backdrop.remove();
  const dialog = node('section', 'museum-modal');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'museum-modal-title');
  const title = node('h3', '', ['ABANDON THIS RUN?']);
  title.id = 'museum-modal-title';
  dialog.append(
    node('div', 'museum-modal__mark', ['!']),
    title,
    copy('Everything collected since the last wave will be left in the dirt.'),
    node('div', 'museum-modal__actions', [
      createButton({ label: 'Stay alive', intent: 'primary', onClick: close }),
      createButton({ label: 'Abandon run', intent: 'danger', onClick: close }),
    ]),
  );
  backdrop.appendChild(dialog);
  backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close(); });
  root.appendChild(backdrop);
  dialog.querySelector<HTMLButtonElement>('button')?.focus();
}

function makeFoundationSection(): HTMLElement {
  const wrapper = section(
    'foundation',
    '01',
    'Foundation',
    'A compressed palette and type scale. Bright values are reserved for information, never decoration.',
  );
  wrapper.append(
    node('div', 'museum-grid museum-grid--wide', [
      specimen('Surface & signal tokens', 'Every game surface resolves through these semantic variables.', [makeSwatches()]),
      specimen('Tiny5 type scale', 'Pixel display type from the shared voxel library. Body copy stays monospaced for dense data.', [makeTypeScale()]),
    ]),
  );
  return wrapper;
}

function makeActionsSection(): HTMLElement {
  const wrapper = section(
    'actions',
    '02',
    'Actions & selection',
    'One button anatomy, four intents, three sizes. State is carried by weight, inset marks, and sparse color.',
  );
  wrapper.append(
    node('div', 'museum-grid', [
      specimen('Buttons', 'Primary, neutral, destructive, disabled, icon and pressed states.', [makeButtons()]),
      specimen('Tabs & toggles', 'Compact selection controls for toolbars and configuration panels.', [
        node('div', 'museum-stack', [
          createTabs(['Build', 'Paint', 'Tune'], 0),
          node('div', 'museum-row', [
            createToggle('Mirror build', true),
            createToggle('Snap to grid'),
          ]),
          makeRange(),
        ]),
      ]),
    ]),
  );
  return wrapper;
}

function makeInputsSection(): HTMLElement {
  const wrapper = section(
    'inputs',
    '03',
    'Inputs',
    'Labels stay outside controls. Supporting text is quiet; errors use a narrow blood-red rail.',
  );
  wrapper.append(specimen('Field set', 'Text, select, error and long-form input examples.', [makeForm()]));
  return wrapper;
}

function makeDataSection(): HTMLElement {
  const wrapper = section(
    'data',
    '04',
    'Panels & data',
    'Panels are layered by fill and shadow. Their edges remain darker than the surface—never outlined in light gray.',
  );
  const defaultPanel = createPanel({
    eyebrow: 'Diagnostics',
    title: 'Drivetrain',
    description: 'Live values from the vehicle assembly.',
    actions: [createBadge('Stable', 'primary')],
    children: [createStat('Torque', '840 NM'), createStat('Grip', '0.78'), createStat('Driven wheels', '4 / 6')],
  });
  const sunkenPanel = createPanel({
    eyebrow: 'Storage',
    title: 'Empty bay',
    variant: 'sunken',
    children: [node('div', 'museum-empty', [node('span', '', ['[ ]']), node('p', '', ['NO PART INSTALLED']), createButton({ label: 'Browse scrap', size: 'small' })])],
  });
  wrapper.append(
    node('div', 'museum-grid', [
      specimen('Panel hierarchy', 'Default, recessed and command surfaces share one API.', [node('div', 'museum-panel-grid', [defaultPanel, sunkenPanel])]),
      specimen('Inventory card', 'A dense part card with rarity, stats, price and one clear action.', [makePartCard()]),
    ]),
  );
  return wrapper;
}

function makeFeedbackSection(root: HTMLElement): HTMLElement {
  const wrapper = section(
    'feedback',
    '05',
    'Feedback & HUD',
    'Persistent meters and notices use controlled signals. Transient layers remain blunt and direct.',
  );
  wrapper.append(
    node('div', 'museum-grid', [
      specimen('Status & resources', 'Progress, compact status, labels and keyboard hints.', [
        node('div', 'museum-stack', [
          createMeter({ label: 'Chassis integrity', value: 82, detail: '820 / 1000' }),
          createMeter({ label: 'Armour', value: 56, detail: '56%', intent: 'armour' }),
          createMeter({ label: 'Critical damage', value: 19, detail: '19%', intent: 'danger' }),
          node('div', 'museum-row museum-row--spread', [
            createStatus('Connected', 'online'),
            createStatus('Low fuel', 'idle'),
            node('span', 'museum-keys', ['Rotate ', createKey('R'), ' Cancel ', createKey('ESC')]),
          ]),
        ]),
      ]),
      specimen('Notices & layers', 'Inline notices plus working toast and confirmation modal.', [
        node('div', 'museum-stack', [
          createNotice('Placement blocked', 'The part overlaps the rear axle.', 'warning'),
          createNotice('Structural failure', 'The turret is no longer connected to the chassis.', 'danger'),
          node('div', 'museum-row', [
            createButton({ label: 'Trigger toast', onClick: () => showToast(root) }),
            createButton({ label: 'Open modal', intent: 'warning', onClick: () => showModal(root) }),
          ]),
        ]),
      ]),
    ]),
  );
  return wrapper;
}

function makeCompositionSection(): HTMLElement {
  const wrapper = section(
    'composition',
    '06',
    'Composition',
    'A complete garage module built from the same panel, status, stat, meter and button primitives.',
  );
  wrapper.append(
    node('div', 'museum-composition', [
      makeLoadout(),
      createPanel({
        eyebrow: 'Wave 07',
        title: 'Incoming dead',
        description: 'The gate will fail. Make the vehicle hurt them first.',
        variant: 'sunken',
        children: [
          createStat('Threat', 'HIGH'),
          createStat('Bodies', '42—58'),
          createStat('Weather', 'ACID RAIN'),
          node('div', 'museum-stack museum-stack--action', [
            createButton({ label: 'Fight zombies', intent: 'primary', size: 'large', icon: '>' }),
            createButton({ label: 'Return to garage' }),
          ]),
        ],
      }),
    ]),
  );
  return wrapper;
}

export function mountUIMuseum(root: HTMLElement): void {
  document.title = 'UI Museum / Zombie Motorworks';
  document.documentElement.classList.add('museum-document');
  root.replaceChildren();
  root.className = 'museum-root';

  const navItems = [
    ['01', 'Foundation', '#foundation'],
    ['02', 'Actions', '#actions'],
    ['03', 'Inputs', '#inputs'],
    ['04', 'Panels & data', '#data'],
    ['05', 'Feedback & HUD', '#feedback'],
    ['06', 'Composition', '#composition'],
  ];
  const nav = node('aside', 'museum-nav', [
    node('a', 'museum-brand', [node('span', '', ['ZM']), node('strong', '', ['UI MUSEUM'])]),
    node('p', 'museum-nav__note', ['DEV BUILD / INTERNAL']),
  ]);
  (nav.firstElementChild as HTMLAnchorElement).href = '/';
  const navList = node('nav', 'museum-nav__list');
  navList.setAttribute('aria-label', 'Museum sections');
  for (const [index, label, href] of navItems) {
    const link = node('a', '', [node('span', '', [index]), label]);
    link.href = href;
    navList.appendChild(link);
  }
  nav.append(
    navList,
    node('footer', 'museum-nav__footer', [
      node('span', '', ['TYPE / TINY5']),
      node('span', '', ['RADIUS / 0']),
      node('span', '', ['BUILD / DEV ONLY']),
    ]),
  );

  const main = node('main', 'museum-main');
  main.append(
    node('header', 'museum-hero', [
      node('div', 'museum-hero__signal', [node('span'), node('span'), node('span')]),
      node('p', 'museum-hero__kicker', ['ZOMBIE MOTORWORKS / INTERFACE STANDARD']),
      node('h1', '', ['TOOLS FOR THE ', node('span', '', ['LAST GARAGE'])]),
      copy('A dark, square, low-color system for building machines while the world rots outside.'),
      node('div', 'museum-hero__meta', [
        createStatus('System online', 'online'),
        node('span', '', ['6 GROUPS']),
        node('span', '', ['DEV / UI']),
      ]),
    ]),
    makeFoundationSection(),
    makeActionsSection(),
    makeInputsSection(),
    makeDataSection(),
    makeFeedbackSection(root),
    makeCompositionSection(),
    node('footer', 'museum-footer', [node('span', '', ['END OF INVENTORY']), node('a', '', ['RETURN TO GAME'])]),
  );
  (main.querySelector('.museum-footer a') as HTMLAnchorElement).href = '/';

  root.append(nav, main);
}
