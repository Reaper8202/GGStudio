/**
 * Weapon meshes.
 *
 * Every weapon bolts to a hardpoint on the block below it, so they share a
 * skeleton — a bolted traverse ring at the bottom of the cell, a receiver
 * sitting on it, and hardware pointing down the part's forward axis. What makes
 * each one distinct is the business end: twin autocannon barrels, a braked
 * artillery piece, a scoped rifle, a cryo emitter, a flame nozzle.
 *
 * Built in part-local axes (+Z forward, +Y up) and rotated by the placed
 * orientation, so a barrel always points where the part is aimed. Receivers
 * carry `placementSurface` — weapons only socket downwards, but the editor
 * still needs something to hit to select one.
 */

import * as THREE from 'three';
import { CELL_SIZE, type PartDefinition, type PlacedPart } from '../../core/types.ts';
import { cellCentreM } from '../../core/mass.ts';
import {
  DARK_STEEL,
  STEEL,
  boltRing,
  boxWithEdges,
  glowLambert,
  lambert,
  orientationQuaternion,
  shade,
} from './shared.ts';

const GUNMETAL = 0x22262c;
const FROST = 0x8fe3ff;
const PILOT_FLAME = 0xffa03a;

export function buildWeaponMesh(
  def: PartDefinition,
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(placed.orient));

  // Bolted traverse ring: what the whole weapon sits and swings on.
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.38, s * 0.42, s * 0.16, 16),
    lambert(DARK_STEEL, opacity),
  );
  ring.position.y = -s * 0.4;
  ring.userData.placementSurface = true;
  group.add(ring);
  group.add(
    boltRing({
      count: 8,
      radius: s * 0.32,
      headRadius: s * 0.04,
      length: s * 0.06,
      axis: new THREE.Vector3(0, 1, 0),
      centre: new THREE.Vector3(0, -s * 0.33, 0),
      phase: Math.PI / 8,
      opacity,
    }),
  );

  switch (def.id) {
    case 'cannon-heavy':
      buildHeavyCannon(group, color, opacity);
      break;
    case 'sniper-light':
      buildSniper(group, color, opacity);
      break;
    case 'ice-cannon':
      buildIceCannon(group, color, opacity);
      break;
    case 'flamethrower':
      buildFlamethrower(group, color, opacity);
      break;
    default:
      buildAutocannon(group, color, opacity);
      break;
  }
  return group;
}

/** Cylinder running down the part's forward axis. */
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

/** Vented muzzle brake: a collar with baffle plates blown out either side. */
function muzzleBrake(
  s: number,
  radius: number,
  z: number,
  material: THREE.Material,
): THREE.Group {
  const brake = new THREE.Group();
  brake.add(pipe(radius, radius, s * 0.24, z, material, 10));
  const baffleGeometry = new THREE.BoxGeometry(radius * 0.9, radius * 1.7, s * 0.06);
  for (const side of [-1, 1]) {
    for (const offset of [-0.07, 0.07]) {
      const baffle = new THREE.Mesh(baffleGeometry, material);
      baffle.position.set(side * radius * 0.95, 0, z + offset * s);
      brake.add(baffle);
    }
  }
  return brake;
}

/**
 * Default weapon: a belt-fed twin autocannon. Fast-firing and mean-looking —
 * shrouded barrels, an ammo can on the flank and a sight on the roof.
 */
function buildAutocannon(group: THREE.Group, color: number, opacity: number): void {
  const s = CELL_SIZE;
  const gunmetal = lambert(GUNMETAL, opacity);
  const steel = lambert(STEEL, opacity);

  const receiver = boxWithEdges(s * 0.62, s * 0.46, s * 0.72, color, opacity);
  receiver.position.y = -s * 0.06;
  group.add(receiver);
  const mantlet = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.46, s * 0.34, s * 0.2),
    lambert(shade(color, 0.72), opacity),
  );
  mantlet.position.set(0, -s * 0.04, s * 0.4);
  group.add(mantlet);

  // Twin barrels inside a ribbed cooling shroud.
  for (const side of [-1, 1]) {
    const barrel = pipe(s * 0.05, s * 0.055, s * 1.5, s * 1.05, gunmetal, 10);
    barrel.position.x = side * s * 0.11;
    if (side > 0) barrel.name = 'weapon-barrel';
    group.add(barrel);
    const flashHider = pipe(s * 0.09, s * 0.06, s * 0.18, s * 1.74, gunmetal, 8);
    flashHider.position.x = side * s * 0.11;
    group.add(flashHider);
  }
  const shroud = pipe(s * 0.19, s * 0.19, s * 0.44, s * 0.66, steel, 12);
  group.add(shroud);
  for (const z of [0.5, 0.66, 0.82]) {
    group.add(pipe(s * 0.22, s * 0.22, s * 0.04, z * s, lambert(shade(STEEL, 0.8), opacity), 12));
  }

  // Ammo can and the belt running up into the receiver.
  const ammo = boxWithEdges(s * 0.26, s * 0.3, s * 0.44, shade(color, 0.62), opacity);
  ammo.position.set(-s * 0.44, -s * 0.1, -s * 0.06);
  group.add(ammo);
  const linkGeometry = new THREE.BoxGeometry(s * 0.14, s * 0.05, s * 0.06);
  const brass = lambert(0xb08a3a, opacity);
  for (let i = 0; i < 4; i++) {
    const link = new THREE.Mesh(linkGeometry, brass);
    link.position.set(-s * (0.31 - i * 0.03), s * (0.06 + i * 0.02), -s * (0.06 - i * 0.04));
    link.rotation.z = -0.3;
    group.add(link);
  }

  // Boxy optic on the roof.
  const sight = new THREE.Mesh(new THREE.BoxGeometry(s * 0.14, s * 0.12, s * 0.3), gunmetal);
  sight.position.set(0, s * 0.24, s * 0.08);
  group.add(sight);
}

/** Heavy cannon: thick braked barrel, bore evacuator, recoil cylinders. */
function buildHeavyCannon(group: THREE.Group, color: number, opacity: number): void {
  const s = CELL_SIZE;
  const gunmetal = lambert(GUNMETAL, opacity);
  const steel = lambert(STEEL, opacity);

  const receiver = boxWithEdges(s * 0.74, s * 0.56, s * 0.8, color, opacity);
  receiver.position.y = -s * 0.02;
  group.add(receiver);
  // Sloped mantlet: a squat cone reads as a cast gun shield.
  const mantlet = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.26, s * 0.34, s * 0.26, 8),
    lambert(shade(color, 0.7), opacity),
  );
  mantlet.rotation.x = Math.PI / 2;
  mantlet.position.set(0, s * 0.02, s * 0.44);
  group.add(mantlet);

  const barrel = pipe(s * 0.075, s * 0.095, s * 2.1, s * 1.4, gunmetal, 14);
  barrel.name = 'weapon-barrel';
  barrel.position.y = s * 0.02;
  group.add(barrel);
  // Bore evacuator bulge partway down the tube.
  const evacuator = pipe(s * 0.15, s * 0.15, s * 0.3, s * 1.0, steel, 12);
  evacuator.position.y = s * 0.02;
  group.add(evacuator);

  const brake = muzzleBrake(s, s * 0.15, s * 2.34, gunmetal);
  brake.position.y = s * 0.02;
  group.add(brake);

  // Recoil cylinders flanking the breech.
  for (const side of [-1, 1]) {
    const recoil = pipe(s * 0.06, s * 0.06, s * 0.7, s * 0.6, steel, 8);
    recoil.position.set(side * s * 0.19, s * 0.22, s * 0.6);
    group.add(recoil);
  }
}

/** Light sniper: long slim tube, big scope, folded bipod. */
function buildSniper(group: THREE.Group, color: number, opacity: number): void {
  const s = CELL_SIZE;
  const gunmetal = lambert(GUNMETAL, opacity);
  const steel = lambert(STEEL, opacity);

  const receiver = boxWithEdges(s * 0.44, s * 0.32, s * 0.88, color, opacity);
  receiver.position.y = -s * 0.04;
  group.add(receiver);

  const barrel = pipe(s * 0.038, s * 0.05, s * 2.0, s * 1.25, gunmetal, 10);
  barrel.name = 'weapon-barrel';
  barrel.position.y = s * 0.04;
  group.add(barrel);
  // Fluting rings down the tube.
  for (const z of [0.75, 1.15, 1.55]) {
    const collar = pipe(s * 0.065, s * 0.065, s * 0.05, z * s, steel, 10);
    collar.position.y = s * 0.04;
    group.add(collar);
  }
  const brake = muzzleBrake(s, s * 0.08, s * 2.2, gunmetal);
  brake.position.y = s * 0.04;
  group.add(brake);

  // Scope: tube, objective bell and two ring mounts.
  const scope = pipe(s * 0.07, s * 0.07, s * 0.62, s * 0.24, gunmetal, 10);
  scope.position.y = s * 0.32;
  group.add(scope);
  const objective = pipe(s * 0.1, s * 0.08, s * 0.16, s * 0.6, gunmetal, 10);
  objective.position.y = s * 0.32;
  group.add(objective);
  const lens = pipe(s * 0.085, s * 0.085, s * 0.02, s * 0.68, glowLambert(FROST, opacity, 0.4), 10);
  lens.position.y = s * 0.32;
  group.add(lens);
  for (const z of [0.02, 0.42]) {
    const mount = new THREE.Mesh(new THREE.BoxGeometry(s * 0.09, s * 0.16, s * 0.07), steel);
    mount.position.set(0, s * 0.24, z * s);
    group.add(mount);
  }

  // Bipod legs braced forward under the barrel.
  const legGeometry = new THREE.BoxGeometry(s * 0.04, s * 0.42, s * 0.04);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeometry, steel);
    leg.position.set(side * s * 0.14, -s * 0.24, s * 0.62);
    leg.rotation.set(0.5, 0, side * 0.35, 'ZYX');
    group.add(leg);
  }
}

/** Ice cannon: coolant bottles, frosted emitter, glowing aperture prongs. */
function buildIceCannon(group: THREE.Group, color: number, opacity: number): void {
  const s = CELL_SIZE;
  const steel = lambert(STEEL, opacity);
  const gunmetal = lambert(GUNMETAL, opacity);
  const frost = glowLambert(FROST, opacity, 0.7);

  const receiver = boxWithEdges(s * 0.62, s * 0.46, s * 0.68, color, opacity);
  receiver.position.y = -s * 0.04;
  group.add(receiver);
  // Cold plate down each side of the receiver.
  for (const side of [-1, 1]) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(s * 0.04, s * 0.22, s * 0.4), frost);
    vent.position.set(side * s * 0.32, -s * 0.02, -s * 0.06);
    group.add(vent);
  }

  // Coolant bottles flanking the emitter.
  for (const side of [-1, 1]) {
    const bottle = pipe(s * 0.12, s * 0.12, s * 0.56, s * 0.16, steel, 12);
    bottle.position.set(side * s * 0.28, s * 0.18, s * 0.16);
    group.add(bottle);
    const cap = pipe(s * 0.09, s * 0.13, s * 0.08, s * 0.48, gunmetal, 10);
    cap.position.set(side * s * 0.28, s * 0.18, s * 0.48);
    group.add(cap);
  }

  // Emitter tube with frost rings and a lit core.
  const emitter = pipe(s * 0.11, s * 0.13, s * 1.15, s * 0.9, gunmetal, 12);
  emitter.name = 'weapon-barrel';
  emitter.position.y = s * 0.02;
  group.add(emitter);
  for (const z of [0.6, 0.95, 1.3]) {
    const band = pipe(s * 0.15, s * 0.15, s * 0.05, z * s, frost, 12);
    band.position.y = s * 0.02;
    group.add(band);
  }

  // Aperture: four prongs around a glowing core.
  const prongGeometry = new THREE.BoxGeometry(s * 0.05, s * 0.05, s * 0.26);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const prong = new THREE.Mesh(prongGeometry, gunmetal);
    prong.position.set(
      Math.cos(angle) * s * 0.12,
      s * 0.02 + Math.sin(angle) * s * 0.12,
      s * 1.56,
    );
    prong.rotation.set(-Math.sin(angle) * 0.3, Math.cos(angle) * 0.3, 0);
    group.add(prong);
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(s * 0.09, 12, 8), frost);
  core.position.set(0, s * 0.02, s * 1.5);
  group.add(core);
}

/** Flamethrower: pressure bottles, a fuel line and a flared nozzle. */
function buildFlamethrower(group: THREE.Group, color: number, opacity: number): void {
  const s = CELL_SIZE;
  const steel = lambert(STEEL, opacity);
  const gunmetal = lambert(GUNMETAL, opacity);
  const flame = glowLambert(PILOT_FLAME, opacity, 0.8);

  const body = boxWithEdges(s * 0.6, s * 0.44, s * 0.56, color, opacity);
  body.position.set(0, -s * 0.06, -s * 0.1);
  group.add(body);

  // Pressure bottles standing on the back of the body.
  for (const side of [-1, 1]) {
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.14, s * 0.14, s * 0.5, 12),
      steel,
    );
    bottle.position.set(side * s * 0.19, s * 0.22, -s * 0.22);
    group.add(bottle);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(s * 0.14, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      steel,
    );
    dome.scale.y = 0.5;
    dome.position.set(side * s * 0.19, s * 0.47, -s * 0.22);
    group.add(dome);
    const valve = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.04, s * 0.05, s * 0.08, 6),
      gunmetal,
    );
    valve.position.set(side * s * 0.19, s * 0.54, -s * 0.22);
    group.add(valve);
  }

  // Fuel line: an elbow off the bottles into the back of the nozzle.
  const elbow = new THREE.Mesh(
    new THREE.TorusGeometry(s * 0.16, s * 0.04, 6, 12, Math.PI / 2),
    gunmetal,
  );
  elbow.rotation.y = Math.PI / 2;
  elbow.position.set(0, s * 0.2, s * 0.02);
  group.add(elbow);

  // Nozzle: ribbed heat shroud flaring into the muzzle, pilot flame alongside.
  const nozzle = pipe(s * 0.1, s * 0.12, s * 0.8, s * 0.42, gunmetal, 12);
  nozzle.name = 'weapon-barrel';
  nozzle.position.y = s * 0.04;
  group.add(nozzle);
  for (const z of [0.2, 0.4, 0.6]) {
    const rib = pipe(s * 0.16, s * 0.16, s * 0.05, z * s, steel, 12);
    rib.position.y = s * 0.04;
    group.add(rib);
  }
  const flare = pipe(s * 0.2, s * 0.11, s * 0.24, s * 0.92, gunmetal, 14);
  flare.position.y = s * 0.04;
  group.add(flare);
  const pilot = new THREE.Mesh(new THREE.SphereGeometry(s * 0.05, 8, 6), flame);
  pilot.position.set(s * 0.16, s * 0.14, s * 0.92);
  group.add(pilot);
}
