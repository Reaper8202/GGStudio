import type { Face, PartDefinition, StructuralSocket, Vec3i } from './types.ts';
import { ALL_FACES, orientationFromSteps, rotateVec } from './grid.ts';
import { MAX_PART_LEVEL } from './partUpgrades.ts';
import type { OrientationIndex } from './types.ts';

const ORIGIN: Vec3i = { x: 0, y: 0, z: 0 };
const WHEEL_AXLE_LOCAL: Vec3i = { x: 1, y: 0, z: 0 };
const WHEEL_SUSPENSION_LOCAL: Vec3i = { x: 0, y: -1, z: 0 };

function v(x: number, y: number, z: number): Vec3i {
  return { x, y, z };
}

function cellId(cell: Vec3i): string {
  return `${cell.x}-${cell.y}-${cell.z}`;
}

function frameSockets(
  cells: readonly Vec3i[],
  overrides: Partial<Record<Face, StructuralSocket>> = {},
): StructuralSocket[] {
  const occupied = new Set(
    cells.map((cell) => `${cell.x},${cell.y},${cell.z}`),
  );
  const faceDelta: Record<Face, Vec3i> = {
    px: v(1, 0, 0),
    nx: v(-1, 0, 0),
    py: v(0, 1, 0),
    ny: v(0, -1, 0),
    pz: v(0, 0, 1),
    nz: v(0, 0, -1),
  };

  return cells.flatMap((cell) =>
    ALL_FACES.flatMap((face) => {
      const neighbour = {
        x: cell.x + faceDelta[face].x,
        y: cell.y + faceDelta[face].y,
        z: cell.z + faceDelta[face].z,
      };
      if (occupied.has(`${neighbour.x},${neighbour.y},${neighbour.z}`))
        return [];
      const override = overrides[face];
      return override
        ? [{ ...override, cell, face }]
        : [{ id: `frame-${cellId(cell)}-${face}`, cell, face, type: 'frame' }];
    }),
  );
}

function singleSocket(
  id: string,
  type: StructuralSocket['type'],
  cell: Vec3i,
  face: Face,
): StructuralSocket {
  return { id, type, cell, face };
}

const oneCell = [ORIGIN];

/** Long Spikes: origin cell plus the one it reaches into, along local +Z. */
const SPIKE_CELLS: Vec3i[] = [ORIGIN, v(0, 0, 1)];

/** Bulldozer Blade: three cells across the nose, centred on the origin. */
const BLADE_3X1_CELLS: Vec3i[] = [v(-1, 0, 0), ORIGIN, v(1, 0, 0)];

/** Phase Drive: a two-cell coil rail lying along the part's forward axis. */
const RAIL_2X1_CELLS: Vec3i[] = [ORIGIN, v(0, 0, 1)];

/**
 * A 2x2 pad in the horizontal plane, back edge on local -Z: the area the
 * sawblade sweeps through, and the barbette the Heavy Cannon is bolted across.
 */
const PAD_2X2_CELLS: Vec3i[] = [ORIGIN, v(1, 0, 0), v(0, 0, 1), v(1, 0, 1)];

/** One cell of headroom over every cell of a footprint. */
function headroom(cells: readonly Vec3i[]): Vec3i[] {
  return cells.map((cell) => v(cell.x, cell.y + 1, cell.z));
}

/** A downward hardpoint under every cell of a footprint. */
function hardpointsBelow(cells: readonly Vec3i[]): StructuralSocket[] {
  return cells.map((cell) =>
    singleSocket(`hardpoint-${cellId(cell)}-ny`, 'frame', cell, 'ny'),
  );
}

/** The four turns about the vertical axis, for parts that must stay level. */
const YAW_ORIENTATIONS: OrientationIndex[] = [0, 1, 2, 3].map((quarter) =>
  orientationFromSteps(0, quarter, 0),
);

/**
 * Every upgradeable part runs the same five-unlock chain (see
 * `core/partUpgrades.ts`), so the garage's star rating means the same thing on
 * a frame box as on a heavy cannon: one star per unlock bought, five at most.
 * `cost` is the part's shelf price; the first unlock asks a bit over half of it
 * and each one after that is 1.6x the last.
 *
 * Separately, each non-starter part below also carries a one-time `unlockCost`
 * — the price to add it to the store before it can be bought at all. That used
 * to be picked independently of shelf price, which let the cheapest early
 * parts (a reinforced frame, an off-road wheel) cost more to unlock than a
 * late-game weapon costs to own outright. It now tracks `cost` directly:
 * roughly 1x for the cheap early tier that should never gate a new player,
 * climbing to ~1.3x for the weapons a full run builds toward. Defence parts
 * (armour) sit at the low end of that band so surviving isn't the thing
 * players are priced out of first.
 */
function upgrade(cost: number) {
  return {
    maxLevel: MAX_PART_LEVEL,
    basePrice: Math.round(cost * 0.6),
    priceGrowth: 1.6,
  };
}

export function wheelAxleWorld(orient: OrientationIndex): Vec3i {
  return rotateVec(orient, WHEEL_AXLE_LOCAL);
}

export function wheelSuspensionWorld(orient: OrientationIndex): Vec3i {
  return rotateVec(orient, WHEEL_SUSPENSION_LOCAL);
}

export const PART_CATALOG: Record<string, PartDefinition> = {
  'chassis-core': {
    id: 'chassis-core',
    name: 'Chassis Core',
    category: 'structural',
    description: 'Root structural block for the vehicle.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell),
    massKg: 60,
    health: 400,
    cost: 0,
    // The core is free to own but not free to harden: it is the one block the
    // rig cannot lose, so its five unlocks are priced off what they protect
    // rather than off its (zero) shelf price.
    upgrade: upgrade(60),
    reinforcement: 1.5,
    unique: true,
    isRoot: true,
  },
  'frame-box': {
    id: 'frame-box',
    name: 'Frame Box',
    category: 'structural',
    description: 'Standard structural frame block.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell),
    massKg: 25,
    health: 150,
    cost: 10,
    upgrade: upgrade(10),
    reinforcement: 1,
  },
  'frame-reinforced': {
    id: 'frame-reinforced',
    name: 'Reinforced Frame',
    category: 'structural',
    description: 'Heavy frame block with strong connections.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell),
    massKg: 85,
    health: 320,
    cost: 25,
    upgrade: upgrade(25),
    unlockCost: 80,
    reinforcement: 2,
  },
  'wheel-standard': {
    id: 'wheel-standard',
    name: 'Standard Wheel',
    category: 'movement',
    description: 'Responsive road wheel with high-grip handling.',
    cells: oneCell,
    clearanceCells: [v(0, -1, 0)],
    // Side-mounted (px) for a left/right pair, or front/back (pz/nz) to hang
    // it centred off a single block like a motorcycle fork.
    sockets: [
      singleSocket('wheel-mount-px', 'frame', ORIGIN, 'px'),
      singleSocket('wheel-mount-pz', 'frame', ORIGIN, 'pz'),
      singleSocket('wheel-mount-nz', 'frame', ORIGIN, 'nz'),
    ],
    massKg: 28,
    health: 90,
    cost: 18,
    upgrade: upgrade(18),
    reinforcement: 1,
    wheel: {
      radius: 0.3,
      width: 0.22,
      axleAxis: WHEEL_AXLE_LOCAL,
      suspensionDir: WHEEL_SUSPENSION_LOCAL,
      maxSteerAngleDeg: 40,
      driveTorqueLimit: 2600,
      brakeTorque: 1400,
      frictionLong: 1,
      frictionLat: 1.05,
      maxLoad: 9000,
      suspension: {
        restLength: 0.35,
        travel: 0.22,
        stiffness: 42000,
        damping: 3200,
        maxLoad: 8000,
      },
    },
  },
  'wheel-offroad': {
    id: 'wheel-offroad',
    name: 'Off-road Wheel',
    category: 'movement',
    description: 'Large high-grip wheel for rough ground.',
    cells: oneCell,
    clearanceCells: [v(0, -1, 0)],
    sockets: [
      singleSocket('wheel-mount-px', 'frame', ORIGIN, 'px'),
      singleSocket('wheel-mount-pz', 'frame', ORIGIN, 'pz'),
      singleSocket('wheel-mount-nz', 'frame', ORIGIN, 'nz'),
    ],
    massKg: 44,
    health: 130,
    cost: 32,
    upgrade: upgrade(32),
    unlockCost: 120,
    reinforcement: 1,
    wheel: {
      radius: 0.42,
      width: 0.3,
      axleAxis: WHEEL_AXLE_LOCAL,
      suspensionDir: WHEEL_SUSPENSION_LOCAL,
      maxSteerAngleDeg: 32,
      driveTorqueLimit: 3400,
      brakeTorque: 1800,
      frictionLong: 1.15,
      frictionLat: 1,
      maxLoad: 14000,
      suspension: {
        restLength: 0.45,
        travel: 0.3,
        stiffness: 56000,
        damping: 4300,
        maxLoad: 12500,
      },
    },
  },
  'wheel-moto': {
    id: 'wheel-moto',
    name: 'Motorcycle Wheel',
    category: 'movement',
    description:
      'Thin racing wheel. Very light and turns hard, but buckles under load.',
    cells: oneCell,
    clearanceCells: [v(0, -1, 0)],
    sockets: [
      singleSocket('wheel-mount-px', 'frame', ORIGIN, 'px'),
      singleSocket('wheel-mount-pz', 'frame', ORIGIN, 'pz'),
      singleSocket('wheel-mount-nz', 'frame', ORIGIN, 'nz'),
    ],
    massKg: 12,
    health: 45,
    cost: 24,
    upgrade: upgrade(24),
    unlockCost: 90,
    reinforcement: 1,
    wheel: {
      radius: 0.36,
      width: 0.1,
      axleAxis: WHEEL_AXLE_LOCAL,
      suspensionDir: WHEEL_SUSPENSION_LOCAL,
      // Light and eager: a big steering lock and low rolling drag, paid for
      // with a narrow contact patch that lets go early in a hard corner.
      maxSteerAngleDeg: 42,
      driveTorqueLimit: 1500,
      brakeTorque: 900,
      frictionLong: 0.95,
      frictionLat: 0.72,
      maxLoad: 3800,
      suspension: {
        restLength: 0.38,
        travel: 0.26,
        stiffness: 21000,
        damping: 1700,
        maxLoad: 3400,
      },
    },
  },
  'tread-tank': {
    id: 'tread-tank',
    name: 'Tank Tread',
    category: 'movement',
    // Three cells long, so it reads as a belt rather than a wheel and forces
    // the player to commit real chassis length to a tracked build.
    description:
      'Three-block armoured belt. Crawls over anything and shrugs off mines. Very slow flat-out, but launches hard and is nearly indestructible.',
    cells: [v(0, 0, -1), ORIGIN, v(0, 0, 1)],
    clearanceCells: [v(0, -1, -1), v(0, -1, 0), v(0, -1, 1)],
    sockets: frameSockets([v(0, 0, -1), ORIGIN, v(0, 0, 1)]),
    massKg: 190,
    // Stronger: a tracked rig should be the tankiest way to roll.
    health: 620,
    cost: 85,
    upgrade: upgrade(85),
    unlockCost: 220,
    reinforcement: 2.6,
    wheel: {
      // A smaller effective drive radius does two things at once: it lowers the
      // flat-out top speed (surface speed = ω·r) while raising the tractive
      // force for the same engine torque (F = torque/r). That is exactly the
      // "slow but grunty" tread feel — more acceleration, lower top speed.
      radius: 0.28,
      width: 0.34,
      axleAxis: WHEEL_AXLE_LOCAL,
      suspensionDir: WHEEL_SUSPENSION_LOCAL,
      // A belt does not angle its hub; it turns by driving one side harder
      // than the other. Lateral grip is deliberately below longitudinal so the
      // rig can pivot instead of digging in.
      maxSteerAngleDeg: 0,
      skidSteer: true,
      // Track gearing, ~61 km/h. Restores the "very slow flat-out" character
      // that used to fall out of the belts wasting their torque on wheelspin:
      // once that runaway was bounded a tracked rig briefly out-ran a car.
      maxSurfaceSpeedMps: 17,
      // Raised so more of the engine's low-gear torque actually reaches the
      // ground before the per-wheel clamp bites: quicker launches.
      driveTorqueLimit: 7200,
      brakeTorque: 4200,
      frictionLong: 1.5,
      frictionLat: 0.8,
      maxLoad: 36000,
      suspension: {
        restLength: 0.4,
        travel: 0.14,
        stiffness: 105000,
        damping: 7600,
        maxLoad: 34000,
      },
    },
  },
  'engine-small': {
    id: 'engine-small',
    name: 'Small Engine',
    category: 'functional',
    description: 'Compact combustion engine.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell, {
      ny: singleSocket('engine-mount-ny', 'frame', ORIGIN, 'ny'),
    }),
    massKg: 120,
    health: 120,
    cost: 60,
    upgrade: upgrade(60),
    reinforcement: 1,
    // Engines carry a small internal fuel reserve so an engine-only build can
    // still drive; fuel-tank blocks extend total onboard fuel from there.
    fuelCapacity: 15,
    engine: {
      torqueCurve: [
        [800, 140],
        [2500, 210],
        [4500, 190],
        [6000, 120],
      ],
      maxRpm: 6000,
      idleRpm: 800,
      maxPowerKw: 95,
      // Burns a tank in a couple of minutes of driving — a light but real
      // resource that keeps refuel crates relevant.
      fuelPerSecondAtFull: 0.27,
    },
  },
  'fuel-tank': {
    id: 'fuel-tank',
    name: 'Fuel Tank',
    category: 'functional',
    description: 'Fuel storage tank counted with fuel mass.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell),
    massKg: 55,
    health: 80,
    cost: 20,
    upgrade: upgrade(20),
    reinforcement: 1,
    fuelCapacity: 50,
  },
  'mine-sweeper': {
    id: 'mine-sweeper',
    name: 'Mine Sweeper',
    category: 'functional',
    description: 'Reveals nearby buried mines.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell),
    massKg: 35,
    health: 90,
    cost: 180,
    upgrade: upgrade(120),
    unlockCost: 180,
    reinforcement: 1,
    unique: true,
  },
  turret: {
    id: 'turret',
    name: 'Turret',
    category: 'weapon',
    description:
      'Rotating weapon turret. It hunts and shoots zombies in range on its ' +
      'own; click to pull it onto your cursor instead.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 85,
    health: 140,
    cost: 150,
    upgrade: upgrade(150),
    reinforcement: 1,
    weapon: {
      mountType: 'turret',
      // Self-acquiring, like every gun on the rig: it works the horde without
      // input, and a click overrides it onto the player's cursor point.
      aimMode: 'auto',
      arcDeg: 360,
      damageType: 'hitscan',
      damage: 3,
      fireRate: 7,
      recoilImpulse: 40,
      projectileSpeed: 140,
      rangeM: 8,
    },
  },
  'armour-plate': {
    id: 'armour-plate',
    name: 'Armour Plate',
    category: 'protection',
    description: 'Heavy reinforced plate that strengthens an exposed section.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell),
    massKg: 95,
    health: 220,
    cost: 50,
    upgrade: upgrade(120),
    // Starter part (see STARTER_UNLOCKS) — no unlockCost, armour is available
    // to field from the very first build so defence is never gated behind
    // store cash on top of the shelf price.
    reinforcement: 2.5,
    armour: {
      faceMounted: false,
      protection: 24,
      cosmetic: false,
    },
  },
  'cannon-heavy': {
    id: 'cannon-heavy',
    name: 'Heavy Cannon',
    category: 'weapon',
    description:
      'Slow, devastating cannon on a two-by-two barbette. It shells zombies ' +
      'in range on its own; click to aim it where you want the blast instead.',
    // A four-cell pad, not a hardpoint: the gun is the size it looks, so it
    // costs real deck space and is bolted down across all four cells.
    cells: PAD_2X2_CELLS,
    clearanceCells: headroom(PAD_2X2_CELLS),
    sockets: hardpointsBelow(PAD_2X2_CELLS),
    // Four cells of cast turret: heavier than any other gun, and tough enough
    // that the extra surface zombies can reach does not make it fragile.
    massKg: 240,
    health: 300,
    cost: 340,
    upgrade: upgrade(340),
    unlockCost: 400,
    reinforcement: 1.25,
    weapon: {
      mountType: 'turret',
      // Self-acquiring like the Zombie Blaster, but every shell is an
      // explosion: the direct hit is only part of the damage, and a near miss
      // still kills. Its slow fire rate is what keeps that in check.
      aimMode: 'auto',
      arcDeg: 360,
      damageType: 'projectile',
      damage: 40,
      fireRate: 0.7,
      // Heavy enough to visibly shove the rig when it goes off.
      recoilImpulse: 900,
      projectileSpeed: 260,
      // Short of the sniper's reach on purpose: the blast is the payoff, so
      // the gun has to be brought into the fight rather than shelling from
      // across the map.
      rangeM: 20,
      splashRadiusM: 4.5,
      splashDamage: 26,
    },
  },
  'ice-cannon': {
    id: 'ice-cannon',
    name: 'Ice Cannon',
    category: 'weapon',
    description:
      'Cryo emitter. Auto-fires ice shards that chill and slow zombies, and ' +
      'fills an ability slot with a Cryo Nova that flash-freezes the nearest ' +
      'ones solid (22s cooldown); upgrades freeze more zombies for longer.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 110,
    health: 150,
    cost: 300,
    upgrade: upgrade(300),
    unlockCost: 380,
    reinforcement: 1.15,
    // Normal fire: an auto-aim cryo turret whose shards slow zombies on hit.
    // A control weapon, not a damage dealer — its damage is deliberately kept
    // well under the basic turret's, so it earns its slot by holding the horde
    // still for the guns that do the killing.
    weapon: {
      mountType: 'turret',
      aimMode: 'auto',
      arcDeg: 360,
      damageType: 'projectile',
      damage: 4,
      fireRate: 2.5,
      recoilImpulse: 30,
      projectileSpeed: 150,
      // Short reach: the chill lands on what is already closing in, not on
      // the far edge of the horde.
      rangeM: 12,
      slowFactor: 0.35,
      slowDurationSeconds: 3,
    },
    // Payload for the Cryo Nova special: SurvivalMode folds this into the
    // base nova when the part is fitted, independently of the normal fire.
    ability: {
      kind: 'freeze',
      cooldownSeconds: 22,
      rangeM: 18,
      baseTargets: 3,
      baseDurationSeconds: 4,
    },
  },
  'tesla-coil': {
    id: 'tesla-coil',
    name: 'Tesla Coil',
    category: 'weapon',
    description:
      'Arc emitter. Auto-fires blue lightning zaps that deal moderate damage. ' +
      'Press Q to detonate a lightning blast around the vehicle, hitting every ' +
      'zombie in a bubble-sized radius (14s cooldown); upgrades hit harder.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 115,
    health: 150,
    cost: 300,
    upgrade: upgrade(300),
    unlockCost: 550,
    reinforcement: 1.15,
    // Normal fire: an auto-aim turret that snaps blue lightning zaps at zombies.
    weapon: {
      mountType: 'turret',
      aimMode: 'auto',
      arcDeg: 360,
      damageType: 'hitscan',
      damage: 14,
      fireRate: 3,
      recoilImpulse: 30,
      projectileSpeed: 200,
      rangeM: 16,
      tracerStyle: 'electric',
    },
    // Player-triggered active ability: a lightning blast around the vehicle,
    // driven off Q by SurvivalMode independently of the normal fire above.
    ability: {
      kind: 'zap',
      cooldownSeconds: 14,
      baseDurationSeconds: 0,
      baseDamage: 90,
    },
  },
  'barrel-drum': {
    id: 'barrel-drum',
    name: 'Barrel Drum',
    category: 'weapon',
    description:
      'Heavy three-block grinder drum that shreds any zombie it touches.',
    cells: [v(-1, 0, 0), ORIGIN, v(1, 0, 0)],
    clearanceCells: [],
    sockets: frameSockets([v(-1, 0, 0), ORIGIN, v(1, 0, 0)]),
    massKg: 240,
    health: 360,
    // Priced above the other early melee options: three blocks of armoured
    // drum that shreds on contact is a heavier commitment than a sniper or
    // flamethrower slot, so both its unlock and shelf price sit higher.
    cost: 275,
    upgrade: upgrade(275),
    unlockCost: 250,
    reinforcement: 1.5,
    melee: {
      damage: 45,
    },
  },
  'spike-ram': {
    id: 'spike-ram',
    name: 'Long Spikes',
    category: 'weapon',
    description:
      'A long, heavy pike that impales anything it touches. Two blocks of ' +
      'reach, but a small contact area — line it up.',
    // Two cells deep along the part's forward axis: the pike is as long as it
    // looks, so the footprint the editor blocks out matches the reach.
    cells: SPIKE_CELLS,
    clearanceCells: [],
    // Bolts on by its back plate alone. Melee weapons are terminal — see the
    // socket note on `sawblade`.
    sockets: [singleSocket('spike-mount', 'frame', ORIGIN, 'nz')],
    massKg: 90,
    health: 130,
    cost: 170,
    upgrade: upgrade(170),
    reinforcement: 1,
    melee: {
      damage: 32,
      visual: 'spikes',
    },
  },
  sawblade: {
    id: 'sawblade',
    name: 'Sawblade',
    category: 'weapon',
    description:
      'Big flat blade on a two-by-two mount that sweeps a wide area, sawing ' +
      'through anything it grazes.',
    // A 2x2 pad under the disc: the blade sweeps a full two blocks across, so
    // it reserves the square it actually spins through.
    cells: PAD_2X2_CELLS,
    clearanceCells: [],
    // Only the two back cells carry a socket, and they carry the modelled arm.
    // Nothing bolts onto a spinning blade, so the rest of the pad is bare —
    // `canPlacePart` refuses to support a part on a melee weapon as well.
    sockets: [
      singleSocket('saw-mount-left', 'frame', ORIGIN, 'nz'),
      singleSocket('saw-mount-right', 'frame', v(1, 0, 0), 'nz'),
    ],
    // The disc is always flat and horizontal, so the pad only ever turns about
    // the vertical axis with it.
    allowedOrientations: YAW_ORIENTATIONS,
    massKg: 85,
    health: 120,
    cost: 150,
    upgrade: upgrade(150),
    reinforcement: 1,
    melee: {
      damage: 20,
      visual: 'blade',
    },
  },
  'dozer-blade': {
    id: 'dozer-blade',
    name: 'Bulldozer Blade',
    category: 'weapon',
    description:
      'Three-block plough blade. It barely scratches what it touches — ' +
      'instead it scoops the horde up and carries it along the nose. Drive ' +
      'that load into a wall, a tree or a wreck and the whole pile is ' +
      'flattened at once; the bigger the pile and the faster you hit, the ' +
      'harder it lands.',
    // Three cells across the nose: the catch zone is as wide as the blade
    // looks, so a player can read what it will sweep up off the silhouette.
    cells: BLADE_3X1_CELLS,
    clearanceCells: [],
    // Bolts on by its back face alone, like every melee weapon; only the cell
    // that finds a neighbour behind it carries the load.
    sockets: BLADE_3X1_CELLS.map((cell) =>
      singleSocket(`blade-mount-${cellId(cell)}`, 'frame', cell, 'nz'),
    ),
    // A blade that is not upright is not a blade, so it only ever turns about
    // the vertical axis.
    allowedOrientations: YAW_ORIENTATIONS,
    // The heaviest thing on the nose: the mass is the point, since it is what
    // lets the rig keep pushing a full load instead of bogging down in it.
    massKg: 280,
    health: 380,
    cost: 260,
    upgrade: upgrade(260),
    unlockCost: 340,
    reinforcement: 2,
    // Driving the load into a wall is what the blade is *for*, so it takes a
    // fifth of what a collision would otherwise cost it. Without this the
    // finisher the part is built around is also the thing that destroys it.
    impactResistance: 0.8,
    melee: {
      // Deliberately feeble. A zombie riding the blade takes this and nothing
      // else — see `PlowDefinition`, which also suppresses the speed ram.
      damage: 4,
      visual: 'plow',
      plow: {
        // The catch zone flares a full cell past each end of the blade, so a
        // body clipped by a corner is scooped into the load rather than spat
        // out down the side. Three ride abreast; the rest stack up behind them.
        halfWidthM: 1.5,
        // Deep enough for every rank of a full load — four of them, at the
        // spacing `plowSlots` lays out. Shorten this and the back ranks fall
        // out of the blade's hands and get rammed instead of carried.
        reachM: 2.9,
        capacity: 12,
        // 45 kills a base walker outright; a loaded blade at speed clears
        // several waves' worth of health per body in the pile.
        crushDamage: 45,
        crushDamagePerSpeed: 9,
        // ~18 km/h: below that the blade is a snowplough, not a weapon.
        minCrushSpeedMps: 5,
        pileBonus: 0.1,
      },
    },
  },
  'sniper-light': {
    id: 'sniper-light',
    name: 'Light Sniper',
    category: 'weapon',
    description:
      'Long-range precision turret that picks off thrower zombies first.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 40,
    health: 90,
    cost: 160,
    upgrade: upgrade(160),
    unlockCost: 170,
    reinforcement: 1,
    weapon: {
      mountType: 'turret',
      aimMode: 'auto',
      arcDeg: 360,
      damageType: 'hitscan',
      damage: 50,
      fireRate: 0.2,
      recoilImpulse: 180,
      projectileSpeed: 400,
      rangeM: 40,
      minRangeM: 10,
      targetPriority: 'ranged',
    },
  },
  flamethrower: {
    id: 'flamethrower',
    name: 'Flamethrower',
    category: 'weapon',
    description:
      'Heavy fixed nozzle that periodically sprays a cone of flame ahead. ' +
      'Its fourth upgrade, the Pilot Cluster, also fills an ability slot with ' +
      'Hellfire: the nozzle stays wide open, throwing a hotter, longer, wider ' +
      'sheet of fire with no pause between bursts. 35s cooldown.',
    cells: oneCell,
    clearanceCells: [v(0, 0, 1)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 130,
    health: 120,
    cost: 200,
    upgrade: upgrade(200),
    unlockCost: 230,
    reinforcement: 1,
    weapon: {
      mountType: 'fixed',
      aimMode: 'manual',
      arcDeg: 50,
      damageType: 'aoe',
      damage: 21,
      fireRate: 4,
      recoilImpulse: 30,
      projectileSpeed: 30,
      rangeM: 7,
      coneDeg: 50,
      raysPerShot: 6,
      fireMode: 'periodic',
      burstSeconds: 1.5,
      burstIntervalSeconds: 6.6,
    },
    // Hellfire overcharges this part's own nozzle rather than the whole rig:
    // 7m → 12.6m of reach and a 50° → 80° cone, sprayed continuously instead
    // of in bursts. The multiplier is the smaller half of it — flame burns
    // everything standing in the cone, so an unbroken sheet across a crowd is
    // most of what the ability is worth, and ×1.9 on top of that is plenty.
    //
    // It arrives with the fourth upgrade (level 5, the Pilot Cluster). The
    // nozzle is bought for its own fire; Hellfire is the pay-off near the end
    // of its chain, not a free ability slot on the cheapest flamethrower.
    ability: {
      kind: 'hellfire',
      unlockLevel: 5,
      cooldownSeconds: 35,
      baseDurationSeconds: 4,
      baseDamageMultiplier: 1.1,
      rangeMultiplier: 1.8,
      coneMultiplier: 1.6,
    },
  },
  'shield-generator': {
    id: 'shield-generator',
    name: 'Shield Generator',
    category: 'weapon',
    description:
      'Defensive emitter. Fills an ability slot: raise a bright blue bubble ' +
      'that makes the whole vehicle invulnerable for a few seconds. 25s ' +
      'cooldown; upgrades extend how long the shield holds.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 120,
    health: 160,
    cost: 320,
    upgrade: upgrade(320),
    unlockCost: 400,
    reinforcement: 1.15,
    // Ability payload only (no `weapon`): SurvivalMode grants the vehicle
    // temporary invulnerability when this ability's slot key is pressed.
    ability: {
      kind: 'shield',
      cooldownSeconds: 25,
      baseDurationSeconds: 4,
    },
  },
  'mind-control-beam': {
    id: 'mind-control-beam',
    name: 'Mind Control Beam',
    category: 'weapon',
    description:
      'Psychic emitter. It never shoots on its own — press Q to mind-control ' +
      'up to 5 nearby zombies into fighting for you for a while, then the ' +
      'control wears off and they turn hostile again (28s cooldown); upgrades ' +
      'keep them on your side longer.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 105,
    health: 140,
    cost: 320,
    upgrade: upgrade(320),
    unlockCost: 600,
    reinforcement: 1.15,
    // Player-triggered active ability only (no `weapon` payload): the beam does
    // nothing on its own; SurvivalMode charms the nearest zombies off the Q key.
    ability: {
      kind: 'charm',
      cooldownSeconds: 28,
      rangeM: 14,
      baseTargets: 5,
      baseDurationSeconds: 12,
    },
  },
  'missile-launcher': {
    id: 'missile-launcher',
    name: 'Missile Launcher',
    category: 'weapon',
    description:
      'Rocket battery. Auto-fires small rockets that burst for splash damage ' +
      'on impact. Press Q to launch one big rocket that drops on the thickest ' +
      'part of the horde for massive blast damage (18s cooldown); upgrades hit ' +
      'harder.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 160,
    health: 150,
    cost: 340,
    upgrade: upgrade(340),
    unlockCost: 700,
    reinforcement: 1.15,
    // Normal fire: an auto-aim turret lobbing small splash rockets at zombies.
    weapon: {
      mountType: 'turret',
      aimMode: 'auto',
      arcDeg: 360,
      damageType: 'projectile',
      damage: 10,
      fireRate: 1.2,
      recoilImpulse: 60,
      projectileSpeed: 90,
      rangeM: 22,
      splashRadiusM: 2.6,
      splashDamage: 14,
    },
    // Player-triggered active ability: SurvivalMode launches a big rocket that
    // detonates a high-damage blast on the densest cluster off the Q key.
    ability: {
      kind: 'rocket',
      cooldownSeconds: 18,
      baseDurationSeconds: 0,
      rangeM: 5,
      baseDamage: 170,
    },
  },
  'thumper': {
    id: 'thumper',
    name: 'Thumper',
    category: 'weapon',
    description:
      'Ground-pound slammer. Press Q to blast a shockwave outward that knocks ' +
      'every zombie in a moderate circle away from you (12s cooldown); upgrades ' +
      'crank up the knockback so they get flung harder and farther.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 110,
    health: 140,
    cost: 300,
    upgrade: upgrade(300),
    unlockCost: 550,
    reinforcement: 1.15,
    // Player-triggered active ability only (no `weapon` payload): SurvivalMode
    // shoves every nearby zombie radially outward off the Q key. `baseDamage`
    // carries the level-1 knockback speed (m/s); `rangeM` is the blast radius.
    ability: {
      kind: 'thump',
      cooldownSeconds: 12,
      baseDurationSeconds: 0,
      rangeM: 5,
      baseDamage: 14,
    },
  },
  'pulse-emitter': {
    id: 'pulse-emitter',
    name: 'Pulse Emitter',
    category: 'weapon',
    description:
      'Kinetic slammer. Fills an ability slot: punch out a ring of force ' +
      'that damages every zombie around the rig and throws the survivors ' +
      'clear. 18s cooldown; upgrades hit harder and reach further.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 130,
    health: 150,
    cost: 300,
    upgrade: upgrade(300),
    unlockCost: 380,
    reinforcement: 1.15,
    // The panic button for a rig that has been swarmed: no aim, no travel
    // time, everything within the ring takes it at once.
    ability: {
      kind: 'pulse',
      cooldownSeconds: 18,
      baseDurationSeconds: 0,
      rangeM: 9,
      baseDamage: 60,
    },
  },
  'nitro-injector': {
    id: 'nitro-injector',
    name: 'Nitro Injector',
    category: 'weapon',
    description:
      'Strapped-on rocket bottle. Fills an ability slot: five seconds of raw ' +
      'thrust that shoves the rig along whether you are on the throttle or ' +
      'not, plus triple drive torque and a lifted speed limit. 20s cooldown; ' +
      'upgrades run longer and push harder.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 95,
    health: 120,
    cost: 260,
    upgrade: upgrade(260),
    unlockCost: 340,
    reinforcement: 1.1,
    // Multiplies drive torque rather than granting speed directly, so it pays
    // off exactly where ramming does: heavy rigs digging out of a crowd.
    ability: {
      kind: 'overdrive',
      cooldownSeconds: 20,
      baseDurationSeconds: 5,
      // A shove, not a nudge: triple torque hauls even a heavy rig out of a
      // crowd, and the ceiling lift is what makes it read as speed rather
      // than just quicker acceleration into the same wall.
      baseTorqueMultiplier: 3.2,
      baseTopSpeedMultiplier: 1.35,
      // Propellant: fires through the chassis, so it still shoves when the
      // driver is coasting or the wheels are bogged in a crowd.
      baseThrustAccel: 16,
    },
  },
  'phase-drive': {
    id: 'phase-drive',
    name: 'Phase Drive',
    category: 'weapon',
    description:
      'Displacement coil on a two-block rail. Fills an ability slot: blink ten ' +
      'metres straight ahead, passing clean through zombies, wrecks and ' +
      'scenery — only the arena wall stops it. 7s cooldown; upgrades blink ' +
      'further.',
    // Two cells along the part's forward axis: the accelerator rail is as long
    // as it looks, and pointing the coil stack costs real deck space.
    cells: RAIL_2X1_CELLS,
    clearanceCells: headroom(RAIL_2X1_CELLS),
    sockets: hardpointsBelow(RAIL_2X1_CELLS),
    massKg: 85,
    health: 110,
    cost: 280,
    upgrade: upgrade(280),
    unlockCost: 360,
    reinforcement: 1.1,
    // The escape hatch nitro is not: no wind-up, no traction needed, and it
    // ignores the wall of bodies that has the rig pinned. The short cooldown is
    // what makes it a driving tool rather than a panic button — so the distance
    // stays modest and upgrades buy reach, never a faster recharge.
    ability: {
      kind: 'phase',
      cooldownSeconds: 7,
      // Instant: the blink is a teleport, so there is no window to scale.
      baseDurationSeconds: 0,
      rangeM: 10,
    },
  },
};

export function getPartDef(id: string): PartDefinition {
  const def = PART_CATALOG[id];
  if (def === undefined) throw new Error(`unknown part definition: ${id}`);
  return def;
}
