import type { Face, PartDefinition, StructuralSocket, Vec3i } from './types.ts';
import { ALL_FACES, rotateVec } from './grid.ts';
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

function upgrade(maxLevel: number, cost: number) {
  return { maxLevel, basePrice: Math.round(cost * 0.6), priceGrowth: 1.6 };
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
    upgrade: upgrade(3, 0),
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
    upgrade: upgrade(3, 10),
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
    upgrade: upgrade(3, 25),
    unlockCost: 150,
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
    upgrade: upgrade(5, 18),
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
    upgrade: upgrade(5, 32),
    unlockCost: 250,
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
    upgrade: upgrade(5, 24),
    unlockCost: 180,
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
    upgrade: upgrade(5, 85),
    unlockCost: 450,
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
    upgrade: upgrade(5, 60),
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
    upgrade: upgrade(3, 20),
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
    upgrade: upgrade(3, 120),
    unlockCost: 220,
    reinforcement: 1,
    unique: true,
  },
  turret: {
    id: 'turret',
    name: 'Turret',
    category: 'weapon',
    description:
      'Rotating weapon turret. Point and click: the mount swings to your cursor and fires wherever you aim.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 85,
    health: 140,
    cost: 150,
    upgrade: upgrade(5, 150),
    reinforcement: 1,
    weapon: {
      mountType: 'turret',
      // Player-aimed: the mount tracks the cursor and shoots exactly where it
      // points, so hitting anything is on the player rather than on a lock-on.
      aimMode: 'manual',
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
    cost: 120,
    upgrade: upgrade(5, 120),
    unlockCost: 200,
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
      'Slow, devastating cannon. Point and click: the shell detonates where it ' +
      'lands and shreds everything caught in the blast.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 140,
    health: 160,
    cost: 340,
    upgrade: upgrade(5, 340),
    unlockCost: 500,
    reinforcement: 1.25,
    weapon: {
      mountType: 'turret',
      // Player-aimed like the Zombie Blaster, but every shell is an explosion:
      // the direct hit is only part of the damage, and a near miss still kills.
      aimMode: 'manual',
      arcDeg: 360,
      damageType: 'projectile',
      damage: 40,
      fireRate: 0.7,
      // Heavy enough to visibly shove the rig when it goes off.
      recoilImpulse: 900,
      projectileSpeed: 260,
      rangeM: 30,
      splashRadiusM: 4.5,
      splashDamage: 26,
    },
  },
  'ice-cannon': {
    id: 'ice-cannon',
    name: 'Ice Cannon',
    category: 'weapon',
    description:
      'Cryo emitter. Auto-fires ice shards that chill and slow zombies. ' +
      'Press Q to flash-freeze the nearest zombies solid (22s cooldown); ' +
      'upgrades freeze more zombies for longer.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 110,
    health: 150,
    cost: 300,
    upgrade: upgrade(5, 300),
    unlockCost: 600,
    reinforcement: 1.15,
    // Normal fire: an auto-aim cryo turret whose shards slow zombies on hit.
    weapon: {
      mountType: 'turret',
      aimMode: 'auto',
      arcDeg: 360,
      damageType: 'projectile',
      damage: 6,
      fireRate: 2.5,
      recoilImpulse: 30,
      projectileSpeed: 150,
      rangeM: 18,
      slowFactor: 0.5,
      slowDurationSeconds: 2.5,
    },
    // Player-triggered active ability: the full flash-freeze, driven off Q by
    // SurvivalMode independently of the normal fire above.
    ability: {
      kind: 'freeze',
      cooldownSeconds: 22,
      rangeM: 18,
      baseTargets: 3,
      baseDurationSeconds: 4,
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
    cost: 200,
    upgrade: upgrade(5, 200),
    unlockCost: 400,
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
      'A long, heavy pike that impales anything it touches. Long reach, but a small contact area — line it up.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell),
    massKg: 90,
    health: 130,
    cost: 170,
    upgrade: upgrade(5, 170),
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
      'Big flat blade that sweeps a wide area, sawing through anything it grazes.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell),
    massKg: 85,
    health: 120,
    cost: 150,
    upgrade: upgrade(5, 150),
    reinforcement: 1,
    melee: {
      damage: 20,
      visual: 'blade',
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
    cost: 220,
    upgrade: upgrade(5, 220),
    unlockCost: 350,
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
      'Heavy fixed nozzle that periodically sprays a cone of flame ahead.',
    cells: oneCell,
    clearanceCells: [v(0, 0, 1)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 130,
    health: 120,
    cost: 260,
    upgrade: upgrade(5, 260),
    unlockCost: 450,
    reinforcement: 1,
    weapon: {
      mountType: 'fixed',
      aimMode: 'manual',
      arcDeg: 50,
      damageType: 'aoe',
      damage: 9,
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
  },
  'shield-generator': {
    id: 'shield-generator',
    name: 'Shield Generator',
    category: 'weapon',
    description:
      'Defensive emitter. Press Q to raise a bright blue bubble that makes ' +
      'the whole vehicle invulnerable for a few seconds. 25s cooldown; ' +
      'upgrades extend how long the shield holds.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 120,
    health: 160,
    cost: 320,
    upgrade: upgrade(5, 320),
    unlockCost: 650,
    reinforcement: 1.15,
    // Player-triggered active ability only (no `weapon` payload): SurvivalMode
    // grants the vehicle temporary invulnerability off the Q key.
    ability: {
      kind: 'shield',
      cooldownSeconds: 25,
      baseDurationSeconds: 4,
    },
  },
};

export function getPartDef(id: string): PartDefinition {
  const def = PART_CATALOG[id];
  if (def === undefined) throw new Error(`unknown part definition: ${id}`);
  return def;
}
