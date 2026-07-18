import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPartDef } from '../src/core/parts.ts';
import type {
  EngineDefinition,
  PartDefinition,
  PlacedPart,
  VehicleBlueprint,
} from '../src/core/types.ts';
import { assembleVehicle } from '../src/runtime/assembler.ts';
import { engineStep } from '../src/runtime/drivetrain.ts';
import { RuntimeVehicle } from '../src/runtime/vehicle.ts';
import { createWeapon, stepWeapons } from '../src/runtime/weapons.ts';

function part(id: string, defId: string, level = 1, x = 0): PlacedPart {
  return {
    id,
    defId,
    pos: { x, y: 0, z: 0 },
    orient: 0,
    config: { level },
  };
}

function blueprint(parts: PlacedPart[]): VehicleBlueprint {
  return {
    schemaVersion: 4,
    id: 'runtime-upgrade-test',
    name: 'Runtime upgrade test',
    parts,
  };
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('runtime upgrade resolution', () => {
  it('feeds a level-three engine torque curve into the drivetrain', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const vehicle = new RuntimeVehicle(
      world,
      blueprint([part('engine', 'engine-small', 3)]),
      getPartDef,
      [],
      { translation: { x: 0, y: 1, z: 0 } },
    );
    const engineState = (
      vehicle as unknown as {
        engines: { def: EngineDefinition }[];
      }
    ).engines[0];
    const base = getPartDef('engine-small').engine!;

    const baseOutput = engineStep(
      base,
      { gear: 0, shiftCooldown: 0 },
      1,
      0,
      1 / 60,
    );
    const upgradedOutput = engineStep(
      engineState.def,
      { gear: 0, shiftCooldown: 0 },
      1,
      0,
      1 / 60,
    );

    expect(engineState.def.torqueCurve[0][1]).toBeCloseTo(
      base.torqueCurve[0][1] * 1.2,
    );
    expect(upgradedOutput.wheelTorqueTotal).toBeCloseTo(
      baseOutput.wheelTorqueTotal * 1.2,
    );

    vehicle.dispose();
    world.free();
  });

  it('assembles scaled part health and wheel inputs', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const engine = part('engine', 'engine-small', 3);
    const wheel = part('wheel', 'wheel-standard', 3, 1);
    const assembled = assembleVehicle(
      world,
      blueprint([engine, wheel]),
      getPartDef,
      [],
      { translation: { x: 0, y: 1, z: 0 } },
    );

    expect(assembled.parts.get(engine.id)?.health).toBeCloseTo(
      getPartDef(engine.defId).health * 1.16,
    );
    expect(assembled.wheels[0].wheelDef.frictionLong).toBeCloseTo(
      getPartDef(wheel.defId).wheel!.frictionLong * 1.12,
    );

    world.removeRigidBody(assembled.body);
    world.free();
  });

  it('defaults an unknown persisted suspension preset to standard', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const wheel = {
      ...part('wheel', 'wheel-standard'),
      config: { suspensionPreset: 'unknown' } as never,
    };
    const assembled = assembleVehicle(
      world,
      blueprint([wheel]),
      getPartDef,
      [],
      { translation: { x: 0, y: 1, z: 0 } },
    );

    expect(assembled.wheels[0].suspension).toEqual(
      getPartDef('wheel-standard').wheel!.suspension,
    );

    world.removeRigidBody(assembled.body);
    world.free();
  });

  it('creates a level-three weapon with scaled damage for catalog and injected definitions', () => {
    const turret = part('turret', 'turret', 3);
    const runtime = createWeapon(turret);

    expect(runtime.def.damage).toBeCloseTo(
      getPartDef('turret').weapon!.damage * 1.24,
    );
    expect(runtime.shotsFired).toBe(0);

    const baseCustom: PartDefinition = {
      ...getPartDef('turret'),
      id: 'custom-turret',
      weapon: { ...getPartDef('turret').weapon!, damage: 20 },
    };
    const custom = createWeapon(
      part('custom', baseCustom.id, 3),
      () => baseCustom,
    );
    expect(custom.def.damage).toBeCloseTo(20 * 1.24);
  });
});

describe('hybrid weapon input', () => {
  it('uses an entry yaw/fire over global input and global input for a missing entry', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const overriddenPart = part('overridden', 'turret', 1, -1);
    const globalPart = part('global', 'turret', 1, 1);
    const assembled = assembleVehicle(
      world,
      blueprint([overriddenPart, globalPart]),
      getPartDef,
      [],
      { translation: { x: 0, y: 1, z: 0 } },
    );
    const overridden = createWeapon(overriddenPart);
    const global = createWeapon(globalPart);

    const result = stepWeapons(
      world,
      assembled,
      [overridden, global],
      new Set([overridden.partId, global.partId]),
      {
        aimYawWorld: -Math.PI / 2,
        fire: true,
        weaponAim: new Map([
          [overridden.partId, { aimYawWorld: Math.PI / 2, fire: false }],
        ]),
      },
      100,
      1_000,
      0.1,
    );

    expect(overridden.yaw).toBeCloseTo(0.32);
    expect(overridden.shotsFired).toBe(0);
    expect(global.yaw).toBeCloseTo(-0.32);
    expect(global.shotsFired).toBe(1);
    expect(result.shots).toHaveLength(1);

    world.removeRigidBody(assembled.body);
    world.free();
  });

  it('pitches an elevated automatic turret down toward its target centre', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const elevated = {
      ...part('elevated', 'turret'),
      pos: { x: 0, y: 3, z: 0 },
    };
    const assembled = assembleVehicle(
      world,
      blueprint([elevated]),
      getPartDef,
      [],
      { translation: { x: 0, y: 0, z: 0 } },
    );
    const weapon = createWeapon(elevated);

    const result = stepWeapons(
      world,
      assembled,
      [weapon],
      new Set([weapon.partId]),
      { aimYawWorld: 0, fire: true, aimPoint: { x: 0, y: 0.9, z: 10 } },
      100,
      1_000,
      1,
    );

    expect(result.shots).toHaveLength(1);
    expect(result.shots[0].to.y).toBeLessThan(result.shots[0].from.y);
    expect(result.shots[0].to.y - result.shots[0].from.y).toBeLessThan(-1);

    world.removeRigidBody(assembled.body);
    world.free();
  });
});
