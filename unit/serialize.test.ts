import { describe, expect, it } from 'vitest';
import { orientationFromSteps } from '../src/core/grid.ts';
import { createEmptyBlueprint, withPartAdded } from '../src/core/blueprint.ts';
import {
  BlueprintFormatError,
  CURRENT_SCHEMA_VERSION,
  deserializeBlueprint,
  serializeBlueprint,
} from '../src/core/serialize.ts';

function sampleBlueprint() {
  let bp = createEmptyBlueprint('roundtrip rig');
  bp = withPartAdded(bp, {
    id: 'p1',
    defId: 'chassis-core',
    pos: { x: 0, y: 0, z: 0 },
    orient: 0,
    config: {},
  });
  bp = withPartAdded(bp, {
    id: 'p2',
    defId: 'wheel-standard',
    pos: { x: 1, y: 0, z: 0 },
    orient: 0,
    config: { driven: true, steering: true, braking: true, paint: 'blue' },
  });
  return bp;
}

describe('blueprint serialization', () => {
  it('round trips a valid blueprint', () => {
    const bp = sampleBlueprint();
    expect(deserializeBlueprint(serializeBlueprint(bp))).toEqual(bp);
  });

  it.each([
    ['invalid JSON', '{'],
    [
      'missing fields',
      JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, id: 'bp' }),
    ],
    [
      'unknown defId',
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: 'bp',
        name: 'bad',
        parts: [
          {
            id: 'p1',
            defId: 'missing',
            pos: { x: 0, y: 0, z: 0 },
            orient: 0,
            config: {},
          },
        ],
      }),
    ],
    [
      'orient outside 0..23',
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: 'bp',
        name: 'bad',
        parts: [
          {
            id: 'p1',
            defId: 'chassis-core',
            pos: { x: 0, y: 0, z: 0 },
            orient: 24,
            config: {},
          },
        ],
      }),
    ],
    [
      'duplicate part ids',
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: 'bp',
        name: 'bad',
        parts: [
          {
            id: 'p1',
            defId: 'chassis-core',
            pos: { x: 0, y: 0, z: 0 },
            orient: 0,
            config: {},
          },
          {
            id: 'p1',
            defId: 'frame-box',
            pos: { x: 1, y: 0, z: 0 },
            orient: 0,
            config: {},
          },
        ],
      }),
    ],
    [
      'non-integer positions',
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: 'bp',
        name: 'bad',
        parts: [
          {
            id: 'p1',
            defId: 'chassis-core',
            pos: { x: 0.5, y: 0, z: 0 },
            orient: 0,
            config: {},
          },
        ],
      }),
    ],
  ])('throws BlueprintFormatError for %s', (_name, json) => {
    expect(() => deserializeBlueprint(json)).toThrow(BlueprintFormatError);
  });

  it('migrates v1 type and rotation fields to v2 defId and orient', () => {
    const legacy = {
      schemaVersion: 1,
      id: 'legacy-bp',
      name: 'legacy rig',
      parts: [
        {
          id: 'p1',
          type: 'chassis-core',
          pos: { x: 0, y: 0, z: 0 },
          rotation: { rx: 0, ry: 1, rz: 0 },
          config: {},
        },
        {
          id: 'p2',
          type: 'frame-box',
          pos: { x: 1, y: 0, z: 0 },
          rotation: { rx: 1, ry: 0, rz: 3 },
        },
      ],
    };

    expect(deserializeBlueprint(JSON.stringify(legacy))).toEqual({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: 'legacy-bp',
      name: 'legacy rig',
      parts: [
        {
          id: 'p1',
          defId: 'chassis-core',
          pos: { x: 0, y: 0, z: 0 },
          orient: orientationFromSteps(0, 1, 0),
          config: {},
        },
        {
          id: 'p2',
          defId: 'frame-box',
          pos: { x: 1, y: 0, z: 0 },
          orient: orientationFromSteps(1, 0, 3),
          config: {},
        },
      ],
    });
  });

  it.each([
    ['wheel-mount', 'frame-box'],
    ['frame-light', 'frame-box'],
    ['battery', 'frame-box'],
    ['ammo-box', 'frame-box'],
    ['cargo-crate', 'frame-box'],
    ['engine-mount', 'frame-box'],
    ['hardpoint', 'frame-box'],
    ['engine-big', 'engine-small'],
    ['gun-fixed', 'turret'],
  ])('migrates v2 %s to %s', (legacyDefId, expectedDefId) => {
    const config = {
      driven: true,
      steering: false,
      steerInverted: true,
      braking: true,
      suspensionPreset: 'off-road',
      paint: 'purple',
    };
    const legacy = {
      schemaVersion: 2,
      id: 'legacy-bp',
      name: 'legacy rig',
      parts: [
        {
          id: 'legacy-part',
          defId: legacyDefId,
          pos: { x: 2, y: 3, z: 4 },
          orient: 7,
          config,
        },
      ],
    };

    expect(deserializeBlueprint(JSON.stringify(legacy))).toEqual({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: 'legacy-bp',
      name: 'legacy rig',
      parts: [
        {
          id: 'legacy-part',
          defId: expectedDefId,
          pos: { x: 2, y: 3, z: 4 },
          orient: 7,
          config,
        },
      ],
    });
  });

  it('expands a rotated v2 long beam into three frame blocks at its occupied world cells', () => {
    const legacy = {
      schemaVersion: 2,
      id: 'legacy-bp',
      name: 'legacy beam rig',
      parts: [
        {
          id: 'beam',
          defId: 'beam-long',
          pos: { x: 2, y: 3, z: 4 },
          orient: orientationFromSteps(0, 1, 0),
          config: { paint: 'yellow' },
        },
      ],
    };

    expect(deserializeBlueprint(JSON.stringify(legacy))).toEqual({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: 'legacy-bp',
      name: 'legacy beam rig',
      parts: [
        {
          id: 'beam',
          defId: 'frame-box',
          pos: { x: 2, y: 3, z: 4 },
          orient: 0,
          config: { paint: 'yellow' },
        },
        {
          id: 'beamb',
          defId: 'frame-box',
          pos: { x: 3, y: 3, z: 4 },
          orient: 0,
          config: { paint: 'yellow' },
        },
        {
          id: 'beamc',
          defId: 'frame-box',
          pos: { x: 4, y: 3, z: 4 },
          orient: 0,
          config: { paint: 'yellow' },
        },
      ],
    });
  });

  it('drops v2 armour and shell panels', () => {
    const legacy = {
      schemaVersion: 2,
      id: 'legacy-bp',
      name: 'legacy panel rig',
      parts: [
        {
          id: 'root',
          defId: 'chassis-core',
          pos: { x: 0, y: 0, z: 0 },
          orient: 0,
          config: {},
        },
        {
          id: 'armour',
          defId: 'armour-panel',
          pos: { x: 1, y: 0, z: 0 },
          orient: 0,
          config: { paint: 'red' },
        },
        {
          id: 'shell',
          defId: 'shell-panel',
          pos: { x: -1, y: 0, z: 0 },
          orient: 0,
          config: { paint: 'green' },
        },
      ],
    };

    expect(deserializeBlueprint(JSON.stringify(legacy)).parts).toEqual([
      {
        id: 'root',
        defId: 'chassis-core',
        pos: { x: 0, y: 0, z: 0 },
        orient: 0,
        config: {},
      },
    ]);
  });

  it('rejects an unknown defId after migrating v2 to the current schema', () => {
    const legacy = {
      schemaVersion: 2,
      id: 'legacy-bp',
      name: 'unknown legacy rig',
      parts: [
        {
          id: 'mystery',
          defId: 'still-unknown',
          pos: { x: 0, y: 0, z: 0 },
          orient: 0,
          config: {},
        },
      ],
    };

    expect(() => deserializeBlueprint(JSON.stringify(legacy))).toThrow(
      'unknown defId: still-unknown',
    );
  });
});
