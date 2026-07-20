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
  it('places a new wheel with drive, steering, and braking enabled', () => {
    const placed = placeCommand(
      wheel(defaultConfigForDef(getPartDef('wheel-standard'))),
    ).apply(createEmptyBlueprint('wheel defaults'));
    const configured = withAutomaticWheelConfigs(placed);

    expect(configured.parts[0].config).toMatchObject({
      driven: true,
      steering: true,
      braking: true,
      steerInverted: false,
    });
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
