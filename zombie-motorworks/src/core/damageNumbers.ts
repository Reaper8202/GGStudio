import { makeRng, rngRange, type Rng } from './rng.ts';

export type DamageTier = 'low' | 'medium' | 'high';

export interface DamageNumber {
  readonly id: number;
  /** Which zombie this number belongs to; merging is keyed on it. */
  readonly targetKey: number;
  /** Running total, already merged. */
  amount: number;
  /** World anchor at spawn time (numbers do not chase the zombie). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Screen-space jitter in px, stable for this number's whole life. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Seconds since spawn. */
  age: number;
  /** Seconds since the most recent merge — drives the pop animation. */
  popAge: number;
  tier: DamageTier;
  /** True while a kill blow is included, for a stronger presentation. */
  killing: boolean;
}

export interface DamageNumberOptions {
  /** Merge window in seconds. Default 0.45. */
  mergeSeconds?: number;
  /** Total float lifetime in seconds. Default 1.1. */
  lifeSeconds?: number;
  /** Hard cap on simultaneous numbers. Default 24, oldest recycled first. */
  capacity?: number;
  /** Deterministic jitter seed. Default 1. */
  seed?: number;
}

export const DAMAGE_TIER_THRESHOLDS = {
  medium: 15,
  high: 45,
} as const;

const DEFAULT_MERGE_SECONDS = 0.45;
const DEFAULT_LIFE_SECONDS = 1.1;
const DEFAULT_CAPACITY = 24;
const DEFAULT_SEED = 1;
const JITTER_DISTANCE_PX = 11;

interface PooledDamageNumber {
  id: number;
  targetKey: number;
  amount: number;
  x: number;
  y: number;
  z: number;
  offsetX: number;
  offsetY: number;
  age: number;
  popAge: number;
  tier: DamageTier;
  killing: boolean;
}

/** Tier changes while a live number accumulates, so its presentation stays honest. */
export function damageTier(amount: number): DamageTier {
  if (amount >= DAMAGE_TIER_THRESHOLDS.high) return 'high';
  if (amount >= DAMAGE_TIER_THRESHOLDS.medium) return 'medium';
  return 'low';
}

/**
 * Pooled damage-number state. The short active list and free list only shuffle
 * objects created by the constructor, keeping hit processing allocation-free.
 */
export class DamageNumberModel {
  readonly capacity: number;
  readonly lifeSeconds: number;

  private readonly mergeSeconds: number;
  private readonly rng: Rng;
  private readonly activeNumbers: PooledDamageNumber[] = [];
  private readonly availableNumbers: PooledDamageNumber[] = [];
  private nextId = 1;

  constructor(options: DamageNumberOptions = {}) {
    this.mergeSeconds = positiveOrDefault(
      options.mergeSeconds,
      DEFAULT_MERGE_SECONDS,
    );
    this.lifeSeconds = positiveOrDefault(
      options.lifeSeconds,
      DEFAULT_LIFE_SECONDS,
    );
    this.capacity = capacityOrDefault(options.capacity);
    this.rng = makeRng(
      Number.isFinite(options.seed)
        ? (options.seed ?? DEFAULT_SEED)
        : DEFAULT_SEED,
    );

    for (let index = 0; index < this.capacity; index += 1) {
      this.availableNumbers.push({
        id: 0,
        targetKey: 0,
        amount: 0,
        x: 0,
        y: 0,
        z: 0,
        offsetX: 0,
        offsetY: 0,
        age: 0,
        popAge: 0,
        tier: 'low',
        killing: false,
      });
    }
  }

  /** Live numbers, oldest first. This is the backed active view, not a copy. */
  get active(): readonly DamageNumber[] {
    return this.activeNumbers;
  }

  /**
   * Merge repeat damage only while its previous pop is fresh. Once that window
   * closes the older number gets to finish its float while a new one begins.
   */
  add(
    targetKey: number,
    amount: number,
    x: number,
    y: number,
    z: number,
    killing = false,
  ): void {
    if (
      !Number.isFinite(targetKey) ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z)
    ) {
      return;
    }

    for (let index = this.activeNumbers.length - 1; index >= 0; index -= 1) {
      const number = this.activeNumbers[index];
      if (number.targetKey !== targetKey || number.popAge > this.mergeSeconds) {
        continue;
      }
      const mergedAmount = number.amount + amount;
      number.amount = Number.isFinite(mergedAmount)
        ? mergedAmount
        : Number.MAX_VALUE;
      number.popAge = 0;
      number.tier = damageTier(number.amount);
      number.killing ||= killing === true;
      return;
    }

    const number = this.takeNumber();
    number.id = this.nextId;
    this.nextId += 1;
    number.targetKey = targetKey;
    number.amount = amount;
    number.x = x;
    number.y = y;
    number.z = z;
    number.offsetX = rngRange(
      this.rng,
      -JITTER_DISTANCE_PX,
      JITTER_DISTANCE_PX,
    );
    number.offsetY = rngRange(
      this.rng,
      -JITTER_DISTANCE_PX,
      JITTER_DISTANCE_PX,
    );
    number.age = 0;
    number.popAge = 0;
    number.tier = damageTier(amount);
    number.killing = killing === true;
    this.activeNumbers.push(number);
  }

  /** Age live entries and return expired ones to the constructor-created pool. */
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    let writeIndex = 0;
    for (
      let readIndex = 0;
      readIndex < this.activeNumbers.length;
      readIndex += 1
    ) {
      const number = this.activeNumbers[readIndex];
      number.age += dt;
      number.popAge += dt;
      if (number.age >= this.lifeSeconds) {
        this.availableNumbers.push(number);
        continue;
      }
      this.activeNumbers[writeIndex] = number;
      writeIndex += 1;
    }
    this.activeNumbers.length = writeIndex;
  }

  clear(): void {
    while (this.activeNumbers.length > 0) {
      const number = this.activeNumbers.pop();
      if (number) this.availableNumbers.push(number);
    }
  }

  /** Reuse the oldest live entry at capacity, matching the visual priority. */
  private takeNumber(): PooledDamageNumber {
    const available = this.availableNumbers.pop();
    if (available) return available;
    return this.activeNumbers.shift()!;
  }
}

function positiveOrDefault(
  value: number | undefined,
  fallback: number,
): number {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? value
    : fallback;
}

function capacityOrDefault(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0)
    return DEFAULT_CAPACITY;
  return Math.max(1, Math.floor(value));
}
