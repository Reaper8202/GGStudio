/**
 * Icon system.
 *  - Pack icons (from assets/icons/<Name>.svg): a white silhouette recolored via
 *    CSS mask-image + background-color (bark by default). Plan §2 mapping.
 *  - Signature icons that don't exist in the pack are hand-drawn here as inline
 *    SVG strings in the same rounded-silhouette style: paw, leaf, acorn, berry,
 *    hammer, hay-bundle, and the flower-blossom rarity star.
 *
 * All icons scale to their container (width/height set by the caller/CSS).
 */

import { el } from './dom';

/** Pack icons shipped in assets/icons/ (see plan §2). Tinted via mask-image. */
export type PackIcon =
  | 'Movie'
  | 'Gift'
  | 'Target'
  | 'Medal'
  | 'Heart'
  | 'Smile'
  | 'Alert'
  | 'Warning1'
  | 'Correct'
  | 'Wrong'
  | 'Locked'
  | 'Unlocked'
  | 'Shop'
  | 'Plus'
  | 'Minus'
  | 'Trash'
  | 'Settings'
  | 'VolumeOn'
  | 'VolumeOff'
  | 'Play'
  | 'Pause'
  | 'Sun'
  | 'Moon';

/** Hand-drawn signature icons (inline SVG, fill: currentColor). */
export type SignatureIcon = 'paw' | 'leaf' | 'acorn' | 'berry' | 'hammer' | 'hay';

const SIGNATURE_SVG: Record<SignatureIcon, string> = {
  // Rounded four-toe paw print.
  paw: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <ellipse cx="12" cy="16" rx="5.2" ry="4"/>
    <circle cx="5.4" cy="11.2" r="2.3"/>
    <circle cx="9.3" cy="7.2" r="2.4"/>
    <circle cx="14.7" cy="7.2" r="2.4"/>
    <circle cx="18.6" cy="11.2" r="2.3"/>
  </svg>`,
  // Single rounded leaf with a midrib.
  leaf: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20 4C11 4 4.5 9 4.5 17c0 1.6.4 2.9.9 3.6C7 15 12 11.5 18 10c-4.5 2.6-7.7 6.2-9.4 10.9C15.5 21.6 21 16 21 8c0-1.7-.3-3-1-4z"/>
  </svg>`,
  // Acorn = currency.
  acorn: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 21c-3.6 0-6.5-3.2-6.5-7 0-.7.6-1.2 1.3-1.2h10.4c.7 0 1.3.5 1.3 1.2 0 3.8-2.9 7-6.5 7z"/>
    <path d="M6 12.2c-.9 0-1.6-.7-1.6-1.5S5.1 9.2 6 9.2h12c.9 0 1.6.7 1.6 1.5s-.7 1.5-1.6 1.5z"/>
    <rect x="11" y="4.4" width="2" height="4" rx="1"/>
  </svg>`,
  // Berry cluster = forage/collect.
  berry: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 3.2c.3 2 1.6 3.3 3.6 3.8-1.4.5-2.4 1.4-2.9 2.6-.5-1.2-1.5-2.1-2.9-2.6 2-.5 3.3-1.8 3.2-3.8z"/>
    <circle cx="9" cy="14" r="3.4"/>
    <circle cx="15" cy="14" r="3.4"/>
    <circle cx="12" cy="18.6" r="3.4"/>
  </svg>`,
  // Builder's hammer = build.
  hammer: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M13.6 3.3 8.9 8l2.5 2.5 4.7-4.7c.5-.5.5-1.3 0-1.9l-.6-.6c-.5-.5-1.4-.5-1.9 0z"/>
    <path d="M9.6 9.4 4.1 14.9c-.6.6-.6 1.5 0 2.1l2.9 2.9c.6.6 1.5.6 2.1 0l5.5-5.5z"/>
    <rect x="14.5" y="3.4" width="2.4" height="8" rx="1.2" transform="rotate(-45 15.7 7.4)"/>
  </svg>`,
  // Tied hay bundle = deposit into trough.
  hay: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="4" y="7" width="16" height="11" rx="2.5"/>
    <rect x="10.6" y="5.5" width="2.8" height="14" rx="1.2"/>
    <path d="M4 11h16M4 14.5h16" stroke="var(--cream,#f6eedd)" stroke-width="1.1" opacity=".55"/>
  </svg>`,
};

export interface IconOpts {
  /** CSS size (applied to width & height). Default inherits from CSS. */
  size?: string;
  /** Tint color (CSS value). Default: var(--bark). */
  color?: string;
  /** Extra class names. */
  class?: string;
}

/** Build a pack icon element (mask-image tinted). */
export function packIcon(name: PackIcon, opts: IconOpts = {}): HTMLElement {
  const node = el('span', { class: 'icon icon-pack' + (opts.class ? ' ' + opts.class : '') });
  const url = `url("/assets/icons/${name}.svg")`;
  node.style.webkitMaskImage = url;
  node.style.maskImage = url;
  node.style.backgroundColor = opts.color ?? 'var(--bark)';
  if (opts.size) {
    node.style.width = opts.size;
    node.style.height = opts.size;
  }
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', name);
  return node;
}

/** Build a hand-drawn signature icon element (inline SVG, colored via CSS color). */
export function signatureIcon(name: SignatureIcon, opts: IconOpts = {}): HTMLElement {
  const node = el('span', {
    class: 'icon icon-svg' + (opts.class ? ' ' + opts.class : ''),
    html: SIGNATURE_SVG[name],
  });
  if (opts.color) node.style.color = opts.color;
  if (opts.size) {
    node.style.width = opts.size;
    node.style.height = opts.size;
  }
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', name);
  return node;
}

/** Flower-blossom rarity star (filled or hollow). */
export function blossomStar(filled: boolean, opts: IconOpts = {}): HTMLElement {
  const petals = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const cx = 12 + Math.cos(a) * 5.4;
    const cy = 12 + Math.sin(a) * 5.4;
    return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="3.4"/>`;
  }).join('');
  const svg = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    ${petals}<circle cx="12" cy="12" r="3.2" fill="var(--cream,#f6eedd)"/></svg>`;
  const node = el('span', {
    class: 'icon icon-svg blossom' + (filled ? ' filled' : ' hollow') + (opts.class ? ' ' + opts.class : ''),
    html: svg,
  });
  if (opts.color) node.style.color = opts.color;
  if (opts.size) {
    node.style.width = opts.size;
    node.style.height = opts.size;
  }
  return node;
}

/** Row of 1..5 blossom stars for a rarity value. */
export function blossomStars(count: number, max = 5): HTMLElement {
  const row = el('span', { class: 'blossom-stars', 'aria-label': `rarity ${count} of ${max}` });
  for (let i = 0; i < max; i++) row.append(blossomStar(i < count));
  return row;
}
