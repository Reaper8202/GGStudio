/**
 * Which alerts the combat HUD should be showing, derived from live vehicle
 * state.
 *
 * Pure and DOM-free on purpose: the thresholds are gameplay judgements worth
 * testing directly, and `WarningHud` only knows how to draw whatever this
 * returns. Ordering here is the display order — the list is already ranked, so
 * the renderer takes the first N without re-sorting.
 */

export type WarningSeverity = 'critical' | 'caution';

/** Chooses the pictogram; each value has a matching CSS modifier. */
export type WarningIcon = 'tire' | 'hull' | 'fuel' | 'engine' | 'weapon';

export interface VehicleWarning {
  /** Stable key, so the renderer can diff without rebuilding the DOM. */
  readonly id: string;
  readonly severity: WarningSeverity;
  readonly icon: WarningIcon;
  readonly title: string;
  readonly detail: string;
}

export interface WheelWarningState {
  /** Remaining part health as a 0..1 fraction of its effective maximum. */
  readonly healthFraction: number;
  /** True once the wheel has been destroyed or detached. */
  readonly broken: boolean;
}

export interface VehicleWarningInput {
  /** Whole-vehicle integrity, 0..100. */
  readonly integrityPct: number;
  readonly wheels: readonly WheelWarningState[];
  readonly fuel: number;
  readonly fuelCapacity: number;
  /** Engine parts still attached and alive. */
  readonly liveEngineCount: number;
  /** Weapon parts the build started with, and how many still work. */
  readonly weaponCount: number;
  readonly liveWeaponCount: number;
}

/** A tire below this fraction of its health is flagged as failing. */
export const TIRE_CAUTION_FRACTION = 0.45;
/** Below this it is about to blow. */
export const TIRE_CRITICAL_FRACTION = 0.2;
/** Whole-vehicle integrity at or below this reads as critical. */
export const HULL_CRITICAL_PCT = 25;
export const HULL_CAUTION_PCT = 50;
/** Fuel fractions for the low and reserve warnings. */
export const FUEL_CAUTION_FRACTION = 0.25;
export const FUEL_CRITICAL_FRACTION = 0.1;

/** Most display slots the HUD should ever fill at once. */
export const MAX_VISIBLE_WARNINGS = 3;

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

export function activeVehicleWarnings(
  input: VehicleWarningInput,
): VehicleWarning[] {
  const critical: VehicleWarning[] = [];
  const caution: VehicleWarning[] = [];

  // --- Drivetrain: a blown tire changes how the car handles immediately, so
  // it outranks everything except a vehicle that is about to come apart.
  let blownTires = 0;
  let criticalTires = 0;
  let cautionTires = 0;
  for (const wheel of input.wheels) {
    if (wheel.broken) {
      blownTires++;
    } else if (wheel.healthFraction <= TIRE_CRITICAL_FRACTION) {
      criticalTires++;
    } else if (wheel.healthFraction <= TIRE_CAUTION_FRACTION) {
      cautionTires++;
    }
  }

  if (blownTires > 0) {
    critical.push({
      id: 'tire-blown',
      severity: 'critical',
      icon: 'tire',
      title: `${blownTires} ${plural(blownTires, 'Tire')} Blown`,
      detail: 'Steering and grip degraded — repair in the garage',
    });
  } else if (criticalTires > 0) {
    critical.push({
      id: 'tire-critical',
      severity: 'critical',
      icon: 'tire',
      title: 'Tire Failure Imminent',
      detail: `${criticalTires} ${plural(criticalTires, 'tire')} near destruction`,
    });
  } else if (cautionTires > 0) {
    caution.push({
      id: 'tire-caution',
      severity: 'caution',
      icon: 'tire',
      title: 'Tire Damage',
      detail: `${cautionTires} ${plural(cautionTires, 'tire')} running low`,
    });
  }

  // --- Hull.
  if (input.integrityPct <= HULL_CRITICAL_PCT) {
    critical.push({
      id: 'hull-critical',
      severity: 'critical',
      icon: 'hull',
      title: 'Hull Critical',
      detail: `Integrity ${Math.round(input.integrityPct)}% — break contact`,
    });
  } else if (input.integrityPct <= HULL_CAUTION_PCT) {
    caution.push({
      id: 'hull-caution',
      severity: 'caution',
      icon: 'hull',
      title: 'Hull Damage',
      detail: `Integrity ${Math.round(input.integrityPct)}%`,
    });
  }

  // --- Fuel. A build with no tank at all is not running dry; it simply has no
  // gauge to warn about.
  if (input.fuelCapacity > 0) {
    const fraction = Math.max(0, input.fuel) / input.fuelCapacity;
    if (input.fuel <= 0) {
      critical.push({
        id: 'fuel-empty',
        severity: 'critical',
        icon: 'fuel',
        title: 'Out of Fuel',
        detail: 'Engine dead — find a refuel crate',
      });
    } else if (fraction <= FUEL_CRITICAL_FRACTION) {
      critical.push({
        id: 'fuel-critical',
        severity: 'critical',
        icon: 'fuel',
        title: 'Fuel Reserve',
        detail: `${Math.round(fraction * 100)}% remaining`,
      });
    } else if (fraction <= FUEL_CAUTION_FRACTION) {
      caution.push({
        id: 'fuel-low',
        severity: 'caution',
        icon: 'fuel',
        title: 'Low Fuel',
        detail: `${Math.round(fraction * 100)}% remaining`,
      });
    }
  }

  // --- Systems lost outright.
  if (input.liveEngineCount <= 0) {
    critical.push({
      id: 'engine-down',
      severity: 'critical',
      icon: 'engine',
      title: 'Engine Down',
      detail: 'No drive power remaining',
    });
  }
  if (input.weaponCount > 0 && input.liveWeaponCount <= 0) {
    critical.push({
      id: 'weapons-offline',
      severity: 'critical',
      icon: 'weapon',
      title: 'Weapons Offline',
      detail: 'Every weapon destroyed — ram or run',
    });
  }

  return [...critical, ...caution];
}
