import { describe, expect, it } from 'vitest';
import { buildStarterBlueprint } from '../src/app/App.ts';
import { createEmptyBlueprint } from '../src/core/blueprint.ts';
import {
  decodeShareCode,
  encodeShareCode,
  lockedDefIdsFor,
  PAINT_COLORS_LIST,
  SUSPENSION_PRESETS,
  ShareCodeError,
} from '../src/core/shareCode.ts';
import {
  PAINT_COLORS,
  type PartConfig,
  type VehicleBlueprint,
} from '../src/core/types.ts';

const part = (
  id: string,
  defId: string,
  x: number,
  config: PartConfig = {},
) => ({
  id,
  defId,
  pos: { x, y: 1, z: -12 },
  orient: 0,
  config,
});

describe('share code', () => {
  it('round-trips the starter blueprint exactly', () => {
    const blueprint = buildStarterBlueprint();
    expect(decodeShareCode(encodeShareCode(blueprint))).toEqual(blueprint);
  });

  it('round-trips every PartConfig field and distinguishes undefined from false', () => {
    const blueprint: VehicleBlueprint = {
      ...createEmptyBlueprint('config rig'),
      parts: [
        part('a', 'chassis-core', 0, {
          level: 1,
          driven: true,
          steerInverted: false,
          braking: true,
          activeAbility: false,
          suspensionPreset: 'off-road',
          paint: 'purple',
        }),
        part('b', 'wheel-standard', 1, { steering: false }),
        part('c', 'shield-generator', 2, { abilitySlot: -1 }),
      ],
    };
    const decoded = decodeShareCode(encodeShareCode(blueprint));
    expect(decoded).toEqual(blueprint);
    expect(decoded.parts[0].config.steering).toBeUndefined();
  });

  it('round-trips negative and multi-digit coordinates', () => {
    const blueprint = {
      ...createEmptyBlueprint('coords'),
      parts: [part('a', 'chassis-core', -123)],
    };
    blueprint.parts[0].pos = { x: -123, y: 456, z: -789 };
    expect(decodeShareCode(encodeShareCode(blueprint))).toEqual(blueprint);
  });

  it('round-trips non-ASCII names', () => {
    const blueprint = { ...createEmptyBlueprint('🚙 Жรถ'), parts: [] };
    expect(decodeShareCode(encodeShareCode(blueprint))).toEqual(blueprint);
  });

  it('uses base64url without padding', () => {
    expect(encodeShareCode(buildStarterBlueprint())).toMatch(
      /^[A-Za-z0-9_-]+$/,
    );
  });

  it('rejects malformed codes with ShareCodeError', () => {
    const code = encodeShareCode(buildStarterBlueprint());
    const bytes = Uint8Array.from(
      atob(
        code.replaceAll('-', '+').replaceAll('_', '/') +
          '='.repeat((4 - (code.length % 4)) % 4),
      ),
      (c) => c.charCodeAt(0),
    );
    const trailing = btoa(String.fromCharCode(...bytes, 0))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    for (const malformed of [
      '',
      'garbage text',
      'AAAA',
      code.slice(0, -2),
      trailing,
    ]) {
      expect(() => decodeShareCode(malformed)).toThrow(ShareCodeError);
    }
  });

  it('returns distinct used locked definitions in catalog order', () => {
    const blueprint = {
      ...createEmptyBlueprint('locked'),
      parts: [
        part('a', 'turret', 0),
        part('b', 'frame-box', 1),
        part('c', 'turret', 2),
      ],
    };
    expect(lockedDefIdsFor(blueprint, ['frame-box'])).toEqual(['turret']);
    expect(lockedDefIdsFor(blueprint, ['frame-box', 'turret'])).toEqual([]);
  });

  it('covers every union member in the append-only option lists', () => {
    // Set comparison, not order comparison: adding a colour must fail this
    // test (the new member is uncovered and would encode as -1), while
    // reordering PAINT_COLORS must NOT change the wire values, which is
    // exactly why the list is spelled out rather than derived from the object.
    expect([...PAINT_COLORS_LIST].sort()).toEqual(
      Object.keys(PAINT_COLORS).sort(),
    );
    expect([...SUSPENSION_PRESETS].sort()).toEqual(
      ['light', 'standard', 'heavy-duty', 'off-road'].sort(),
    );
    expect(Object.isFrozen(SUSPENSION_PRESETS)).toBe(true);
    expect(Object.isFrozen(PAINT_COLORS_LIST)).toBe(true);
  });

  it('pins the wire value of every option, so old codes keep decoding', () => {
    // These indices are the on-the-wire encoding. Changing any line here
    // breaks every build code already shared; append instead.
    expect([...PAINT_COLORS_LIST]).toEqual([
      'scrap',
      'red',
      'blue',
      'green',
      'yellow',
      'purple',
    ]);
    expect([...SUSPENSION_PRESETS]).toEqual([
      'light',
      'standard',
      'heavy-duty',
      'off-road',
    ]);
  });

  it('round-trips every paint colour and suspension preset', () => {
    for (const paint of PAINT_COLORS_LIST) {
      for (const suspensionPreset of SUSPENSION_PRESETS) {
        const bp = {
          ...createEmptyBlueprint('paints'),
          parts: [part('a', 'chassis-core', 0, { paint, suspensionPreset })],
        };
        expect(decodeShareCode(encodeShareCode(bp))).toEqual(bp);
      }
    }
  });

  it('keeps a realistic rig compact', () => {
    const blueprint = {
      ...createEmptyBlueprint('40 parts'),
      parts: Array.from({ length: 40 }, (_, i) =>
        part(`p${i}`, 'frame-box', i - 20),
      ),
    };
    expect(encodeShareCode(blueprint).length).toBeLessThan(1200);
  });
});
