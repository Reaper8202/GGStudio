/**
 * Editor palette presentation + interactive tutorial step machine (pure logic).
 * The editor overlay renders these steps; predicates inspect the blueprint so
 * progress advances automatically as the player builds.
 */

import type { PartDefinition, VehicleBlueprint } from './types.ts';
import { createEmptyBlueprint, withPartAdded } from './blueprint.ts';
import { validateBlueprint } from './placement.ts';

export type GetDef = (defId: string) => PartDefinition;

/** Store and inventory entries shown in the garage, in this order. */
export const SIMPLE_PART_IDS: readonly string[] = [
  'frame-box',
  'frame-reinforced',
  'wheel-standard',
  'wheel-offroad',
  'driver-seat',
  'engine-small',
  'fuel-tank',
  'turret',
  'armour-plate',
  'cannon-heavy',
];

export interface PartLabel {
  name: string;
  blurb: string;
}

/** Display names for every catalog part id. */
export const KID_LABELS: Record<string, PartLabel> = {
  'chassis-core': {
    name: 'Truck Heart',
    blurb: 'Everything connects to this!',
  },
  'frame-box': {
    name: 'Block',
    blurb: 'Build your truck one block at a time!',
  },
  'frame-reinforced': {
    name: 'Strong Block',
    blurb: 'Tough stuff for big bumps!',
  },
  'wheel-standard': { name: 'Wheel', blurb: 'Rolls smoothly down the road!' },
  'wheel-offroad': {
    name: 'Monster Wheel',
    blurb: 'Climbs over big, bumpy ground!',
  },
  'driver-seat': { name: 'Driver Seat', blurb: 'Put your brave driver here!' },
  'engine-small': { name: 'Engine', blurb: 'Makes the truck go!' },
  'fuel-tank': { name: 'Fuel Tank', blurb: 'Keeps the engine fueled up!' },
  turret: { name: 'Zombie Blaster', blurb: 'Spins around to blast zombies!' },
  'armour-plate': { name: 'Armour Plate', blurb: 'Adds a tough layer of protection!' },
  'cannon-heavy': { name: 'Heavy Cannon', blurb: 'A big boom for tough zombies!' },
};

export interface TutorialStep {
  id: string;
  /** Short instructional title. */
  title: string;
  /** Short instruction telling the player exactly what to do. */
  text: string;
  /** Palette part to highlight while this step is active. */
  paletteDefId?: string;
  isComplete(bp: VehicleBlueprint, getDef: GetDef): boolean;
}

function countOf(bp: VehicleBlueprint, defId: string): number {
  return bp.parts.filter((part) => part.defId === defId).length;
}

/** The guided build: frame → wheels → driver → engine → fuel → drive. */
const BUILD_STEPS: readonly TutorialStep[] = [
  {
    id: 'frame',
    title: 'Build the frame',
    text: 'Add 4 Blocks around the orange Truck Heart. Right-click a mistake to erase.',
    paletteDefId: 'frame-box',
    isComplete: (bp) =>
      countOf(bp, 'frame-box') + countOf(bp, 'frame-reinforced') >= 4,
  },
  {
    id: 'wheels',
    title: 'Wheels on',
    text: 'Put 4 Wheels straight onto the outside Blocks. Wheels set themselves up.',
    paletteDefId: 'wheel-standard',
    isComplete: (bp) =>
      countOf(bp, 'wheel-standard') + countOf(bp, 'wheel-offroad') >= 4,
  },
  {
    id: 'driver',
    title: 'Add the driver',
    text: 'Put the Driver Seat on top.',
    paletteDefId: 'driver-seat',
    isComplete: (bp) => countOf(bp, 'driver-seat') >= 1,
  },
  {
    id: 'engine',
    title: 'Engine time',
    text: 'Snap on an Engine.',
    paletteDefId: 'engine-small',
    isComplete: (bp) => countOf(bp, 'engine-small') >= 1,
  },
  {
    id: 'fuel',
    title: 'Fuel it up',
    text: 'Add a Fuel Tank.',
    paletteDefId: 'fuel-tank',
    isComplete: (bp) => countOf(bp, 'fuel-tank') >= 1,
  },
];

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  ...BUILD_STEPS,
  {
    id: 'drive',
    title: 'Ready to roll',
    text: 'Press TEST DRIVE!',
    isComplete: (bp, getDef) =>
      validateBlueprint(bp, getDef).errors.length === 0 &&
      BUILD_STEPS.every((step) => step.isComplete(bp, getDef)),
  },
];

/** Fresh blueprint the tutorial starts from: just the Truck Heart placed. */
export function createTutorialBlueprint(): VehicleBlueprint {
  return withPartAdded(createEmptyBlueprint('my-first-truck'), {
    id: 'p1',
    defId: 'chassis-core',
    pos: { x: 0, y: 1, z: 0 },
    orient: 0,
    config: {},
  });
}

/** Index of the first incomplete step; TUTORIAL_STEPS.length when finished. */
export function tutorialProgress(bp: VehicleBlueprint, getDef: GetDef): number {
  for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
    if (!TUTORIAL_STEPS[i].isComplete(bp, getDef)) return i;
  }
  return TUTORIAL_STEPS.length;
}
