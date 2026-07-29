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
  'wheel-moto',
  'tread-tank',
  'nitro-injector',
  'phase-drive',
  'engine-small',
  'fuel-tank',
  'mine-sweeper',
  'turret',
  'armour-plate',
  'cannon-heavy',
  'ice-cannon',
  'tesla-coil',
  'shield-generator',
  'mind-control-beam',
  'missile-launcher',
  'nitro-booster',
  'thumper',
  'pulse-emitter',
  'barrel-drum',
  'spike-ram',
  'sawblade',
  'dozer-blade',
  'sniper-light',
  'flamethrower',
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
  'wheel-moto': {
    name: 'Speedy Wheel',
    blurb: 'Super fast and turns sharp, but breaks easily!',
  },
  'tread-tank': {
    name: 'Tank Tread',
    blurb: 'Slow and super tough! Crawls over anything.',
  },
  'engine-small': { name: 'Engine', blurb: 'Makes the truck go!' },
  'fuel-tank': { name: 'Fuel Tank', blurb: 'Keeps the engine fueled up!' },
  'mine-sweeper': {
    name: 'Mine Finder',
    blurb: 'Beeps when buried mines are close by!',
  },
  turret: {
    name: 'Zombie Blaster',
    blurb: 'Blasts zombies all by itself — click to aim it where you want!',
  },
  'armour-plate': { name: 'Armour Plate', blurb: 'Adds a tough layer of protection!' },
  'cannon-heavy': {
    name: 'Heavy Cannon',
    blurb: 'Lobs shells that explode and wipe out the whole crowd — click to pick the spot!',
  },
  'ice-cannon': {
    name: 'Ice Cannon',
    blurb:
      'Shoots chilly shards that slow zombies — hit its key to freeze them solid!',
  },
  'tesla-coil': {
    name: 'Tesla Coil',
    blurb:
      'Zaps zombies with blue lightning — hit its key for a big lightning blast!',
  },
  'barrel-drum': {
    name: 'Grinder Drum',
    blurb: 'Spinning drum that munches zombies it touches!',
  },
  'spike-ram': {
    name: 'Long Spikes',
    blurb: 'Long, sharp spikes that poke any zombie that gets close!',
  },
  sawblade: {
    name: 'Sawblade',
    blurb: 'A spinning blade that saws through zombies it grazes!',
  },
  'dozer-blade': {
    name: 'Bulldozer Blade',
    blurb: 'Scoops up a whole crowd — squash them against a wall!',
  },
  'sniper-light': {
    name: 'Light Sniper',
    blurb: 'One careful shot from far, far away!',
  },
  flamethrower: {
    name: 'Flamethrower',
    blurb: 'Whoosh! Sprays hot flames up close!',
  },
  'shield-generator': {
    name: 'Shield Bubble',
    blurb: 'Press its key for a blue bubble that keeps your truck safe for a bit!',
  },
  'mind-control-beam': {
    name: 'Mind Control Beam',
    blurb: 'Hit its key to make nearby zombies fight for you — until it wears off!',
  },
  'missile-launcher': {
    name: 'Missile Launcher',
    blurb: 'Fires splashy rockets. Hit its key for one BIG rocket on the crowd!',
  },
  'nitro-booster': {
    name: 'Nitro Booster',
    blurb: 'Hit its key for a mega speed boost with blue flames out the back!',
  },
  thumper: {
    name: 'Thumper',
    blurb: 'Hit its key to SLAM the ground and blast nearby zombies away!',
  },
  'pulse-emitter': {
    name: 'Push Blaster',
    blurb: 'BOOM! Shoves every zombie around you away and hurts them too!',
  },
  'nitro-injector': {
    name: 'Speed Boost',
    blurb: 'Gives your truck a big push of go-fast for smashing through!',
  },
  'phase-drive': {
    name: 'Blink Coil',
    blurb: 'Zap! Jump forward right through zombies and walls!',
  },
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

/** The guided build: frame → wheels → engine → fuel → drive. */
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
