/**
 * Armour plate meshes.
 *
 * A plate is a layered slab: a wide mounting flange bolted to the host block, a
 * stepped face plate on top of it, and a welded X-brace across the face. It is
 * modelled with its outward normal along local +Y and then rotated so that
 * normal points away from whatever it was bolted to — the plate lies flat
 * against the host face instead of standing perpendicular to it.
 *
 * `ARMOUR_FACE_AXIS` is the contract for that: the editor picks the placement
 * orientation by sending this local axis to the face normal it was dropped on.
 */

import * as THREE from 'three';
import { CELL_SIZE, type PartDefinition, type PlacedPart, type Vec3i } from '../../core/types.ts';
import { FACE_VECTORS, rotateFace } from '../../core/grid.ts';
import { cellCentreM } from '../../core/mass.ts';
import {
  DARK_STEEL,
  boltRing,
  edgesOf,
  lambert,
  orientationQuaternion,
  shade,
  toVector3,
} from './shared.ts';

/** Local axis the plate's outward face points along at orientation 0. */
export const ARMOUR_FACE_AXIS: Vec3i = { x: 0, y: 1, z: 0 };

/**
 * The layered plate itself, built flat in the XZ plane with its outward face
 * along +Y and its mounting face at -thickness/2.
 */
function armourSlab(width: number, thickness: number, color: number, opacity: number): THREE.Group {
  const group = new THREE.Group();
  const flangeThickness = thickness * 0.42;
  // Sunk a little into the flange: butting the two layers face to face would
  // leave coplanar surfaces to z-fight.
  const plateThickness = thickness - flangeThickness * 0.7;

  // Mounting flange: the full footprint, the part the host block sees.
  const flange = new THREE.Mesh(
    new THREE.BoxGeometry(width, flangeThickness, width),
    lambert(shade(color, 0.82), opacity),
  );
  flange.position.y = -thickness / 2 + flangeThickness / 2;
  flange.userData.placementSurface = true;
  group.add(flange);
  const flangeEdges = edgesOf(flange.geometry, opacity);
  flangeEdges.position.copy(flange.position);
  group.add(flangeEdges);

  // Face plate: stepped in from the flange so the plate reads as two layers.
  const faceWidth = width * 0.78;
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(faceWidth, plateThickness, faceWidth),
    lambert(color, opacity),
  );
  plate.position.y = thickness / 2 - plateThickness / 2;
  plate.userData.placementSurface = true;
  group.add(plate);
  const plateEdges = edgesOf(plate.geometry, opacity);
  plateEdges.position.copy(plate.position);
  group.add(plateEdges);

  // Welded X-brace across the face.
  const braceGeometry = new THREE.BoxGeometry(
    faceWidth * 1.24,
    thickness * 0.16,
    faceWidth * 0.13,
  );
  const braceMaterial = lambert(shade(color, 1.16), opacity);
  for (const turn of [1, -1]) {
    const brace = new THREE.Mesh(braceGeometry, braceMaterial);
    brace.rotation.y = (turn * Math.PI) / 4;
    brace.position.y = thickness / 2 + thickness * 0.04;
    group.add(brace);
  }

  // Bolts: four at the flange corners, four more at the edge midpoints.
  const boltHead = width * 0.055;
  const flangeTop = -thickness / 2 + flangeThickness;
  const corner = width * 0.42;
  group.add(
    boltRing({
      count: 4,
      radius: corner * Math.SQRT2,
      headRadius: boltHead,
      length: flangeThickness * 1.2,
      axis: new THREE.Vector3(0, 1, 0),
      centre: new THREE.Vector3(0, flangeTop, 0),
      phase: Math.PI / 4,
      color: DARK_STEEL,
      opacity,
    }),
  );
  group.add(
    boltRing({
      count: 4,
      radius: width * 0.44,
      headRadius: boltHead * 0.85,
      length: flangeThickness * 1.05,
      axis: new THREE.Vector3(0, 1, 0),
      centre: new THREE.Vector3(0, flangeTop, 0),
      color: DARK_STEEL,
      opacity,
    }),
  );
  return group;
}

/**
 * Cell-occupying armour plate. It hugs the far side of its own cell so the
 * flange sits flush against the block it was bolted to.
 */
export function buildArmourPlateMesh(
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const thickness = s * 0.34;
  const group = new THREE.Group();
  const slab = armourSlab(s * 0.98, thickness, color, opacity);
  slab.quaternion.copy(orientationQuaternion(placed.orient));

  // The host block is on the -normal side of this cell; sit the mounting face
  // against it rather than floating in the middle of the cell.
  const centre = cellCentreM(placed.pos);
  const normal = toVector3(ARMOUR_FACE_AXIS).applyQuaternion(slab.quaternion);
  slab.position
    .set(centre.x, centre.y, centre.z)
    .addScaledVector(normal, thickness / 2 - s / 2);
  group.add(slab);
  return group;
}

/**
 * Face-mounted armour: no cell of its own, so the slab sits on the covered face
 * of the host cell. Thin by definition — it is a skin, not a block.
 */
export function buildFaceArmourMesh(
  def: PartDefinition,
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const thickness = 0.07;
  const group = new THREE.Group();
  const face = rotateFace(placed.orient, def.sockets[0]?.face ?? 'pz');
  const normal = toVector3(FACE_VECTORS[face]);
  const slab = armourSlab(
    s * 0.98,
    thickness,
    color,
    def.armour?.cosmetic ? Math.min(opacity, 0.9) : opacity,
  );
  slab.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

  const centre = cellCentreM(placed.pos);
  slab.position
    .set(centre.x, centre.y, centre.z)
    .addScaledVector(normal, s / 2 - thickness / 2);
  group.add(slab);
  return group;
}
