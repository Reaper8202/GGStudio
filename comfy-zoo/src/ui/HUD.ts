/**
 * HUD — exactly four elements, zero persistent panels:
 *   1. Coin counter (top-left)   2. Quest chip (top-center)
 *   3. Menu leaf + radial (top-right)
 *   4. Action button (bottom-right) + virtual joystick (bottom-left) — TOUCH ONLY.
 *      Desktop shows neither; instead a one-time `E` keycap hint per new context.
 *
 * Joystick Y-axis convention (core reads UIHandles.joystick):
 *   x = +1 when the thumb is pushed RIGHT, y = +1 when pushed UP-SCREEN.
 *   Screen delta dy is negative going up, so we store y = -dy / radius. Pushing
 *   up on the stick therefore moves the player "up-screen".
 */

import type { JoystickState } from '../core/EventBus';
import type { UIContext } from './context';
import { clamp, el, store } from './dom';
import { packIcon, signatureIcon, type SignatureIcon } from './icons';

export interface HUDCallbacks {
  openBuild(): void;
  openZooPedia(): void;
  openSettings(): void;
}

type ActionContext = ReturnType<UIContext['query']['actionContext']>;

const HINTS_KEY = 'comfyzoo.hints';
const ACTION_ICON: Record<Exclude<ActionContext, 'none'>, SignatureIcon> = {
  capture: 'paw',
  collect: 'berry',
  build: 'hammer',
  deposit: 'hay',
};

export class HUD {
  private ctx: UIContext;
  private cb: HUDCallbacks;
  readonly joystick: JoystickState;

  private layer: HTMLElement;
  private coinValueEl!: HTMLElement;
  private coinCounter!: HTMLElement;
  private questChip!: HTMLElement;
  private questLabel!: HTMLElement;
  private questList!: HTMLElement;
  private radial!: HTMLElement;
  private leafBtn!: HTMLElement;
  private actionBtn!: HTMLElement;
  private actionIconWrap!: HTMLElement;
  private joyBase!: HTMLElement;
  private joyThumb!: HTMLElement;
  private keyHint!: HTMLElement;

  private displayedCoins = 0;
  private coinAnimRaf = 0;
  private questCollapseTimer = 0;
  private radialOpen = false;
  private touchInputBuilt = false;
  private lastActionCtx: ActionContext = 'none';
  private seenHintContexts: Record<string, boolean>;

  constructor(ctx: UIContext, joystick: JoystickState, cb: HUDCallbacks) {
    this.ctx = ctx;
    this.cb = cb;
    this.joystick = joystick;
    this.seenHintContexts = store.get<Record<string, boolean>>(HINTS_KEY, {});
    this.layer = el('div', { class: 'hud' });
    ctx.root.append(this.layer);
    this.buildCoinCounter();
    this.buildQuestChip();
    this.buildMenuLeaf();
    this.buildActionAndKeyHint();
    this.bindEvents();
    this.applyOrientation();
    window.addEventListener('resize', () => this.applyOrientation());
    // Enable touch controls the first time a touch is seen.
    const onTouch = () => {
      this.buildTouchControls();
      window.removeEventListener('touchstart', onTouch);
    };
    window.addEventListener('touchstart', onTouch, { passive: true });
    requestAnimationFrame(this.pollAction);
  }

  // --- 1. Coin counter -----------------------------------------------------
  private buildCoinCounter(): void {
    this.coinValueEl = el('span', { class: 'coin-value', text: '0' });
    this.coinCounter = el('div', { class: 'coin-counter', 'aria-label': 'coins' }, [
      signatureIcon('acorn', { class: 'coin-acorn', color: 'var(--peach)' }),
      this.coinValueEl,
    ]);
    this.layer.append(this.coinCounter);
    this.displayedCoins = this.ctx.query.coins();
    this.coinValueEl.textContent = String(this.displayedCoins);
  }

  private animateCoinsTo(target: number): void {
    if (this.coinAnimRaf) cancelAnimationFrame(this.coinAnimRaf);
    const from = this.displayedCoins;
    const start = performance.now();
    const dur = 450;
    const step = (now: number) => {
      const k = clamp((now - start) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      this.displayedCoins = Math.round(from + (target - from) * eased);
      this.coinValueEl.textContent = String(this.displayedCoins);
      if (k < 1) this.coinAnimRaf = requestAnimationFrame(step);
      else this.displayedCoins = target;
    };
    this.coinAnimRaf = requestAnimationFrame(step);
  }

  private spawnCoinFly(count: number): void {
    const target = this.coinCounter.getBoundingClientRect();
    const tx = target.left + 14;
    const ty = target.top + target.height / 2;
    const n = clamp(count, 1, 6);
    for (let i = 0; i < n; i++) {
      const p = signatureIcon('acorn', { class: 'coin-fly', color: 'var(--peach)' });
      const sx = window.innerWidth * (0.4 + Math.random() * 0.25);
      const sy = window.innerHeight * (0.45 + Math.random() * 0.2);
      const arc = -40 - Math.random() * 60;
      p.style.setProperty('--sx', `${sx}px`);
      p.style.setProperty('--sy', `${sy}px`);
      p.style.setProperty('--tx', `${tx}px`);
      p.style.setProperty('--ty', `${ty}px`);
      p.style.setProperty('--arc', `${arc}px`);
      p.style.animationDelay = `${i * 70}ms`;
      p.addEventListener('animationend', () => p.remove());
      this.layer.append(p);
      window.setTimeout(() => this.ctx.sfx.coinTick(), i * 70);
    }
  }

  // --- 2. Quest chip -------------------------------------------------------
  private buildQuestChip(): void {
    this.questLabel = el('span', { class: 'quest-label' });
    this.questList = el('div', { class: 'quest-list' });
    this.questChip = el('button', { class: 'quest-chip', 'aria-label': 'current quest' }, [
      packIcon('Target', { class: 'quest-icon', size: '18px' }),
      this.questLabel,
    ]);
    this.questChip.append(this.questList);
    this.questChip.addEventListener('click', () => this.toggleQuestList());
    this.layer.append(this.questChip);
    this.refreshQuestChip();
  }

  private refreshQuestChip(): void {
    const quests = this.ctx.query.activeQuests();
    const top = quests[0];
    this.questLabel.textContent = top
      ? `${stripTemplate(top.text, top.target)} · ${top.current}/${top.target}`
      : 'All quests done!';
  }

  private toggleQuestList(): void {
    if (this.questChip.classList.contains('expanded')) {
      this.collapseQuestList();
      return;
    }
    const quests = this.ctx.query.activeQuests();
    this.questList.replaceChildren(
      ...quests.map((q) =>
        el('div', { class: 'quest-row' }, [
          packIcon('Medal', { size: '16px' }),
          el('span', {
            class: 'quest-row-text',
            text: `${stripTemplate(q.text, q.target)} · ${q.current}/${q.target}`,
          }),
        ]),
      ),
    );
    this.questChip.classList.add('expanded');
    this.ctx.sfx.play('menuOpen', 0.5);
    if (this.questCollapseTimer) clearTimeout(this.questCollapseTimer);
    this.questCollapseTimer = window.setTimeout(() => this.collapseQuestList(), 4000);
  }

  private collapseQuestList(): void {
    this.questChip.classList.remove('expanded');
    if (this.questCollapseTimer) clearTimeout(this.questCollapseTimer);
  }

  private bloomQuestChip(): void {
    const burst = el('div', { class: 'quest-bloom' });
    for (let i = 0; i < 6; i++) {
      const petal = signatureIcon('leaf', { color: 'var(--leaf)', size: '14px' });
      petal.style.setProperty('--i', String(i));
      burst.append(petal);
    }
    burst.addEventListener('animationend', () => burst.remove());
    this.questChip.append(burst);
    this.questChip.classList.add('sliding');
    window.setTimeout(() => {
      this.refreshQuestChip();
      this.questChip.classList.remove('sliding');
    }, 240);
  }

  // --- 3. Menu leaf + radial ----------------------------------------------
  private buildMenuLeaf(): void {
    this.leafBtn = el('button', { class: 'menu-leaf', 'aria-label': 'menu' }, [
      signatureIcon('leaf', { color: 'var(--leaf)', size: '30px' }),
    ]);
    this.radial = el('div', { class: 'radial' }, [
      this.radialItem('Build', signatureIcon('hammer', { size: '24px' }), () => {
        this.closeRadial();
        this.cb.openBuild();
      }),
      this.radialItem('ZooPedia', packIcon('Medal', { size: '24px' }), () => {
        this.closeRadial();
        this.cb.openZooPedia();
      }),
      this.radialItem('Settings', packIcon('Settings', { size: '24px' }), () => {
        this.closeRadial();
        this.cb.openSettings();
      }),
    ]);
    this.leafBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.radialOpen ? this.closeRadial() : this.openRadial();
    });
    const wrap = el('div', { class: 'menu-leaf-wrap' }, [this.radial, this.leafBtn]);
    this.layer.append(wrap);
    window.addEventListener('pointerdown', (e) => {
      if (this.radialOpen && !wrap.contains(e.target as Node)) this.closeRadial();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.radialOpen) this.closeRadial();
    });
  }

  private radialItem(label: string, icon: HTMLElement, onClick: () => void): HTMLElement {
    const btn = el('button', { class: 'radial-item', 'aria-label': label, title: label }, [icon]);
    btn.addEventListener('pointerenter', () => this.ctx.sfx.play('hover', 0.4));
    btn.addEventListener('click', () => {
      this.ctx.sfx.play('confirm', 0.6);
      onClick();
    });
    return btn;
  }

  private openRadial(): void {
    this.radialOpen = true;
    this.leafBtn.classList.add('open');
    this.radial.classList.add('open');
    this.ctx.sfx.play('menuOpen', 0.7);
  }

  private closeRadial(): void {
    if (!this.radialOpen) return;
    this.radialOpen = false;
    this.leafBtn.classList.remove('open');
    this.radial.classList.remove('open');
    this.ctx.sfx.play('menuClose', 0.6);
  }

  // --- 4. Action button + joystick (touch) / key hint (desktop) ------------
  private buildActionAndKeyHint(): void {
    // Action button + joystick are created lazily on first touch.
    this.actionIconWrap = el('div', { class: 'action-icon' });
    this.actionBtn = el('button', { class: 'action-btn hidden', 'aria-label': 'action' }, [
      this.actionIconWrap,
    ]);
    // Desktop key hint keycap.
    this.keyHint = el('div', { class: 'key-hint hidden' }, [
      el('span', { class: 'keycap', text: 'E' }),
      el('span', { class: 'key-hint-icon' }),
    ]);
    this.layer.append(this.keyHint);
  }

  private buildTouchControls(): void {
    if (this.touchInputBuilt) return;
    this.touchInputBuilt = true;
    document.body.classList.add('touch-mode');
    this.keyHint.classList.add('hidden');

    // Action button
    this.layer.append(this.actionBtn);
    const press = (e: Event) => {
      e.preventDefault();
      if (this.actionBtn.classList.contains('hidden') || this.actionBtn.classList.contains('dimmed')) return;
      this.actionBtn.classList.add('pressed');
      this.ctx.bus.emit('ui:actionPressed', {});
    };
    const release = () => {
      if (!this.actionBtn.classList.contains('pressed')) return;
      this.actionBtn.classList.remove('pressed');
      this.ctx.bus.emit('ui:actionReleased', {});
    };
    this.actionBtn.addEventListener('touchstart', press, { passive: false });
    this.actionBtn.addEventListener('touchend', release);
    this.actionBtn.addEventListener('touchcancel', release);
    this.actionBtn.addEventListener('pointerdown', press);
    this.actionBtn.addEventListener('pointerup', release);
    this.actionBtn.addEventListener('pointerleave', release);

    // Virtual joystick
    this.joyThumb = el('div', { class: 'joy-thumb' });
    this.joyBase = el('div', { class: 'joy-base idle' }, [this.joyThumb]);
    const zone = el('div', { class: 'joy-zone' }, [this.joyBase]);
    this.layer.append(zone);
    this.wireJoystick(zone);
  }

  private restJoystick(): { x: number; y: number } {
    return { x: 92, y: window.innerHeight - 100 };
  }

  private wireJoystick(zone: HTMLElement): void {
    let touchId: number | null = null;
    let cx = 0;
    let cy = 0;
    const radius = 56;
    const rest = this.restJoystick();
    this.joyBase.style.left = `${rest.x}px`;
    this.joyBase.style.top = `${rest.y}px`;

    const start = (x: number, y: number) => {
      // Re-anchor the base under the finger for thumb-follow feel.
      cx = x;
      cy = y;
      this.joyBase.style.left = `${x}px`;
      this.joyBase.style.top = `${y}px`;
      this.joyBase.classList.remove('idle');
      this.joyBase.classList.add('active');
      move(x, y);
    };
    const move = (x: number, y: number) => {
      let dx = x - cx;
      let dy = y - cy;
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        dx = (dx / len) * radius;
        dy = (dy / len) * radius;
      }
      this.joyThumb.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joystick.x = clamp(dx / radius, -1, 1);
      // y = +1 when pushed up-screen (dy negative going up).
      this.joystick.y = clamp(-dy / radius, -1, 1);
      this.joystick.active = true;
    };
    const end = () => {
      touchId = null;
      this.joystick.x = 0;
      this.joystick.y = 0;
      this.joystick.active = false;
      this.joyThumb.style.transform = 'translate(0,0)';
      this.joyBase.classList.remove('active');
      this.joyBase.classList.add('idle');
      const r = this.restJoystick();
      this.joyBase.style.left = `${r.x}px`;
      this.joyBase.style.top = `${r.y}px`;
    };

    zone.addEventListener(
      'touchstart',
      (e) => {
        if (touchId !== null) return;
        const t = e.changedTouches[0];
        touchId = t.identifier;
        start(t.clientX, t.clientY);
        e.preventDefault();
      },
      { passive: false },
    );
    zone.addEventListener(
      'touchmove',
      (e) => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === touchId) {
            move(t.clientX, t.clientY);
            e.preventDefault();
          }
        }
      },
      { passive: false },
    );
    const onEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === touchId) end();
      }
    };
    zone.addEventListener('touchend', onEnd);
    zone.addEventListener('touchcancel', onEnd);
  }

  private pollAction = (): void => {
    const c = this.ctx.query.actionContext();
    if (c !== this.lastActionCtx) {
      this.onActionContextChanged(c);
      this.lastActionCtx = c;
    }
    requestAnimationFrame(this.pollAction);
  };

  private onActionContextChanged(c: ActionContext): void {
    if (this.touchInputBuilt) {
      // Touch: swap the action-button icon; hide/dim on 'none'.
      if (c === 'none') {
        this.actionBtn.classList.add('dimmed');
      } else {
        this.actionBtn.classList.remove('dimmed', 'hidden');
        this.actionIconWrap.replaceChildren(signatureIcon(ACTION_ICON[c], { size: '38px', color: 'var(--cream)' }));
        this.actionBtn.classList.add('pop');
        window.setTimeout(() => this.actionBtn.classList.remove('pop'), 220);
      }
    } else {
      // Desktop: show the E keycap once per NEW context, then never again.
      if (c === 'none') {
        this.keyHint.classList.add('hidden');
        return;
      }
      if (this.seenHintContexts[c]) {
        this.keyHint.classList.add('hidden');
        return;
      }
      this.seenHintContexts[c] = true;
      store.set(HINTS_KEY, this.seenHintContexts);
      const iconWrap = this.keyHint.querySelector('.key-hint-icon');
      if (iconWrap) iconWrap.replaceChildren(signatureIcon(ACTION_ICON[c], { size: '22px' }));
      this.keyHint.classList.remove('hidden');
      this.keyHint.classList.add('pop');
      window.setTimeout(() => this.keyHint.classList.add('hidden'), 3200);
    }
  }

  // --- events / layout -----------------------------------------------------
  private bindEvents(): void {
    const bus = this.ctx.bus;
    bus.on('coins:changed', (p) => {
      this.animateCoinsTo(p.coins);
      if (p.delta > 0) this.spawnCoinFly(Math.min(6, Math.ceil(p.delta / 5)));
    });
    bus.on('coins:insufficient', () => {
      this.coinCounter.classList.remove('shake');
      void this.coinCounter.offsetWidth; // reflow to restart animation
      this.coinCounter.classList.add('shake');
    });
    bus.on('quest:progress', () => this.refreshQuestChip());
    bus.on('quest:new', () => this.refreshQuestChip());
    bus.on('quest:completed', () => this.bloomQuestChip());
    bus.on('game:ready', () => {
      this.animateCoinsTo(this.ctx.query.coins());
      this.refreshQuestChip();
    });
  }

  private applyOrientation(): void {
    const aspect = window.innerWidth / window.innerHeight;
    document.body.classList.toggle('portrait-narrow', aspect < 0.6);
  }
}

/** Fill a quest template ("House {n} Deer" → "House 2 Deer"). */
function stripTemplate(text: string, target: number): string {
  return text.replace('{n}', String(target));
}
