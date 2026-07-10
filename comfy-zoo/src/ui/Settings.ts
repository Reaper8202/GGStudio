/**
 * Settings — a small cozy card summoned from the radial menu. SFX toggle
 * (VolumeOn/VolumeOff), music toggle (grayed "coming soon"), a credits line.
 * Emits 'ui:settingChanged'. Matches the design tokens.
 */

import type { UIContext } from './context';
import { el } from './dom';
import { packIcon } from './icons';

export class Settings {
  private ctx: UIContext;
  private scrim: HTMLElement;
  private card: HTMLElement;
  private sfxRow!: HTMLElement;
  private open = false;
  private sfxOn: boolean;

  constructor(ctx: UIContext) {
    this.ctx = ctx;
    this.sfxOn = ctx.sfx.isEnabled();
    this.card = el('div', { class: 'settings-card' });
    this.scrim = el('div', { class: 'scrim settings-scrim' }, [this.card]);
    this.scrim.addEventListener('pointerdown', (e) => {
      if (e.target === this.scrim) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (this.open && e.key === 'Escape') this.close();
    });
    ctx.root.append(this.scrim);
    this.build();
  }

  private build(): void {
    const close = el('button', { class: 'menu-close', 'aria-label': 'close' }, [
      packIcon('Wrong', { size: '18px' }),
    ]);
    close.addEventListener('click', () => this.close());

    this.sfxRow = this.toggleRow('Sound', () => this.sfxOn, () => {
      this.sfxOn = !this.sfxOn;
      this.ctx.sfx.setEnabled(this.sfxOn);
      this.ctx.bus.emit('ui:settingChanged', { key: 'sfx', value: this.sfxOn });
      this.ctx.sfx.play('confirm', 0.6);
      this.refreshSfxRow();
    });

    const musicRow = el('div', { class: 'settings-row disabled' }, [
      packIcon('Pause', { size: '22px' }),
      el('span', { class: 'settings-label', text: 'Music' }),
      el('span', { class: 'settings-soon', text: 'coming soon' }),
    ]);

    this.card.append(
      el('div', { class: 'settings-head' }, [
        packIcon('Settings', { size: '22px' }),
        el('span', { class: 'settings-title', text: 'Settings' }),
        close,
      ]),
      this.sfxRow,
      musicRow,
      el('div', { class: 'settings-credits', text: 'Comfy Zoo · made with love' }),
    );
    this.refreshSfxRow();
  }

  private toggleRow(label: string, get: () => boolean, onToggle: () => void): HTMLElement {
    const iconWrap = el('span', { class: 'settings-icon' });
    const state = el('span', { class: 'settings-state' });
    const row = el('button', { class: 'settings-row', 'aria-label': label }, [
      iconWrap,
      el('span', { class: 'settings-label', text: label }),
      state,
    ]);
    row.addEventListener('click', onToggle);
    // store a refresh hook on the element for later state sync
    (row as HTMLElement & { _refresh?: () => void })._refresh = () => {
      const on = get();
      iconWrap.replaceChildren(packIcon(on ? 'VolumeOn' : 'VolumeOff', { size: '22px' }));
      state.textContent = on ? 'On' : 'Off';
      row.classList.toggle('on', on);
    };
    return row;
  }

  private refreshSfxRow(): void {
    (this.sfxRow as HTMLElement & { _refresh?: () => void })._refresh?.();
  }

  toggle(): void {
    this.open ? this.close() : this.show();
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.sfxOn = this.ctx.sfx.isEnabled();
    this.refreshSfxRow();
    this.scrim.classList.add('open');
    this.ctx.sfx.play('menuOpen', 0.7);
    this.ctx.bus.emit('ui:menuOpened', { menu: 'settings' });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.scrim.classList.remove('open');
    this.ctx.sfx.play('menuClose', 0.6);
    this.ctx.bus.emit('ui:menuClosed', { menu: 'settings' });
  }

  isOpen(): boolean {
    return this.open;
  }
}
