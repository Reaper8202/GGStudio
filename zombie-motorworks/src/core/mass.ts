/**
 * Shared mass-distribution rule: multi-cell parts split their mass evenly
 * across their occupied cells; each cell's mass acts at the cell centre.
 * Both the build-time analyzer and the runtime assembler MUST use these
 * functions so their independently derived centre-of-mass values agree.
 */

import type { PartDefinition, PlacedPart, Vec3, Vec3i } from './types.ts';
import { CELL_SIZE } from './types.ts';
import { addVec, rotateVec } from './grid.ts';

/**
 * The starter vehicle sits close to this mass. Above it, extra structure is
 * deliberately felt twice: Rapier already has more mass to accelerate, and
 * the drivetrain loses additional output to the heavier build.
 */
export const VEHICLE_PERFORMANCE_REFERENCE_MASS_KG = 800;
const VEHICLE_MIN_PERFORMANCE_FACTOR = 0.35;
const VEHICLE_MASS_PENALTY_EXPONENT = 0.72;

export function vehicleMassPerformanceFactor(massKg: number): number {
  if (!Number.isFinite(massKg) || massKg <= 0) return 1;
  if (massKg <= VEHICLE_PERFORMANCE_REFERENCE_MASS_KG) return 1;
  return Math.max(
    VEHICLE_MIN_PERFORMANCE_FACTOR,
    Math.pow(
      VEHICLE_PERFORMANCE_REFERENCE_MASS_KG / massKg,
      VEHICLE_MASS_PENALTY_EXPONENT,
    ),
  );
}

/**
 * Scales ramming-impact damage by vehicle mass: a heavier build hits harder,
 * a lighter one hits softer. Pivots on the same reference mass as the
 * performance factor above (1x at 800kg) so the two mass effects agree on
 * what counts as a "normal" vehicle; the speed side of the ram formula is
 * untouched (see IMPACT_DAMAGE_PER_SPEED in zombieConfig.ts).
 */
const VEHICLE_IMPACT_MASS_EXPONENT = 0.6;
const VEHICLE_IMPACT_MIN_MASS_FACTOR = 0.4;
const VEHICLE_IMPACT_MAX_MASS_FACTOR = 2.5;

export function vehicleImpactMassFactor(massKg: number): number {
  if (!Number.isFinite(massKg) || massKg <= 0) return 1;
  const ratio = massKg / VEHICLE_PERFORMANCE_REFERENCE_MASS_KG;
  return Math.min(
    VEHICLE_IMPACT_MAX_MASS_FACTOR,
    Math.max(
      VEHICLE_IMPACT_MIN_MASS_FACTOR,
      Math.pow(ratio, VEHICLE_IMPACT_MASS_EXPONENT),
    ),
  );
}

export interface CellMass {
  /** World grid cell. */
  cell: Vec3i;
  /** Cell centre in vehicle-local metres. */
  centreM: Vec3;
  massKg: number;
}

/** Centre of a grid cell in vehicle-local metres. */
export function cellCentreM(cell: Vec3i): Vec3 {
  return {
    x: (cell.x + 0.5) * CELL_SIZE,
    y: (cell.y + 0.5) * CELL_SIZE,
    z: (cell.z + 0.5) * CELL_SIZE,
  };
}

/**
 * Per-cell masses of a placed part. Face-mounted parts (empty footprint,
 * e.g. armour panels) act at their host cell centre offset half a cell
 * toward the covered face; callers pass that face's world vector, or omit
 * it to use the host cell centre.
 */
export function placedCellMasses(
  def: PartDefinition,
  placed: Pick<PlacedPart, 'pos' | 'orient'>,
  faceMountOffset?: Vec3i,
): CellMass[] {
  if (def.cells.length === 0) {
    const centre = cellCentreM(placed.pos);
    if (faceMountOffset) {
      centre.x += faceMountOffset.x * CELL_SIZE * 0.5;
      centre.y += faceMountOffset.y * CELL_SIZE * 0.5;
      centre.z += faceMountOffset.z * CELL_SIZE * 0.5;
    }
    return [{ cell: placed.pos, centreM: centre, massKg: def.massKg }];
  }
  const per = def.massKg / def.cells.length;
  return def.cells.map((local) => {
    const cell = addVec(placed.pos, rotateVec(placed.orient, local));
    return { cell, centreM: cellCentreM(cell), massKg: per };
  });
}
