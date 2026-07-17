import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MONEY,
  decodeProfile,
  defaultProfile,
  encodeProfile,
  STARTER_UNLOCKS,
} from '../src/core/profile.ts';

describe('player profile codec', () => {
  it('round-trips supported profile fields', () => {
    const profile = {
      schemaVersion: 1 as const,
      money: 475,
      unlockedDefIds: ['frame-reinforced', 'wheel-offroad'],
      currentBlueprintName: 'Rammer',
    };

    expect(decodeProfile(encodeProfile(profile))).toEqual({
      ...profile,
      unlockedDefIds: [...STARTER_UNLOCKS, ...profile.unlockedDefIds],
    });
  });

  it('uses the default profile for corrupt JSON or an invalid schema', () => {
    expect(decodeProfile('{not json')).toEqual(defaultProfile());
    expect(
      decodeProfile(
        JSON.stringify({ schemaVersion: 2, money: 10, unlockedDefIds: [] }),
      ),
    ).toEqual(defaultProfile());
  });

  it('filters unknown definitions while retaining every starter unlock', () => {
    const profile = decodeProfile(
      JSON.stringify({
        schemaVersion: 1,
        money: 10,
        unlockedDefIds: ['frame-reinforced', 'not-a-part', 'frame-reinforced'],
      }),
    );

    expect(profile.unlockedDefIds).toEqual([
      ...STARTER_UNLOCKS,
      'frame-reinforced',
    ]);
  });

  it('clamps negative and non-finite money to a safe profile value', () => {
    expect(
      decodeProfile(
        JSON.stringify({ schemaVersion: 1, money: -35, unlockedDefIds: [] }),
      ).money,
    ).toBe(0);
    expect(
      decodeProfile(
        JSON.stringify({ schemaVersion: 1, money: Number.NaN, unlockedDefIds: [] }),
      ).money,
    ).toBe(DEFAULT_MONEY);
  });

  it('ignores extra fields without accepting invalid typed fields', () => {
    expect(
      decodeProfile(
        JSON.stringify({
          schemaVersion: 1,
          money: 25,
          unlockedDefIds: [],
          ignored: 'value',
        }),
      ),
    ).toEqual({
      schemaVersion: 1,
      money: 25,
      unlockedDefIds: [...STARTER_UNLOCKS],
    });
    expect(
      decodeProfile(
        JSON.stringify({ schemaVersion: 1, money: '25', unlockedDefIds: [] }),
      ),
    ).toEqual(defaultProfile());
  });
});
