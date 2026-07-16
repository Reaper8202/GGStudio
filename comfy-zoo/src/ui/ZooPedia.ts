/**
 * ZooPedia — a leather-and-leaf journal, one animal per page-spread. Left page:
 * the real 3D model on a slow TURNTABLE (only while visible). Right page: name
 * (Yuyu), diet icon, rarity as 1–5 flower-blossom stars, capture chance %, count.
 * Uncaught = charcoal silhouette + "???". Prev/next arrows + completion % footer.
 *
 * Doubles as skin selector: a swatch row per species from query.zoopedia() skins.
 * Owned → 'ui:requestSkin'. adLocked → Movie icon → 'ui:requestAd' {placement:'skin'}.
 */

import type { ZooPediaEntry } from '../core/EventBus';
import type { ResourceKind } from '../data/types';
import { animalModelPath, tierStars, type UIContext } from './context';
import { clear, el } from './dom';
import { blossomStars, packIcon, signatureIcon } from './icons';
import type { ThumbHandle } from './Thumbnails';

export class ZooPedia {
  private ctx: UIContext;
  private scrim: HTMLElement;
  private journal: HTMLElement;
  private leftPage!: HTMLElement;
  private rightPage!: HTMLElement;
  private footer!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private thumb: ThumbHandle | null = null;
  private entries: ZooPediaEntry[] = [];
  private index = 0;
  private open = false;

  constructor(ctx: UIContext) {
    this.ctx = ctx;
    this.canvas = el('canvas', { class: 'zp-canvas' });
    this.leftPage = el('div', { class: 'zp-page zp-left' }, [this.canvas]);
    this.rightPage = el('div', { class: 'zp-page zp-right' });
    this.footer = el('div', { class: 'zp-footer' });
    const prev = el('button', { class: 'zp-arrow zp-prev', 'aria-label': 'previous' }, [
      packIcon('Play', { size: '22px' }),
    ]);
    const next = el('button', { class: 'zp-arrow zp-next', 'aria-label': 'next' }, [
      packIcon('Play', { size: '22px' }),
    ]);
    prev.addEventListener('click', () => this.turn(-1));
    next.addEventListener('click', () => this.turn(1));
    const close = el('button', { class: 'menu-close zp-close', 'aria-label': 'close' }, [
      packIcon('Wrong', { size: '18px' }),
    ]);
    close.addEventListener('click', () => this.close());
    this.journal = el('div', { class: 'zp-journal' }, [
      close,
      el('div', { class: 'zp-spread' }, [prev, this.leftPage, this.rightPage, next]),
      this.footer,
    ]);
    this.scrim = el('div', { class: 'scrim zp-scrim' }, [this.journal]);
    this.scrim.addEventListener('pointerdown', (e) => {
      if (e.target === this.scrim) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.key === 'Escape') this.close();
      if (e.key === 'ArrowLeft') this.turn(-1);
      if (e.key === 'ArrowRight') this.turn(1);
    });
    ctx.root.append(this.scrim);
    ctx.bus.on('zoopedia:updated', () => {
      if (this.open) this.reload(false);
    });
  }

  private reload(resetIndex: boolean): void {
    this.entries = this.ctx.query.zoopedia();
    if (resetIndex) this.index = 0;
    this.index = Math.max(0, Math.min(this.index, this.entries.length - 1));
    this.render();
  }

  private turn(dir: number): void {
    const n = this.entries.length;
    if (n === 0) return;
    this.index = (this.index + dir + n) % n;
    this.ctx.sfx.play('scroll', 0.6);
    this.render();
  }

  private render(): void {
    const entry = this.entries[this.index];
    if (!entry) return;
    // Left page turntable.
    const path = animalModelPath(entry.speciesId);
    if (path) {
      if (!this.thumb) this.thumb = this.ctx.thumbs.attach(this.canvas, path, 'turntable', { silhouette: !entry.caught });
      else this.thumb.setModel(path, { silhouette: !entry.caught });
      this.thumb.setVisible(true);
    }

    // Right page.
    clear(this.rightPage);
    const name = entry.caught ? entry.name : '???';
    this.rightPage.append(
      el('div', { class: 'zp-name', text: name }),
      el('div', { class: 'zp-stars' }, [blossomStars(tierStars(entry.tier))]),
      el('div', { class: 'zp-row' }, [
        this.dietIcon(entry.diet),
        el('span', { class: 'zp-row-label', text: entry.caught ? capitalize(entry.diet) : '???' }),
      ]),
      el('div', { class: 'zp-row' }, [
        packIcon('Heart', { size: '18px', color: 'var(--soft-red)' }),
        el('span', {
          class: 'zp-row-label',
          text: entry.caught ? `${entry.captureChancePct}% befriend` : '??%',
        }),
      ]),
      el('div', { class: 'zp-row' }, [
        signatureIcon('paw', { size: '18px' }),
        el('span', { class: 'zp-row-label', text: `×${entry.count} housed` }),
      ]),
    );
    if (entry.caught && entry.skins.length > 0) this.rightPage.append(this.skinRow(entry));

    // Footer completion.
    clear(this.footer);
    this.footer.append(
      el('span', { class: 'zp-count', text: `${this.index + 1} / ${this.entries.length}` }),
      el('span', { class: 'zp-complete', text: `${Math.round(this.ctx.query.zoopediaCompletionPct())}% complete` }),
    );
  }

  private skinRow(entry: ZooPediaEntry): HTMLElement {
    const row = el('div', { class: 'zp-skins' });
    for (const skin of entry.skins) {
      const active = entry.activeSkinId === skin.skinId;
      const swatch = el('button', {
        class: 'zp-swatch' + (active ? ' active' : '') + (skin.owned ? '' : ' locked'),
        title: skin.name,
        'aria-label': skin.name,
      });
      if (skin.owned) {
        swatch.addEventListener('click', () => {
          this.ctx.sfx.play('confirm', 0.7);
          this.ctx.bus.emit('ui:requestSkin', { speciesId: entry.speciesId, skinId: skin.skinId });
          this.reload(false);
        });
      } else if (skin.adLocked) {
        swatch.append(packIcon('Movie', { size: '16px', color: 'var(--cream)' }));
        swatch.addEventListener('click', () => {
          this.ctx.sfx.play('confirm', 0.7);
          this.ctx.bus.emit('ui:requestAd', {
            placement: 'skin',
            payload: `${entry.speciesId}:${skin.skinId}`,
          });
        });
      } else {
        swatch.append(packIcon('Locked', { size: '14px', color: 'var(--cream)' }));
      }
      row.append(swatch);
    }
    return row;
  }

  private dietIcon(diet: ResourceKind): HTMLElement {
    switch (diet) {
      case 'hay':
        return signatureIcon('hay', { size: '18px', color: 'var(--peach)' });
      case 'berry':
        return signatureIcon('berry', { size: '18px', color: 'var(--soft-red)' });
      case 'forage':
        return signatureIcon('berry', { size: '18px', color: 'var(--leaf)' });
      case 'water':
        return signatureIcon('leaf', { size: '18px', color: 'var(--sky)' });
    }
  }

  toggle(): void {
    this.open ? this.close() : this.show();
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.reload(true);
    this.scrim.classList.add('open');
    this.ctx.sfx.play('woop', 0.7);
    this.ctx.bus.emit('ui:menuOpened', { menu: 'zoopedia' });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.scrim.classList.remove('open');
    this.thumb?.setVisible(false);
    this.ctx.sfx.play('woom', 0.6);
    this.ctx.bus.emit('ui:menuClosed', { menu: 'zoopedia' });
  }

  isOpen(): boolean {
    return this.open;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
