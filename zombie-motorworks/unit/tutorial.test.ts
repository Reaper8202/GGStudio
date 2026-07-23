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
import { BLUEPRINT_SCHEMA_VERSION } from '../src/core/types.ts';
import type { Vec3i, VehicleBlueprint } from '../src/core/types.ts';

const EXPECTED_LABELS: Record<string, string> = {
  'chassis-core': 'Truck Heart',
  'frame-box': 'Block',
  'frame-reinforced': 'Strong Block',
  'wheel-standard': 'Wheel',
  'wheel-offroad': 'Monster Wheel',
  'wheel-moto': 'Speedy Wheel',
  'tread-tank': 'Tank Tread',
  'driver-seat': 'Driver Seat',
  'engine-small': 'Engine',
  'fuel-tank': 'Fuel Tank',
  'mine-sweeper': 'Mine Finder',
  turret: 'Zombie Blaster',
  'armour-plate': 'Armour Plate',
  'cannon-heavy': 'Heavy Cannon',
  'ice-cannon': 'Ice Cannon',
  'barrel-drum': 'Grinder Drum',
  'sniper-light': 'Light Sniper',
  flamethrower: 'Flamethrower',
  'shield-generator': 'Shield Bubble',
};

const FRAME_BUILD: readonly { defId: string; pos: Vec3i }[] = [
  { defId: 'frame-box', pos: { x: 0, y: 1, z: 1 } },
  { defId: 'frame-box', pos: { x: 0, y: 1, z: -1 } },
  { defId: 'frame-box', pos: { x: 1, y: 1, z: 0 } },
  { defId: 'frame-reinforced', pos: { x: -1, y: 1, z: 0 } },
];

const WHEEL_SUPPORTS: readonly Vec3i[] = [
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

function addFrameBuild(bp: VehicleBlueprint): VehicleBlueprint {
  return FRAME_BUILD.reduce(
    (current, part) => addValidPart(current, part.defId, part.pos),
    bp,
  );
}

function addDirectWheels(bp: VehicleBlueprint): VehicleBlueprint {
  let current = addParts(bp, 'frame-box', WHEEL_SUPPORTS);
  current = addValidPart(current, 'wheel-standard', { x: -2, y: 1, z: 1 });
  current = addValidPart(current, 'wheel-offroad', { x: -2, y: 1, z: -1 });
  const rightWheelOrient = orientationFromSteps(0, 2, 0);
  current = addValidPart(
    current,
    'wheel-standard',
    { x: 2, y: 1, z: 1 },
    rightWheelOrient,
  );
  return addValidPart(
    current,
    'wheel-offroad',
    { x: 2, y: 1, z: -1 },
    rightWheelOrient,
  );
}

function buildThroughFuel(): VehicleBlueprint {
  let bp = addFrameBuild(createTutorialBlueprint());
  bp = addDirectWheels(bp);
  bp = addValidPart(bp, 'driver-seat', { x: 0, y: 2, z: 0 });
  bp = addValidPart(bp, 'engine-small', { x: 0, y: 2, z: 1 });
  return addValidPart(bp, 'fuel-tank', { x: 0, y: 2, z: -1 });
}

describe('editor catalog presentation', () => {
  it('has exactly one non-empty label for every kept catalog part', () => {
    const catalogIds = Object.keys(PART_CATALOG);
    expect(Object.keys(KID_LABELS)).toEqual(catalogIds);
    expect(Object.keys(EXPECTED_LABELS)).toEqual(catalogIds);

    for (const id of catalogIds) {
      expect(KID_LABELS[id].name).toBe(EXPECTED_LABELS[id]);
      expect(KID_LABELS[id].name.trim()).not.toBe('');
      expect(KID_LABELS[id].blurb.trim()).not.toBe('');
    }
  });

  it('exposes exactly the visible store tiles in spec order', () => {
    expect(SIMPLE_PART_IDS).toEqual([
      'frame-box',
      'frame-reinforced',
      'wheel-standard',
      'wheel-offroad',
      'wheel-moto',
      'tread-tank',
      'driver-seat',
      'engine-small',
      'fuel-tank',
      'mine-sweeper',
      'turret',
      'armour-plate',
      'cannon-heavy',
      'ice-cannon',
      'shield-generator',
      'barrel-drum',
      'sniper-light',
      'flamethrower',
    ]);
    expect(SIMPLE_PART_IDS).not.toContain('chassis-core');
    expect(SIMPLE_PART_IDS.every((id) => PART_CATALOG[id] !== undefined)).toBe(
      true,
    );
  });
});

describe('tutorial progression', () => {
  it('defines the exact six-step sequence and instructions', () => {
    expect(TUTORIAL_STEPS.map((step) => step.id)).toEqual([
      'frame',
      'wheels',
      'driver',
      'engine',
      'fuel',
      'drive',
    ]);
    expect(TUTORIAL_STEPS.map((step) => step.paletteDefId)).toEqual([
      'frame-box',
      'wheel-standard',
      'driver-seat',
      'engine-small',
      'fuel-tank',
      undefined,
    ]);
    expect(TUTORIAL_STEPS.map((step) => step.text)).toEqual([
      'Add 4 Blocks around the orange Truck Heart. Right-click a mistake to erase.',
      'Put 4 Wheels straight onto the outside Blocks. Wheels set themselves up.',
      'Put the Driver Seat on top.',
      'Snap on an Engine.',
      'Add a Fuel Tank.',
      'Press TEST DRIVE!',
    ]);
  });

  it('starts with only the Truck Heart at the requested position', () => {
    const bp = createTutorialBlueprint();

    expect(bp.schemaVersion).toBe(BLUEPRINT_SCHEMA_VERSION);
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

  it('walks a valid direct-attachment truck through every tutorial stage', () => {
    let bp = createTutorialBlueprint();

    bp = addFrameBuild(bp);
    expect(tutorialProgress(bp, getPartDef)).toBe(1);

    bp = addDirectWheels(bp);
    expect(tutorialProgress(bp, getPartDef)).toBe(2);

    bp = addValidPart(bp, 'driver-seat', { x: 0, y: 2, z: 0 });
    expect(tutorialProgress(bp, getPartDef)).toBe(3);

    bp = addValidPart(bp, 'engine-small', { x: 0, y: 2, z: 1 });
    expect(tutorialProgress(bp, getPartDef)).toBe(4);

    bp = addValidPart(bp, 'fuel-tank', { x: 0, y: 2, z: -1 });
    expect(TUTORIAL_STEPS[4].isComplete(bp, getPartDef)).toBe(true);
    expect(validateBlueprint(bp, getPartDef).errors).toEqual([]);
    expect(tutorialProgress(bp, getPartDef)).toBe(TUTORIAL_STEPS.length);
  });

  it('stays on the first incomplete step when parts are added out of order', () => {
    const bp = addValidPart(createTutorialBlueprint(), 'engine-small', {
      x: 0,
      y: 2,
      z: 0,
    });

    expect(TUTORIAL_STEPS[3].isComplete(bp, getPartDef)).toBe(true);
    expect(tutorialProgress(bp, getPartDef)).toBe(0);
  });

  it('does not finish when all build steps pass but validation has an error', () => {
    const complete = buildThroughFuel();
    const invalid = blueprint.withPartAdded(complete, {
      id: blueprint.nextPartId(complete),
      defId: 'frame-box',
      pos: { x: 6, y: 8, z: 8 },
      orient: 0,
      config: {},
    });

    expect(
      TUTORIAL_STEPS.slice(0, 5).every((step) =>
        step.isComplete(invalid, getPartDef),
      ),
    ).toBe(true);
    expect(
      validateBlueprint(invalid, getPartDef).errors.map((issue) => issue.code),
    ).toContain('DISCONNECTED');
    expect(TUTORIAL_STEPS[5].isComplete(invalid, getPartDef)).toBe(false);
    expect(tutorialProgress(invalid, getPartDef)).toBe(5);
  });
});
