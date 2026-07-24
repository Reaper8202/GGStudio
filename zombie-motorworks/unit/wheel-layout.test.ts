/**
 * Automatic steer/drive layout. The steering half of this exists because a
 * wheel placed in the editor starts with an empty config: before it was
 * derived, a wheel replaced after a landmine mounted as non-steering and its
 * lateral grip fought the wheel that still steered, so the rig could barely
 * turn.
 */

import { describe, expect, it } from 'vitest';
import { getPartDef } from '../src/core/parts.ts';
import { deriveAutomaticWheelLayout } from '../src/core/wheelLayout.ts';
import { BLUEPRINT_SCHEMA_VERSION } from '../src/core/types.ts';
import type { PartConfig, VehicleBlueprint, Vec3i } from '../src/core/types.ts';

function wheel(id: string, pos: Vec3i, config: PartConfig = {}): VehicleBlueprint['parts'][number] {
  return { id, defId: 'wheel-standard', pos, orient: 0, config };
}

/** Root chassis with wheels on a front and a rear axle. */
function rig(parts: VehicleBlueprint['parts']): VehicleBlueprint {
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    id: 'test-rig',
    name: 'Test Rig',
    parts: [
      { id: 'root', defId: 'chassis-core', pos: { x: 0, y: 1, z: 0 }, orient: 0, config: {} },
      ...parts,
    ],
  };
}

const FRONT_L = { x: -1, y: 0, z: 2 };
const FRONT_R = { x: 1, y: 0, z: 2 };
const REAR_L = { x: -1, y: 0, z: -2 };
const REAR_R = { x: 1, y: 0, z: -2 };

describe('deriveAutomaticWheelLayout steering', () => {
  it('steers the wheels ahead of the axle midpoint', () => {
    const layout = deriveAutomaticWheelLayout(
      rig([wheel('fl', FRONT_L), wheel('fr', FRONT_R), wheel('rl', REAR_L), wheel('rr', REAR_R)]),
      getPartDef,
    );
    expect([...layout.steeringPartIds].sort()).toEqual(['fl', 'fr']);
  });

  it('steers a freshly placed replacement wheel, matching its axle mate', () => {
    // 'fr' was destroyed and rebuilt by the player, so it carries an empty
    // config while the surviving 'fl' still has its explicit tick.
    const layout = deriveAutomaticWheelLayout(
      rig([
        wheel('fl', FRONT_L, { steering: true }),
        wheel('fr-new', FRONT_R),
        wheel('rl', REAR_L, { steering: false }),
        wheel('rr', REAR_R, { steering: false }),
      ]),
      getPartDef,
    );
    expect(layout.steeringPartIds.has('fr-new')).toBe(true);
    expect(layout.steeringPartIds.has('fl')).toBe(true);
    expect(layout.steeringPartIds.has('rl')).toBe(false);
  });

  it('never overrides an explicit player choice', () => {
    const layout = deriveAutomaticWheelLayout(
      rig([
        wheel('fl', FRONT_L, { steering: false }),
        wheel('fr', FRONT_R, { steering: false }),
        wheel('rl', REAR_L, { steering: true }),
        wheel('rr', REAR_R, { steering: true }),
      ]),
      getPartDef,
    );
    expect([...layout.steeringPartIds].sort()).toEqual(['rl', 'rr']);
  });

  it('lets a single axle steer rather than leaving the rig with none', () => {
    const layout = deriveAutomaticWheelLayout(
      rig([wheel('l', { x: -1, y: 0, z: 0 }), wheel('r', { x: 1, y: 0, z: 0 })]),
      getPartDef,
    );
    expect([...layout.steeringPartIds].sort()).toEqual(['l', 'r']);
  });

  it('never nominates a wheel that cannot steer', () => {
    const layout = deriveAutomaticWheelLayout(
      rig([
        { id: 'tl', defId: 'tread-tank', pos: FRONT_L, orient: 0, config: {} },
        { id: 'tr', defId: 'tread-tank', pos: FRONT_R, orient: 0, config: {} },
        wheel('rl', REAR_L),
        wheel('rr', REAR_R),
      ]),
      getPartDef,
    );
    expect(layout.steeringPartIds.has('tl')).toBe(false);
    expect(layout.steeringPartIds.has('tr')).toBe(false);
    // Falls back to the remaining steer-capable axle so the rig can still turn.
    expect([...layout.steeringPartIds].sort()).toEqual(['rl', 'rr']);
  });
});

describe('deriveAutomaticWheelLayout drive', () => {
  it('drives the two wheels farthest from the root, preferring non-steering', () => {
    const layout = deriveAutomaticWheelLayout(
      rig([wheel('fl', FRONT_L), wheel('fr', FRONT_R), wheel('rl', REAR_L), wheel('rr', REAR_R)]),
      getPartDef,
    );
    expect(layout.drivenPartIds.size).toBe(2);
    // Front wheels steer, so drive falls to the rear axle.
    expect([...layout.drivenPartIds].sort()).toEqual(['rl', 'rr']);
  });
});
