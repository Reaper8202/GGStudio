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
  bp = withPartAdded(bp, { id: 'p1', defId: 'chassis-core', pos: { x: 0, y: 0, z: 0 }, orient: 0, config: {} });
  bp = withPartAdded(bp, {
    id: 'p2',
    defId: 'wheel-standard',
    pos: { x: 1, y: 0, z: 0 },
    orient: 0,
    config: { driven: true, steering: true, braking: true },
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
    ['missing fields', JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, id: 'bp' })],
    [
      'unknown defId',
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: 'bp',
        name: 'bad',
        parts: [{ id: 'p1', defId: 'missing', pos: { x: 0, y: 0, z: 0 }, orient: 0, config: {} }],
      }),
    ],
    [
      'orient outside 0..23',
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: 'bp',
        name: 'bad',
        parts: [{ id: 'p1', defId: 'chassis-core', pos: { x: 0, y: 0, z: 0 }, orient: 24, config: {} }],
      }),
    ],
    [
      'duplicate part ids',
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: 'bp',
        name: 'bad',
        parts: [
          { id: 'p1', defId: 'chassis-core', pos: { x: 0, y: 0, z: 0 }, orient: 0, config: {} },
          { id: 'p1', defId: 'frame-box', pos: { x: 1, y: 0, z: 0 }, orient: 0, config: {} },
        ],
      }),
    ],
    [
      'non-integer positions',
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: 'bp',
        name: 'bad',
        parts: [{ id: 'p1', defId: 'chassis-core', pos: { x: 0.5, y: 0, z: 0 }, orient: 0, config: {} }],
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
});
