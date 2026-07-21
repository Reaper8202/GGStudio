import type { PartDefinition, VehicleBlueprint } from './types.ts';
import { cellCentreM } from './mass.ts';

export interface AutomaticWheelLayout {
  drivenPartIds: ReadonlySet<string>;
  steeringPartIds: ReadonlySet<string>;
}

/**
 * Which wheels actually receive drive torque: an explicit config.driven wins,
 * otherwise the automatic 2WD layout decides.
 *
 * Both the runtime assembler and the editor's analysis read drive through
 * here, so the build report can never disagree with what the vehicle does.
 */
export function resolveDrivenPartIds(
  blueprint: VehicleBlueprint,
  getDef: (id: string) => PartDefinition,
): ReadonlySet<string> {
  const layout = deriveAutomaticWheelLayout(blueprint, getDef);
  const driven = new Set<string>();
  for (const part of blueprint.parts) {
    if (getDef(part.defId).wheel === undefined) continue;
    const explicit = part.config.driven;
    const isDriven =
      typeof explicit === 'boolean'
        ? explicit
        : layout.drivenPartIds.has(part.id);
    if (isDriven) driven.add(part.id);
  }
  return driven;
}

/**
 * Automatic steer + 2WD drive layout.
 *
 * Steering defaults to the wheels ahead of the axle midpoint (vehicle forward
 * is +Z). A wheel that sets config.steering explicitly always keeps its own
 * value; this only fills in wheels that never had it decided, which is what
 * every player-placed wheel looks like — the editor creates parts with an
 * empty config. Without this, a wheel replaced after a landmine mounts as
 * non-steering and its lateral grip fights the wheel that still steers, which
 * reads in-game as the rig barely being able to turn.
 *
 * Drive torque goes to the two wheels farthest from the driver, preferring
 * wheels that do not steer.
 */
export function deriveAutomaticWheelLayout(
  blueprint: VehicleBlueprint,
  getDef: (id: string) => PartDefinition,
): AutomaticWheelLayout {
  const wheels = blueprint.parts
    .filter((part) => getDef(part.defId).wheel !== undefined)
    .map((part) => ({ part, centre: cellCentreM(part.pos) }));
  if (wheels.length === 0) {
    return { drivenPartIds: new Set<string>(), steeringPartIds: new Set<string>() };
  }

  // Wheels ahead of the axle midpoint steer, but only those that can: a part
  // with maxSteerAngleDeg 0 (tank treads) is never nominated.
  const zs = wheels.map((w) => w.centre.z);
  const midZ = (Math.max(...zs) + Math.min(...zs)) / 2;
  const steerCapable = (w: (typeof wheels)[number]): boolean =>
    (getDef(w.part.defId).wheel?.maxSteerAngleDeg ?? 0) > 0;
  const steeringPartIds = new Set<string>();
  for (const wheel of wheels) {
    if (!steerCapable(wheel)) continue;
    if (wheel.part.config.steering ?? wheel.centre.z > midZ) {
      steeringPartIds.add(wheel.part.id);
    }
  }
  // Single-axle rigs (every wheel at the same z) have no wheel ahead of the
  // midpoint, which would leave them with no steering at all. Let the whole
  // axle steer instead, minus any wheel the player explicitly turned off.
  if (steeringPartIds.size === 0) {
    for (const wheel of wheels) {
      if (steerCapable(wheel) && wheel.part.config.steering !== false) {
        steeringPartIds.add(wheel.part.id);
      }
    }
  }

  const driver = blueprint.parts.find(
    (part) => getDef(part.defId).providesControl === true,
  );
  const root = blueprint.parts.find(
    (part) => getDef(part.defId).isRoot === true,
  );
  const reference = cellCentreM((driver ?? root ?? wheels[0]!.part).pos);
  const distanceSq = (wheel: (typeof wheels)[number]): number => {
    const dx = wheel.centre.x - reference.x;
    const dy = wheel.centre.y - reference.y;
    const dz = wheel.centre.z - reference.z;
    return dx * dx + dy * dy + dz * dz;
  };

  const driveOrder = [...wheels].sort(
    (a, b) => distanceSq(b) - distanceSq(a) || a.part.id.localeCompare(b.part.id),
  );
  const nonSteering = driveOrder.filter(({ part }) => !steeringPartIds.has(part.id));
  const candidates = [...nonSteering, ...driveOrder.filter(({ part }) => steeringPartIds.has(part.id))];
  const driven = new Set(
    candidates.slice(0, Math.min(2, wheels.length)).map(({ part }) => part.id),
  );

  return { drivenPartIds: driven, steeringPartIds };
}
