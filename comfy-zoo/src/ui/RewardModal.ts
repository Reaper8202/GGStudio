/**
 * RewardModal — a small centered card (never full-screen). Handles:
 *   'ad:offer'       → reward's 3D model bouncing, one big Movie button
 *                      ("Watch to Rescue"/"Watch"), quiet "not now"; accept → 'ui:requestAd'.
 *   'offline:summary'→ warm "While you were away…" card with coins earned.
 *   'daily:gift'     → Gift icon + streak day.
 *   'ad:unavailable' → soft-timer message ("returns in N min") for Playables.
 *   Local fake-ad interstitial: when adapter.name==='local' and 'ad:accepted'
 *   fires, a 1.5s cozy "supporting the zoo…" overlay.
 */

import type { AdPlacement } from '../core/EventBus';
import { animalModelPath, type UIContext } from './context';
import { clear, el } from './dom';
import { packIcon, signatureIcon } from './icons';
import type { ThumbHandle } from './Thumbnails';

const WATCH_LABEL: Record<AdPlacement, string> = {
  rescue: 'Watch to Rescue',
  legendary: 'Watch to Summon',
  mythicEgg: 'Watch to Hatch',
  skin: 'Watch to Unlock',
  doubleHarvest: 'Watch for 2×',
  instantBuild: 'Watch to Finish',
};

export class RewardModal {
  private ctx: UIContext;
  private scrim: HTMLElement;
  private card: HTMLElement;
  private interstitial: HTMLElement;
  private thumb: ThumbHandle | null = null;
  private open = false;

  constructor(ctx: UIContext) {
    this.ctx = ctx;
    this.card = el('div', { class: 'reward-card' });
    this.scrim = el('div', { class: 'scrim reward-scrim' }, [this.card]);
    this.scrim.addEventListener('pointerdown', (e) => {
      if (e.target === this.scrim) this.dismiss();
    });
    this.interstitial = el('div', { class: 'interstitial hidden' }, [
      signatureIcon('leaf', { size: '48px', color: 'var(--leaf)' }),
      el('div', { class: 'interstitial-text', text: 'supporting the zoo…' }),
    ]);
    ctx.root.append(this.scrim, this.interstitial);
    this.bind();
  }

  private bind(): void {
    const bus = this.ctx.bus;
    bus.on('ad:offer', (p) => this.showAdOffer(p.placement, p.payload));
    bus.on('ad:unavailable', (p) => this.showUnavailable(p.placement, p.cooldownSeconds));
    bus.on('offline:summary', (p) => this.showOffline(p.coins, p.awaySeconds));
    bus.on('daily:gift', (p) => this.showDailyGift(p.day, p.coins));
    bus.on('ad:accepted', () => {
      if (this.ctx.adapter.name === 'local') this.showInterstitial();
    });
  }

  private frame(children: (Node | string)[]): void {
    this.thumb?.setVisible(false);
    this.thumb = null;
    clear(this.card);
    this.card.append(...children);
    this.show();
  }

  private modelBounce(species: string | null): HTMLElement {
    const holder = el('div', { class: 'reward-thumb' });
    const path = species ? animalModelPath(species) : null;
    if (path) {
      const canvas = el('canvas', { class: 'reward-canvas' });
      holder.append(canvas);
      this.thumb = this.ctx.thumbs.attach(canvas, path, 'bounce');
      this.thumb.setVisible(true);
    } else {
      holder.append(packIcon('Gift', { size: '64px', color: 'var(--peach)' }));
    }
    return holder;
  }

  private watchButton(label: string, onClick: () => void): HTMLElement {
    const btn = el('button', { class: 'watch-btn', 'aria-label': label }, [
      packIcon('Movie', { size: '26px', color: 'var(--cream)' }),
      el('span', { text: label }),
    ]);
    btn.addEventListener('click', onClick);
    return btn;
  }

  private notNow(): HTMLElement {
    const link = el('button', { class: 'not-now', text: 'not now' });
    link.addEventListener('click', () => this.dismiss());
    return link;
  }

  private showAdOffer(placement: AdPlacement, payload?: string): void {
    const species = placement === 'skin' ? (payload ?? '').split(':')[0] : payload ?? null;
    this.frame([
      el('div', { class: 'reward-flavor', text: rewardFlavor(placement) }),
      this.modelBounce(species || null),
      this.watchButton(WATCH_LABEL[placement], () => {
        this.ctx.sfx.play('confirm', 0.8);
        this.ctx.bus.emit('ui:requestAd', { placement, payload });
        this.dismiss();
      }),
      this.notNow(),
    ]);
  }

  private showUnavailable(placement: AdPlacement, cooldownSeconds: number): void {
    const mins = Math.max(1, Math.ceil(cooldownSeconds / 60));
    this.frame([
      el('div', { class: 'reward-flavor', text: rewardFlavor(placement) }),
      el('div', { class: 'reward-thumb' }, [packIcon('Pause', { size: '54px', color: 'var(--sky)' })]),
      el('div', { class: 'reward-timer', text: `Returns in ${mins} min` }),
      this.notNow(),
    ]);
  }

  private showOffline(coins: number, awaySeconds: number): void {
    this.frame([
      el('div', { class: 'reward-flavor', text: 'While you were away…' }),
      el('div', { class: 'reward-thumb' }, [signatureIcon('acorn', { size: '58px', color: 'var(--peach)' })]),
      el('div', { class: 'reward-big' }, [
        signatureIcon('acorn', { size: '24px', color: 'var(--peach)' }),
        el('span', { text: `+${coins}` }),
      ]),
      el('div', { class: 'reward-sub', text: `Your animals earned this over ${formatAway(awaySeconds)}` }),
      this.okButton('Collect'),
    ]);
  }

  private showDailyGift(day: number, coins: number): void {
    this.frame([
      el('div', { class: 'reward-flavor', text: `Daily gift · Day ${day}` }),
      el('div', { class: 'reward-thumb' }, [packIcon('Gift', { size: '58px', color: 'var(--leaf)' })]),
      el('div', { class: 'reward-big' }, [
        signatureIcon('acorn', { size: '24px', color: 'var(--peach)' }),
        el('span', { text: `+${coins}` }),
      ]),
      this.okButton('Thanks!'),
    ]);
  }

  private okButton(label: string): HTMLElement {
    const btn = el('button', { class: 'watch-btn ok-btn', 'aria-label': label }, [
      packIcon('Correct', { size: '24px', color: 'var(--cream)' }),
      el('span', { text: label }),
    ]);
    btn.addEventListener('click', () => {
      this.ctx.sfx.play('positive', 0.7);
      this.dismiss();
    });
    return btn;
  }

  private showInterstitial(): void {
    this.interstitial.classList.remove('hidden');
    this.interstitial.classList.add('show');
    window.setTimeout(() => {
      this.interstitial.classList.remove('show');
      this.interstitial.classList.add('hidden');
    }, 1500);
  }

  show(): void {
    if (!this.open) {
      this.open = true;
      this.scrim.classList.add('open');
      this.ctx.sfx.play('woop', 0.8);
    }
  }

  dismiss(): void {
    if (!this.open) return;
    this.open = false;
    this.scrim.classList.remove('open');
    this.thumb?.setVisible(false);
    this.thumb = null;
    this.ctx.sfx.play('woom', 0.6);
  }
}

function rewardFlavor(placement: AdPlacement): string {
  switch (placement) {
    case 'rescue':
      return 'A friend is feeling sad…';
    case 'legendary':
      return 'A legendary friend appears!';
    case 'mythicEgg':
      return 'A giant egg is trembling…';
    case 'skin':
      return 'Unlock a new look';
    case 'doubleHarvest':
      return 'Double harvest!';
    case 'instantBuild':
      return 'Finish it instantly?';
  }
}

function formatAway(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}
