/**
 * Melee weapon meshes: grinder drum, long spikes, sawblade.
 *
 * All three are contact weapons — they damage whatever the vehicle drives into
 * — so each one is modelled to fill the cells it actually reserves. A player
 * has to be able to read the reach off the silhouette, because that reach is
 * the whole weapon.
 *
 * Nothing mounts onto a melee weapon (`blocksAttachments` in core/placement),
 * so the drum and the blade each carry their own modelled mount: the hardware
 * that bolts them to the rig is part of the part, not a bare face waiting for
 * a neighbour.
 */

import * as THREE from 'three';
import { CELL_SIZE, type PartDefinition, type PlacedPart } from '../../core/types.ts';
import { rotateVec } from '../../core/grid.ts';
import { cellCentreM } from '../../core/mass.ts';
import { DARK_STEEL, STEEL, boltRing, lambert, orientationQuaternion } from './shared.ts';

const TOOTH_COLOR = 0x2b2e33;
const BLADE_STEEL = 0xb7bcc2;

/** Cylinder running down the group's local +Z. */
function pipe(
  radiusFront: number,
  radiusBack: number,
  length: number,
  z: number,
  material: THREE.Material,
  segments = 12,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusFront, radiusBack, length, segments),
    material,
  );
  mesh.rotation.x = Math.PI / 2; // cylinder +Y -> local +Z
  mesh.position.z = z;
  return mesh;
}

export function buildMeleeMesh(
  def: PartDefinition,
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  switch (def.melee?.visual) {
    case 'spikes':
      return buildSpikes(placed, color, opacity);
    case 'blade':
      return buildSawblade(placed, color, opacity);
    default:
      return buildDrum(def, placed, color, opacity);
  }
}

/**
 * Long Spikes: a bolted back plate, a shaft running the part's two cells, and
 * a pike whose tip reaches the far edge of the second cell. Built along local
 * +Z so the reach follows the part's forward axis like every other weapon.
 */
function buildSpikes(placed: PlacedPart, color: number, opacity: number): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  group.name = 'melee-spikes';
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(placed.orient));

  const body = lambert(color, opacity);
  const steel = lambert(STEEL, opacity);
  const blade = lambert(BLADE_STEEL, opacity);

  // Back plate, flush with the mounting face so it reads as bolted on.
  const plate = new THREE.Mesh(new THREE.BoxGeometry(s * 0.86, s * 0.86, s * 0.14), body);
  plate.position.z = -s * 0.43;
  plate.userData.placementSurface = true;
  group.add(plate);
  group.add(
    boltRing({
      count: 4,
      radius: s * 0.3,
      headRadius: s * 0.05,
      length: s * 0.07,
      axis: new THREE.Vector3(0, 0, -1),
      centre: new THREE.Vector3(0, 0, -s * 0.5),
      phase: Math.PI / 4,
      opacity,
    }),
  );

  // Shaft down the middle of both cells, collared where the pike takes over.
  const shaft = pipe(s * 0.16, s * 0.22, s * 0.96, s * 0.12, body, 10);
  shaft.userData.placementSurface = true;
  group.add(shaft);
  for (const z of [-s * 0.16, s * 0.5]) {
    group.add(pipe(s * 0.25, s * 0.25, s * 0.08, z, lambert(DARK_STEEL, opacity), 10));
  }

  // The pike itself: tip on the far boundary of the second cell.
  const pike = new THREE.Mesh(new THREE.ConeGeometry(s * 0.19, s * 0.94, 8), blade);
  pike.rotation.x = Math.PI / 2;
  pike.position.z = s * 1.03;
  group.add(pike);

  // Barbs swept back off the collar, so a glancing hit still catches.
  for (const side of [-1, 1]) {
    for (const axis of ['x', 'y'] as const) {
      const barb = new THREE.Mesh(new THREE.ConeGeometry(s * 0.07, s * 0.4, 6), steel);
      const lateral = side * s * 0.2;
      barb.position.set(axis === 'x' ? lateral : 0, axis === 'y' ? lateral : 0, s * 0.62);
      barb.rotation.set(
        axis === 'y' ? Math.PI / 2 - side * 0.6 : Math.PI / 2,
        0,
        axis === 'x' ? side * 0.6 : 0,
      );
      group.add(barb);
    }
  }
  return group;
}

/**
 * Sawblade: a horizontal disc filling its 2x2 pad, hung off a back plate by an
 * arm and a gearbox. The mount is modelled rather than implied, which is what
 * makes the blade read as bolted to the block behind it instead of floating
 * next to it.
 */
function buildSawblade(placed: PlacedPart, color: number, opacity: number): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  group.name = 'melee-blade';
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  // Only the four level turns are allowed for this part, so the disc stays
  // horizontal and the pad stays in the ground plane.
  group.quaternion.copy(orientationQuaternion(placed.orient));

  const body = lambert(color, opacity);
  const steel = lambert(STEEL, opacity);
  const dark = lambert(DARK_STEEL, opacity);

  // Hub centre of the 2x2 pad, one half-cell forward and one to the side.
  const hubX = s * 0.5;
  const hubZ = s * 0.5;
  const armY = s * 0.4;

  // Back plate across both mounting cells, flush with the mounting face.
  const plate = new THREE.Mesh(new THREE.BoxGeometry(s * 1.7, s * 0.8, s * 0.14), body);
  plate.position.set(hubX, s * 0.1, -s * 0.43);
  plate.userData.placementSurface = true;
  group.add(plate);
  group.add(
    boltRing({
      count: 6,
      radius: s * 0.55,
      headRadius: s * 0.05,
      length: s * 0.07,
      axis: new THREE.Vector3(0, 0, -1),
      centre: new THREE.Vector3(hubX, s * 0.1, -s * 0.5),
      opacity,
    }),
  );

  // Arm out to the hub, with the drive housing sat over the plate.
  const arm = new THREE.Mesh(new THREE.BoxGeometry(s * 0.34, s * 0.28, s * 1.0), steel);
  arm.position.set(hubX, armY, hubZ - s * 0.5);
  group.add(arm);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(s * 0.5, s * 0.5, s * 0.5), body);
  housing.position.set(hubX, armY + s * 0.06, -s * 0.14);
  group.add(housing);

  // Spindle from the arm down onto the blade hub.
  const spindle = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.09, s * 0.11, armY, 10),
    dark,
  );
  spindle.position.set(hubX, armY / 2, hubZ);
  group.add(spindle);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.28, s * 0.3, s * 0.22, 12), steel);
  hub.position.set(hubX, s * 0.06, hubZ);
  group.add(hub);
  group.add(
    boltRing({
      count: 5,
      radius: s * 0.19,
      headRadius: s * 0.04,
      length: s * 0.06,
      axis: new THREE.Vector3(0, 1, 0),
      centre: new THREE.Vector3(hubX, s * 0.16, hubZ),
      opacity,
    }),
  );

  // The disc: as wide as the pad it reserves, teeth around the rim.
  const radius = s * 0.95;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, s * 0.16, 28), body);
  disc.position.set(hubX, 0, hubZ);
  disc.userData.placementSurface = true;
  group.add(disc);
  const toothMaterial = lambert(TOOTH_COLOR, opacity);
  const toothCount = 20;
  for (let i = 0; i < toothCount; i++) {
    const angle = (i / toothCount) * Math.PI * 2;
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(s * 0.1, s * 0.2, 4), toothMaterial);
    tooth.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)),
    );
    tooth.position.set(hubX + Math.cos(angle) * radius, 0, hubZ + Math.sin(angle) * radius);
    group.add(tooth);
  }
  return group;
}

/**
 * Grinder drum: one studded cylinder spanning the part's cells along its local
 * X. The group's local +Y is the spin axis.
 */
function buildDrum(
  def: PartDefinition,
  placed: PlacedPart,
  color: number,
  opacity: number,
): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  group.name = 'melee-drum';
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  // Local +Y (the spin axis) follows the part's local X once rotated into the
  // vehicle frame by its placed orientation.
  const axle = rotateVec(placed.orient, { x: 1, y: 0, z: 0 });
  group.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(axle.x, axle.y, axle.z),
  );

  const radius = s * 0.48;
  const length = def.cells.length * s * 0.96;
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 14),
    lambert(color, opacity),
  );
  drum.userData.placementSurface = true;
  group.add(drum);

  const toothMaterial = lambert(TOOTH_COLOR, opacity);
  const toothGeometry = new THREE.BoxGeometry(s * 0.14, s * 0.1, s * 0.14);
  const rings = def.cells.length * 2;
  for (let ring = 0; ring < rings; ring++) {
    const y = -length / 2 + ((ring + 0.5) / rings) * length;
    for (let toothIndex = 0; toothIndex < 5; toothIndex++) {
      const angle = (toothIndex / 5) * Math.PI * 2 + ring * 0.55;
      const tooth = new THREE.Mesh(toothGeometry, toothMaterial);
      tooth.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      group.add(tooth);
    }
  }
  return group;
}
