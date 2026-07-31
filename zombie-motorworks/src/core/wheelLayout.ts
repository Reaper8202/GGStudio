import type { PartDefinition, VehicleBlueprint } from './types.ts';
import { cellCentreM } from './mass.ts';

export interface AutomaticWheelLayout {
  drivenPartIds: ReadonlySet<string>;
  steeringPartIds: ReadonlySet<string>;
}

/**
 * Which wheels actually receive drive torque: an explicit config.driven wins,
 * otherwise the automatic all-wheel-drive layout decides.
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
 * Automatic steer + all-wheel-drive layout.
 *
 * Steering defaults to the wheels ahead of the axle midpoint (vehicle forward
 * is +Z). A wheel that sets config.steering explicitly always keeps its own
 * value; this only fills in wheels that never had it decided, which is what
 * every player-placed wheel looks like — the editor creates parts with an
 * empty config. Without this, a wheel replaced after a landmine mounts as
 * non-steering and its lateral grip fights the wheel that still steers, which
 * reads in-game as the rig barely being able to turn.
 *
 * Drive torque defaults to every wheel. An explicit `driven: false` remains
 * the opt-out for builds that deliberately want fewer driven wheels.
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

  const driven = new Set(wheels.map(({ part }) => part.id));

  return { drivenPartIds: driven, steeringPartIds };
}
