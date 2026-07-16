/**
 * BuildMenu — a wooden-signpost card sliding up over the bottom third only; the
 * world stays visible (body.menu-open desaturates #game-canvas via theme.css).
 * Catalog entries are parchment cards with LIVE 3D model thumbnails, cost under,
 * locked entries as darkened silhouettes with a lockHint. Picking an entry emits
 * 'ui:requestBuild' and collapses to a slim Correct/Wrong confirm bar wired to
 * 'ui:confirmBuild'/'ui:cancelBuild'; 'build:ghostValidity' toggles confirm.
 */

import type { BuildCatalogEntry } from '../core/EventBus';
import type { UIContext } from './context';
import { getAnimal } from '../core/data';
import { clear, el, handmadeTilt } from './dom';
import { packIcon, signatureIcon } from './icons';
import type { ThumbHandle } from './Thumbnails';

export class BuildMenu {
  private ctx: UIContext;
  private root: HTMLElement;
  private cardsWrap!: HTMLElement;
  private confirmBar!: HTMLElement;
  private confirmBtn!: HTMLElement;
  private catalogView!: HTMLElement;
  private thumbs: ThumbHandle[] = [];
  private open = false;
  private pendingShelter: string | null = null;

  constructor(ctx: UIContext) {
    this.ctx = ctx;
    this.root = el('div', { class: 'build-menu' });
    ctx.root.append(this.root);
    this.build();
    ctx.bus.on('build:ghostValidity', (p) => this.setConfirmEnabled(p.valid));
    // Build mode can end core-side (double-click placement) — close up if so.
    ctx.bus.on('build:mode', (p) => {
      if (!p.active && this.pendingShelter) {
        this.pendingShelter = null;
        this.close();
      }
    });
    // Clicking elsewhere on the map/UI closes the shop (but not while actively
    // placing a shelter — that click drives the build-ghost placement instead).
    window.addEventListener('pointerdown', (e) => {
      if (!this.open || this.pendingShelter) return;
      if (!this.root.contains(e.target as Node)) this.close();
    });
  }

  private build(): void {
    this.cardsWrap = el('div', { class: 'build-cards' });
    this.catalogView = el('div', { class: 'build-catalog' }, [
      el('div', { class: 'build-signpost-head' }, [
        packIcon('Shop', { size: '22px', color: 'var(--cream)' }),
        el('span', { class: 'build-title', text: 'Shop' }),
        this.closeButton(),
      ]),
      this.cardsWrap,
    ]);

    this.confirmBtn = el('button', { class: 'confirm-yes', 'aria-label': 'confirm placement' }, [
      packIcon('Correct', { size: '30px', color: 'var(--cream)' }),
    ]);
    this.confirmBtn.addEventListener('click', () => {
      if (this.confirmBtn.classList.contains('disabled')) return;
      this.ctx.sfx.play('confirm', 0.8);
      this.ctx.bus.emit('ui:confirmBuild', {});
      this.close();
    });
    const cancelBtn = el('button', { class: 'confirm-no', 'aria-label': 'cancel placement' }, [
      packIcon('Wrong', { size: '30px', color: 'var(--cream)' }),
    ]);
    cancelBtn.addEventListener('click', () => {
      this.ctx.sfx.play('back', 0.7);
      // clear pending BEFORE cancelBuild so the build:mode handler doesn't close us
      this.showCatalog();
      this.ctx.bus.emit('ui:cancelBuild', {});
    });
    this.confirmBar = el('div', { class: 'confirm-bar' }, [
      cancelBtn,
      el('span', { class: 'confirm-hint', text: 'Place it just right' }),
      this.confirmBtn,
    ]);

    this.root.append(this.catalogView, this.confirmBar);
  }

  private closeButton(): HTMLElement {
    const btn = el('button', { class: 'menu-close', 'aria-label': 'close' }, [
      packIcon('Wrong', { size: '18px' }),
    ]);
    btn.addEventListener('click', () => this.close());
    return btn;
  }

  private renderCatalog(): void {
    for (const t of this.thumbs) t.dispose();
    this.thumbs = [];
    clear(this.cardsWrap);
    const catalog = this.ctx.query.buildCatalog();
    for (const entry of catalog) this.cardsWrap.append(this.card(entry));
  }

  private card(entry: BuildCatalogEntry): HTMLElement {
    const canvas = el('canvas', { class: 'build-thumb-canvas' });
    const thumb = el('div', { class: 'build-thumb' }, [canvas]);
    const cost = el('div', { class: 'build-cost' }, [
      signatureIcon('acorn', { size: '16px', color: 'var(--peach)' }),
      el('span', { text: String(entry.cost) }),
    ]);
    const names = entry.species.map((id) => getAnimal(id).name);
    const accepts =
      names.length > 0
        ? el('div', { class: 'build-accepts', title: `Accepts: ${names.join(', ')}` }, [
            signatureIcon('paw', { size: '12px', color: 'var(--bark)' }),
            el('span', { text: names.join(', ') }),
          ])
        : null;

    const card = el(
      'button',
      { class: 'build-card' + (entry.unlocked ? '' : ' locked'), title: entry.name },
      [thumb, el('div', { class: 'build-name', text: entry.name }), ...(accepts ? [accepts] : []), cost],
    );
    card.style.setProperty('--rot', `${handmadeTilt()}deg`);

    if (!entry.unlocked) {
      card.append(
        el('div', { class: 'build-lock' }, [
          packIcon('Locked', { size: '20px', color: 'var(--cream)' }),
          el('span', { class: 'lock-hint', text: entry.lockHint ?? 'Locked' }),
        ]),
      );
      card.classList.add('disabled');
    } else {
      card.addEventListener('pointerenter', () => this.ctx.sfx.play('hover', 0.35));
      card.addEventListener('click', () => this.pick(entry));
    }

    // Live thumbnail (silhouette for locked entries).
    this.thumbs.push(
      this.ctx.thumbs.attach(canvas, entry.modelPath, 'static', { silhouette: !entry.unlocked }),
    );
    return card;
  }

  private pick(entry: BuildCatalogEntry): void {
    this.pendingShelter = entry.shelterId;
    this.ctx.sfx.play('confirm', 0.7);
    this.ctx.bus.emit('ui:requestBuild', { shelterId: entry.shelterId });
    this.showConfirm();
  }

  private showConfirm(): void {
    this.catalogView.classList.add('hidden');
    this.confirmBar.classList.add('active');
    this.setConfirmEnabled(false); // wait for first build:ghostValidity
  }

  private showCatalog(): void {
    this.pendingShelter = null;
    this.confirmBar.classList.remove('active');
    this.catalogView.classList.remove('hidden');
  }

  private setConfirmEnabled(valid: boolean): void {
    this.confirmBtn.classList.toggle('disabled', !valid);
  }

  toggle(): void {
    this.open ? this.close() : this.show();
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.renderCatalog();
    this.showCatalog();
    document.body.classList.add('menu-open');
    this.root.classList.add('open');
    this.ctx.sfx.play('menuOpen', 0.8);
    this.ctx.bus.emit('ui:menuOpened', { menu: 'build' });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    document.body.classList.remove('menu-open');
    this.root.classList.remove('open');
    if (this.pendingShelter) {
      this.ctx.bus.emit('ui:cancelBuild', {});
      this.pendingShelter = null;
    }
    for (const t of this.thumbs) t.dispose();
    this.thumbs = [];
    this.ctx.sfx.play('menuClose', 0.7);
    this.ctx.bus.emit('ui:menuClosed', { menu: 'build' });
  }

  isOpen(): boolean {
    return this.open;
  }
}
