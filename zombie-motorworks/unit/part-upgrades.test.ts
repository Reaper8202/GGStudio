import { describe, expect, it } from 'vitest';
import { PART_CATALOG, getPartDef } from '../src/core/parts.ts';
import {
  MAX_PART_LEVEL,
  MAX_UPGRADE_STEPS,
  upgradeStars,
  upgradeStepFor,
  upgradeStepsFor,
  upgradeTrackFor,
} from '../src/core/partUpgrades.ts';
import { upgradePrice } from '../src/core/upgrades.ts';

describe('named part upgrades', () => {
  it('gives every upgradeable part the same five-unlock chain', () => {
    const upgradeable = Object.values(PART_CATALOG).filter(
      (def) => def.upgrade !== undefined,
    );
    expect(upgradeable.length).toBeGreaterThan(0);
    for (const def of upgradeable) {
      expect(def.upgrade?.maxLevel).toBe(MAX_PART_LEVEL);
      const steps = upgradeStepsFor(def);
      expect(steps).toHaveLength(MAX_UPGRADE_STEPS);
      expect(steps.map((step) => step.level)).toEqual([2, 3, 4, 5, 6]);
      for (const step of steps) {
        expect(step.icon).not.toBe('');
        expect(step.name).not.toBe('');
        expect(step.blurb).not.toBe('');
        // Every link is priced, so the panel can show the whole chain's cost.
        expect(upgradePrice(def, step.level)).toBeGreaterThan(0);
      }
    }
  });

  it('routes a part to the chain matching the hardware it carries', () => {
    // Guns and melee heads split by model: a sniper and a flamethrower share
    // nothing worth bolting on, so they do not share a chain either.
    expect(upgradeTrackFor(getPartDef('turret'))).toBe('weapon-auto');
    expect(upgradeTrackFor(getPartDef('cannon-heavy'))).toBe('weapon-cannon');
    expect(upgradeTrackFor(getPartDef('sniper-light'))).toBe('weapon-sniper');
    expect(upgradeTrackFor(getPartDef('ice-cannon'))).toBe('weapon-ice');
    expect(upgradeTrackFor(getPartDef('flamethrower'))).toBe('weapon-flame');
    expect(upgradeTrackFor(getPartDef('sawblade'))).toBe('melee-blade');
    expect(upgradeTrackFor(getPartDef('spike-ram'))).toBe('melee-spikes');
    expect(upgradeTrackFor(getPartDef('barrel-drum'))).toBe('melee-drum');
    expect(upgradeTrackFor(getPartDef('wheel-standard'))).toBe('wheel');
    expect(upgradeTrackFor(getPartDef('engine-small'))).toBe('engine');
    expect(upgradeTrackFor(getPartDef('armour-plate'))).toBe('armour');
    expect(upgradeTrackFor(getPartDef('shield-generator'))).toBe('ability');
    expect(upgradeTrackFor(getPartDef('fuel-tank'))).toBe('tank');
    expect(upgradeTrackFor(getPartDef('frame-box'))).toBe('frame');
  });

  it('names the unlock a level grants and nothing for the base level', () => {
    const turret = getPartDef('turret');
    expect(upgradeStepFor(turret, 1)).toBeUndefined();
    expect(upgradeStepFor(turret, 2)?.name).toBe('Long Barrels');
    expect(upgradeStepFor(turret, MAX_PART_LEVEL)?.name).toBe('Recoil Rig');
    expect(upgradeStepFor(turret, MAX_PART_LEVEL + 1)).toBeUndefined();
  });

  it('counts one star per unlock bought and clamps at both ends', () => {
    expect(upgradeStars(1)).toBe(0);
    expect(upgradeStars(3)).toBe(2);
    expect(upgradeStars(MAX_PART_LEVEL)).toBe(MAX_UPGRADE_STEPS);
    expect(upgradeStars(0)).toBe(0);
    expect(upgradeStars(99)).toBe(MAX_UPGRADE_STEPS);
  });
});
