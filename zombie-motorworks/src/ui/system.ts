/**
 * Framework-free UI primitives shared by the game and the development museum.
 *
 * Components only own semantic markup, state and class composition. Visual
 * decisions live in ui-system.css so the whole game can be re-themed through
 * tokens without rewriting component code.
 */

export type UIIntent = 'neutral' | 'primary' | 'danger' | 'warning';
export type UISize = 'small' | 'medium' | 'large';

export interface ButtonOptions {
  label: string;
  intent?: UIIntent;
  size?: UISize;
  icon?: string;
  iconOnly?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
  onClick?: (event: MouseEvent) => void;
}

export interface PanelOptions {
  title?: string;
  eyebrow?: string;
  description?: string;
  variant?: 'default' | 'sunken' | 'command';
  compact?: boolean;
  actions?: HTMLElement[];
  children?: (HTMLElement | string)[];
  className?: string;
}

export interface FieldOptions {
  label: string;
  hint?: string;
  error?: string;
  id?: string;
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
}

export interface MeterOptions {
  label: string;
  value: number;
  max?: number;
  detail?: string;
  intent?: 'health' | 'armour' | 'fuel' | 'danger';
}

function appendContent(parent: HTMLElement, children: (HTMLElement | string)[]): void {
  for (const child of children) {
    parent.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function classes(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

export function createButton(options: ButtonOptions): HTMLButtonElement {
  const button = document.createElement('button');
  const intent = options.intent ?? 'neutral';
  const size = options.size ?? 'medium';
  button.type = 'button';
  button.className = classes(
    'ui-button',
    `ui-button--${intent}`,
    `ui-button--${size}`,
    options.iconOnly && 'ui-button--icon',
    options.className,
  );
  button.disabled = options.disabled ?? false;
  if (options.pressed !== undefined) button.setAttribute('aria-pressed', String(options.pressed));
  if (options.iconOnly) button.setAttribute('aria-label', options.label);

  if (options.icon) {
    const icon = document.createElement('span');
    icon.className = 'ui-button__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = options.icon;
    button.appendChild(icon);
  }
  if (!options.iconOnly) {
    const label = document.createElement('span');
    label.textContent = options.label;
    button.appendChild(label);
  }
  if (options.onClick) button.addEventListener('click', options.onClick);
  return button;
}

export function createPanel(options: PanelOptions = {}): HTMLElement {
  const panel = document.createElement('section');
  panel.className = classes(
    'ui-panel',
    `ui-panel--${options.variant ?? 'default'}`,
    options.compact && 'ui-panel--compact',
    options.className,
  );

  if (options.eyebrow || options.title || options.description || options.actions?.length) {
    const header = document.createElement('header');
    header.className = 'ui-panel__header';
    const heading = document.createElement('div');
    heading.className = 'ui-panel__heading';
    if (options.eyebrow) {
      const eyebrow = document.createElement('div');
      eyebrow.className = 'ui-eyebrow';
      eyebrow.textContent = options.eyebrow;
      heading.appendChild(eyebrow);
    }
    if (options.title) {
      const title = document.createElement('h3');
      title.className = 'ui-panel__title';
      title.textContent = options.title;
      heading.appendChild(title);
    }
    if (options.description) {
      const description = document.createElement('p');
      description.className = 'ui-panel__description';
      description.textContent = options.description;
      heading.appendChild(description);
    }
    header.appendChild(heading);
    if (options.actions?.length) {
      const actions = document.createElement('div');
      actions.className = 'ui-panel__actions';
      actions.append(...options.actions);
      header.appendChild(actions);
    }
    panel.appendChild(header);
  }

  if (options.children?.length) {
    const body = document.createElement('div');
    body.className = 'ui-panel__body';
    appendContent(body, options.children);
    panel.appendChild(body);
  }
  return panel;
}

export function createField(options: FieldOptions): HTMLLabelElement {
  const field = document.createElement('label');
  field.className = classes('ui-field', options.error && 'ui-field--error');
  const id = options.id ?? `ui-field-${crypto.randomUUID()}`;
  options.control.id = id;
  options.control.classList.add('ui-control');

  const label = document.createElement('span');
  label.className = 'ui-field__label';
  label.textContent = options.label;
  field.htmlFor = id;
  field.append(label, options.control);

  const supporting = options.error ?? options.hint;
  if (supporting) {
    const message = document.createElement('span');
    message.className = options.error ? 'ui-field__error' : 'ui-field__hint';
    message.textContent = supporting;
    field.appendChild(message);
  }
  return field;
}

export function createBadge(label: string, intent: UIIntent = 'neutral'): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `ui-badge ui-badge--${intent}`;
  badge.textContent = label;
  return badge;
}

export function createStatus(label: string, state: 'online' | 'idle' | 'danger'): HTMLElement {
  const status = document.createElement('span');
  status.className = `ui-status ui-status--${state}`;
  const dot = document.createElement('span');
  dot.className = 'ui-status__dot';
  dot.setAttribute('aria-hidden', 'true');
  status.append(dot, label);
  return status;
}

export function createMeter(options: MeterOptions): HTMLElement {
  const max = Math.max(options.max ?? 100, 1);
  const value = Math.min(Math.max(options.value, 0), max);
  const wrapper = document.createElement('div');
  wrapper.className = `ui-meter ui-meter--${options.intent ?? 'health'}`;
  const head = document.createElement('div');
  head.className = 'ui-meter__head';
  const label = document.createElement('span');
  label.textContent = options.label;
  const detail = document.createElement('span');
  detail.className = 'ui-meter__detail';
  detail.textContent = options.detail ?? `${value} / ${max}`;
  head.append(label, detail);
  const track = document.createElement('div');
  track.className = 'ui-meter__track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', options.label);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(max));
  track.setAttribute('aria-valuenow', String(value));
  const fill = document.createElement('span');
  fill.className = 'ui-meter__fill';
  fill.style.setProperty('--ui-meter-value', `${(value / max) * 100}%`);
  track.appendChild(fill);
  wrapper.append(head, track);
  return wrapper;
}

export function createStat(labelText: string, valueText: string, meta?: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ui-stat';
  const label = document.createElement('span');
  label.className = 'ui-stat__label';
  label.textContent = labelText;
  const value = document.createElement('strong');
  value.className = 'ui-stat__value';
  value.textContent = valueText;
  row.append(label, value);
  if (meta) {
    const annotation = document.createElement('span');
    annotation.className = 'ui-stat__meta';
    annotation.textContent = meta;
    row.appendChild(annotation);
  }
  return row;
}

export function createToggle(labelText: string, checked = false): HTMLLabelElement {
  const toggle = document.createElement('label');
  toggle.className = 'ui-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  const track = document.createElement('span');
  track.className = 'ui-toggle__track';
  track.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = labelText;
  toggle.append(input, track, label);
  return toggle;
}

export function createTabs(labels: string[], activeIndex = 0): HTMLElement {
  const tabs = document.createElement('div');
  tabs.className = 'ui-tabs';
  tabs.setAttribute('role', 'tablist');
  labels.forEach((text, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'ui-tab';
    tab.textContent = text;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(index === activeIndex));
    tab.addEventListener('click', () => {
      for (const sibling of tabs.querySelectorAll<HTMLElement>('.ui-tab')) {
        sibling.setAttribute('aria-selected', String(sibling === tab));
      }
    });
    tabs.appendChild(tab);
  });
  return tabs;
}

export function createNotice(
  titleText: string,
  bodyText: string,
  intent: 'info' | 'warning' | 'danger' = 'info',
): HTMLElement {
  const notice = document.createElement('div');
  notice.className = `ui-notice ui-notice--${intent}`;
  const mark = document.createElement('span');
  mark.className = 'ui-notice__mark';
  mark.textContent = intent === 'danger' ? 'X' : intent === 'warning' ? '!' : 'i';
  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = titleText;
  const body = document.createElement('p');
  body.textContent = bodyText;
  copy.append(title, body);
  notice.append(mark, copy);
  return notice;
}

export function createKey(label: string): HTMLElement {
  const key = document.createElement('kbd');
  key.className = 'ui-key';
  key.textContent = label;
  return key;
}
