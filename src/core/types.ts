/**
 * Shared, engine-independent data model for the vehicle construction system.
 *
 * Vehicle-local axes: X = width (+X is the vehicle's right), Y = height (up),
 * Z = forward. Grid positions are integers. Blueprints contain only
 * serializable identifiers, positions, rotations, configurations, and
 * relationships — never runtime object references.
 */

export interface Vec3i {
  x: number;
  y: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** One of the six axis-aligned faces of a grid cell. */
export type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

/** Index into the canonical table of 24 axis-aligned orientations (0 = identity). */
export type OrientationIndex = number;

export type PartCategory = 'structural' | 'functional' | 'movement' | 'protection' | 'weapon';

/**
 * Socket types. Compatibility is defined centrally in the placement service.
 * - frame: generic structural face-to-face connection
 * - wheel-mount: provided by wheel/suspension mount parts, required by wheels
 * - engine-mount: provided by engine mounts, required by engines
 * - hardpoint: provided by weapon hardpoints, required by weapons
 * - armour: provided by any structural face, consumed by face-mounted armour/shell
 */
export type SocketType = 'frame' | 'wheel-mount' | 'engine-mount' | 'hardpoint' | 'armour';

export interface StructuralSocket {
  /** Unique within the part definition. */
  id: string;
  /** Local cell the socket belongs to (orientation 0). */
  cell: Vec3i;
  /** Face of that cell the socket sits on (orientation 0). */
  face: Face;
  type: SocketType;
}

export type SuspensionPreset = 'light' | 'standard' | 'heavy-duty' | 'off-road';

export interface SuspensionParams {
  restLength: number; // m, below the wheel mount anchor
  travel: number; // m
  stiffness: number; // N/m
  damping: number; // N·s/m
  /** Suspension load rating, N: static loads beyond this warn and bottom out at runtime. */
  maxLoad: number;
}

/**
 * Player-facing suspension presets scale the wheel definition's base
 * suspension. Applied multiplicatively by analyzer and runtime alike.
 */
export const SUSPENSION_PRESET_MULTIPLIERS: Record<
  SuspensionPreset,
  { stiffness: number; damping: number; travel: number; maxLoad: number }
> = {
  light: { stiffness: 0.6, damping: 0.7, travel: 0.85, maxLoad: 0.6 },
  standard: { stiffness: 1.0, damping: 1.0, travel: 1.0, maxLoad: 1.0 },
  'heavy-duty': { stiffness: 1.8, damping: 1.6, travel: 0.75, maxLoad: 1.9 },
  'off-road': { stiffness: 1.1, damping: 1.15, travel: 1.6, maxLoad: 1.3 },
};

export interface WheelDefinition {
  radius: number; // m
  width: number; // m
  /** Local axle axis at orientation 0. Wheels spin around this axis. */
  axleAxis: Vec3i;
  /** Local suspension travel direction at orientation 0 (usually -Y). */
  suspensionDir: Vec3i;
  maxSteerAngleDeg: number; // usable only when configured as steering
  driveTorqueLimit: number; // N·m the hub survives
  brakeTorque: number; // N·m
  frictionLong: number; // longitudinal friction coefficient multiplier
  frictionLat: number; // lateral friction coefficient multiplier
  /** Tire load rating, N (distinct from suspension.maxLoad, the spring rating). */
  maxLoad: number;
  /** Base suspension parameters; PartConfig.suspensionPreset scales these. */
  suspension: SuspensionParams;
}

export interface EngineDefinition {
  /** Torque curve as [rpm, N·m] samples, ascending rpm. */
  torqueCurve: [number, number][];
  maxRpm: number;
  idleRpm: number;
  maxPowerKw: number;
  fuelPerSecondAtFull: number; // litres/s at full throttle
}

export type WeaponMountType = 'fixed' | 'turret';

export interface WeaponDefinition {
  mountType: WeaponMountType;
  /** Horizontal firing arc in degrees (centered on part forward; 360 for turrets). */
  arcDeg: number;
  damage: number;
  fireRate: number; // shots/s
  ammoPerShot: number;
  powerPerShot: number;
  recoilImpulse: number; // N·s applied opposite to fire direction at the mount
  projectileSpeed: number; // m/s
  rangeM: number;
}

export interface ArmourDefinition {
  /** Face-mounted armour occupies a face, not a cell volume. */
  faceMounted: boolean;
  protection: number; // flat damage absorbed while intact
  cosmetic: boolean; // cosmetic shell: negligible protection
}

export interface PartDefinition {
  id: string;
  name: string;
  category: PartCategory;
  description: string;
  /** Occupied local cells at orientation 0. Single or multi-cell. */
  cells: Vec3i[];
  /**
   * Local cells that must remain empty (orientation 0) — wheel travel volume,
   * weapon breech clearance, steering swing, etc.
   */
  clearanceCells: Vec3i[];
  /** Allowed orientation indices; undefined = all 24. */
  allowedOrientations?: OrientationIndex[];
  sockets: StructuralSocket[];
  /**
   * Socket type this part must attach through (its own socket of this type
   * must meet a compatible provider). Undefined = any frame connection.
   */
  requiresMount?: SocketType;
  massKg: number;
  health: number;
  cost: number;
  /** Multiplier on the strength of structural connections into this part. */
  reinforcement: number;
  /** Only one instance allowed per vehicle (root chassis, driver seat). */
  unique?: boolean;
  /** True for the root chassis / driver compartment that anchors connectivity. */
  isRoot?: boolean;
  providesControl?: boolean; // driver seat / cab
  wheel?: WheelDefinition;
  engine?: EngineDefinition;
  weapon?: WeaponDefinition;
  armour?: ArmourDefinition;
  fuelCapacity?: number; // litres
  batteryCapacity?: number; // kJ
  ammoCapacity?: number; // rounds
  cargoCapacity?: number; // kg
  /** Approximate render/collider box size per cell, metres (default 1). */
  visualScale?: number;
}

/** Paint swatches available on every part (customization). */
export const PAINT_COLORS = {
  scrap: 0x8a8f98,
  red: 0xc84c4c,
  blue: 0x4d79c7,
  green: 0x5f9b55,
  yellow: 0xd6a928,
  purple: 0x8b5bb5,
} as const;

export type PaintColor = keyof typeof PAINT_COLORS;

export interface PartConfig {
  driven?: boolean;
  steering?: boolean;
  /** Invert steering direction (rear-steer axles). */
  steerInverted?: boolean;
  braking?: boolean;
  suspensionPreset?: SuspensionPreset;
  /** Player-chosen paint; undefined = the part's default colour. */
  paint?: PaintColor;
}

export interface PlacedPart {
  /** Instance id, unique within the blueprint. */
  id: string;
  defId: string;
  pos: Vec3i;
  orient: OrientationIndex;
  config: PartConfig;
}

export interface VehicleBlueprint {
  schemaVersion: number;
  id: string;
  name: string;
  parts: PlacedPart[];
}

export interface StructuralConnection {
  aId: string;
  bId: string;
  aSocketId: string;
  bSocketId: string;
  maxForce: number; // N
  maxTorque: number; // N·m
  health: number; // 0..1 remaining
}

export interface DrivetrainConnection {
  /** Engine placed-part id feeding this wheel placed-part id. */
  engineId: string;
  wheelId: string;
}

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  /** Affected placed part ids, when known. */
  partIds: string[];
  /** Affected world grid cells, when known. */
  cells: Vec3i[];
  suggestion?: string;
}

export interface PlacementResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface ValidationReport {
  /** Hard errors: vehicle cannot be meaningfully assembled / test-driven. */
  errors: ValidationIssue[];
  /** Physics/design warnings: never block experimentation. */
  warnings: ValidationIssue[];
  /** Informational notes. */
  infos: ValidationIssue[];
}

export interface WheelContactEstimate {
  partId: string;
  /** Expected contact point in vehicle-local metres (at suspension rest). */
  point: Vec3;
  /** Estimated static load share, N. */
  load: number;
  grounded: boolean;
}

export interface VehicleAnalysisReport {
  totalMassKg: number;
  centreOfMass: Vec3; // vehicle-local metres
  frontMassFraction: number; // 0..1 mass ahead of CoM midpoint (by wheelbase)
  leftMassFraction: number;
  wheelContacts: WheelContactEstimate[];
  /** Convex hull (XZ, metres) of expected grounded wheel contacts. */
  supportPolygon: { x: number; z: number }[];
  /** Min horizontal distance from CoM projection to polygon edge; negative = outside. */
  stabilityMarginM: number;
  rolloverRisk: 'low' | 'medium' | 'high' | 'extreme';
  trackWidthM: number;
  wheelbaseM: number;
  groundClearanceM: number;
  powerToWeightKwPerT: number;
  drivenWheelLoadFraction: number; // share of static load on driven wheels
  estimatedMaxSlopeDeg: number;
  fuelCapacityL: number;
  totalCost: number;
  warnings: ValidationIssue[];
}

/** Grid bounds (inclusive), vehicle-local cells. */
export const GRID_MIN: Vec3i = { x: -6, y: 0, z: -8 };
export const GRID_MAX: Vec3i = { x: 6, y: 8, z: 8 };

/** World metres per grid cell. */
export const CELL_SIZE = 0.5;

export const BLUEPRINT_SCHEMA_VERSION = 3;
