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
    sockets: [singleSocket('wheel-mount-px', 'frame', ORIGIN, 'px')],
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
      maxSteerAngleDeg: 34,
      driveTorqueLimit: 2600,
      brakeTorque: 1400,
      frictionLong: 1,
      frictionLat: 0.95,
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
    sockets: [singleSocket('wheel-mount-px', 'frame', ORIGIN, 'px')],
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
  'driver-seat': {
    id: 'driver-seat',
    name: 'Driver Seat',
    category: 'functional',
    description: 'Control seat including driver mass.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell),
    massKg: 30,
    health: 80,
    cost: 0,
    upgrade: upgrade(3, 0),
    reinforcement: 1,
    unique: true,
    providesControl: true,
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
      fuelPerSecondAtFull: 0.03,
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
    fuelCapacity: 40,
  },
  turret: {
    id: 'turret',
    name: 'Turret',
    category: 'weapon',
    description: 'Rotating weapon turret.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 85,
    health: 140,
    cost: 90,
    upgrade: upgrade(5, 90),
    reinforcement: 1,
    ammoCapacity: 200,
    batteryCapacity: 500,
    weapon: {
      mountType: 'turret',
      aimMode: 'auto',
      arcDeg: 360,
      damageType: 'hitscan',
      damage: 4,
      fireRate: 12,
      ammoPerShot: 1,
      powerPerShot: 2,
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
    description: 'Slow, powerful manually aimed cannon with a long barrel.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'frame', ORIGIN, 'ny')],
    massKg: 140,
    health: 160,
    cost: 260,
    upgrade: upgrade(5, 260),
    unlockCost: 500,
    reinforcement: 1.25,
    ammoCapacity: 40,
    batteryCapacity: 600,
    weapon: {
      mountType: 'turret',
      aimMode: 'manual',
      arcDeg: 120,
      damageType: 'projectile',
      damage: 55,
      fireRate: 0.8,
      ammoPerShot: 1,
      powerPerShot: 12,
      recoilImpulse: 520,
      projectileSpeed: 260,
      rangeM: 30,
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
      damage: 60,
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
    upgrade: upgrade(5, 160),
    unlockCost: 350,
    reinforcement: 1,
    ammoCapacity: 60,
    batteryCapacity: 400,
    weapon: {
      mountType: 'turret',
      aimMode: 'auto',
      arcDeg: 360,
      damageType: 'hitscan',
      damage: 60,
      fireRate: 0.2,
      ammoPerShot: 1,
      powerPerShot: 6,
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
    cost: 180,
    upgrade: upgrade(5, 180),
    unlockCost: 450,
    reinforcement: 1,
    ammoCapacity: 120,
    batteryCapacity: 400,
    weapon: {
      mountType: 'fixed',
      aimMode: 'manual',
      arcDeg: 50,
      damageType: 'aoe',
      damage: 16,
      fireRate: 4,
      ammoPerShot: 1,
      powerPerShot: 2,
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
};

export function getPartDef(id: string): PartDefinition {
  const def = PART_CATALOG[id];
  if (def === undefined) throw new Error(`unknown part definition: ${id}`);
  return def;
}
