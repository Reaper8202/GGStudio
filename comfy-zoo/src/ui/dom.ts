/**
 * Tiny DOM helpers — no framework, crisp text overlay. UI agent owns this.
 */

export type ElAttrs = {
  class?: string;
  text?: string;
  html?: string;
  title?: string;
  style?: Partial<CSSStyleDeclaration>;
  dataset?: Record<string, string>;
  [key: `aria-${string}`]: string | undefined;
};

/** Create an element with class/text/style/dataset in one call. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: ElAttrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs.class) node.className = attrs.class;
  if (attrs.text !== undefined) node.textContent = attrs.text;
  if (attrs.html !== undefined) node.innerHTML = attrs.html;
  if (attrs.title) node.title = attrs.title;
  if (attrs.style) Object.assign(node.style, attrs.style);
  if (attrs.dataset) for (const k in attrs.dataset) node.dataset[k] = attrs.dataset[k];
  for (const key in attrs) {
    if (key.startsWith('aria-')) {
      const v = attrs[key as `aria-${string}`];
      if (v !== undefined) node.setAttribute(key, v);
    }
  }
  for (const c of children) node.append(c);
  return node;
}

/** Remove all children. */
export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Random handmade tilt for cards, in degrees. */
export function handmadeTilt(maxDeg = 2): number {
  const mag = 1 + Math.random() * (maxDeg - 1);
  return Math.random() < 0.5 ? -mag : mag;
}

/** Fire a callback on the next animation frame after layout (double-rAF). */
export function nextFrame(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/** Clamp a number. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** localStorage get/set with JSON + silent failure (private mode safe). */
export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore quota / private mode */
    }
  },
};
