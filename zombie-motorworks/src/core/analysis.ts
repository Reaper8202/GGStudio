import type {
  PartDefinition,
  PlacedPart,
  ValidationIssue,
  Vec3,
  Vec3i,
  VehicleAnalysisReport,
  VehicleBlueprint,
  WheelContactEstimate,
} from './types.ts';
import { CELL_SIZE } from './types.ts';
import { ALL_FACES, FACE_VECTORS, addVec, cellKey, rotateFace, rotateVec, worldCells } from './grid.ts';
import {
  cellCentreM,
  placedCellMasses,
  vehicleMassPerformanceFactor,
} from './mass.ts';
import { getPartDef } from './parts.ts';
import { effectivePartDef, getEffectiveDef } from './upgrades.ts';
import { deriveAutomaticWheelLayout } from './wheelLayout.ts';

type Point2 = { x: number; z: number };

interface PartEntry {
  part: PlacedPart;
  def: PartDefinition;
}

interface WheelEntry {
  part: PlacedPart;
  def: PartDefinition;
  contact: WheelContactEstimate;
  radius: number;
}

const GRAVITY = 9.81;
const EPSILON = 1e-9;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function cross(o: Point2, a: Point2, b: Point2): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

function distancePointToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq <= EPSILON) return Math.hypot(p.x - a.x, p.z - a.z);
  const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq);
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (distancePointToSegment(point, a, b) <= 1e-8) return true;
    const crosses = a.z > point.z !== b.z > point.z;
    if (crosses && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function convexHull2D(points: readonly Point2[]): Point2[] {
  const sorted = [...points]
    .sort((a, b) => a.x - b.x || a.z - b.z)
    .filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.z !== all[index - 1].z);
  if (sorted.length <= 1) return sorted;

  const lower: Point2[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }

  const upper: Point2[] = [];
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }

  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function pointToPolygonSignedDistance(point: Point2, polygon: readonly Point2[]): number {
  if (polygon.length === 0) return -Infinity;
  if (polygon.length === 1) return -Math.hypot(point.x - polygon[0].x, point.z - polygon[0].z);

  let minDistance = Infinity;
  const edgeCount = polygon.length === 2 ? 1 : polygon.length;
  for (let index = 0; index < edgeCount; index++) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    minDistance = Math.min(minDistance, distancePointToSegment(point, a, b));
  }
  return pointInPolygon(point, polygon) ? minDistance : -minDistance;
}

function issue(
  code: string,
  message: string,
  partIds: string[],
  cells: Vec3i[],
  suggestion: string,
  severity: ValidationIssue['severity'] = 'warning',
): ValidationIssue {
  return { severity, code, message, partIds, cells, suggestion };
}

function faceMountOffset(def: PartDefinition, part: PlacedPart): Vec3i | undefined {
  if (def.cells.length !== 0) return undefined;
  const socket = def.sockets[0];
  return socket === undefined ? undefined : FACE_VECTORS[rotateFace(part.orient, socket.face)];
}

function peakTorque(defs: readonly PartDefinition[]): number {
  return defs.reduce((sum, def) => sum + (def.engine?.torqueCurve.reduce((peak, [, torque]) => Math.max(peak, torque), 0) ?? 0), 0);
}

function axleKey(z: number): number {
  return Math.round(z / 1e-6);
}

function exposedCellsForSensitivePart(entry: PartEntry, occupied: Map<string, string>, armourFaces: Map<string, string>): Vec3i[] {
  const exposed: Vec3i[] = [];
  for (const cell of worldCells(entry.def.cells, entry.part.pos, entry.part.orient)) {
    for (const face of ALL_FACES) {
      const neighbour = addVec(cell, FACE_VECTORS[face]);
      if (!occupied.has(cellKey(neighbour)) && !armourFaces.has(`${cellKey(cell)}|${face}`)) {
        exposed.push(cell);
        break;
      }
    }
  }
  return exposed;
}

export function analyzeVehicle(bp: VehicleBlueprint, getDef: (id: string) => PartDefinition): VehicleAnalysisReport {
  const entries: PartEntry[] = bp.parts.map((part) => ({
    part,
    def: getDef === getPartDef
      ? getEffectiveDef(part)
      : effectivePartDef(getDef(part.defId), part.config.level ?? 1),
  }));
  const cellMasses = entries.flatMap(({ part, def }) => placedCellMasses(def, part, faceMountOffset(def, part)));
  const totalMassKg = cellMasses.reduce((sum, mass) => sum + mass.massKg, 0);
  const centreOfMass: Vec3 =
    totalMassKg > 0
      ? {
          x: cellMasses.reduce((sum, mass) => sum + mass.centreM.x * mass.massKg, 0) / totalMassKg,
          y: cellMasses.reduce((sum, mass) => sum + mass.centreM.y * mass.massKg, 0) / totalMassKg,
          z: cellMasses.reduce((sum, mass) => sum + mass.centreM.z * mass.massKg, 0) / totalMassKg,
        }
      : { x: 0, y: 0, z: 0 };
  const totalCost = entries.reduce((sum, entry) => sum + entry.def.cost, 0);
  const fuelCapacityL = entries.reduce((sum, entry) => sum + (entry.def.fuelCapacity ?? 0), 0);

  const wheelEntries: WheelEntry[] = entries.flatMap(({ part, def }) => {
    if (def.wheel === undefined) return [];
    const anchor = cellCentreM(part.pos);
    const suspDirWorld = rotateVec(part.orient, def.wheel.suspensionDir);
    const contact = {
      x: anchor.x + suspDirWorld.x * (def.wheel.suspension.restLength + def.wheel.radius),
      y: anchor.y + suspDirWorld.y * (def.wheel.suspension.restLength + def.wheel.radius),
      z: anchor.z + suspDirWorld.z * (def.wheel.suspension.restLength + def.wheel.radius),
    };
    return [{ part, def, radius: def.wheel.radius, contact: { partId: part.id, point: contact, load: 0, grounded: false } }];
  });
  const downWheelContacts = wheelEntries.filter(({ part, def }) => rotateVec(part.orient, def.wheel!.suspensionDir).y === -1);
  const lowestDownContactY = Math.min(...downWheelContacts.map(({ contact }) => contact.point.y));
  for (const wheel of wheelEntries) {
    const suspDirWorld = rotateVec(wheel.part.orient, wheel.def.wheel!.suspensionDir);
    wheel.contact.grounded = suspDirWorld.y === -1 && wheel.contact.point.y <= lowestDownContactY + 0.06;
  }

  const groundedWheels = wheelEntries.filter((wheel) => wheel.contact.grounded);
  const groundedContacts = groundedWheels.map((wheel) => wheel.contact.point);
  const frontmostContactZ = Math.max(...groundedContacts.map((point) => point.z));
  const rearmostContactZ = Math.min(...groundedContacts.map((point) => point.z));
  const leftmostX = Math.min(...groundedContacts.map((point) => point.x));
  const rightmostX = Math.max(...groundedContacts.map((point) => point.x));
  const wheelbaseM = groundedContacts.length >= 2 ? frontmostContactZ - rearmostContactZ : 0;
  const trackWidthM = groundedContacts.length >= 2 ? rightmostX - leftmostX : 0;
  const axles = new Map<number, WheelEntry[]>();
  for (const wheel of groundedWheels) {
    const key = axleKey(wheel.contact.point.z);
    const axle = axles.get(key) ?? [];
    axle.push(wheel);
    axles.set(key, axle);
  }

  // Static wheel load is an analyzer approximation: axle shares follow CoM-to-axle
  // distance over wheelbase, then each axle uses a simple left/right lever split.
  const axleWeights = [...axles.entries()].map(([key, wheels]) => ({
    key,
    wheels,
    z: wheels[0].contact.point.z,
    weight: Math.max(0, 1 - Math.abs(wheels[0].contact.point.z - centreOfMass.z) / Math.max(wheelbaseM, 0.1)),
  }));
  const axleWeightSum = axleWeights.reduce((sum, axle) => sum + axle.weight, 0);
  const totalWeightN = totalMassKg * GRAVITY;
  for (const axle of axleWeights) {
    const axleLoad = (axleWeightSum > 0 ? axle.weight / axleWeightSum : 1 / axleWeights.length) * totalWeightN;
    const minX = Math.min(...axle.wheels.map((wheel) => wheel.contact.point.x));
    const maxX = Math.max(...axle.wheels.map((wheel) => wheel.contact.point.x));
    if (Math.abs(maxX - minX) <= EPSILON) {
      for (const wheel of axle.wheels) wheel.contact.load = axleLoad / axle.wheels.length;
      continue;
    }
    const leftShare = clamp((maxX - centreOfMass.x) / (maxX - minX));
    const leftWheels = axle.wheels.filter((wheel) => Math.abs(wheel.contact.point.x - minX) <= EPSILON);
    const rightWheels = axle.wheels.filter((wheel) => Math.abs(wheel.contact.point.x - maxX) <= EPSILON);
    const middleWheels = axle.wheels.filter((wheel) => !leftWheels.includes(wheel) && !rightWheels.includes(wheel));
    for (const wheel of leftWheels) wheel.contact.load = (axleLoad * leftShare) / leftWheels.length;
    for (const wheel of rightWheels) wheel.contact.load = (axleLoad * (1 - leftShare)) / rightWheels.length;
    for (const wheel of middleWheels) wheel.contact.load = 0;
  }

  const frontMassFraction = axles.size < 2 ? 0.5 : clamp((centreOfMass.z - rearmostContactZ) / (frontmostContactZ - rearmostContactZ));
  const leftMassFraction = groundedContacts.length < 2 ? 0.5 : 1 - clamp((centreOfMass.x - leftmostX) / (rightmostX - leftmostX));
  const supportPolygon = convexHull2D(groundedContacts.map((point) => ({ x: point.x, z: point.z })));
  const stabilityMarginM =
    supportPolygon.length >= 3 ? pointToPolygonSignedDistance({ x: centreOfMass.x, z: centreOfMass.z }, supportPolygon) : supportPolygon.length === 0 ? -1 : -0.5;
  const lowestGroundContactY = Math.min(...groundedContacts.map((point) => point.y));
  const comHeight = groundedContacts.length === 0 ? centreOfMass.y : centreOfMass.y - lowestGroundContactY;
  const ssf = groundedContacts.length === 0 ? 0 : (trackWidthM / 2) / Math.max(comHeight, 0.05);
  const rolloverRisk: VehicleAnalysisReport['rolloverRisk'] = ssf > 1.1 ? 'low' : ssf >= 0.85 ? 'medium' : ssf >= 0.6 ? 'high' : 'extreme';
  const nonWheelBottoms = entries.flatMap((entry) =>
    entry.def.wheel === undefined ? worldCells(entry.def.cells, entry.part.pos, entry.part.orient).map((cell) => cell.y * CELL_SIZE) : [],
  );
  const groundClearanceM = groundedContacts.length === 0 || nonWheelBottoms.length === 0 ? 0 : Math.min(...nonWheelBottoms) - lowestGroundContactY;
  const engineEntries = entries.filter((entry) => entry.def.engine !== undefined);
  const engineDefs = engineEntries.map((entry) => entry.def);
  const totalPowerKw = engineDefs.reduce((sum, def) => sum + def.engine!.maxPowerKw, 0);
  const powerToWeightKwPerT = totalMassKg > 0 ? totalPowerKw / (totalMassKg / 1000) : 0;
  const totalDps = entries.reduce(
    (sum, entry) =>
      sum + (entry.def.weapon === undefined
        ? 0
        : entry.def.weapon.damage * entry.def.weapon.fireRate),
    0,
  );
  const wheelLayout = deriveAutomaticWheelLayout(bp, getDef);
  const drivenWheels = wheelEntries.filter((wheel) =>
    wheelLayout.drivenPartIds.has(wheel.part.id),
  );
  const groundedDrivenWheels = drivenWheels.filter((wheel) => wheel.contact.grounded);
  const drivenWheelLoad = groundedDrivenWheels.reduce((sum, wheel) => sum + wheel.contact.load, 0);
  const drivenWheelLoadFraction = totalWeightN > 0 ? drivenWheelLoad / totalWeightN : 0;
  const meanDrivenWheelRadius =
    groundedDrivenWheels.length > 0 ? groundedDrivenWheels.reduce((sum, wheel) => sum + wheel.radius, 0) / groundedDrivenWheels.length : 0;
  const maxEngineRpm = engineDefs.reduce(
    (maximum, def) => Math.max(maximum, def.engine?.maxRpm ?? 0),
    0,
  );
  const massPerformance = vehicleMassPerformanceFactor(totalMassKg);
  const estimatedTopSpeedKph =
    meanDrivenWheelRadius > 0 && maxEngineRpm > 0
      ? (((maxEngineRpm / (3.6 * 3.9)) * (2 * Math.PI * meanDrivenWheelRadius) * 60) / 1000) *
        massPerformance
      : 0;
  const tractiveForce = meanDrivenWheelRadius > 0 ? (peakTorque(engineDefs) * 3.6 * 3.9 * 0.85 * massPerformance) / meanDrivenWheelRadius : 0;
  const tractionSlope = Math.atan(0.9 * drivenWheelLoadFraction);
  const torqueSlope = totalWeightN > 0 ? Math.asin(clamp(tractiveForce / totalWeightN)) : 0;
  const estimatedMaxSlopeDeg =
    groundedDrivenWheels.length === 0 || engineDefs.length === 0 ? 0 : (Math.min(tractionSlope, torqueSlope) * 180) / Math.PI;

  const occupied = new Map<string, string>();
  for (const entry of entries) {
    for (const cell of worldCells(entry.def.cells, entry.part.pos, entry.part.orient)) occupied.set(cellKey(cell), entry.part.id);
  }
  const armourFaces = new Map<string, string>();
  for (const entry of entries) {
    if (entry.def.armour?.faceMounted !== true) continue;
    const socket = entry.def.sockets[0];
    if (socket !== undefined) armourFaces.set(`${cellKey(entry.part.pos)}|${rotateFace(entry.part.orient, socket.face)}`, entry.part.id);
  }

  const warnings: ValidationIssue[] = [];
  const addIssue = (value: ValidationIssue) => warnings.push(value);
  if (wheelEntries.length === 0) {
    addIssue(issue('NO_WHEELS', 'Vehicle has no wheels.', [], [], 'Add at least two grounded wheels.'));
  }
  const ungroundedWheels = wheelEntries.filter((wheel) => !wheel.contact.grounded);
  if (wheelEntries.length > 0 && ungroundedWheels.length > 0) {
    addIssue(issue('WHEELS_NOT_GROUNDED', 'Some wheels are not expected to touch the ground.', ungroundedWheels.map((wheel) => wheel.part.id), [], 'Lower the wheels or rotate the fixed wheel mount downward.'));
  }
  const badOrientation = wheelEntries.filter(({ part, def }) => {
    const axle = rotateVec(part.orient, def.wheel!.axleAxis);
    const susp = rotateVec(part.orient, def.wheel!.suspensionDir);
    return axle.y !== 0 || susp.y !== -1;
  });
  if (badOrientation.length > 0) {
    addIssue(issue('WHEEL_AXLE_ORIENTATION', 'Some wheels have vertical axles or upward-facing mounts.', badOrientation.map((wheel) => wheel.part.id), [], 'Rotate wheels so axles are horizontal and mounts point down.'));
  }
  if (wheelEntries.length > 0 && drivenWheels.length === 0) {
    addIssue(issue('NO_DRIVEN_WHEELS', 'No wheels are configured as driven.', wheelEntries.map((wheel) => wheel.part.id), [], 'Mark at least one grounded wheel as driven.'));
  }
  const steeringWheels = wheelEntries.filter((wheel) =>
    wheelLayout.steeringPartIds.has(wheel.part.id),
  );
  if (wheelEntries.length > 0 && steeringWheels.length === 0) {
    addIssue(issue('NO_STEERING_WHEELS', 'No wheels are configured for steering.', wheelEntries.map((wheel) => wheel.part.id), [], 'Mark at least one wheel as steering.'));
  }
  if (trackWidthM < 2.2 * comHeight && groundedWheels.length >= 2) {
    addIssue(issue('NARROW_TRACK', 'Track width is narrow for the centre of mass height.', groundedWheels.map((wheel) => wheel.part.id), [], 'Move wheels farther left and right or lower heavy parts.'));
  }
  if (wheelbaseM < 0.9 && axles.size >= 2) {
    addIssue(issue('SHORT_WHEELBASE', 'Wheelbase is short.', groundedWheels.map((wheel) => wheel.part.id), [], 'Move front and rear axles farther apart.'));
  }
  if (ssf < 0.85 && groundedWheels.length > 0) {
    addIssue(issue('HIGH_COM', 'Centre of mass is high relative to the track width.', [], [], 'Lower heavy parts or widen the stance.'));
  }
  if (stabilityMarginM < 0.05 && groundedWheels.length > 0) {
    addIssue(issue('COM_OUTSIDE_SUPPORT', 'Centre of mass is close to or outside the support polygon.', [], [], 'Move weight toward the middle of the grounded wheel polygon.'));
  }
  if (leftMassFraction < 0.38 || leftMassFraction > 0.62) {
    addIssue(issue('LATERAL_IMBALANCE', 'Left-right mass distribution is imbalanced.', [], [], 'Move heavy parts toward the vehicle centreline.'));
  }
  if (frontMassFraction < 0.25 || frontMassFraction > 0.75) {
    addIssue(issue('LONGITUDINAL_IMBALANCE', 'Front-rear mass distribution is imbalanced.', [], [], 'Move heavy parts between the axles.'));
  }
  const overloaded = groundedWheels.filter(({ def, contact }) => {
    return contact.load > def.wheel!.maxLoad;
  });
  if (overloaded.length > 0) {
    addIssue(issue('WHEEL_OVERLOAD', 'Static load exceeds a wheel rating.', overloaded.map((wheel) => wheel.part.id), [], 'Use stronger wheels, add more wheels, or reduce mass.'));
  }
  if (engineDefs.length > 0 && powerToWeightKwPerT < 25) {
    addIssue(issue('LOW_POWER', 'Power-to-weight ratio is low.', engineEntries.map((entry) => entry.part.id), [], 'Add power or reduce vehicle mass.'));
  }
  if (drivenWheels.length > 0 && drivenWheelLoadFraction < 0.25) {
    addIssue(issue('LOW_TRACTION', 'Driven wheels carry little static load.', drivenWheels.map((wheel) => wheel.part.id), [], 'Move driven wheels under more mass or drive more grounded wheels.'));
  }
  if (groundedWheels.length > 0 && groundClearanceM < 0.12) {
    addIssue(issue('LOW_CLEARANCE', 'Ground clearance is low.', [], [], 'Raise the chassis or use larger wheels.'));
  }
  for (const entry of entries) {
    if (entry.def.id !== 'fuel-tank' && entry.def.id !== 'ammo-box') continue;
    const exposed = exposedCellsForSensitivePart(entry, occupied, armourFaces);
    if (exposed.length > 0) {
      addIssue(issue('EXPOSED_FUEL', `${entry.def.name} has exposed faces.`, [entry.part.id], exposed, 'Cover exposed faces with armour or adjacent structure.', 'info'));
    }
  }
  const recoilImpulse = entries.reduce((sum, entry) => sum + (entry.def.weapon?.recoilImpulse ?? 0), 0);
  if (recoilImpulse > 0 && (recoilImpulse * comHeight) / Math.max(totalMassKg * trackWidthM, 1) > 0.12) {
    addIssue(issue('RECOIL_RISK', 'Weapon recoil may destabilize the vehicle.', entries.filter((entry) => entry.def.weapon !== undefined).map((entry) => entry.part.id), [], 'Widen the track, lower weapons, or add mass.'));
  }

  return {
    totalMassKg,
    centreOfMass,
    frontMassFraction,
    leftMassFraction,
    wheelContacts: wheelEntries.map((wheel) => wheel.contact),
    supportPolygon,
    stabilityMarginM,
    rolloverRisk,
    trackWidthM,
    wheelbaseM,
    groundClearanceM,
    powerToWeightKwPerT,
    totalDps,
    estimatedTopSpeedKph,
    drivenWheelLoadFraction,
    estimatedMaxSlopeDeg,
    fuelCapacityL,
    totalCost,
    warnings,
  };
}
