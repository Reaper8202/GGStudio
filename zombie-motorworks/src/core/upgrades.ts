import { getPartDef } from './parts.ts';
import type { PartDefinition, PlacedPart } from './types.ts';

function resolvedLevel(base: PartDefinition, level: number): number {
  const maxLevel = base.upgrade?.maxLevel ?? 1;
  const requested = Number.isFinite(level) ? Math.floor(level) : 1;
  return Math.min(maxLevel, Math.max(1, requested));
}

/**
 * Returns the immutable catalog definition at a placed part's upgrade level.
 * Level 1 (and parts without upgrade metadata) returns the original object.
 */
export function effectivePartDef(
  base: PartDefinition,
  level: number,
): PartDefinition {
  const effectiveLevel = resolvedLevel(base, level);
  if (effectiveLevel === 1) return base;

  const steps = effectiveLevel - 1;
  let effective: PartDefinition = {
    ...base,
    health: base.health * (1 + 0.08 * steps),
  };

  if (base.engine !== undefined) {
    // Engine levels must change the actual driving feel. Torque improves
    // launch and pull in every gear; the wider RPM range raises real gearing-
    // limited top speed instead of only increasing a UI power number.
    const torqueMultiplier = 1 + 0.08 * steps;
    const rpmMultiplier = 1 + 0.14 * steps;
    effective = {
      ...effective,
      engine: {
        ...base.engine,
        maxPowerKw:
          base.engine.maxPowerKw * torqueMultiplier * rpmMultiplier,
        maxRpm: base.engine.maxRpm * rpmMultiplier,
        torqueCurve: base.engine.torqueCurve.map(
          ([rpm, torque]): [number, number] => [
            rpm * rpmMultiplier,
            torque * torqueMultiplier,
          ],
        ),
        fuelPerSecondAtFull:
          base.engine.fuelPerSecondAtFull * (1 + 0.06 * steps),
      },
    };
  }
  if (base.wheel !== undefined) {
    const multiplier = 1 + 0.06 * steps;
    effective = {
      ...effective,
      wheel: {
        ...base.wheel,
        frictionLong: base.wheel.frictionLong * multiplier,
        frictionLat: base.wheel.frictionLat * multiplier,
      },
    };
  }
  if (base.weapon !== undefined) {
    effective = {
      ...effective,
      weapon: {
        ...base.weapon,
        damage: base.weapon.damage * (1 + 0.12 * steps),
        fireRate: base.weapon.fireRate * (1 + 0.08 * steps),
        // Blast damage tracks direct damage; the radius stays fixed so an
        // upgraded cannon hits harder without quietly changing its footprint.
        ...(base.weapon.splashDamage !== undefined
          ? { splashDamage: base.weapon.splashDamage * (1 + 0.12 * steps) }
          : {}),
      },
    };
  }
  if (base.melee !== undefined) {
    effective = {
      ...effective,
      melee: {
        ...base.melee,
        damage: base.melee.damage * (1 + 0.12 * steps),
        // A plough's damage is the slam, so upgrading it has to move the slam
        // too — otherwise the stars buy a rounding error. Reach and capacity
        // stay fixed: the blade is the size it is drawn.
        ...(base.melee.plow !== undefined
          ? {
              plow: {
                ...base.melee.plow,
                crushDamage: base.melee.plow.crushDamage * (1 + 0.12 * steps),
              },
            }
          : {}),
      },
    };
  }
  if (base.armour !== undefined) {
    effective = {
      ...effective,
      armour: {
        ...base.armour,
        protection: base.armour.protection * (1 + 0.15 * steps),
      },
    };
  }
  return effective;
}

/**
 * Price to reach `targetLevel`. Returns undefined for non-upgradeable parts;
 * target levels below 2 or non-integers throw RangeError.
 */
export function upgradePrice(
  def: PartDefinition,
  targetLevel: number,
): number | undefined {
  if (!Number.isInteger(targetLevel) || targetLevel < 2) {
    throw new RangeError('targetLevel must be an integer >= 2');
  }
  if (def.upgrade === undefined) return undefined;
  return Math.round(
    def.upgrade.basePrice * def.upgrade.priceGrowth ** (targetLevel - 2),
  );
}

/** Resolves a placed catalog part to its level-adjusted immutable definition. */
export function getEffectiveDef(placed: PlacedPart): PartDefinition {
  return effectivePartDef(getPartDef(placed.defId), placed.config.level ?? 1);
}
