/**
 * Kid-friendly presentation + interactive tutorial step machine (pure logic).
 * The editor overlay renders these steps; predicates inspect the blueprint so
 * progress advances automatically as the player builds.
 */

import type { PartDefinition, VehicleBlueprint } from './types.ts';
import { createEmptyBlueprint, withPartAdded } from './blueprint.ts';
import { validateBlueprint } from './placement.ts';

export type GetDef = (defId: string) => PartDefinition;

/** Palette entries shown in simple (kids) mode, in this order. */
export const SIMPLE_PART_IDS: readonly string[] = [
  'frame-box',
  'wheel-mount',
  'wheel-standard',
  'wheel-offroad',
  'driver-seat',
  'engine-mount',
  'engine-small',
  'fuel-tank',
  'hardpoint',
  'turret',
];

export interface KidLabel {
  name: string;
  blurb: string; // one short kid-friendly line
}

/** Friendly names for EVERY catalog part id (used by the palette in both modes). */
export const KID_LABELS: Record<string, KidLabel> = {
  'chassis-core': {
    name: 'Truck Heart',
    blurb: 'Everything connects to this!',
  },
  'frame-box': {
    name: 'Block',
    blurb: 'Build your truck one block at a time!',
  },
  'frame-light': {
    name: 'Light Block',
    blurb: 'Keeps your truck quick and light!',
  },
  'frame-reinforced': {
    name: 'Strong Block',
    blurb: 'Tough stuff for big bumps!',
  },
  'beam-long': { name: 'Long Beam', blurb: 'Builds a long, sturdy stretch!' },
  'wheel-mount': {
    name: 'Wheel Holder',
    blurb: 'Gives a wheel a place to snap!',
  },
  'engine-mount': { name: 'Engine Stand', blurb: 'Holds the engine up high!' },
  hardpoint: { name: 'Gun Stand', blurb: 'Gives a blaster a sturdy spot!' },
  'driver-seat': { name: 'Driver Seat', blurb: 'Put your brave driver here!' },
  'engine-small': { name: 'Engine', blurb: 'Makes the truck go!' },
  'engine-big': { name: 'Mega Engine', blurb: 'Big power for a mighty truck!' },
  'fuel-tank': { name: 'Fuel Tank', blurb: 'Keeps the engine fueled up!' },
  battery: { name: 'Battery', blurb: 'Stores power for your gadgets!' },
  'ammo-box': { name: 'Ammo Box', blurb: 'Carries extra blaster rounds!' },
  'cargo-crate': {
    name: 'Cargo Box',
    blurb: 'Hauls all your important stuff!',
  },
  'wheel-standard': { name: 'Wheel', blurb: 'Rolls smoothly down the road!' },
  'wheel-offroad': {
    name: 'Monster Wheel',
    blurb: 'Climbs over big, bumpy ground!',
  },
  'armour-panel': { name: 'Armour Plate', blurb: 'Helps protect your truck!' },
  'shell-panel': {
    name: 'Paint Panel',
    blurb: 'Adds a splash of cool colour!',
  },
  'gun-fixed': {
    name: 'Front Gun',
    blurb: 'Blasts whatever is straight ahead!',
  },
  turret: { name: 'Zombie Blaster', blurb: 'Spins around to blast zombies!' },
};

export interface TutorialStep {
  id: string;
  /** Short title, may contain an emoji. */
  title: string;
  /** 1–2 kid-friendly sentences telling them exactly what to do. */
  text: string;
  /** Palette part to highlight while this step is active. */
  paletteDefId?: string;
  isComplete(bp: VehicleBlueprint, getDef: GetDef): boolean;
}

function countOf(bp: VehicleBlueprint, defId: string): number {
  return bp.parts.filter((part) => part.defId === defId).length;
}

/** The guided build: frame → wheel holders → wheels → driver → engine → fuel → drive. */
const BUILD_STEPS: readonly TutorialStep[] = [
  {
    id: 'frame',
    title: '🧱 Build the frame',
    text: "Click the Block and add 4 blocks around the orange Truck Heart to make your truck's body!",
    paletteDefId: 'frame-box',
    isComplete: (bp) =>
      countOf(bp, 'frame-box') +
        countOf(bp, 'frame-light') +
        countOf(bp, 'frame-reinforced') +
        countOf(bp, 'beam-long') >=
      4,
  },
  {
    id: 'mounts',
    title: '🔩 Wheel Holders',
    text: 'Add 4 Wheel Holders on the sides of the truck.',
    paletteDefId: 'wheel-mount',
    isComplete: (bp) => countOf(bp, 'wheel-mount') >= 4,
  },
  {
    id: 'wheels',
    title: '🛞 Wheels on!',
    text: 'Snap a Wheel onto the outside of each Wheel Holder (tip: press R if it shows red).',
    paletteDefId: 'wheel-standard',
    isComplete: (bp) =>
      countOf(bp, 'wheel-standard') + countOf(bp, 'wheel-offroad') >= 4,
  },
  {
    id: 'driver',
    title: '🧑‍✈️ The driver',
    text: 'Every truck needs a driver — place the Driver Seat on top.',
    paletteDefId: 'driver-seat',
    isComplete: (bp) => countOf(bp, 'driver-seat') >= 1,
  },
  {
    id: 'engine',
    title: '⚙️ Engine time',
    text: 'Place an Engine Stand on the truck, then put the Engine ON TOP of it.',
    paletteDefId: 'engine-small',
    isComplete: (bp) =>
      countOf(bp, 'engine-small') + countOf(bp, 'engine-big') >= 1,
  },
  {
    id: 'fuel',
    title: '⛽ Fuel it up',
    text: 'Engines are thirsty — add a Fuel Tank.',
    paletteDefId: 'fuel-tank',
    isComplete: (bp) => countOf(bp, 'fuel-tank') >= 1,
  },
];

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  ...BUILD_STEPS,
  {
    id: 'drive',
    title: '🏁 Ready to roll!',
    text: 'Press the green TEST DRIVE button and take it for a spin!',
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
