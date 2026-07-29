import { describe, expect, it } from 'vitest';
import {
  makeRng,
  rngInt,
  rngPick,
  rngShuffle,
  rngWeighted,
} from '../src/core/rng.ts';

function draws(seed: number, count: number): number[] {
  const rng = makeRng(seed);
  return Array.from({ length: count }, () => rng());
}

describe('makeRng', () => {
  it('repeats 100 draws for the same seed and differs for another seed', () => {
    expect(draws(42, 100)).toEqual(draws(42, 100));
    expect(draws(42, 100)).not.toEqual(draws(43, 100));
  });

  it('stays within [0, 1) over 10,000 draws', () => {
    for (const value of draws(7, 10_000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('keeps negative and fractional seeds stable and distinct', () => {
    const seeds = [-12.75, -12.25, 12.75];
    const sequences = seeds.map((seed) => draws(seed, 32));

    for (let i = 0; i < seeds.length; i += 1) {
      expect(sequences[i]).toEqual(draws(seeds[i]!, 32));
    }
    expect(new Set(sequences.map((sequence) => sequence.join(','))).size).toBe(
      seeds.length,
    );
  });
});

describe('rngInt', () => {
  it('covers the full range without returning the exclusive upper bound', () => {
    const rng = makeRng(101);
    const seen = new Set<number>();

    for (let i = 0; i < 10_000; i += 1) {
      const value = rngInt(rng, -3, 4);
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThan(4);
      seen.add(value);
    }

    expect([...seen].sort((a, b) => a - b)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
  });
});

describe('rngWeighted', () => {
  it('respects relative weights with a fixed seed', () => {
    const rng = makeRng(2024);
    let common = 0;

    for (let i = 0; i < 2_000; i += 1) {
      if (
        rngWeighted(rng, [
          { item: 'common', weight: 9 },
          { item: 'rare', weight: 1 },
        ]) === 'common'
      ) {
        common += 1;
      }
    }

    expect(common / 2_000).toBeGreaterThanOrEqual(0.8);
  });

  it('ignores non-positive weights', () => {
    const rng = makeRng(5);
    for (let i = 0; i < 100; i += 1) {
      expect(
        rngWeighted(rng, [
          { item: 'zero', weight: 0 },
          { item: 'negative', weight: -1 },
          { item: 'positive', weight: 1 },
        ]),
      ).toBe('positive');
    }
  });

  it('throws on an all-zero list', () => {
    expect(() =>
      rngWeighted(makeRng(1), [
        { item: 'first', weight: 0 },
        { item: 'second', weight: 0 },
      ]),
    ).toThrow('at least one positive weight');
  });
});

describe('rngPick', () => {
  it('throws on an empty array', () => {
    expect(() => rngPick(makeRng(1), [])).toThrow('at least one item');
  });
});

describe('rngShuffle', () => {
  it('returns a deterministic permutation without mutating the input', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const original = [...input];
    const first = rngShuffle(makeRng(88), input);
    const second = rngShuffle(makeRng(88), input);

    expect(input).toEqual(original);
    expect(first).toEqual(second);
    expect([...first].sort((a, b) => a - b)).toEqual(original);
  });
});
