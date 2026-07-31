import { describe, expect, it } from 'vitest';
import { analyzeVehicle } from '../src/core/analysis.ts';
import { storeOffer } from '../src/core/economy.ts';
import { getPartDef } from '../src/core/parts.ts';
import {
  decodeProfile,
  defaultProfile,
  encodeProfile,
} from '../src/core/profile.ts';
import type { PlacedPart, VehicleBlueprint } from '../src/core/types.ts';
import {
  previewUpgradeMetrics,
  previewUpgradedBlueprint,
  vehicleIntegrity,
} from '../src/editor/EditorMode.ts';

function part(
  id: string,
  defId: string,
  x: number,
  y: number,
  z: number,
  config: PlacedPart['config'] = {},
): PlacedPart {
  return { id, defId, pos: { x, y, z }, orient: 0, config };
}

function previewBlueprint(): VehicleBlueprint {
  return {
    schemaVersion: 4,
    id: 'store-flow-preview',
    name: 'Store flow preview',
    parts: [
      part('engine', 'engine-small', 0, 1, 0),
      part('wheel-left', 'wheel-standard', -1, 0, 1, { driven: true }),
      part('wheel-right', 'wheel-standard', 1, 0, 1, { driven: true }),
      part('turret', 'turret', 0, 2, 0),
    ],
  };
}

describe('two-stage store and upgrade preview helpers', () => {
  it('offers only the unlock before offering the separate part purchase', () => {
    expect(storeOffer('frame-reinforced', [])).toEqual({
      action: 'unlock',
      price: 10,
    });
    expect(storeOffer('frame-reinforced', ['frame-reinforced'])).toEqual({
      action: 'buy',
      price: 20,
    });
    expect(storeOffer('mine-sweeper', [])).toEqual({
      action: 'unlock',
      price: 98,
    });
  });

  it('keeps an unlock across a round without granting or buying inventory', () => {
    const profile = defaultProfile();
    const offer = storeOffer('frame-reinforced', profile.unlockedDefIds);
    profile.money -= offer.price;
    profile.unlockedDefIds.push('frame-reinforced');

    const restored = decodeProfile(encodeProfile(profile));

    expect(restored.inventory?.['frame-reinforced']).toBeUndefined();
    expect(storeOffer('frame-reinforced', restored.unlockedDefIds)).toEqual({
      action: 'buy',
      price: 20,
    });
  });

  it('clones the blueprint and increments only the selected part level', () => {
    const original = previewBlueprint();
    const clone = previewUpgradedBlueprint(original, 'engine');

    expect(clone).not.toBeNull();
    expect(clone).not.toBe(original);
    expect(clone?.parts[0]).not.toBe(original.parts[0]);
    expect(clone?.parts[0].config).not.toBe(original.parts[0].config);
    expect(clone?.parts[0].config.level).toBe(2);
    expect(clone?.parts[1]).not.toBe(original.parts[1]);
    expect(original.parts[0].config.level).toBeUndefined();
    expect(original).toEqual(previewBlueprint());
  });

  it('uses analyzeVehicle and effective health for every preview value', () => {
    const original = previewBlueprint();
    const upgraded = previewUpgradedBlueprint(original, 'engine');
    const preview = previewUpgradeMetrics(original, 'engine');

    expect(upgraded).not.toBeNull();
    expect(preview).not.toBeNull();
    if (!upgraded || !preview) return;

    const beforeReport = analyzeVehicle(original, getPartDef);
    const afterReport = analyzeVehicle(upgraded, getPartDef);
    expect(preview.before).toEqual({
      totalDps: beforeReport.totalDps,
      integrity: vehicleIntegrity(original),
      estimatedTopSpeedKph: beforeReport.estimatedTopSpeedKph,
    });
    expect(preview.after).toEqual({
      totalDps: afterReport.totalDps,
      integrity: vehicleIntegrity(upgraded),
      estimatedTopSpeedKph: afterReport.estimatedTopSpeedKph,
    });
    expect(preview.after.integrity).toBeGreaterThan(preview.before.integrity);
    expect(preview.after.estimatedTopSpeedKph).toBeGreaterThan(
      preview.before.estimatedTopSpeedKph,
    );
  });

  it('shows the real whole-vehicle DPS change for a weapon upgrade', () => {
    const original = previewBlueprint();
    const upgraded = previewUpgradedBlueprint(original, 'turret');
    const preview = previewUpgradeMetrics(original, 'turret');

    expect(upgraded).not.toBeNull();
    expect(preview?.after.totalDps).toBe(
      analyzeVehicle(upgraded!, getPartDef).totalDps,
    );
    expect(preview!.after.totalDps).toBeGreaterThan(preview!.before.totalDps);
  });
});
