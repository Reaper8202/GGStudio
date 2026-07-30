import { describe, expect, it } from 'vitest';
import {
  buildWaveTimeline,
  waveIcon,
  type TimelineNode,
  type WaveTimelineInput,
} from '../src/core/waveTimeline.ts';

function timeline(
  overrides: Partial<WaveTimelineInput> = {},
): ReturnType<typeof buildWaveTimeline> {
  return buildWaveTimeline({
    currentWave: 1,
    killedThisWave: 0,
    totalThisWave: 10,
    threatsForWave: () => [],
    ...overrides,
  });
}

describe('wave timeline window', () => {
  it.each([1, 2, 3, 50])(
    'keeps seven nodes around current wave %i',
    (currentWave) => {
      expect(timeline({ currentWave }).nodes).toHaveLength(7);
    },
  );

  it('shifts the wave 1 window forward without waves below 1', () => {
    const nodes = timeline({ currentWave: 1 }).nodes;

    expect(nodes.map((node) => node.wave)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(nodes.every((node) => node.wave >= 1)).toBe(true);
  });

  it('marks exactly the normalized current wave as current', () => {
    const result = timeline({ currentWave: 50 });
    const currentNodes = result.nodes.filter(
      (node) => node.state === 'current',
    );

    expect(currentNodes).toHaveLength(1);
    expect(currentNodes[0]?.wave).toBe(result.currentWave);
    expect(result.nodes.map((node) => node.state)).toEqual([
      'past',
      'past',
      'current',
      'future',
      'future',
      'future',
      'future',
    ]);
  });

  it('attaches injected threats and milestone markers to their waves', () => {
    const threatsByWave: Readonly<Record<number, readonly string[]>> = {
      2: ['thrower'],
      4: ['worker', 'phone-addict'],
    };
    const result = timeline({
      currentWave: 2,
      threatsForWave: (wave) => threatsByWave[wave] ?? [],
    });

    expect(
      result.nodes.map(({ wave, threats, isMilestone }) => ({
        wave,
        threats,
        isMilestone,
      })),
    ).toEqual([
      { wave: 1, threats: [], isMilestone: false },
      { wave: 2, threats: ['thrower'], isMilestone: true },
      { wave: 3, threats: [], isMilestone: false },
      {
        wave: 4,
        threats: ['worker', 'phone-addict'],
        isMilestone: true,
      },
      { wave: 5, threats: [], isMilestone: false },
      { wave: 6, threats: [], isMilestone: false },
      { wave: 7, threats: [], isMilestone: false },
    ]);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    -4,
  ])('normalizes invalid current wave %s to wave 1', (currentWave) => {
    const result = timeline({ currentWave });

    expect(result.currentWave).toBe(1);
    expect(result.nodes.map((node) => node.wave)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });
});

describe('wave timeline progress', () => {
  it('returns the current clear fraction', () => {
    expect(timeline({ killedThisWave: 3, totalThisWave: 12 }).progress).toBe(
      0.25,
    );
  });

  it('returns zero when the total is not positive', () => {
    expect(timeline({ killedThisWave: 3, totalThisWave: 0 }).progress).toBe(0);
    expect(timeline({ killedThisWave: 3, totalThisWave: -1 }).progress).toBe(0);
  });

  it('clamps progress above one and below zero', () => {
    expect(timeline({ killedThisWave: 12, totalThisWave: 10 }).progress).toBe(
      1,
    );
    expect(timeline({ killedThisWave: -2, totalThisWave: 10 }).progress).toBe(
      0,
    );
  });

  it('returns zero for non-finite progress inputs', () => {
    expect(
      timeline({
        killedThisWave: Number.NaN,
        totalThisWave: 10,
      }).progress,
    ).toBe(0);
    expect(
      timeline({
        killedThisWave: 5,
        totalThisWave: Number.POSITIVE_INFINITY,
      }).progress,
    ).toBe(0);
  });
});

describe('wave icon', () => {
  function node(overrides: Partial<TimelineNode> = {}): TimelineNode {
    return {
      wave: 6,
      state: 'future',
      threats: [],
      isMilestone: false,
      ...overrides,
    };
  }

  it('uses the boss icon for the Phone Addict introduction', () => {
    expect(
      waveIcon(
        node({
          wave: 10,
          threats: ['phone-addict'],
          isMilestone: true,
        }),
      ),
    ).toBe('boss');
  });

  it('uses the boss icon for the Behemoth introduction', () => {
    expect(
      waveIcon(
        node({
          wave: 8,
          threats: ['behemoth'],
          isMilestone: true,
        }),
      ),
    ).toBe('boss');
  });

  it('keeps other specialist introductions as new threats', () => {
    expect(waveIcon(node({ threats: ['worker'], isMilestone: true }))).toBe(
      'threat',
    );
  });

  it('uses the zombie icon for an ordinary wave', () => {
    expect(waveIcon(node())).toBe('zombie');
  });

  it.each(['past', 'current', 'future'] as const)(
    'keeps a wave identity once it is %s',
    (state) => {
      expect(waveIcon(node({ state, threats: ['phone-addict'] }))).toBe('boss');
      expect(waveIcon(node({ state }))).toBe('zombie');
    },
  );
});
