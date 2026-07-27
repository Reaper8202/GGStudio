import { describe, expect, it } from 'vitest';
import {
  resetProfileForNewGame,
  resetProfileForNewRun,
} from '../src/app/App.ts';
import { DEFAULT_MONEY, defaultProfile } from '../src/core/profile.ts';
import type { PlayerProfile } from '../src/core/profile.ts';

function progressedProfile(): PlayerProfile {
  return {
    schemaVersion: 1,
    money: 4_820,
    unlockedDefIds: [
      'chassis-core',
      'frame-box',
      'wheel-standard',
      'engine-small',
      'fuel-tank',
      'turret',
      'mine-sweeper',
      'heavy-cannon',
    ],
    inventory: { 'heavy-cannon': 2, 'armour-plate': 5 },
    currentBlueprintName: 'Death Machine',
    highestWaveCleared: 12,
    phoneAddictsKilled: 37,
  };
}

describe('reset after a finished run', () => {
  it('takes back the money, inventory, and vehicle', () => {
    const profile = progressedProfile();

    resetProfileForNewRun(profile);

    expect(profile.money).toBe(DEFAULT_MONEY);
    expect(profile.inventory).toEqual(defaultProfile().inventory);
    expect(profile.currentBlueprintName).toBeUndefined();
  });

  it('keeps unlocked parts and lifetime progression', () => {
    const profile = progressedProfile();
    const unlocksBefore = [...profile.unlockedDefIds];

    resetProfileForNewRun(profile);

    expect(profile.unlockedDefIds).toEqual(unlocksBefore);
    expect(profile.unlockedDefIds).toContain('mine-sweeper');
    expect(profile.highestWaveCleared).toBe(12);
    expect(profile.phoneAddictsKilled).toBe(37);
  });

  it('leaves the profile schema valid for persistence', () => {
    const profile = progressedProfile();

    resetProfileForNewRun(profile);

    expect(profile.schemaVersion).toBe(1);
    expect(Number.isSafeInteger(profile.money)).toBe(true);
  });

  it('is weaker than a brand-new game, which drops progression too', () => {
    const afterRun = progressedProfile();
    const afterNewGame = progressedProfile();

    resetProfileForNewRun(afterRun);
    resetProfileForNewGame(afterNewGame);

    // Both hand back the same starting money and parts...
    expect(afterNewGame.money).toBe(afterRun.money);
    expect(afterNewGame.inventory).toEqual(afterRun.inventory);
    // ...but only a new game forgets what the player unlocked.
    expect(afterNewGame.unlockedDefIds).not.toContain('mine-sweeper');
    expect(afterRun.unlockedDefIds).toContain('mine-sweeper');
    expect(afterNewGame.highestWaveCleared).toBeUndefined();
    expect(afterRun.highestWaveCleared).toBe(12);
  });
});
