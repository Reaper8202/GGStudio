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
 *
 * The traverse ring stays with the mount; everything above it hangs off a
 * swivel group the runtime turns to the weapon's live aim (see
 * `applyWeaponAim`). In the editor the swivel is identity, so a parked gun
 * looks exactly as it is built.
 */

import * as THREE from 'three';
import { CELL_SIZE, type PartDefinition, type PlacedPart } from '../../core/types.ts';
import { cellCentreM, footprintCentreM } from '../../core/mass.ts';
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

/** Group the runtime rotates to the weapon's live aim. */
export const WEAPON_SWIVEL_NAME = 'weapon-swivel';

/**
 * How many cells the footprint runs along each horizontal part-local axis.
 * Every gun but the Heavy Cannon is 1x1, so this only widens that one mount.
 */
function footprintSpanCells(def: PartDefinition): { x: number; z: number } {
  if (def.cells.length === 0) return { x: 1, z: 1 };
  const xs = def.cells.map((cell) => cell.x);
  const zs = def.cells.map((cell) => cell.z);
  return {
    x: Math.max(...xs) - Math.min(...xs) + 1,
    z: Math.max(...zs) - Math.min(...zs) + 1,
  };
}

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
  const orientQuaternion = orientationQuaternion(placed.orient);

  // A gun sits over the middle of the cells it reserves, not over its anchor
  // cell. Single-cell weapons resolve to zero here; the Heavy Cannon's 2x2
  // barbette shifts everything to the centre of its pad.
  const padCentre = footprintCentreM(def, placed);
  const padOffset = new THREE.Vector3(
    padCentre.x - centre.x,
    padCentre.y - centre.y,
    padCentre.z - centre.z,
  );

  // The mount does not move with the gun: ring and bolts stay bolted to the
  // block below, in the part's placed orientation.
  const mount = new THREE.Group();
  mount.position.copy(padOffset);
  mount.quaternion.copy(orientQuaternion);
  group.add(mount);

  // A multi-cell gun gets a plated barbette deck spanning its footprint, so
  // the cells it reserves read as taken rather than as bare frame with a
  // turret floating over one corner of them.
  const span = footprintSpanCells(def);
  const wide = span.x > 1 || span.z > 1;
  if (wide) {
    const deck = boxWithEdges(
      s * (span.x - 0.06),
      s * 0.16,
      s * (span.z - 0.06),
      shade(color, 0.78),
      opacity,
    );
    deck.position.y = -s * 0.42;
    mount.add(deck);
  }

  // Bolted traverse ring: what the whole weapon sits and swings on. It grows
  // with the mount, so a wide gun swings on a ring that fills its deck.
  const ringRadius = s * 0.38 * Math.max(span.x, span.z);
  const ringY = wide ? -s * 0.26 : -s * 0.4;
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(ringRadius, ringRadius * 1.1, s * 0.16, wide ? 20 : 16),
    lambert(DARK_STEEL, opacity),
  );
  ring.position.y = ringY;
  ring.userData.placementSurface = true;
  mount.add(ring);
  mount.add(
    boltRing({
      count: wide ? 12 : 8,
      radius: ringRadius * 0.84,
      headRadius: s * 0.04,
      length: s * 0.06,
      axis: new THREE.Vector3(0, 1, 0),
      centre: new THREE.Vector3(0, ringY + s * 0.07, 0),
      phase: Math.PI / 8,
      opacity,
    }),
  );

  // Swivel sits in the vehicle frame (no orientation of its own) so the
  // runtime can turn it about vehicle up by the weapon's yaw, exactly the axis
  // the shot itself is yawed around. The hardware inside it carries the
  // placed orientation.
  const swivel = new THREE.Group();
  swivel.name = WEAPON_SWIVEL_NAME;
  swivel.position.copy(padOffset);
  const hardware = new THREE.Group();
  hardware.quaternion.copy(orientQuaternion);
  swivel.add(hardware);
  group.add(swivel);

  switch (def.id) {
    case 'cannon-heavy':
      buildHeavyCannon(hardware, color, opacity);
      break;
    case 'sniper-light':
      buildSniper(hardware, color, opacity);
      break;
    case 'ice-cannon':
      buildIceCannon(hardware, color, opacity);
      break;
    case 'flamethrower':
      buildFlamethrower(hardware, color, opacity);
      break;
    default:
      buildAutocannon(hardware, color, opacity);
      break;
  }
  return group;
}

const VEHICLE_UP = new THREE.Vector3(0, 1, 0);
const aimYaw = new THREE.Quaternion();
const aimPitch = new THREE.Quaternion();
const aimPitchAxis = new THREE.Vector3();

/**
 * Point a placed weapon's hardware where the runtime is actually shooting.
 *
 * `yaw` and `pitch` come straight off `RuntimeWeapon`, and the axes match how
 * the shot direction is built: yaw about vehicle up, pitch about the mount's
 * right-hand axis. A gun rolled onto the side of the hull therefore still
 * traverses level, because both the mesh and the ray use the same up.
 */
export function applyWeaponAim(
  partMesh: THREE.Object3D,
  forwardLocal: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
): void {
  const swivel = partMesh.getObjectByName(WEAPON_SWIVEL_NAME);
  if (!swivel) return;
  aimYaw.setFromAxisAngle(VEHICLE_UP, yaw);
  aimPitchAxis
    .set(forwardLocal.x, forwardLocal.y, forwardLocal.z)
    .cross(VEHICLE_UP);
  if (aimPitchAxis.lengthSq() < 1e-6) {
    // Mounted looking straight up or down: there is no pitch axis to use.
    swivel.quaternion.copy(aimYaw);
    return;
  }
  aimPitch.setFromAxisAngle(aimPitchAxis.normalize(), pitch);
  swivel.quaternion.copy(aimYaw).multiply(aimPitch);
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

/**
 * Heavy cannon: a cast turret filling the 2x2 barbette it is bolted to. Wide
 * hull with a chamfered roof, a rear stowage bustle counterweighting the tube,
 * a thick braked barrel with a bore evacuator, recoil cylinders over the
 * breech, and shell racks down the flanks. Everything is sized against the pad
 * rather than a single cell — this gun is meant to look like it earns the four
 * blocks of deck it takes up.
 */
function buildHeavyCannon(group: THREE.Group, color: number, opacity: number): void {
  const s = CELL_SIZE;
  const gunmetal = lambert(GUNMETAL, opacity);
  const steel = lambert(STEEL, opacity);

  const hull = boxWithEdges(s * 1.24, s * 0.5, s * 1.18, color, opacity);
  hull.position.set(0, s * 0.06, -s * 0.04);
  group.add(hull);
  const roof = boxWithEdges(s * 0.94, s * 0.24, s * 0.9, shade(color, 0.86), opacity);
  roof.position.set(0, s * 0.41, -s * 0.08);
  group.add(roof);

  // Stowage bustle out the back: what keeps a two-metre tube from looking like
  // it is about to tip the turret over its own front.
  const bustle = boxWithEdges(s * 0.88, s * 0.34, s * 0.42, shade(color, 0.7), opacity);
  bustle.position.set(0, s * 0.16, -s * 0.8);
  group.add(bustle);

  // Sloped mantlet: a squat eight-sided cone reads as a cast gun shield.
  const mantlet = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.3, s * 0.46, s * 0.34, 8),
    lambert(shade(color, 0.68), opacity),
  );
  mantlet.rotation.x = Math.PI / 2;
  mantlet.position.set(0, s * 0.1, s * 0.6);
  group.add(mantlet);

  const barrel = pipe(s * 0.1, s * 0.13, s * 2.3, s * 1.65, gunmetal, 14);
  barrel.name = 'weapon-barrel';
  barrel.position.y = s * 0.1;
  group.add(barrel);
  // Bore evacuator bulge partway down the tube.
  const evacuator = pipe(s * 0.2, s * 0.2, s * 0.36, s * 1.3, steel, 12);
  evacuator.position.y = s * 0.1;
  group.add(evacuator);

  const brake = muzzleBrake(s, s * 0.2, s * 2.68, gunmetal);
  brake.position.y = s * 0.1;
  group.add(brake);

  // Recoil cylinders over the breech, shell racks down each flank.
  for (const side of [-1, 1]) {
    const recoil = pipe(s * 0.08, s * 0.08, s * 0.86, s * 0.52, steel, 8);
    recoil.position.set(side * s * 0.27, s * 0.38, s * 0.52);
    group.add(recoil);
    const rack = boxWithEdges(s * 0.16, s * 0.3, s * 0.58, shade(color, 0.62), opacity);
    rack.position.set(side * s * 0.68, s * 0.1, -s * 0.16);
    group.add(rack);
  }

  // Loader's hatch, offset off the turret centreline like the real thing.
  const hatch = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.17, s * 0.17, s * 0.08, 10),
    steel,
  );
  hatch.position.set(-s * 0.22, s * 0.55, -s * 0.16);
  group.add(hatch);
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
