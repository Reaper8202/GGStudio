import { describe, expect, it } from 'vitest';
import {
  buildStarterBlueprint,
  recordPhoneAddictKilled,
  recordWaveCleared,
  resetProfileForNewGame,
} from '../src/app/App.ts';
import { createEmptyBlueprint } from '../src/core/blueprint.ts';
import { getPartDef } from '../src/core/parts.ts';
import { canPlacePart, validateBlueprint } from '../src/core/placement.ts';
import {
  decodeProfile,
  defaultProfile,
  encodeProfile,
  STARTER_UNLOCKS,
} from '../src/core/profile.ts';

describe('starter blueprint', () => {
  it('includes a deck turret and remains valid', () => {
    const blueprint = buildStarterBlueprint();

    expect(blueprint.parts).toHaveLength(23);
    expect(blueprint.parts).toContainEqual(
      expect.objectContaining({
        defId: 'turret',
        pos: { x: 0, y: 2, z: 1 },
      }),
    );
    expect(validateBlueprint(blueprint, getPartDef).errors).toEqual([]);
    expect(
      blueprint.parts.every((part) =>
        STARTER_UNLOCKS.includes(
          part.defId as (typeof STARTER_UNLOCKS)[number],
        ),
      ),
    ).toBe(true);
  });

  it('allows both new palette parts to mount on the chassis', () => {
    const blueprint = {
      ...createEmptyBlueprint('palette-parts'),
      parts: [
        {
          id: 'p1',
          defId: 'chassis-core',
          pos: { x: 0, y: 1, z: 0 },
          orient: 0,
          config: {},
        },
      ],
    };

    expect(
      canPlacePart(
        blueprint,
        getPartDef,
        'armour-plate',
        { x: 1, y: 1, z: 0 },
        0,
      ).ok,
    ).toBe(true);
    expect(
      canPlacePart(
        blueprint,
        getPartDef,
        'cannon-heavy',
        { x: 0, y: 2, z: 0 },
        0,
      ).ok,
    ).toBe(true);
  });
});

describe('application profile progression', () => {
  it('unlocks the Mine Sweeper at wave 7 but not wave 6', () => {
    const beforeGate = defaultProfile();
    recordWaveCleared(beforeGate, 6);
    expect(beforeGate.unlockedDefIds).not.toContain('mine-sweeper');

    const atGate = defaultProfile();
    recordWaveCleared(atGate, 7);
    expect(atGate.unlockedDefIds).toContain('mine-sweeper');
  });

  it('keeps the highest cleared wave when an earlier wave is cleared later', () => {
    const profile = defaultProfile();
    recordWaveCleared(profile, 9);
    recordWaveCleared(profile, 4);

    expect(profile.highestWaveCleared).toBe(9);
  });

  it('increments Phone Addict kills and survives profile persistence', () => {
    const profile = defaultProfile();
    recordPhoneAddictKilled(profile);
    recordPhoneAddictKilled(profile);

    expect(decodeProfile(encodeProfile(profile)).phoneAddictsKilled).toBe(2);
  });

  it('clears both progression fields for a New Game profile reset', () => {
    const profile = defaultProfile();
    profile.money = 999;
    profile.unlockedDefIds.push('mine-sweeper');
    profile.highestWaveCleared = 12;
    profile.phoneAddictsKilled = 3;

    resetProfileForNewGame(profile);

    expect(profile).toEqual(defaultProfile());
  });
});
