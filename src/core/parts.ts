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

function frameSockets(cells: readonly Vec3i[], overrides: Partial<Record<Face, StructuralSocket>> = {}): StructuralSocket[] {
  const occupied = new Set(cells.map((cell) => `${cell.x},${cell.y},${cell.z}`));
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
      if (occupied.has(`${neighbour.x},${neighbour.y},${neighbour.z}`)) return [];
      const override = overrides[face];
      return override
        ? [{ ...override, cell, face }]
        : [{ id: `frame-${cellId(cell)}-${face}`, cell, face, type: 'frame' }];
    }),
  );
}

function singleSocket(id: string, type: StructuralSocket['type'], cell: Vec3i, face: Face): StructuralSocket {
  return { id, type, cell, face };
}

const oneCell = [ORIGIN];
const beamCells = [v(0, 0, 0), v(0, 0, 1), v(0, 0, 2)];

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
    reinforcement: 1,
  },
  'frame-light': {
    id: 'frame-light',
    name: 'Light Frame',
    category: 'structural',
    description: 'Lightweight frame block with weaker connections.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell),
    massKg: 12,
    health: 70,
    cost: 8,
    reinforcement: 0.6,
  },
  'frame-reinforced': {
    id: 'frame-reinforced',
    name: 'Reinforced Frame',
    category: 'structural',
    description: 'Heavy frame block with strong connections.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell),
    massKg: 45,
    health: 320,
    cost: 25,
    reinforcement: 2,
  },
  'beam-long': {
    id: 'beam-long',
    name: 'Long Beam',
    category: 'structural',
    description: 'Three-cell structural beam.',
    cells: beamCells,
    clearanceCells: [],
    sockets: frameSockets(beamCells),
    massKg: 55,
    health: 220,
    cost: 22,
    reinforcement: 1,
  },
  'wheel-mount': {
    id: 'wheel-mount',
    name: 'Wheel Mount',
    category: 'structural',
    description: 'Structural block with left and right wheel mount sockets.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell, {
      px: singleSocket('wm-px', 'wheel-mount', ORIGIN, 'px'),
      nx: singleSocket('wm-nx', 'wheel-mount', ORIGIN, 'nx'),
    }),
    massKg: 18,
    health: 140,
    cost: 15,
    reinforcement: 1,
  },
  'engine-mount': {
    id: 'engine-mount',
    name: 'Engine Mount',
    category: 'structural',
    description: 'Structural block with a top engine mount socket.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell, {
      py: singleSocket('engine-py', 'engine-mount', ORIGIN, 'py'),
    }),
    massKg: 20,
    health: 160,
    cost: 15,
    reinforcement: 1,
  },
  hardpoint: {
    id: 'hardpoint',
    name: 'Hardpoint',
    category: 'structural',
    description: 'Structural weapon mount block.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell, {
      py: singleSocket('hardpoint-py', 'hardpoint', ORIGIN, 'py'),
    }),
    massKg: 15,
    health: 120,
    cost: 20,
    reinforcement: 1,
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
      ny: singleSocket('engine-mount-ny', 'engine-mount', ORIGIN, 'ny'),
    }),
    requiresMount: 'engine-mount',
    massKg: 120,
    health: 120,
    cost: 60,
    reinforcement: 1,
    engine: {
      torqueCurve: [[800, 140], [2500, 210], [4500, 190], [6000, 120]],
      maxRpm: 6000,
      idleRpm: 800,
      maxPowerKw: 95,
      fuelPerSecondAtFull: 0.03,
    },
  },
  'engine-big': {
    id: 'engine-big',
    name: 'Big Engine',
    category: 'functional',
    description: 'Heavy high-output combustion engine.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell, {
      ny: singleSocket('engine-mount-ny', 'engine-mount', ORIGIN, 'ny'),
    }),
    requiresMount: 'engine-mount',
    massKg: 300,
    health: 200,
    cost: 140,
    reinforcement: 1,
    engine: {
      torqueCurve: [[800, 320], [2200, 480], [4200, 430], [5500, 260]],
      maxRpm: 5500,
      idleRpm: 800,
      maxPowerKw: 210,
      fuelPerSecondAtFull: 0.07,
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
    health: 60,
    cost: 20,
    reinforcement: 1,
    fuelCapacity: 40,
  },
  battery: {
    id: 'battery',
    name: 'Battery',
    category: 'functional',
    description: 'Electrical storage module.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell),
    massKg: 40,
    health: 70,
    cost: 25,
    reinforcement: 1,
    batteryCapacity: 500,
  },
  'ammo-box': {
    id: 'ammo-box',
    name: 'Ammo Box',
    category: 'functional',
    description: 'Ammunition storage module.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell),
    massKg: 50,
    health: 60,
    cost: 30,
    reinforcement: 1,
    ammoCapacity: 200,
  },
  'cargo-crate': {
    id: 'cargo-crate',
    name: 'Cargo Crate',
    category: 'functional',
    description: 'Cargo storage crate.',
    cells: oneCell,
    clearanceCells: [],
    sockets: frameSockets(oneCell),
    massKg: 20,
    health: 90,
    cost: 12,
    reinforcement: 1,
    cargoCapacity: 150,
  },
  'wheel-standard': {
    id: 'wheel-standard',
    name: 'Standard Wheel',
    category: 'movement',
    description: 'Road wheel with integrated suspension preset support.',
    cells: oneCell,
    clearanceCells: [v(0, -1, 0)],
    sockets: [singleSocket('wheel-mount-px', 'wheel-mount', ORIGIN, 'px')],
    requiresMount: 'wheel-mount',
    massKg: 28,
    health: 90,
    cost: 18,
    reinforcement: 1,
    wheel: {
      radius: 0.3,
      width: 0.22,
      axleAxis: WHEEL_AXLE_LOCAL,
      suspensionDir: WHEEL_SUSPENSION_LOCAL,
      maxSteerAngleDeg: 32,
      driveTorqueLimit: 900,
      brakeTorque: 1400,
      frictionLong: 1,
      frictionLat: 0.95,
      maxLoad: 9000,
      suspension: { restLength: 0.35, travel: 0.22, stiffness: 42000, damping: 3200, maxLoad: 8000 },
    },
  },
  'wheel-offroad': {
    id: 'wheel-offroad',
    name: 'Off-road Wheel',
    category: 'movement',
    description: 'Large wheel with longer-travel integrated suspension.',
    cells: oneCell,
    clearanceCells: [v(0, -1, 0)],
    sockets: [singleSocket('wheel-mount-px', 'wheel-mount', ORIGIN, 'px')],
    requiresMount: 'wheel-mount',
    massKg: 44,
    health: 130,
    cost: 32,
    reinforcement: 1,
    wheel: {
      radius: 0.42,
      width: 0.3,
      axleAxis: WHEEL_AXLE_LOCAL,
      suspensionDir: WHEEL_SUSPENSION_LOCAL,
      maxSteerAngleDeg: 28,
      driveTorqueLimit: 1400,
      brakeTorque: 1800,
      frictionLong: 1.15,
      frictionLat: 1,
      maxLoad: 14000,
      suspension: { restLength: 0.45, travel: 0.3, stiffness: 56000, damping: 4300, maxLoad: 12500 },
    },
  },
  'armour-panel': {
    id: 'armour-panel',
    name: 'Armour Panel',
    category: 'protection',
    description: 'Face-mounted protective armour panel.',
    cells: [],
    clearanceCells: [],
    sockets: [singleSocket('armour-pz', 'armour', ORIGIN, 'pz')],
    massKg: 22,
    health: 180,
    cost: 14,
    reinforcement: 1,
    armour: { faceMounted: true, protection: 25, cosmetic: false },
  },
  'shell-panel': {
    id: 'shell-panel',
    name: 'Shell Panel',
    category: 'protection',
    description: 'Face-mounted cosmetic shell panel.',
    cells: [],
    clearanceCells: [],
    sockets: [singleSocket('armour-pz', 'armour', ORIGIN, 'pz')],
    massKg: 6,
    health: 25,
    cost: 5,
    reinforcement: 1,
    armour: { faceMounted: true, protection: 2, cosmetic: true },
  },
  'gun-fixed': {
    id: 'gun-fixed',
    name: 'Fixed Gun',
    category: 'weapon',
    description: 'Forward fixed weapon for hardpoints.',
    cells: oneCell,
    clearanceCells: [],
    sockets: [singleSocket('hardpoint-ny', 'hardpoint', ORIGIN, 'ny')],
    requiresMount: 'hardpoint',
    massKg: 45,
    health: 100,
    cost: 45,
    reinforcement: 1,
    weapon: {
      mountType: 'fixed',
      arcDeg: 20,
      damage: 12,
      fireRate: 5,
      ammoPerShot: 1,
      powerPerShot: 0,
      recoilImpulse: 90,
      projectileSpeed: 120,
      rangeM: 60,
    },
  },
  turret: {
    id: 'turret',
    name: 'Turret',
    category: 'weapon',
    description: 'Rotating weapon turret for hardpoints.',
    cells: oneCell,
    clearanceCells: [v(0, 1, 0)],
    sockets: [singleSocket('hardpoint-ny', 'hardpoint', ORIGIN, 'ny')],
    requiresMount: 'hardpoint',
    massKg: 85,
    health: 140,
    cost: 90,
    reinforcement: 1,
    weapon: {
      mountType: 'turret',
      arcDeg: 360,
      damage: 9,
      fireRate: 8,
      ammoPerShot: 1,
      powerPerShot: 2,
      recoilImpulse: 60,
      projectileSpeed: 140,
      rangeM: 70,
    },
  },
};

export function getPartDef(id: string): PartDefinition {
  const def = PART_CATALOG[id];
  if (def === undefined) throw new Error(`unknown part definition: ${id}`);
  return def;
}
