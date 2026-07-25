import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { createEmptyBlueprint } from '../src/core/blueprint.ts';
import { placeCommand } from '../src/core/commands.ts';
import { getPartDef } from '../src/core/parts.ts';
import type { PlacedPart, VehicleBlueprint } from '../src/core/types.ts';
import {
  defaultConfigForDef,
  withAutomaticWheelConfigs,
} from '../src/editor/EditorMode.ts';
import { assembleVehicle } from '../src/runtime/assembler.ts';

function wheel(config: PlacedPart['config']): PlacedPart {
  return {
    id: 'wheel',
    defId: 'wheel-standard',
    pos: { x: 0, y: 0, z: 0 },
    orient: 0,
    config,
  };
}

function blueprint(part: PlacedPart): VehicleBlueprint {
  return {
    schemaVersion: 4,
    id: 'wheel-config-test',
    name: 'Wheel config test',
    parts: [part],
  };
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('authoritative wheel configuration', () => {
  it('places a new wheel with drive and braking enabled while steering stays automatic', () => {
    const placed = placeCommand(
      wheel(defaultConfigForDef(getPartDef('wheel-standard'))),
    ).apply(createEmptyBlueprint('wheel defaults'));
    const configured = withAutomaticWheelConfigs(placed);

    expect(configured.parts[0].config).toMatchObject({
      driven: true,
      braking: true,
      steerInverted: false,
    });
    expect(configured.parts[0].config.steering).toBeUndefined();
  });

  it('re-derives the complete front steering axle after sequential placements', () => {
    const placements: PlacedPart[] = [
      {
        id: 'root',
        defId: 'chassis-core',
        pos: { x: 0, y: 1, z: 0 },
        orient: 0,
        config: {},
      },
      {
        id: 'front-left',
        defId: 'wheel-standard',
        pos: { x: -1, y: 0, z: 2 },
        orient: 0,
        config: defaultConfigForDef(getPartDef('wheel-standard')),
      },
      {
        id: 'front-right',
        defId: 'wheel-standard',
        pos: { x: 1, y: 0, z: 2 },
        orient: 0,
        config: defaultConfigForDef(getPartDef('wheel-standard')),
      },
      {
        id: 'rear-left',
        defId: 'wheel-standard',
        pos: { x: -1, y: 0, z: -2 },
        orient: 0,
        config: defaultConfigForDef(getPartDef('wheel-standard')),
      },
      {
        id: 'rear-right',
        defId: 'wheel-standard',
        pos: { x: 1, y: 0, z: -2 },
        orient: 0,
        config: defaultConfigForDef(getPartDef('wheel-standard')),
      },
    ];
    let placed = createEmptyBlueprint('sequential wheel layout');
    for (const next of placements) {
      placed = withAutomaticWheelConfigs(placeCommand(next).apply(placed));
    }

    const placedWheels = placed.parts.filter((part) =>
      getPartDef(part.defId).wheel,
    );
    expect(placedWheels.every((part) => part.config.steering === undefined)).toBe(
      true,
    );

    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const assembled = assembleVehicle(
      world,
      placed,
      getPartDef,
      [],
      { translation: { x: 0, y: 1, z: 0 } },
    );
    const steeringByPartId = new Map(
      assembled.wheels.map((runtimeWheel) => [
        runtimeWheel.partId,
        runtimeWheel.steering,
      ]),
    );

    expect(steeringByPartId.get('front-left')).toBe(true);
    expect(steeringByPartId.get('front-right')).toBe(true);
    expect(steeringByPartId.get('rear-left')).toBe(false);
    expect(steeringByPartId.get('rear-right')).toBe(false);

    world.removeRigidBody(assembled.body);
    world.free();
  });

  it('preserves explicit driven false in editor automatic configuration', () => {
    const configured = withAutomaticWheelConfigs(blueprint(wheel({ driven: false })));

    expect(configured.parts[0].config.driven).toBe(false);
  });

  it('preserves explicit driven false during runtime assembly', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const assembled = assembleVehicle(
      world,
      blueprint(wheel({ driven: false })),
      getPartDef,
      [],
      { translation: { x: 0, y: 1, z: 0 } },
    );

    expect(assembled.wheels[0].driven).toBe(false);
    world.removeRigidBody(assembled.body);
    world.free();
  });

  it('retains automatic drive fallback for a legacy wheel', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const assembled = assembleVehicle(
      world,
      blueprint(wheel({})),
      getPartDef,
      [],
      { translation: { x: 0, y: 1, z: 0 } },
    );

    expect(assembled.wheels[0].driven).toBe(true);
    world.removeRigidBody(assembled.body);
    world.free();
  });
});
