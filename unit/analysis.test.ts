import { describe, expect, it } from 'vitest';
import {
  analyzeVehicle,
  convexHull2D,
  pointToPolygonSignedDistance,
} from '../src/core/analysis.ts';
import { orientationFromSteps } from '../src/core/grid.ts';
import { placedCellMasses } from '../src/core/mass.ts';
import { getPartDef } from '../src/core/parts.ts';
import type { PartConfig, VehicleBlueprint } from '../src/core/types.ts';

const RIGHT_WHEEL_ORIENTATION = orientationFromSteps(0, 2, 0);

function blueprint(parts: VehicleBlueprint['parts']): VehicleBlueprint {
  return {
    schemaVersion: 3,
    id: 'analysis-test',
    name: 'analysis-test',
    parts,
  };
}

function part(
  id: string,
  defId: string,
  x: number,
  y: number,
  z: number,
  orient = 0,
  config: PartConfig = {},
): VehicleBlueprint['parts'][number] {
  return { id, defId, pos: { x, y, z }, orient, config };
}

function codes(report: ReturnType<typeof analyzeVehicle>): string[] {
  return report.warnings.map((warning) => warning.code);
}

function symmetricFrameParts(): VehicleBlueprint['parts'] {
  return [
    part('f-rl', 'frame-box', -1, 1, -1),
    part('f-rr', 'frame-box', 1, 1, -1),
    part('f-fl', 'frame-box', -1, 1, 1),
    part('f-fr', 'frame-box', 1, 1, 1),
  ];
}

function fourWheels(
  config: PartConfig = { driven: true, steering: true },
): VehicleBlueprint['parts'] {
  return [
    part('w-rl', 'wheel-standard', -2, 1, -1, 0, config),
    part('w-rr', 'wheel-standard', 2, 1, -1, RIGHT_WHEEL_ORIENTATION, config),
    part('w-fl', 'wheel-standard', -2, 1, 1, 0, config),
    part('w-fr', 'wheel-standard', 2, 1, 1, RIGHT_WHEEL_ORIENTATION, config),
  ];
}

describe('analyzeVehicle mass properties', () => {
  it('computes hand-checked total mass and centre of mass for an asymmetric 3-part rig', () => {
    const bp = blueprint([
      part('core', 'chassis-core', 0, 0, 0),
      part('frame', 'frame-box', 1, 0, 0),
      part('fuel', 'fuel-tank', 0, 0, 1),
    ]);

    const report = analyzeVehicle(bp, getPartDef);

    expect(report.totalMassKg).toBe(140);
    expect(report.totalCost).toBe(30);
    const masses = [
      ...placedCellMasses(getPartDef('chassis-core'), bp.parts[0]),
      ...placedCellMasses(getPartDef('frame-box'), bp.parts[1]),
      ...placedCellMasses(getPartDef('fuel-tank'), bp.parts[2]),
    ];
    const expected = {
      x:
        masses.reduce((sum, mass) => sum + mass.centreM.x * mass.massKg, 0) /
        140,
      y:
        masses.reduce((sum, mass) => sum + mass.centreM.y * mass.massKg, 0) /
        140,
      z:
        masses.reduce((sum, mass) => sum + mass.centreM.z * mass.massKg, 0) /
        140,
    };
    expect(report.centreOfMass.x).toBeCloseTo(expected.x, 8);
    expect(report.centreOfMass.y).toBeCloseTo(expected.y, 8);
    expect(report.centreOfMass.z).toBeCloseTo(expected.z, 8);
  });
});

describe('analyzeVehicle wheels and stability', () => {
  it('gives a symmetric 4-wheel rig equal loads, balanced fractions, and a valid support hull', () => {
    const report = analyzeVehicle(
      blueprint([...symmetricFrameParts(), ...fourWheels()]),
      getPartDef,
    );

    expect(report.wheelContacts).toHaveLength(4);
    for (const contact of report.wheelContacts) {
      expect(contact.grounded).toBe(true);
      expect(contact.load).toBeCloseTo(report.totalMassKg * 9.81 * 0.25, -1);
    }
    expect(report.leftMassFraction).toBeCloseTo(0.5, 8);
    expect(report.frontMassFraction).toBeCloseTo(0.5, 8);
    expect(report.supportPolygon).toHaveLength(4);
    expect(report.stabilityMarginM).toBeGreaterThan(0);
  });

  it('moves the front mass fraction forward when an engine is placed at the front', () => {
    const report = analyzeVehicle(
      blueprint([
        ...symmetricFrameParts(),
        ...fourWheels(),
        part('engine', 'engine-small', 0, 0, 2),
      ]),
      getPartDef,
    );

    expect(report.frontMassFraction).toBeGreaterThan(0.5);
  });

  it('marks a sideways wheel as misoriented and not grounded', () => {
    const sideways = orientationFromSteps(0, 0, 1);
    const report = analyzeVehicle(
      blueprint([
        part('wheel', 'wheel-standard', 0, 1, 0, sideways, {
          driven: true,
          steering: true,
        }),
      ]),
      getPartDef,
    );

    expect(codes(report)).toContain('WHEEL_AXLE_ORIENTATION');
    expect(report.wheelContacts[0].grounded).toBe(false);
  });

  it('reports a floating wheel higher than the other wheels', () => {
    const wheels = fourWheels();
    wheels[3] = part(
      'w-fr',
      'wheel-standard',
      2,
      2,
      1,
      RIGHT_WHEEL_ORIENTATION,
      { driven: true, steering: true },
    );
    const report = analyzeVehicle(
      blueprint([...symmetricFrameParts(), ...wheels]),
      getPartDef,
    );

    expect(codes(report)).toContain('WHEELS_NOT_GROUNDED');
    expect(
      report.wheelContacts.find((contact) => contact.partId === 'w-fr')
        ?.grounded,
    ).toBe(false);
  });

  it('reports wheels without driven configuration', () => {
    const report = analyzeVehicle(
      blueprint([...symmetricFrameParts(), ...fourWheels({ steering: true })]),
      getPartDef,
    );

    expect(codes(report)).toContain('NO_DRIVEN_WHEELS');
  });

  it('flags a tall narrow stack as high rollover risk', () => {
    const tower = Array.from({ length: 8 }, (_, index) =>
      part(`tower-${index}`, 'frame-reinforced', 0, index, 0),
    );
    const report = analyzeVehicle(
      blueprint([
        ...tower,
        part('w-l', 'wheel-standard', -1, 1, 0, 0, {
          driven: true,
          steering: true,
        }),
        part('w-r', 'wheel-standard', 0, 1, 0, 0, {
          driven: true,
          steering: true,
        }),
      ]),
      getPartDef,
    );

    expect(codes(report)).toContain('HIGH_COM');
    expect(['high', 'extreme']).toContain(report.rolloverRisk);
  });

  it('flags suspension overload on light wheels under a heavy stack', () => {
    const heavy = Array.from({ length: 120 }, (_, index) =>
      part(
        `heavy-${index}`,
        'frame-reinforced',
        index % 10,
        Math.floor(index / 10),
        0,
      ),
    );
    const report = analyzeVehicle(
      blueprint([
        ...heavy,
        ...fourWheels({
          driven: true,
          steering: true,
          suspensionPreset: 'light',
        }),
      ]),
      getPartDef,
    );

    expect(codes(report)).toContain('SUSPENSION_OVERLOAD');
  });
});

describe('analysis geometry helpers', () => {
  it('builds a square convex hull and removes collinear interior points', () => {
    const hull = convexHull2D([
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 0.5, z: 0 },
      { x: 1, z: 1 },
      { x: 0, z: 1 },
      { x: 0.5, z: 1 },
    ]);

    expect(hull).toEqual([
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 1, z: 1 },
      { x: 0, z: 1 },
    ]);
  });

  it('returns a negative stability margin when the point is outside the hull', () => {
    const hull = [
      { x: -1, z: -1 },
      { x: 1, z: -1 },
      { x: 1, z: 1 },
      { x: -1, z: 1 },
    ];

    expect(pointToPolygonSignedDistance({ x: 0, z: 0 }, hull)).toBeGreaterThan(
      0,
    );
    expect(pointToPolygonSignedDistance({ x: 2, z: 0 }, hull)).toBeLessThan(0);
  });
});
