/** Deterministic uniform generator over [0, 1). */
export type Rng = () => number;

const UINT32_RANGE = 0x100000000;

function hashSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new Error('makeRng requires a finite seed.');
  }

  const text = Object.is(seed, -0) ? '-0' : String(seed);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** Creates a mulberry32 generator whose sequence is fixed by the finite seed. */
export function makeRng(seed: number): Rng {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

/** Creates a fresh non-deterministic unsigned seed for a new run. */
export function randomSeed(): number {
  return (Math.random() * UINT32_RANGE) >>> 0;
}

/** Draws a uniform value from the half-open interval [min, max). */
export function rngRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Draws an integer from [minInclusive, maxExclusive). */
export function rngInt(
  rng: Rng,
  minInclusive: number,
  maxExclusive: number,
): number {
  if (
    !Number.isInteger(minInclusive) ||
    !Number.isInteger(maxExclusive) ||
    minInclusive >= maxExclusive
  ) {
    throw new Error(
      'rngInt requires integer bounds with minInclusive < maxExclusive.',
    );
  }
  return minInclusive + Math.floor(rng() * (maxExclusive - minInclusive));
}

/** Picks one item uniformly from a non-empty array. */
export function rngPick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('rngPick requires at least one item.');
  }
  return items[rngInt(rng, 0, items.length)]!;
}

/** Picks one item according to its positive relative weight. */
export function rngWeighted<T>(
  rng: Rng,
  entries: readonly { item: T; weight: number }[],
): T {
  const positiveEntries = entries.filter(({ weight }) => weight > 0);
  if (positiveEntries.length === 0) {
    throw new Error('rngWeighted requires at least one positive weight.');
  }

  const infiniteEntries = positiveEntries.filter(
    ({ weight }) => weight === Number.POSITIVE_INFINITY,
  );
  if (infiniteEntries.length > 0) {
    return rngPick(rng, infiniteEntries).item;
  }

  const maxWeight = Math.max(
    ...positiveEntries.map(({ weight }) => weight),
  );
  const totalWeight = positiveEntries.reduce(
    (sum, { weight }) => sum + weight / maxWeight,
    0,
  );
  let target = rng() * totalWeight;

  for (const entry of positiveEntries) {
    target -= entry.weight / maxWeight;
    if (target < 0) return entry.item;
  }

  return positiveEntries[positiveEntries.length - 1]!.item;
}

/** Returns a deterministically Fisher-Yates-shuffled copy of the input. */
export function rngShuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = rngInt(rng, 0, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}
