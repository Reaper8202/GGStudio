import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD_ID } from '../src/core/builds.ts';
import {
  DEFAULT_MONEY,
  MINE_SWEEPER_UNLOCK_WAVE,
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
      highestWaveCleared: 12,
      phoneAddictsKilled: 3,
    };

    expect(decodeProfile(encodeProfile(profile))).toEqual({
      ...profile,
      unlockedDefIds: [...STARTER_UNLOCKS, ...profile.unlockedDefIds],
      inventory: {},
      // Saves written before builds existed decode onto the default rig, which
      // is also the one they were already playing.
      buildId: DEFAULT_BUILD_ID,
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

  it('decodes legacy profile JSON without progression fields', () => {
    const profile = decodeProfile(
      JSON.stringify({ schemaVersion: 1, money: 25, unlockedDefIds: [] }),
    );

    expect(profile).not.toHaveProperty('highestWaveCleared');
    expect(profile).not.toHaveProperty('phoneAddictsKilled');
  });

  it.each([-1, 1.5])(
    'drops an invalid highest wave value of %s without discarding the profile',
    (highestWaveCleared) => {
      const profile = decodeProfile(
        JSON.stringify({
          schemaVersion: 1,
          money: 25,
          unlockedDefIds: [],
          highestWaveCleared,
          phoneAddictsKilled: 2,
        }),
      );

      expect(profile).not.toHaveProperty('highestWaveCleared');
      expect(profile.phoneAddictsKilled).toBe(2);
      expect(profile.money).toBe(25);
    },
  );

  it('omits zero-valued progression when encoding', () => {
    const encoded = encodeProfile({
      schemaVersion: 1,
      money: 25,
      unlockedDefIds: [],
      highestWaveCleared: 0,
      phoneAddictsKilled: 0,
    });

    expect(JSON.parse(encoded)).not.toHaveProperty('highestWaveCleared');
    expect(JSON.parse(encoded)).not.toHaveProperty('phoneAddictsKilled');
    expect(MINE_SWEEPER_UNLOCK_WAVE).toBe(7);
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

  it('clamps negatives and rejects non-integer or unsafe balances', () => {
    expect(
      decodeProfile(
        JSON.stringify({ schemaVersion: 1, money: -35, unlockedDefIds: [] }),
      ).money,
    ).toBe(0);
    expect(
      decodeProfile(
        JSON.stringify({
          schemaVersion: 1,
          money: Number.NaN,
          unlockedDefIds: [],
        }),
      ).money,
    ).toBe(DEFAULT_MONEY);
    expect(
      decodeProfile(
        JSON.stringify({ schemaVersion: 1, money: 10.5, unlockedDefIds: [] }),
      ).money,
    ).toBe(DEFAULT_MONEY);
    expect(
      decodeProfile(
        JSON.stringify({
          schemaVersion: 1,
          money: Number.MAX_SAFE_INTEGER + 1,
          unlockedDefIds: [],
        }),
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
      inventory: {},
      buildId: DEFAULT_BUILD_ID,
    });
    expect(
      decodeProfile(
        JSON.stringify({ schemaVersion: 1, money: '25', unlockedDefIds: [] }),
      ),
    ).toEqual(defaultProfile());
  });
});
