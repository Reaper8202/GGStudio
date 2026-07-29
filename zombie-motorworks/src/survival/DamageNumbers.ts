import * as THREE from 'three';
import {
  DamageNumberModel,
  type DamageNumberOptions,
} from '../core/damageNumbers.ts';
import './DamageNumbers.css';

const FLOAT_DISTANCE_PX = 38;
const POP_SECONDS = 0.14;
const FADE_START = 0.68;

/**
 * Decorative DOM projection for pooled damage reports. World anchors stay fixed
 * at hit time so a number remains understandable even after its zombie dies.
 */
export class DamageNumbersOverlay {
  private readonly model: DamageNumberModel;
  private readonly root: HTMLDivElement;
  private readonly elements: HTMLDivElement[] = [];
  private readonly displayedIds: number[];
  private readonly displayedAmounts: number[];
  private readonly displayedTiers: number[];
  private readonly displayedKills: Uint8Array;
  private readonly hidden: Uint8Array;
  private readonly displayedOpacity: number[];
  private readonly scratch = new THREE.Vector3();
  private readonly onResize = (): void => this.cacheViewport();
  private readonly reducedMotionQuery: MediaQueryList;
  private readonly onReducedMotionChange = (
    event: MediaQueryListEvent,
  ): void => {
    this.reducedMotion = event.matches;
  };
  private readonly lifeSeconds: number;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private reducedMotion = false;
  private disposed = false;

  constructor(parent: HTMLElement, options: DamageNumberOptions = {}) {
    this.model = new DamageNumberModel(options);
    this.lifeSeconds = this.model.lifeSeconds;
    this.root = document.createElement('div');
    this.root.className = 'damage-numbers';
    this.root.setAttribute('aria-hidden', 'true');

    this.displayedIds = new Array(this.model.capacity).fill(0);
    this.displayedAmounts = new Array(this.model.capacity).fill(0);
    this.displayedTiers = new Array(this.model.capacity).fill(-1);
    this.displayedKills = new Uint8Array(this.model.capacity);
    this.hidden = new Uint8Array(this.model.capacity);
    this.hidden.fill(1);
    this.displayedOpacity = new Array(this.model.capacity).fill(-1);

    for (let index = 0; index < this.model.capacity; index += 1) {
      const element = document.createElement('div');
      element.className = 'damage-numbers__number damage-numbers__number--low';
      element.style.display = 'none';
      this.elements.push(element);
      this.root.appendChild(element);
    }

    parent.appendChild(this.root);
    this.cacheViewport();
    window.addEventListener('resize', this.onResize);
    this.reducedMotionQuery = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    );
    this.reducedMotion = this.reducedMotionQuery.matches;
    this.reducedMotionQuery.addEventListener(
      'change',
      this.onReducedMotionChange,
    );
  }

  /** Accept reports after physics, while safely ignoring a mode already torn down. */
  add(
    targetKey: number,
    amount: number,
    x: number,
    y: number,
    z: number,
    killing = false,
  ): void {
    if (this.disposed) return;
    this.model.add(targetKey, amount, x, y, z, killing);
  }

  /** Project pooled anchors only after the camera has reached its render position. */
  update(dt: number, camera: THREE.Camera): void {
    if (this.disposed) return;
    this.model.update(dt);
    camera.updateMatrixWorld();

    const active = this.model.active;
    for (let index = 0; index < active.length; index += 1) {
      const number = active[index]!;
      const element = this.elements[index]!;
      this.scratch.set(number.x, number.y, number.z).project(camera);
      if (!this.isOnScreen()) {
        this.hide(index);
        continue;
      }

      this.show(index, element);
      this.syncContent(index, element, number);
      this.syncPosition(index, element, number);
    }
    for (let index = active.length; index < this.elements.length; index += 1) {
      this.hide(index);
    }
  }

  clear(): void {
    if (this.disposed) return;
    this.model.clear();
    for (let index = 0; index < this.elements.length; index += 1) {
      this.displayedIds[index] = 0;
      this.displayedOpacity[index] = -1;
      this.hide(index);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.reducedMotionQuery.removeEventListener(
      'change',
      this.onReducedMotionChange,
    );
    this.model.clear();
    this.root.remove();
  }

  private cacheViewport(): void {
    this.viewportWidth = window.innerWidth;
    this.viewportHeight = window.innerHeight;
  }

  private isOnScreen(): boolean {
    return (
      this.scratch.z >= -1 &&
      this.scratch.z <= 1 &&
      this.scratch.x >= -1 &&
      this.scratch.x <= 1 &&
      this.scratch.y >= -1 &&
      this.scratch.y <= 1
    );
  }

  private show(index: number, element: HTMLDivElement): void {
    if (this.hidden[index] === 0) return;
    this.hidden[index] = 0;
    element.style.display = 'block';
  }

  private hide(index: number): void {
    if (this.hidden[index] === 1) return;
    this.hidden[index] = 1;
    this.elements[index]!.style.display = 'none';
  }

  private syncContent(
    index: number,
    element: HTMLDivElement,
    number: (typeof this.model.active)[number],
  ): void {
    const amount = Math.max(1, Math.round(number.amount));
    const tier = tierCode(number.tier);
    const killing = number.killing ? 1 : 0;
    if (
      this.displayedIds[index] !== number.id ||
      this.displayedAmounts[index] !== amount
    ) {
      this.displayedIds[index] = number.id;
      this.displayedAmounts[index] = amount;
      element.textContent = String(amount);
    }
    if (
      this.displayedTiers[index] !== tier ||
      this.displayedKills[index] !== killing
    ) {
      this.displayedTiers[index] = tier;
      this.displayedKills[index] = killing;
      element.className = `damage-numbers__number damage-numbers__number--${number.tier}${
        number.killing ? ' damage-numbers__number--killing' : ''
      }`;
    }
  }

  private syncPosition(
    index: number,
    element: HTMLDivElement,
    number: (typeof this.model.active)[number],
  ): void {
    const progress = Math.min(1, number.age / this.lifeSeconds);
    const fade =
      progress <= FADE_START
        ? 1
        : Math.max(0, (1 - progress) / (1 - FADE_START));
    const opacity = Math.round(fade * 100) / 100;
    if (this.displayedOpacity[index] !== opacity) {
      this.displayedOpacity[index] = opacity;
      element.style.opacity = String(opacity);
    }

    const x =
      (this.scratch.x * 0.5 + 0.5) * this.viewportWidth + number.offsetX;
    const y =
      (-this.scratch.y * 0.5 + 0.5) * this.viewportHeight +
      number.offsetY -
      (this.reducedMotion ? 0 : progress * FLOAT_DISTANCE_PX);
    const pop = this.reducedMotion
      ? 0
      : Math.max(0, 1 - number.popAge / POP_SECONDS) *
        (number.killing ? 0.34 : 0.22);
    element.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(
      y,
    )}px, 0) translate(-50%, -50%) scale(${(1 + pop).toFixed(2)})`;
  }
}

function tierCode(tier: 'low' | 'medium' | 'high'): number {
  if (tier === 'medium') return 1;
  if (tier === 'high') return 2;
  return 0;
}
