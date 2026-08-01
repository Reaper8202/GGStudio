import { describe, expect, it, vi } from 'vitest';
import {
  App,
  buildStarterBlueprint,
  recordPhoneAddictKilled,
  recordWaveCleared,
  resetProfileForNewGame,
  type RunCheckpoint,
} from '../src/app/App.ts';
import { createEmptyBlueprint } from '../src/core/blueprint.ts';
import {
  BUILDS,
  BUILD_IDS,
  buildStarterUnlocks,
} from '../src/core/builds.ts';
import { partRepairCost, repairPlan } from '../src/core/economy.ts';
import { getPartDef } from '../src/core/parts.ts';
import { canPlacePart, validateBlueprint } from '../src/core/placement.ts';
import {
  decodeProfile,
  defaultProfile,
  encodeProfile,
  STARTER_UNLOCKS,
} from '../src/core/profile.ts';
import type { PlacedPart, VehicleBlueprint } from '../src/core/types.ts';
import { getEffectiveDef } from '../src/core/upgrades.ts';

interface RepairDebugSeam {
  repairPart(partId: string): boolean;
  repairAll(): boolean;
}

function appWithDamagedCheckpoint(
  parts: PlacedPart[],
  partHp: Record<string, number>,
  money: number,
): {
  checkpoint: RunCheckpoint;
  profile: ReturnType<typeof defaultProfile>;
  refreshProfile: ReturnType<typeof vi.fn>;
  seam: RepairDebugSeam;
} {
  const blueprint: VehicleBlueprint = {
    ...createEmptyBlueprint('repair-test'),
    parts,
  };
  const checkpoint: RunCheckpoint = {
    wave: 2,
    blueprint,
    partHp: { ...partHp },
    missingParts: [],
    kills: 0,
    biomeId: 'graveyard',
    seed: 1234,
    score: 0,
    bankedEarnings: 0,
    elapsedSeconds: 0,
  };
  const profile = defaultProfile();
  profile.money = money;
  const refreshProfile = vi.fn();
  const app = Object.create(App.prototype) as App;
  Object.assign(app, {
    activeRun: { wave: 1 },
    inBuildPhase: true,
    checkpoint,
    bp: blueprint,
    profile,
    editor: { blueprint: () => blueprint, refreshProfile },
    saveProfileOrThrow: () => undefined,
  });
  return {
    checkpoint,
    profile,
    refreshProfile,
    seam: app.debugSeam() as unknown as RepairDebugSeam,
  };
}

describe('starter blueprint', () => {
  it('ships every build with its signature block already fitted', () => {
    for (const buildId of BUILD_IDS) {
      const blueprint = buildStarterBlueprint(buildId);
      const signatures = blueprint.parts.filter(
        (part) => getPartDef(part.defId).signature !== undefined,
      );

      // Exactly one, and it is the one this build is defined by. A rig that
      // shipped with two, or with another build's block, would hand the player
      // a click attack they never chose.
      expect(signatures).toHaveLength(1);
      expect(signatures[0].defId).toBe(BUILDS[buildId].signatureDefId);
      expect(validateBlueprint(blueprint, getPartDef).errors).toEqual([]);
    }
  });

  it('leaves every replaceable block on a starting rig buyable', () => {
    for (const buildId of BUILD_IDS) {
      // The heavy rig ships on treads and reinforced frame, neither of which
      // is a starter unlock — so the build grants them. Anything on the rig
      // that is not the signature block has to be purchasable from wave one,
      // or losing it mid-run would leave a hole nothing can fill.
      const buyable = new Set([
        ...STARTER_UNLOCKS,
        ...buildStarterUnlocks(buildId),
      ]);
      for (const part of buildStarterBlueprint(buildId).parts) {
        if (getPartDef(part.defId).buildSignature === true) continue;
        expect([...buyable]).toContain(part.defId);
      }
    }
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

describe('application repair transactions', () => {
  it('deducts the exact repair cost and restores the checkpoint part to full HP', () => {
    const turret: PlacedPart = {
      id: 'turret',
      defId: 'turret',
      pos: { x: 0, y: 0, z: 0 },
      orient: 0,
      config: {},
    };
    const maxHp = getEffectiveDef(turret).health;
    const currentHp = maxHp / 2;
    const expectedCost = partRepairCost(
      getPartDef(turret.defId).cost,
      currentHp,
      maxHp,
    );
    const app = appWithDamagedCheckpoint(
      [turret],
      { [turret.id]: currentHp },
      expectedCost + 10,
    );

    expect(app.seam.repairPart(turret.id)).toBe(true);
    expect(app.profile.money).toBe(10);
    expect(app.checkpoint.partHp[turret.id]).toBe(maxHp);
    expect(app.refreshProfile).toHaveBeenCalledOnce();
  });

  it('keeps both money and HP unchanged when Repair All is unaffordable', () => {
    const parts: PlacedPart[] = [
      {
        id: 'turret',
        defId: 'turret',
        pos: { x: 0, y: 0, z: 0 },
        orient: 0,
        config: {},
      },
      {
        id: 'frame',
        defId: 'frame-box',
        pos: { x: 1, y: 0, z: 0 },
        orient: 0,
        config: {},
      },
    ];
    const repairInputs = parts.map((part) => {
      const maxHp = getEffectiveDef(part).health;
      return {
        id: part.id,
        baseCost: getPartDef(part.defId).cost,
        currentHp: maxHp / 2,
        maxHp,
      };
    });
    const totalCost = repairPlan(repairInputs).totalCost;
    const initialHp = Object.fromEntries(
      repairInputs.map((part) => [part.id, part.currentHp]),
    );
    const app = appWithDamagedCheckpoint(
      parts,
      initialHp,
      totalCost - 1,
    );

    expect(app.seam.repairAll()).toBe(false);
    expect(app.profile.money).toBe(totalCost - 1);
    expect(app.checkpoint.partHp).toEqual(initialHp);
    expect(app.refreshProfile).not.toHaveBeenCalled();
  });
});
