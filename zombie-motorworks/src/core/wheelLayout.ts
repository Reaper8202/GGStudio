import type { PartDefinition, VehicleBlueprint } from './types.ts';
import { cellCentreM } from './mass.ts';

export interface AutomaticWheelLayout {
  steeringPartIds: ReadonlySet<string>;
  drivenPartIds: ReadonlySet<string>;
}

/**
 * Automatic 2WD layout. The driver defines the front of an unconventional
 * build: its two nearest wheels steer, while the two farthest remaining
 * wheels receive engine torque. A two-wheel vehicle uses both for both roles.
 */
export function deriveAutomaticWheelLayout(
  blueprint: VehicleBlueprint,
  getDef: (id: string) => PartDefinition,
): AutomaticWheelLayout {
  const wheels = blueprint.parts
    .filter((part) => getDef(part.defId).wheel !== undefined)
    .map((part) => ({ part, centre: cellCentreM(part.pos) }));
  if (wheels.length === 0) {
    return {
      steeringPartIds: new Set<string>(),
      drivenPartIds: new Set<string>(),
    };
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
  const nearestFirst = [...wheels].sort(
    (a, b) => distanceSq(a) - distanceSq(b) || a.part.id.localeCompare(b.part.id),
  );
  const steering = new Set(
    nearestFirst.slice(0, Math.min(2, wheels.length)).map(({ part }) => part.id),
  );

  const driveOrder = [...wheels].sort(
    (a, b) => distanceSq(b) - distanceSq(a) || a.part.id.localeCompare(b.part.id),
  );
  const nonSteering = driveOrder.filter(({ part }) => !steering.has(part.id));
  const candidates = [...nonSteering, ...driveOrder.filter(({ part }) => steering.has(part.id))];
  const driven = new Set(
    candidates.slice(0, Math.min(2, wheels.length)).map(({ part }) => part.id),
  );

  return { steeringPartIds: steering, drivenPartIds: driven };
}
