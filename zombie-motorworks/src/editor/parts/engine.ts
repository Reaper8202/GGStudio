/**
 * Engine mesh: a V8 rather than a block with pipes on it.
 *
 * The part drops the generic cell cube entirely — a crankcase and sump under
 * two heads canted out into a V, an intake manifold and air cleaner in the
 * valley, log manifolds down both flanks, and a pulley and fan on the nose.
 *
 * Placement still has to work off it. The editor steps a build-face hit 0.3 of
 * a cell along its normal (`FACE_STEP_M` in `EditorMode.ts`), so a surface
 * within that of the cell boundary resolves into the neighbour: the crankcase,
 * sump, valve covers and air cleaner carry `placementSurface` and between them
 * sit close enough to all six faces. Everything else is detail the raycast
 * passes straight through.
 *
 * Modelled in part-local axes — crank along Z, nose at -Z, V opening up across
 * X — and rotated by the placed orientation.
 */

import * as THREE from 'three';
import { CELL_SIZE, type OrientationIndex, type Vec3 } from '../../core/types.ts';
import {
  DARK_STEEL,
  STEEL,
  boxWithEdges,
  lambert,
  orientationQuaternion,
  shade,
} from './shared.ts';

/** Half-angle of the V, radians. */
const BANK_ANGLE = 0.38;

/** Exhaust port positions along the crank, as fractions of the cell. */
const PORT_OFFSETS = [-0.27, -0.09, 0.09, 0.27];

export function buildEngineMesh(
  centre: Vec3,
  orient: OrientationIndex,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(orient));

  const alloy = lambert(shade(STEEL, 1.35), opacity);
  const steel = lambert(STEEL, opacity);
  const darkSteel = lambert(DARK_STEEL, opacity);
  const coverColor = shade(color, 1.2);

  // Sump and crankcase.
  const sump = boxWithEdges(s * 0.58, s * 0.22, s * 0.64, shade(color, 0.78), opacity);
  sump.position.y = -s * 0.36;
  group.add(sump);
  const crankcase = boxWithEdges(s * 0.72, s * 0.4, s * 0.86, color, opacity);
  crankcase.position.y = -s * 0.08;
  group.add(crankcase);

  // Cylinder banks canted out into the V, each capped with a valve cover.
  for (const side of [-1, 1]) {
    const lean = -side * BANK_ANGLE;
    const up = new THREE.Vector3(Math.sin(BANK_ANGLE) * side, Math.cos(BANK_ANGLE), 0);

    const bank = boxWithEdges(s * 0.32, s * 0.34, s * 0.8, color, opacity);
    bank.rotation.z = lean;
    bank.position.set(side * s * 0.19, s * 0.13, 0);
    group.add(bank);

    const cover = boxWithEdges(s * 0.28, s * 0.14, s * 0.72, coverColor, opacity);
    cover.rotation.z = lean;
    cover.position.set(
      side * s * 0.19 + up.x * s * 0.22,
      s * 0.13 + up.y * s * 0.22,
      0,
    );
    group.add(cover);
  }

  // Intake manifold filling the valley, topped by a carburettor and the round
  // air cleaner that makes the whole thing read as an engine at a glance.
  const manifold = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.38, s * 0.22, s * 0.62),
    alloy,
  );
  manifold.position.y = s * 0.28;
  group.add(manifold);
  const carb = new THREE.Mesh(new THREE.BoxGeometry(s * 0.2, s * 0.13, s * 0.2), alloy);
  carb.position.set(0, s * 0.43, -s * 0.04);
  group.add(carb);
  const airCleaner = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.23, s * 0.23, s * 0.09, 16),
    darkSteel,
  );
  airCleaner.position.set(0, s * 0.53, -s * 0.04);
  airCleaner.userData.placementSurface = true;
  group.add(airCleaner);
  const wingNut = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.04, s * 0.05, s * 0.05, 6),
    steel,
  );
  wingNut.position.set(0, s * 0.6, -s * 0.04);
  group.add(wingNut);

  // Exhaust: a log manifold down each flank with a port stub per cylinder,
  // finishing flush with the cell face so a neighbouring block never eats it.
  const logGeometry = new THREE.CylinderGeometry(s * 0.07, s * 0.07, s * 0.72, 10);
  const stubGeometry = new THREE.CylinderGeometry(s * 0.05, s * 0.05, s * 0.16, 8);
  for (const side of [-1, 1]) {
    const log = new THREE.Mesh(logGeometry, alloy);
    log.rotation.x = Math.PI / 2; // cylinder +Y -> local Z
    log.position.set(side * s * 0.42, s * 0.02, 0);
    group.add(log);
    for (const z of PORT_OFFSETS) {
      const stub = new THREE.Mesh(stubGeometry, alloy);
      stub.rotation.z = Math.PI / 2; // cylinder +Y -> local X
      stub.position.set(side * s * 0.36, s * 0.06, z * s);
      group.add(stub);
    }
    const downpipe = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.06, s * 0.06, s * 0.3, 8),
      steel,
    );
    downpipe.position.set(side * s * 0.42, -s * 0.14, s * 0.3);
    group.add(downpipe);
  }

  // Nose: crank pulley, water pump snout and a fan.
  const pulley = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.17, s * 0.17, s * 0.06, 14),
    darkSteel,
  );
  pulley.rotation.x = Math.PI / 2;
  pulley.position.set(0, -s * 0.14, -s * 0.47);
  group.add(pulley);
  const snout = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.1, s * 0.12, s * 0.16, 10),
    steel,
  );
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, s * 0.02, -s * 0.48);
  group.add(snout);

  const fanHub = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.07, s * 0.07, s * 0.05, 10),
    darkSteel,
  );
  fanHub.rotation.x = Math.PI / 2;
  fanHub.position.set(0, s * 0.02, -s * 0.55);
  group.add(fanHub);
  const bladeGeometry = new THREE.BoxGeometry(s * 0.09, s * 0.26, s * 0.02);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const blade = new THREE.Mesh(bladeGeometry, darkSteel);
    // 'ZYX' applies the pitch about the blade's own length first, then swings
    // it round the fan axis — plain XYZ order would bend two of the four.
    blade.rotation.set(0, 0.4, angle, 'ZYX');
    blade.position.set(-Math.sin(angle) * s * 0.19, s * 0.02 + Math.cos(angle) * s * 0.19, -s * 0.55);
    group.add(blade);
  }

  return group;
}
