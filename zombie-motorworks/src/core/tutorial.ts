/**
 * Editor palette presentation + the guided garage tour (pure logic).
 *
 * The tour is a coach-mark walk through the garage rather than a scripted
 * build: it names each panel in turn, then hands the player the loop itself —
 * buy a part, bolt it on, take the truck out. It never touches the blueprint,
 * so running it on a half-finished rig costs the player nothing.
 */

import type { PartDefinition, VehicleBlueprint } from './types.ts';
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
  // The three Build signature blocks. They are never on the store shelf (see
  // SIMPLE_PART_IDS above, which deliberately omits them), so these labels are
  // only ever read by the inspector and the ability panel.
  'storm-rod': {
    name: 'Lightning Mast',
    blurb: 'Click anywhere to drop a bolt of lightning on it!',
  },
  'pyre-core': {
    name: 'Fire Heart',
    blurb: 'Click to throw a big ball of fire. Everything it hits keeps burning!',
  },
  'fallout-silo': {
    name: 'Boom Tube',
    blurb: 'Click far away to call down a HUGE bomb. Count to four!',
  },
};

/**
 * Which piece of garage furniture a tour step points at. The overlay resolves
 * these to elements; `core` stays free of the DOM.
 */
export type TourAnchor =
  | 'viewport'
  | 'store'
  | 'stats'
  | 'abilities'
  | 'buildBar'
  | 'fight';

/** Everything the tour needs to know about the garage at one instant. */
export interface GarageTourSnapshot {
  /** Parts bought but not yet placed. */
  inventoryCount: number;
  /** Parts on the rig, Chassis Core excluded. */
  placedPartCount: number;
  /** The rig passes validation, so a wave can be started. */
  canFight: boolean;
}

export interface GarageTourStep {
  id: string;
  /** Heading of the coach card. */
  title: string;
  /** What this part of the garage is for. */
  text: string;
  /** Garage furniture the card points at. */
  anchor: TourAnchor;
  /**
   * Whether the spotlight dims the rest of the garage. Steps whose real work
   * happens on the truck itself only ring their anchor, because the scrim would
   * black out the thing the player has to click.
   */
  dim?: boolean;
  /**
   * `next` waits on the tour's own button; `action` waits on the player doing
   * the thing, and `isDone` says when they have.
   */
  advance: 'next' | 'action';
  /** Imperative one-liner shown on action steps: the thing to actually do. */
  action?: string;
  isDone?(now: GarageTourSnapshot, start: GarageTourSnapshot): boolean;
}

/** Parts the player has paid for, wherever they currently sit. */
function partsOwned(state: GarageTourSnapshot): number {
  return state.inventoryCount + state.placedPartCount;
}

/**
 * Four stops that name the garage, then the loop itself. The action steps
 * compare against the snapshot taken when the tour started rather than against
 * absolute counts, so a player who already owns a yard full of parts still has
 * to buy one to move on.
 */
export const GARAGE_TOUR_STEPS: readonly GarageTourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to the Garage',
    text: 'This is where the truck gets built. Four quick stops, then you run the loop yourself. Nothing you have already built gets touched.',
    anchor: 'viewport',
    advance: 'next',
  },
  {
    id: 'store',
    title: 'The Store',
    text: 'Every block, wheel, gun, and gadget is bought here. The tabs split the shelves into Essentials, Weapons, Defence, and Mobility, and each tile carries its price. Your cash sits up in the top-right corner.',
    anchor: 'store',
    advance: 'next',
  },
  {
    id: 'stats',
    title: 'Vehicle Stats',
    text: 'The read-out for the whole truck: how heavy it is, how likely it is to roll, how much damage it puts out, and how fast it goes. Watch these move as you bolt parts on.',
    anchor: 'stats',
    advance: 'next',
  },
  {
    id: 'abilities',
    title: 'Abilities',
    text: 'Some parts bring an ability you fire by hand mid-wave with Q, E, and R. Three boxes, so three abilities — click a box to change which part fills it.',
    anchor: 'abilities',
    advance: 'next',
  },
  {
    id: 'buy',
    title: 'Buy a part',
    text: 'Your turn. Pick anything you can afford in the Store and click its tile. Buying puts the part straight in your hands, ready to place.',
    action: 'Buy any part from the Store',
    anchor: 'store',
    advance: 'action',
    isDone: (now, start) => partsOwned(now) > partsOwned(start),
  },
  {
    id: 'attach',
    title: 'Bolt it on',
    text: 'Move over the truck and click a green cell to attach the part — red means it cannot go there, because everything has to touch what it mounts to. The build bar along the bottom keeps your blocks one click away.',
    action: 'Attach the part to the truck',
    anchor: 'buildBar',
    // The truck is the target here, so nothing gets dimmed.
    dim: false,
    advance: 'action',
    isDone: (now, start) => now.placedPartCount > start.placedPartCount,
  },
  {
    id: 'fight',
    title: 'Start the wave',
    text: 'That is the whole loop: buy, bolt on, drive out. Press Fight Zombies to take this truck into a wave — the tour ends the moment you do.',
    action: 'Press Fight Zombies',
    anchor: 'fight',
    advance: 'action',
  },
];

/** Reads the garage state the tour's action steps are measured against. */
export function garageTourSnapshot(
  bp: VehicleBlueprint,
  inventory: Readonly<Record<string, number>>,
  getDef: GetDef,
): GarageTourSnapshot {
  let inventoryCount = 0;
  for (const count of Object.values(inventory)) {
    if (Number.isFinite(count) && count > 0) inventoryCount += count;
  }
  return {
    inventoryCount,
    placedPartCount: bp.parts.filter((part) => part.defId !== 'chassis-core')
      .length,
    canFight: validateBlueprint(bp, getDef).errors.length === 0,
  };
}

/** Has the player done what this step asked? Narration steps never have. */
export function tourStepDone(
  step: GarageTourStep,
  now: GarageTourSnapshot,
  start: GarageTourSnapshot,
): boolean {
  return step.advance === 'action' && (step.isDone?.(now, start) ?? false);
}

/**
 * Index to sit on after a garage change. Only action steps advance on their
 * own — narration waits on the Next button — and several can fall at once when
 * a single click both buys a part and places it.
 */
export function advanceGarageTour(
  index: number,
  now: GarageTourSnapshot,
  start: GarageTourSnapshot,
): number {
  let next = Math.max(0, index);
  while (
    next < GARAGE_TOUR_STEPS.length &&
    tourStepDone(GARAGE_TOUR_STEPS[next], now, start)
  ) {
    next += 1;
  }
  return next;
}
