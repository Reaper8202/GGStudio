import { describe, expect, it } from 'vitest';
import { orientationFromSteps } from '../src/core/grid.ts';
import { createEmptyBlueprint, withPartAdded } from '../src/core/blueprint.ts';
import {
  BlueprintFormatError,
  CURRENT_SCHEMA_VERSION,
  deserializeBlueprint,
  serializeBlueprint,
} from '../src/core/serialize.ts';
import { MAX_PART_LEVEL } from '../src/core/partUpgrades.ts';

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
    config: {
      level: 3,
      driven: true,
      steering: true,
      braking: true,
      paint: 'blue',
    },
  });
  bp = withPartAdded(bp, {
    id: 'p3',
    defId: 'turret',
    pos: { x: 0, y: 1, z: 0 },
    orient: 0,
    config: { level: 4 },
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
    [
      'non-integer upgrade level',
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: 'bp',
        name: 'bad',
        parts: [
          {
            id: 'p1',
            defId: 'wheel-standard',
            pos: { x: 0, y: 0, z: 0 },
            orient: 0,
            config: { level: 1.5 },
          },
        ],
      }),
    ],
    [
      'upgrade level below one',
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: 'bp',
        name: 'bad',
        parts: [
          {
            id: 'p1',
            defId: 'wheel-standard',
            pos: { x: 0, y: 0, z: 0 },
            orient: 0,
            config: { level: 0 },
          },
        ],
      }),
    ],
  ])('throws BlueprintFormatError for %s', (_name, json) => {
    expect(() => deserializeBlueprint(json)).toThrow(BlueprintFormatError);
  });

  it('clamps future upgrade levels and strips invalid or unknown config fields', () => {
    const result = deserializeBlueprint(
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: 'bp',
        name: 'sanitized',
        parts: [
          {
            id: 'p1',
            defId: 'wheel-standard',
            pos: { x: 0, y: 0, z: 0 },
            orient: 0,
            config: {
              level: 99,
              driven: true,
              steering: 'yes',
              braking: false,
              suspensionPreset: 'space',
              paint: 'invisible',
              injected: 'nope',
            },
          },
        ],
      }),
    );

    expect(result.parts[0].config).toEqual({
      level: MAX_PART_LEVEL,
      driven: true,
      braking: false,
    });
  });

  it('clamps an over-high upgrade level to each part own maximum', () => {
    // EMP and piercing used to be separately stored module levels. They are now
    // unlocks on the part's upgrade chain, so `level` is the only thing the codec
    // has to sanitize — and it clamps per part rather than to a global ceiling.
    const result = deserializeBlueprint(
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: 'bp',
        name: 'level sanitizing',
        parts: [
          {
            id: 'turret-high',
            defId: 'turret',
            pos: { x: 0, y: 0, z: 0 },
            orient: 0,
            config: { level: 99 },
          },
          {
            id: 'turret-stock',
            defId: 'turret',
            pos: { x: 1, y: 0, z: 0 },
            orient: 0,
            config: { level: 1 },
          },
          {
            id: 'frame',
            defId: 'frame-box',
            pos: { x: 2, y: 0, z: 0 },
            orient: 0,
            config: {},
          },
        ],
      }),
    );

    expect(result.parts.map((part) => part.config)).toEqual([
      { level: MAX_PART_LEVEL },
      { level: 1 },
      {},
    ]);
  });

  it.each([
    ['a non-number', '2'],
    ['a fractional', 2.5],
    ['a below-one', 0],
    ['a negative', -3],
  ])('rejects %s upgrade level', (_label, level) => {
    const json = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: 'bp',
      name: 'invalid level',
      parts: [
        {
          id: 'turret',
          defId: 'turret',
          pos: { x: 0, y: 0, z: 0 },
          orient: 0,
          config: { level },
        },
      ],
    });

    expect(() => deserializeBlueprint(json)).toThrow(BlueprintFormatError);
  });

  it('decodes a current turret blueprint saved before module fields existed', () => {
    const legacy = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: 'pre-modules',
      name: 'old turret rig',
      parts: [
        {
          id: 'turret',
          defId: 'turret',
          pos: { x: 0, y: 0, z: 0 },
          orient: 0,
          config: {},
        },
      ],
    };

    expect(deserializeBlueprint(JSON.stringify(legacy))).toEqual(legacy);
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

  it('migrates a v3 fixture through the v4 pass-through migration', () => {
    const legacy = {
      schemaVersion: 3,
      id: 'v3-bp',
      name: 'v3 rig',
      parts: [
        {
          id: 'p1',
          defId: 'engine-small',
          pos: { x: 0, y: 0, z: 0 },
          orient: 0,
          config: {},
        },
      ],
    };

    expect(deserializeBlueprint(JSON.stringify(legacy))).toEqual({
      ...legacy,
      schemaVersion: CURRENT_SCHEMA_VERSION,
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
