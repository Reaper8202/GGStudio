/**
 * Fuel tank mesh: an upright fuel drum.
 *
 * The barrel body is the part's only placement surface. Its flat top and bottom
 * land exactly on the cell faces, and the editor resolves a curved side hit by
 * its dominant axis (see `updateGhost` in `EditorMode.ts`), so building off a
 * drum behaves the same as building off a block.
 *
 * Everything else is deliberately sparse — rolling hoops for the silhouette,
 * a valve on top, a sight gauge on each flank.
 */

import * as THREE from 'three';
import { CELL_SIZE, type PlacedPart } from '../../core/types.ts';
import { cellCentreM } from '../../core/mass.ts';
import {
  DARK_STEEL,
  STEEL,
  glowLambert,
  lambert,
  orientationQuaternion,
  shade,
} from './shared.ts';

const FUEL_AMBER = 0xf2a33c;

/**
 * Builds the drum in cell-local metres, standing on local +Y, then plants it at
 * the cell centre under the placed rotation.
 */
export function buildFuelTankMesh(
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(placed.orient));

  const steel = lambert(STEEL, opacity);
  const darkSteel = lambert(DARK_STEEL, opacity);
  const radius = s * 0.49;

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, s * 0.98, 20),
    lambert(color, opacity),
  );
  barrel.userData.placementSurface = true;
  group.add(barrel);

  // Rolling hoops and end chimes: raised rings in a darker tone, the detail
  // that makes a cylinder read as a barrel.
  const hoopGeometry = new THREE.CylinderGeometry(radius * 1.05, radius * 1.05, s * 0.09, 20);
  const chimeGeometry = new THREE.CylinderGeometry(radius * 1.03, radius * 1.03, s * 0.06, 20);
  const bandMaterial = lambert(shade(color, 0.74), opacity);
  for (const side of [-1, 1]) {
    const hoop = new THREE.Mesh(hoopGeometry, bandMaterial);
    hoop.position.y = side * s * 0.17;
    group.add(hoop);

    // Kept clear of the lid plane: a chime flush with the barrel end would put
    // two coplanar faces on the top face and z-fight.
    const chime = new THREE.Mesh(chimeGeometry, bandMaterial);
    chime.position.y = side * s * 0.4;
    group.add(chime);
  }

  // Filler valve, offset from the lid centre like a real bung.
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.12, s * 0.14, s * 0.09, 12),
    steel,
  );
  neck.position.set(0, s * 0.52, -s * 0.2);
  group.add(neck);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.14, s * 0.15, s * 0.07, 6),
    darkSteel,
  );
  cap.position.set(0, s * 0.58, -s * 0.2);
  group.add(cap);

  // Sight gauge on both flanks: a dark frame around a lit fuel column.
  const frameGeometry = new THREE.BoxGeometry(s * 0.05, s * 0.5, s * 0.14);
  const columnGeometry = new THREE.BoxGeometry(s * 0.05, s * 0.32, s * 0.08);
  const fuelMaterial = glowLambert(FUEL_AMBER, opacity, 0.55);
  for (const side of [-1, 1]) {
    const frame = new THREE.Mesh(frameGeometry, darkSteel);
    frame.position.set(side * radius * 0.98, 0, 0);
    group.add(frame);

    const column = new THREE.Mesh(columnGeometry, fuelMaterial);
    column.position.set(side * radius, -s * 0.05, 0);
    group.add(column);
  }

  return group;
}
