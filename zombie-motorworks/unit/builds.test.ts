/**
 * Guards on the Build system: the three starting rigs, the signature blocks
 * they carry, and the click-strike scaling those blocks upgrade along.
 *
 * Deliberately thin. How a strike *feels* — whether the nuke's fall time reads
 * as fair, whether the lightning's cadence is fun — is verified by playing it;
 * what is asserted here is only the structural stuff that would break quietly:
 * a rig that stops validating, a block that becomes purchasable, an upgrade
 * curve that stops moving.
 */

import { describe, expect, it } from 'vitest';
import {
  BUILDS,
  BUILD_IDS,
  DEFAULT_BUILD_ID,
  buildStarterRig,
  buildStarterUnlocks,
  getBuild,
  isBuildId,
  isSignatureDefId,
} from '../src/core/builds.ts';
import { PART_CATALOG, getPartDef } from '../src/core/parts.ts';
import { validateBlueprint } from '../src/core/placement.ts';
import { SIMPLE_PART_IDS } from '../src/core/tutorial.ts';
import { STARTER_UNLOCKS } from '../src/core/profile.ts';
import { effectiveSignature } from '../src/core/signatures.ts';
import { clampStrikePoint } from '../src/survival/SignatureStrikes.ts';

describe('build catalog', () => {
  it('gives every build a distinct, real signature block', () => {
    const seen = new Set<string>();
    for (const buildId of BUILD_IDS) {
      const defId = BUILDS[buildId].signatureDefId;
      expect(PART_CATALOG[defId]?.signature).toBeDefined();
      expect(seen.has(defId)).toBe(false);
      seen.add(defId);
    }
  });

  it('falls back to the default build for anything unrecognised', () => {
    expect(isBuildId('heavy')).toBe(true);
    expect(isBuildId('hovercraft')).toBe(false);
    // Persisted profiles and URLs are the untrusted inputs here, so an unknown
    // value has to resolve to a playable rig rather than throw on boot.
    expect(getBuild(undefined).id).toBe(DEFAULT_BUILD_ID);
    expect(getBuild('hovercraft').id).toBe(DEFAULT_BUILD_ID);
  });

  it('keeps every signature block off the store shelf', () => {
    for (const buildId of BUILD_IDS) {
      const defId = BUILDS[buildId].signatureDefId;
      const def = getPartDef(defId);
      expect(isSignatureDefId(defId)).toBe(true);
      expect(def.buildSignature).toBe(true);
      // Never listed, and marked unsellable, so there is no route by which a
      // player can end a wave without the build they chose.
      expect(SIMPLE_PART_IDS).not.toContain(defId);
      expect(def.unlockCost).toBeUndefined();
    }
  });

  it('builds a valid, upgradeable rig for every build', () => {
    for (const buildId of BUILD_IDS) {
      const rig = buildStarterRig(buildId);
      expect(validateBlueprint(rig, getPartDef).errors).toEqual([]);
      // The signature block is the one upgrade path guaranteed from wave one,
      // so it has to actually have a chain to spend money on.
      const signature = rig.parts.find(
        (part) => getPartDef(part.defId).signature !== undefined,
      );
      expect(getPartDef(signature?.defId ?? '').upgrade).toBeDefined();
    }
  });

  it('hands back fresh part objects on every call', () => {
    // The title screen renders one of these while the app starts a run from
    // another; a shared part array would let one mutate the other's rig.
    const first = buildStarterRig('light');
    const second = buildStarterRig('light');
    first.parts[0].pos.x = 99;
    expect(second.parts[0].pos.x).toBe(0);
  });

  it('grants the unlocks a rig needs but never the signature block', () => {
    const heavy = buildStarterUnlocks('heavy');
    // The heavy rig ships on parts that are otherwise locked behind a fee.
    expect(heavy).toContain('tread-tank');
    expect(heavy).toContain('frame-reinforced');
    expect(heavy).not.toContain(BUILDS.heavy.signatureDefId);
  });

  it('needs its own wheels unlocked for the default rig', () => {
    // The Sparkrunner rides on Motorcycle Wheels, which carry an unlock fee.
    // A new game therefore has to grant the default build's unlocks up front
    // (App.beginNewGame) rather than assume the opening rig is all starter
    // parts — otherwise the first wheel a zombie tears off is unbuyable.
    const light = buildStarterUnlocks(DEFAULT_BUILD_ID);
    expect(light).toContain('wheel-moto');
    expect(STARTER_UNLOCKS).not.toContain('wheel-moto');
  });
});

describe('signature strike scaling', () => {
  it('makes every level bought hit harder, wider, and sooner', () => {
    for (const buildId of BUILD_IDS) {
      const def = getPartDef(BUILDS[buildId].signatureDefId).signature;
      expect(def).toBeDefined();
      if (!def) continue;

      const base = effectiveSignature(def, 1);
      const maxed = effectiveSignature(def, 6);
      expect(maxed.damage).toBeGreaterThan(base.damage);
      expect(maxed.radiusM).toBeGreaterThan(base.radiusM);
      expect(maxed.cooldownSeconds).toBeLessThan(base.cooldownSeconds);
      // Reach is fixed on purpose: upgrades change how hard a strike lands,
      // never how far across the arena the player can place it.
      expect(maxed.rangeM).toBe(base.rangeM);
    }
  });

  it('reads level 0 and level 1 as the catalog numbers', () => {
    const def = getPartDef('storm-rod').signature;
    expect(def).toBeDefined();
    if (!def) return;
    expect(effectiveSignature(def, 0)).toEqual(effectiveSignature(def, 1));
    expect(effectiveSignature(def, 1).damage).toBe(def.baseDamage);
  });

  it('resolves the storm rod as a self-firing chain, not a blast', () => {
    const def = getPartDef('storm-rod').signature;
    expect(def).toBeDefined();
    if (!def) return;
    const strike = effectiveSignature(def, 1);

    // The mast is the one signature the player never clicks, and the one that
    // hits a list of bodies rather than an area.
    expect(strike.autoFire).toBe(true);
    expect(strike.chainTargets).toBeGreaterThan(1);
    expect(strike.chainRangeM).toBeGreaterThan(0);
    // Each jump lands lighter, so which body the cursor is on still matters.
    expect(strike.chainFalloff).toBeGreaterThan(0);
    expect(strike.chainFalloff).toBeLessThan(1);
  });

  it('leaves the two blast signatures hand-fired and chainless', () => {
    for (const defId of ['pyre-core', 'fallout-silo']) {
      const def = getPartDef(defId).signature;
      expect(def).toBeDefined();
      if (!def) continue;
      const strike = effectiveSignature(def, 1);
      expect(strike.autoFire).toBe(false);
      expect(strike.chainTargets).toBe(1);
    }
  });

  it('keeps a fully upgraded strike on a readable cadence', () => {
    // The reticle's fill is the only cooldown readout the strike has, so a
    // cooldown that scaled to zero would leave it permanently full.
    for (const buildId of BUILD_IDS) {
      const def = getPartDef(BUILDS[buildId].signatureDefId).signature;
      if (!def) continue;
      expect(effectiveSignature(def, 6).cooldownSeconds).toBeGreaterThanOrEqual(
        0.4,
      );
    }
  });
});

describe('strike targeting', () => {
  it('leaves a click inside the weapon reach exactly where it landed', () => {
    const point = clampStrikePoint({ x: 0, z: 0 }, { x: 3, z: 4 }, 10);
    expect(point).toEqual({ x: 3, z: 4 });
  });

  it('pulls a click past the reach back onto the edge rather than refusing it', () => {
    // Eating the click would give the player no shot and no explanation, and
    // would leave the cooldown they were watching untouched.
    const point = clampStrikePoint({ x: 0, z: 0 }, { x: 30, z: 40 }, 10);
    expect(Math.hypot(point.x, point.z)).toBeCloseTo(10, 5);
    expect(point.x).toBeCloseTo(6, 5);
    expect(point.z).toBeCloseTo(8, 5);
  });

  it('survives a click on the rig itself', () => {
    const point = clampStrikePoint({ x: 5, z: 5 }, { x: 5, z: 5 }, 10);
    expect(point).toEqual({ x: 5, z: 5 });
  });
});
