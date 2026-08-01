/** Editor palette presentation + exact first-car tutorial logic. */

import { createEmptyBlueprint } from './blueprint.ts';
import { composeOrientations, orientationFromSteps } from './grid.ts';
import { validateBlueprint } from './placement.ts';
import type {
  OrientationIndex,
  PartConfig,
  PartDefinition,
  PlacedPart,
  Vec3i,
  VehicleBlueprint,
} from './types.ts';

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
  'armour-plate': {
    name: 'Armour Plate',
    blurb: 'Adds a tough layer of protection!',
  },
  'cannon-heavy': {
    name: 'Heavy Cannon',
    blurb:
      'Lobs shells that explode and wipe out the whole crowd — click to pick the spot!',
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
    blurb:
      'Press its key for a blue bubble that keeps your truck safe for a bit!',
  },
  'mind-control-beam': {
    name: 'Mind Control Beam',
    blurb:
      'Hit its key to make nearby zombies fight for you — until it wears off!',
  },
  'missile-launcher': {
    name: 'Missile Launcher',
    blurb:
      'Fires splashy rockets. Hit its key for one BIG rocket on the crowd!',
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

export interface TutorialPartSpec {
  readonly defId: string;
  readonly pos: Readonly<Vec3i>;
  readonly orient: OrientationIndex;
  readonly config: Readonly<PartConfig>;
}

const DEFAULT_TUTORIAL_WHEEL_CONFIG: Readonly<PartConfig> = {
  driven: true,
  braking: true,
  steerInverted: false,
};

function spec(
  defId: string,
  x: number,
  y: number,
  z: number,
  orient: OrientationIndex = 0,
  config: Readonly<PartConfig> = {},
): TutorialPartSpec {
  return { defId, pos: { x, y, z }, orient, config };
}

/**
 * Canonical free body a New Game used to spawn fully assembled. Tutorial mode
 * gives the pieces to the player and makes them recreate this exact layout.
 */
export const TUTORIAL_STARTER_BODY_SPECS: readonly TutorialPartSpec[] = [
  spec('chassis-core', 0, 1, 0),
  spec('frame-box', 0, 1, 1),
  spec('frame-box', 0, 1, -1),
  spec('frame-box', 1, 1, -1),
  spec('frame-box', -1, 1, -1),
  spec('wheel-standard', 0, 1, 2, 0, DEFAULT_TUTORIAL_WHEEL_CONFIG),
  spec(
    'wheel-standard',
    2,
    1,
    -1,
    orientationFromSteps(0, 2, 0),
    DEFAULT_TUTORIAL_WHEEL_CONFIG,
  ),
  spec('wheel-standard', -2, 1, -1, 0, DEFAULT_TUTORIAL_WHEEL_CONFIG),
  spec('engine-small', 0, 2, -1),
  spec('fuel-tank', 0, 2, 0),
];

/** Pieces staged for free so tutorial economics equal the old free starter. */
export const TUTORIAL_STAGED_INVENTORY: Readonly<Record<string, number>> = {
  'frame-box': 4,
  'wheel-standard': 3,
  'engine-small': 1,
  'fuel-tank': 1,
};

/** Short integration name: free stock staged only while tutorial is active. */
export const STARTER_TUTORIAL_INVENTORY = TUTORIAL_STAGED_INVENTORY;

/** One prescribed first weapon. It sits over the front frame. */
export const TUTORIAL_TURRET_SPEC: TutorialPartSpec = spec('turret', 0, 2, 1);

export const TUTORIAL_COMPLETE_VEHICLE_SPECS: readonly TutorialPartSpec[] = [
  ...TUTORIAL_STARTER_BODY_SPECS,
  TUTORIAL_TURRET_SPEC,
];

/** Body pieces the player places; Chassis Core starts in the bay. */
export const TUTORIAL_BUILD_SPECS: readonly TutorialPartSpec[] =
  TUTORIAL_STARTER_BODY_SPECS.slice(1);

function partFromSpec(piece: TutorialPartSpec, index: number): PlacedPart {
  return {
    id: `p${index + 1}`,
    defId: piece.defId,
    pos: { ...piece.pos },
    orient: piece.orient,
    config: { ...piece.config },
  };
}

/** Fresh tutorial bay: same blueprint identity, Chassis Core only. */
export function createTutorialChassisBlueprint(
  name = 'starter-rig',
): VehicleBlueprint {
  return {
    ...createEmptyBlueprint(name),
    parts: [partFromSpec(TUTORIAL_STARTER_BODY_SPECS[0], 0)],
  };
}

/** Canonical body used by tutorial skip and normal starter construction. */
export function createTutorialStarterBodyBlueprint(
  name = 'starter-rig',
): VehicleBlueprint {
  return {
    ...createEmptyBlueprint(name),
    parts: TUTORIAL_STARTER_BODY_SPECS.map(partFromSpec),
  };
}

/** Short integration name for normal/skip starter construction. */
export const starterBodyBlueprint = createTutorialStarterBodyBlueprint;
/** Short integration name for tutorial's Chassis-Core-only starting state. */
export const starterTutorialBlueprint = createTutorialChassisBlueprint;

interface NormalizedTutorialConfig {
  level: number;
  driven: boolean | null;
  steering: boolean | null;
  steerInverted: boolean | null;
  braking: boolean | null;
  activeAbility: boolean | null;
  abilitySlot: number | null;
  suspensionPreset: PartConfig['suspensionPreset'] | null;
  paint: PartConfig['paint'] | null;
}

/**
 * Saved starter wheels predate the explicit `standard` suspension value used by
 * newly placed wheels. Treat those two spellings as the same car while keeping
 * real configuration changes (manual steering, paint, upgrades) exact.
 */
export function normalizeTutorialPartConfig(
  defId: string,
  config: Readonly<PartConfig>,
): NormalizedTutorialConfig {
  const wheel = defId === 'wheel-standard';
  return {
    level: config.level ?? 1,
    driven: wheel ? (config.driven ?? true) : (config.driven ?? null),
    steering: config.steering ?? null,
    steerInverted: wheel
      ? (config.steerInverted ?? false)
      : (config.steerInverted ?? null),
    braking: wheel ? (config.braking ?? true) : (config.braking ?? null),
    activeAbility: config.activeAbility ?? null,
    abilitySlot: config.abilitySlot ?? null,
    suspensionPreset: wheel
      ? (config.suspensionPreset ?? 'standard')
      : (config.suspensionPreset ?? null),
    paint: config.paint ?? null,
  };
}

function normalizedConfigEquals(
  a: NormalizedTutorialConfig,
  b: NormalizedTutorialConfig,
): boolean {
  return (Object.keys(a) as (keyof NormalizedTutorialConfig)[]).every(
    (key) => a[key] === b[key],
  );
}

/** IDs do not matter; every player still has to match part, cell and setup. */
export function partMatchesTutorialSpec(
  part: Pick<PlacedPart, 'defId' | 'pos' | 'orient' | 'config'>,
  piece: TutorialPartSpec,
): boolean {
  return (
    part.defId === piece.defId &&
    part.pos.x === piece.pos.x &&
    part.pos.y === piece.pos.y &&
    part.pos.z === piece.pos.z &&
    part.orient === piece.orient &&
    normalizedConfigEquals(
      normalizeTutorialPartConfig(part.defId, part.config),
      normalizeTutorialPartConfig(piece.defId, piece.config),
    )
  );
}

/**
 * Exact prefix, ignoring array order and generated IDs. `prefixLength` includes
 * Chassis Core. Extra, early, misplaced, or misconfigured parts fail.
 */
export function blueprintMatchesTutorialPrefix(
  bp: VehicleBlueprint,
  prefixLength: number,
): boolean {
  if (
    !Number.isInteger(prefixLength) ||
    prefixLength < 1 ||
    prefixLength > TUTORIAL_COMPLETE_VEHICLE_SPECS.length ||
    bp.parts.length !== prefixLength
  ) {
    return false;
  }

  const unmatched = [...bp.parts];
  for (const piece of TUTORIAL_COMPLETE_VEHICLE_SPECS.slice(0, prefixLength)) {
    const match = unmatched.findIndex((part) =>
      partMatchesTutorialSpec(part, piece),
    );
    if (match < 0) return false;
    unmatched.splice(match, 1);
  }
  return unmatched.length === 0;
}

/** Current valid recipe prefix, or null when an unexpected edit slipped in. */
export function tutorialRecipePrefixLength(
  bp: VehicleBlueprint,
): number | null {
  return blueprintMatchesTutorialPrefix(bp, bp.parts.length)
    ? bp.parts.length
    : null;
}

export function starterTutorialBodyComplete(bp: VehicleBlueprint): boolean {
  return blueprintMatchesTutorialPrefix(bp, TUTORIAL_STARTER_BODY_SPECS.length);
}

/** Exact starter body plus exact turret; ordinary validation is checked later. */
export function starterTutorialVehicleComplete(bp: VehicleBlueprint): boolean {
  return blueprintMatchesTutorialPrefix(
    bp,
    TUTORIAL_COMPLETE_VEHICLE_SPECS.length,
  );
}

export const starterTutorialComplete = starterTutorialVehicleComplete;

/** Which garage furniture a coach mark points at. Core stays DOM-free. */
export type TourAnchor =
  'viewport' | 'store' | 'stats' | 'abilities' | 'buildBar' | 'fight';

/** Everything pure tutorial logic needs to know about the garage now. */
export interface GarageTourSnapshot {
  blueprint: VehicleBlueprint;
  inventory: Readonly<Record<string, number>>;
  armedDefId: string | null;
  /** Live ghost orientation. Null means no reliably reported armed ghost. */
  armedOrient: OrientationIndex | null;
  /** Allowed rotate actions completed since this tutorial piece was armed. */
  rotationTurnsCompleted: number;
  inventoryCount: number;
  placedPartCount: number;
  canFight: boolean;
}

export type GarageTourStepKind = 'welcome' | 'place' | 'buy' | 'fight';

export interface GarageTourStep {
  id: string;
  kind: GarageTourStepKind;
  title: string;
  text: string;
  anchor: TourAnchor;
  dim?: boolean;
  advance: 'next' | 'action';
  action?: string;
  /** Prescribed part for arm/place steps. */
  piece?: TutorialPartSpec;
  /** Recipe size proving a placement step finished. */
  completedPrefixLength?: number;
  isDone?(now: GarageTourSnapshot, start: GarageTourSnapshot): boolean;
}

function placementStep(
  id: string,
  title: string,
  text: string,
  action: string,
  piece: TutorialPartSpec,
  completedPrefixLength: number,
): GarageTourStep {
  return {
    id,
    kind: 'place',
    title,
    text,
    action,
    anchor: 'buildBar',
    dim: false,
    advance: 'action',
    piece,
    completedPrefixLength,
    isDone: (now) => {
      const prefix = tutorialRecipePrefixLength(now.blueprint);
      return prefix !== null && prefix >= completedPrefixLength;
    },
  };
}

const BODY = TUTORIAL_STARTER_BODY_SPECS;

/** One short instruction at a time. Every placement starts in the Store. */
export const STARTER_TUTORIAL_STEPS: readonly GarageTourStep[] = [
  {
    id: 'welcome',
    kind: 'welcome',
    title: 'Let’s Build Your First Car!',
    text: 'Hey, builder! I’m your garage buddy. Drag only the shiny parts and we’ll make a zombie-smashing car together.',
    anchor: 'viewport',
    advance: 'next',
  },
  placementStep(
    'front-frame',
    'Add the Front Block',
    'Blocks are the car’s bones. Grab the shiny Block in the Store. Drag it onto the glowing space in front of the Truck Heart.',
    'Drag the Block from the Store to the glow',
    BODY[1],
    2,
  ),
  placementStep(
    'rear-frame',
    'Add the Back Block',
    'Great! Grab another Block from the Store. Drag it onto the glow behind the Truck Heart.',
    'Drag another Block to the back glow',
    BODY[2],
    3,
  ),
  placementStep(
    'right-frame',
    'Make the Back Wide',
    'Grab another Block from the Store. Drag it to one side so a wheel has room.',
    'Drag a Block to the right glow',
    BODY[3],
    4,
  ),
  placementStep(
    'left-frame',
    'Match the Other Side',
    'One more Block! Drag it from the Store to the other side so the car stays balanced.',
    'Drag a Block to the left glow',
    BODY[4],
    5,
  ),
  placementStep(
    'front-wheel',
    'Give It a Front Wheel',
    'Grab a Wheel from the Store. Drag it to the glow at the nose. This wheel helps the car turn.',
    'Drag a Wheel to the front glow',
    BODY[5],
    6,
  ),
  placementStep(
    'right-wheel',
    'Turn the Back Wheel',
    'This wheel must face inward. Drag it onto the green spot, then tap Rotate two times.',
    'Drag the Wheel, then Rotate twice',
    BODY[6],
    7,
  ),
  placementStep(
    'left-wheel',
    'Add the Last Wheel',
    'Grab the last Wheel from the Store. Drag it to the final wheel glow.',
    'Drag a Wheel to the left glow',
    BODY[7],
    8,
  ),
  placementStep(
    'engine',
    'Give It an Engine',
    'The Engine makes the wheels go. Grab it from the Store and drag it onto the glowing back Block.',
    'Drag the Engine to the glow',
    BODY[8],
    9,
  ),
  placementStep(
    'fuel-tank',
    'Fill It With Go-Juice',
    'The Fuel Tank keeps the Engine running. Grab it from the Store and drag it on top of the Truck Heart.',
    'Drag the Fuel Tank to the glow',
    BODY[9],
    10,
  ),
  {
    id: 'buy-turret',
    kind: 'buy',
    title: 'Buy a Zombie Blaster',
    text: 'Cars need a way to fight! Tap the shiny Zombie Blaster in the Store. It costs $120.',
    action: 'Buy the Zombie Blaster',
    anchor: 'store',
    advance: 'action',
    isDone: (now) => tutorialTurretOwned(now),
  },
  placementStep(
    'place-turret',
    'Bolt On the Blaster',
    'Now grab your Zombie Blaster from the Store. Drag it onto the glowing front Block. It shoots by itself!',
    'Drag the Zombie Blaster to the glow',
    TUTORIAL_TURRET_SPEC,
    11,
  ),
  {
    id: 'fight',
    kind: 'fight',
    title: 'Ready to Smash Zombies!',
    text: 'Your first car is ready. Tap Fight Zombies. I’ll show you the driving controls before the wave starts.',
    action: 'Tap Fight Zombies',
    anchor: 'fight',
    advance: 'action',
  },
];

/** Existing overlay name retained while its implementation moves to new model. */
export const GARAGE_TOUR_STEPS = STARTER_TUTORIAL_STEPS;

export type StarterTutorialAction =
  | { kind: 'next' }
  | { kind: 'arm'; defId: string }
  | { kind: 'rotate'; defId: string; orient: OrientationIndex }
  | {
      kind: 'place';
      defId: string;
      pos: Vec3i;
      orient: OrientationIndex;
      config: PartConfig;
    }
  | { kind: 'buy'; defId: string }
  | { kind: 'fight' }
  | { kind: 'skip' };

export interface StarterTutorialProgress {
  valid: boolean;
  stepIndex: number;
  step: GarageTourStep | null;
}

/** Bought but not yet placed, or already bolted into the prescribed cell. */
export function tutorialTurretOwned(snapshot: GarageTourSnapshot): boolean {
  return (
    (snapshot.inventory.turret ?? 0) > 0 ||
    snapshot.blueprint.parts.some((part) => part.defId === 'turret')
  );
}

/** Derive resumable progress from exact garage state after welcome is closed. */
export function deriveStarterTutorialProgress(
  snapshot: GarageTourSnapshot,
  welcomeAcknowledged: boolean,
): StarterTutorialProgress {
  if (!welcomeAcknowledged) {
    return { valid: true, stepIndex: 0, step: STARTER_TUTORIAL_STEPS[0] };
  }

  const prefix = tutorialRecipePrefixLength(snapshot.blueprint);
  if (prefix === null) return { valid: false, stepIndex: -1, step: null };

  if (prefix < TUTORIAL_STARTER_BODY_SPECS.length) {
    return {
      valid: true,
      stepIndex: prefix,
      step: STARTER_TUTORIAL_STEPS[prefix],
    };
  }

  if (prefix === TUTORIAL_STARTER_BODY_SPECS.length) {
    const stepIndex = tutorialTurretOwned(snapshot) ? 11 : 10;
    return {
      valid: true,
      stepIndex,
      step: STARTER_TUTORIAL_STEPS[stepIndex],
    };
  }

  return {
    valid: true,
    stepIndex: 12,
    step: STARTER_TUTORIAL_STEPS[12],
  };
}

/** Convenience lookup used by App/Editor integrations after welcome state. */
export function starterTutorialStep(
  bp: VehicleBlueprint,
  inventory: Readonly<Record<string, number>>,
  welcomeAcknowledged = true,
): GarageTourStep | null {
  const snapshot: GarageTourSnapshot = {
    blueprint: bp,
    inventory,
    armedDefId: null,
    armedOrient: null,
    rotationTurnsCompleted: 0,
    inventoryCount: 0,
    placedPartCount: Math.max(0, bp.parts.length - 1),
    canFight: false,
  };
  return deriveStarterTutorialProgress(snapshot, welcomeAcknowledged).step;
}

/** Narrow placement gate for Editor's canvas path. */
export function starterTutorialPlacementAllowed(
  step: GarageTourStep,
  defId: string,
  pos: Vec3i,
  orient: OrientationIndex,
  config: PartConfig = {},
  rotationTurnsCompleted = 0,
): boolean {
  return (
    step.kind === 'place' &&
    step.piece !== undefined &&
    partMatchesTutorialSpec({ defId, pos, orient, config }, step.piece) &&
    rotationTurnsCompleted >= tutorialRequiredRotationTurns(step.piece)
  );
}

/**
 * Hard input gate. Scrims guide attention; this predicate enforces exact part,
 * exact cell and exact orientation before any command mutates game state.
 */
export function starterTutorialActionAllowed(
  step: GarageTourStep,
  action: StarterTutorialAction,
  snapshot: GarageTourSnapshot,
): boolean {
  if (action.kind === 'skip') return true;
  if (step.kind === 'welcome') return action.kind === 'next';

  if (step.kind === 'buy') {
    return (
      action.kind === 'buy' &&
      action.defId === TUTORIAL_TURRET_SPEC.defId &&
      starterTutorialBodyComplete(snapshot.blueprint) &&
      !tutorialTurretOwned(snapshot)
    );
  }

  if (step.kind === 'fight') {
    return (
      action.kind === 'fight' &&
      starterTutorialVehicleComplete(snapshot.blueprint) &&
      snapshot.canFight
    );
  }

  const piece = step.piece;
  if (!piece) return false;
  const expectedBefore = (step.completedPrefixLength ?? 1) - 1;
  if (tutorialRecipePrefixLength(snapshot.blueprint) !== expectedBefore) {
    return false;
  }
  if (action.kind === 'arm') return action.defId === piece.defId;
  if (action.kind === 'rotate') {
    return (
      action.defId === piece.defId &&
      snapshot.armedDefId === piece.defId &&
      snapshot.armedOrient !== null &&
      action.orient ===
        nextTutorialRotationOrientation(snapshot.armedOrient, piece.orient)
    );
  }
  if (action.kind !== 'place') return false;
  if (
    snapshot.armedDefId !== piece.defId ||
    snapshot.armedOrient !== piece.orient ||
    snapshot.rotationTurnsCompleted < tutorialRequiredRotationTurns(piece)
  ) {
    return false;
  }
  return partMatchesTutorialSpec(
    {
      defId: action.defId,
      pos: action.pos,
      orient: action.orient,
      config: action.config,
    },
    piece,
  );
}

const TUTORIAL_YAW_QUARTER_TURN = orientationFromSteps(0, 1, 0);

/** Explicit quarter turns from a freshly armed orientation 0 to this piece. */
export function tutorialRequiredRotationTurns(piece: TutorialPartSpec): number {
  let orient: OrientationIndex = 0;
  for (let turns = 0; turns < 4; turns++) {
    if (orient === piece.orient) return turns;
    orient = composeOrientations(TUTORIAL_YAW_QUARTER_TURN, orient);
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Next explicit R-style quarter turn on a yaw-only route to `target`, or null
 * when already there / unreachable without resetting the held part.
 */
export function nextTutorialRotationOrientation(
  current: OrientationIndex,
  target: OrientationIndex,
): OrientationIndex | null {
  if (current === target) return null;
  let candidate = current;
  let first: OrientationIndex | null = null;
  for (let turn = 0; turn < 4; turn++) {
    candidate = composeOrientations(TUTORIAL_YAW_QUARTER_TURN, candidate);
    first ??= candidate;
    if (candidate === target) return first;
  }
  return null;
}

/** What coach should point at within a placement step. */
export function nextStarterTutorialAction(
  step: GarageTourStep,
  snapshot: GarageTourSnapshot,
): StarterTutorialAction | null {
  if (step.kind === 'welcome') return { kind: 'next' };
  if (step.kind === 'buy') return { kind: 'buy', defId: 'turret' };
  if (step.kind === 'fight') return { kind: 'fight' };
  if (!step.piece) return null;
  if (
    snapshot.armedDefId !== step.piece.defId ||
    snapshot.armedOrient === null
  ) {
    return { kind: 'arm', defId: step.piece.defId };
  }
  if (
    snapshot.armedOrient === step.piece.orient &&
    snapshot.rotationTurnsCompleted < tutorialRequiredRotationTurns(step.piece)
  ) {
    // Re-arm at zero. Reaching target without recorded turns was auto-rotation.
    return { kind: 'arm', defId: step.piece.defId };
  }
  const rotateTo = nextTutorialRotationOrientation(
    snapshot.armedOrient,
    step.piece.orient,
  );
  if (rotateTo !== null) {
    return {
      kind: 'rotate',
      defId: step.piece.defId,
      orient: rotateTo,
    };
  }
  if (snapshot.armedOrient !== step.piece.orient) {
    // A flip moved the part outside the yaw-only path. Re-arming resets to 0.
    return { kind: 'arm', defId: step.piece.defId };
  }
  return {
    kind: 'place',
    defId: step.piece.defId,
    pos: { ...step.piece.pos },
    orient: step.piece.orient,
    config: { ...step.piece.config },
  };
}

/** Reads live garage state for progress and hard-action predicates. */
export function garageTourSnapshot(
  bp: VehicleBlueprint,
  inventory: Readonly<Record<string, number>>,
  getDef: GetDef,
  armedDefId: string | null = null,
  armedOrient: OrientationIndex | null = null,
  rotationTurnsCompleted = 0,
): GarageTourSnapshot {
  let inventoryCount = 0;
  for (const count of Object.values(inventory)) {
    if (Number.isFinite(count) && count > 0) inventoryCount += count;
  }
  return {
    blueprint: bp,
    inventory,
    armedDefId,
    armedOrient,
    rotationTurnsCompleted,
    inventoryCount,
    placedPartCount: bp.parts.filter((part) => part.defId !== 'chassis-core')
      .length,
    canFight: validateBlueprint(bp, getDef).errors.length === 0,
  };
}

/** Has player completed this exact action step? Narration never auto-advances. */
export function tourStepDone(
  step: GarageTourStep,
  now: GarageTourSnapshot,
  start: GarageTourSnapshot,
): boolean {
  return step.advance === 'action' && (step.isDone?.(now, start) ?? false);
}

/** Advance through completed action steps; welcome still waits for Next. */
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
