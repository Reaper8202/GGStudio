import type { PartDefinition, VehicleBlueprint } from './types.ts';
import { cellCentreM } from './mass.ts';

export interface AutomaticWheelLayout {
  drivenPartIds: ReadonlySet<string>;
}

/**
 * Automatic 2WD drive layout. Steering is player-configured per wheel
 * (config.steering); this only assigns engine torque, to the two wheels
 * farthest from the driver, preferring wheels not configured to steer.
 */
export function deriveAutomaticWheelLayout(
  blueprint: VehicleBlueprint,
  getDef: (id: string) => PartDefinition,
): AutomaticWheelLayout {
  const wheels = blueprint.parts
    .filter((part) => getDef(part.defId).wheel !== undefined)
    .map((part) => ({ part, centre: cellCentreM(part.pos) }));
  if (wheels.length === 0) {
    return { drivenPartIds: new Set<string>() };
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
  const nonSteering = driveOrder.filter(({ part }) => part.config.steering !== true);
  const candidates = [...nonSteering, ...driveOrder.filter(({ part }) => part.config.steering === true)];
  const driven = new Set(
    candidates.slice(0, Math.min(2, wheels.length)).map(({ part }) => part.id),
  );

  return { drivenPartIds: driven };
}
