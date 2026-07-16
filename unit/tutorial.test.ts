import { describe, expect, it } from 'vitest';
import * as blueprint from '../src/core/blueprint.ts';
import { orientationFromSteps } from '../src/core/grid.ts';
import { getPartDef, PART_CATALOG } from '../src/core/parts.ts';
import { canPlacePart, validateBlueprint } from '../src/core/placement.ts';
import {
  createTutorialBlueprint,
  KID_LABELS,
  SIMPLE_PART_IDS,
  TUTORIAL_STEPS,
  tutorialProgress,
} from '../src/core/tutorial.ts';
import type { Vec3i, VehicleBlueprint } from '../src/core/types.ts';

const EXPECTED_KID_NAMES: Record<string, string> = {
  'chassis-core': 'Truck Heart',
  'frame-box': 'Block',
  'frame-light': 'Light Block',
  'frame-reinforced': 'Strong Block',
  'beam-long': 'Long Beam',
  'wheel-mount': 'Wheel Holder',
  'engine-mount': 'Engine Stand',
  hardpoint: 'Gun Stand',
  'driver-seat': 'Driver Seat',
  'engine-small': 'Engine',
  'engine-big': 'Mega Engine',
  'fuel-tank': 'Fuel Tank',
  battery: 'Battery',
  'ammo-box': 'Ammo Box',
  'cargo-crate': 'Cargo Box',
  'wheel-standard': 'Wheel',
  'wheel-offroad': 'Monster Wheel',
  'armour-panel': 'Armour Plate',
  'shell-panel': 'Paint Panel',
  'gun-fixed': 'Front Gun',
  turret: 'Zombie Blaster',
};

const FRAME_POSITIONS: readonly Vec3i[] = [
  { x: 0, y: 1, z: 1 },
  { x: 0, y: 1, z: -1 },
  { x: 1, y: 1, z: 0 },
  { x: -1, y: 1, z: 0 },
];

const MOUNT_POSITIONS: readonly Vec3i[] = [
  { x: 1, y: 1, z: 1 },
  { x: -1, y: 1, z: 1 },
  { x: 1, y: 1, z: -1 },
  { x: -1, y: 1, z: -1 },
];

function addValidPart(
  bp: VehicleBlueprint,
  defId: string,
  pos: Vec3i,
  orient = 0,
): VehicleBlueprint {
  const placement = canPlacePart(bp, getPartDef, defId, pos, orient);
  expect(placement.issues).toEqual([]);
  expect(placement.ok).toBe(true);
  return blueprint.withPartAdded(bp, {
    id: blueprint.nextPartId(bp),
    defId,
    pos,
    orient,
    config: {},
  });
}

function addParts(
  bp: VehicleBlueprint,
  defId: string,
  positions: readonly Vec3i[],
  orient = 0,
): VehicleBlueprint {
  return positions.reduce(
    (current, pos) => addValidPart(current, defId, pos, orient),
    bp,
  );
}

function buildThroughFuel(): VehicleBlueprint {
  let bp = createTutorialBlueprint();
  bp = addParts(bp, 'frame-box', FRAME_POSITIONS);
  bp = addParts(bp, 'wheel-mount', MOUNT_POSITIONS);
  bp = addParts(bp, 'wheel-standard', [
    { x: -2, y: 1, z: 1 },
    { x: -2, y: 1, z: -1 },
  ]);
  bp = addParts(
    bp,
    'wheel-standard',
    [
      { x: 2, y: 1, z: 1 },
      { x: 2, y: 1, z: -1 },
    ],
    orientationFromSteps(0, 2, 0),
  );
  bp = addValidPart(bp, 'driver-seat', { x: 0, y: 2, z: 0 });
  bp = addValidPart(bp, 'engine-mount', { x: 0, y: 1, z: 2 });
  bp = addValidPart(bp, 'engine-small', { x: 0, y: 2, z: 2 });
  return addValidPart(bp, 'fuel-tank', { x: 0, y: 2, z: 1 });
}

describe('kid-friendly catalog presentation', () => {
  it('has exactly one non-empty label for every catalog part', () => {
    const catalogIds = Object.keys(PART_CATALOG).sort();
    expect(Object.keys(KID_LABELS).sort()).toEqual(catalogIds);
    expect(Object.keys(EXPECTED_KID_NAMES).sort()).toEqual(catalogIds);

    for (const id of catalogIds) {
      expect(KID_LABELS[id].name).toBe(EXPECTED_KID_NAMES[id]);
      expect(KID_LABELS[id].name.trim()).not.toBe('');
      expect(KID_LABELS[id].blurb.trim()).not.toBe('');
    }
  });

  it('only exposes real catalog parts in the simple palette', () => {
    expect(
      SIMPLE_PART_IDS.filter((id) => PART_CATALOG[id] === undefined),
    ).toEqual([]);
  });
});

describe('tutorial progression', () => {
  it('defines the exact seven-step sequence', () => {
    expect(TUTORIAL_STEPS.map((step) => step.id)).toEqual([
      'frame',
      'mounts',
      'wheels',
      'driver',
      'engine',
      'fuel',
      'drive',
    ]);
    expect(TUTORIAL_STEPS.map((step) => step.paletteDefId)).toEqual([
      'frame-box',
      'wheel-mount',
      'wheel-standard',
      'driver-seat',
      'engine-small',
      'fuel-tank',
      undefined,
    ]);
  });

  it('starts with only the Truck Heart at the requested position', () => {
    const bp = createTutorialBlueprint();

    expect(bp.name).toBe('my-first-truck');
    expect(bp.parts).toEqual([
      {
        id: 'p1',
        defId: 'chassis-core',
        pos: { x: 0, y: 1, z: 0 },
        orient: 0,
        config: {},
      },
    ]);
    expect(tutorialProgress(bp, getPartDef)).toBe(0);
  });

  it('walks a valid truck build through every tutorial stage', () => {
    let bp = createTutorialBlueprint();

    bp = addParts(bp, 'frame-box', FRAME_POSITIONS);
    expect(tutorialProgress(bp, getPartDef)).toBe(1);

    bp = addParts(bp, 'wheel-mount', MOUNT_POSITIONS);
    expect(tutorialProgress(bp, getPartDef)).toBe(2);

    bp = addParts(bp, 'wheel-standard', [
      { x: -2, y: 1, z: 1 },
      { x: -2, y: 1, z: -1 },
    ]);
    bp = addParts(
      bp,
      'wheel-standard',
      [
        { x: 2, y: 1, z: 1 },
        { x: 2, y: 1, z: -1 },
      ],
      orientationFromSteps(0, 2, 0),
    );
    expect(tutorialProgress(bp, getPartDef)).toBe(3);

    bp = addValidPart(bp, 'driver-seat', { x: 0, y: 2, z: 0 });
    expect(tutorialProgress(bp, getPartDef)).toBe(4);

    bp = addValidPart(bp, 'engine-mount', { x: 0, y: 1, z: 2 });
    bp = addValidPart(bp, 'engine-small', { x: 0, y: 2, z: 2 });
    expect(tutorialProgress(bp, getPartDef)).toBe(5);

    bp = addValidPart(bp, 'fuel-tank', { x: 0, y: 2, z: 1 });
    expect(TUTORIAL_STEPS[5].isComplete(bp, getPartDef)).toBe(true);
    expect(validateBlueprint(bp, getPartDef).errors).toEqual([]);
    expect(tutorialProgress(bp, getPartDef)).toBe(TUTORIAL_STEPS.length);
  });

  it('stays on the first incomplete step when parts are added out of order', () => {
    let bp = createTutorialBlueprint();
    bp = addValidPart(bp, 'engine-mount', { x: 0, y: 1, z: 1 });
    bp = addValidPart(bp, 'engine-small', { x: 0, y: 2, z: 1 });

    expect(TUTORIAL_STEPS[4].isComplete(bp, getPartDef)).toBe(true);
    expect(tutorialProgress(bp, getPartDef)).toBe(0);
  });

  it('does not finish when the build passes steps 1–6 but fails validation', () => {
    const complete = buildThroughFuel();
    const invalid = blueprint.withPartAdded(complete, {
      id: blueprint.nextPartId(complete),
      defId: 'frame-box',
      pos: { x: 6, y: 8, z: 8 },
      orient: 0,
      config: {},
    });

    expect(
      TUTORIAL_STEPS.slice(0, 6).every((step) =>
        step.isComplete(invalid, getPartDef),
      ),
    ).toBe(true);
    expect(
      validateBlueprint(invalid, getPartDef).errors.map((issue) => issue.code),
    ).toContain('DISCONNECTED');
    expect(TUTORIAL_STEPS[6].isComplete(invalid, getPartDef)).toBe(false);
    expect(tutorialProgress(invalid, getPartDef)).toBe(6);
  });
});
