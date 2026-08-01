/**
 * The three Build signature blocks: the Storm Rod, the Pyre Core, and the
 * Fallout Silo.
 *
 * These are the one part on every rig the player did not choose to buy, so they
 * have to read as issued equipment rather than as scrap bolted on: each sits on
 * the same armoured plinth with a machined deck and a bolt ring, and what
 * stands on that deck is unmistakably one of three things — a lightning mast, a
 * furnace, or a launch tube.
 *
 * The plinth is the only thing carrying `placementSurface`, and it spans the
 * full cell so the flanks and underside still resolve as build faces. The rod
 * and the core each reserve the cell above them (`clearanceCells`), which is
 * what lets their hardware stand proud without ever clipping a neighbour; the
 * silo reserves the cell above both of its own.
 */

import * as THREE from 'three';
import { CELL_SIZE, type PlacedPart } from '../../core/types.ts';
import { cellCentreM } from '../../core/mass.ts';
import {
  DARK_STEEL,
  STEEL,
  boltRing,
  edgesOf,
  glowLambert,
  lambert,
  orientationQuaternion,
  shade,
} from './shared.ts';

/** Storm Rod arc blue — the same family as the Tesla Coil's zaps. */
export const STORM_ARC = 0x7fd4ff;
/** Pyre Core furnace orange, matching the flame VFX. */
export const PYRE_FIRE = 0xff7a1e;
/** Fallout Silo warning green, matching the nuke's marker ring. */
export const FALLOUT_GLOW = 0x9dff5c;

/**
 * The shared lower half every signature block stands on: an armoured plinth
 * spanning the cell, a machined deck, and the bolt ring that ties the hardware
 * through it. Modelled about the origin so the caller can drop it on any cell.
 */
function signaturePlinth(color: number, opacity: number): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();

  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.98, s * 0.44, s * 0.98),
    lambert(shade(color, 0.6), opacity),
  );
  plinth.position.y = -s * 0.5 + s * 0.22;
  plinth.userData.placementSurface = true;
  group.add(plinth);
  const plinthEdges = edgesOf(plinth.geometry, opacity);
  plinthEdges.position.copy(plinth.position);
  group.add(plinthEdges);

  // Corner feet: four stubby pads that make the block look bolted down rather
  // than resting on the deck.
  const foot = new THREE.BoxGeometry(s * 0.18, s * 0.1, s * 0.18);
  const footMaterial = lambert(DARK_STEEL, opacity);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pad = new THREE.Mesh(foot, footMaterial);
      pad.position.set(sx * s * 0.38, -s * 0.46, sz * s * 0.38);
      group.add(pad);
    }
  }

  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.4, s * 0.45, s * 0.1, 8),
    lambert(STEEL, opacity),
  );
  deck.position.y = -s * 0.05;
  group.add(deck);
  group.add(
    boltRing({
      count: 6,
      radius: s * 0.34,
      headRadius: s * 0.045,
      length: s * 0.05,
      axis: new THREE.Vector3(0, 1, 0),
      centre: new THREE.Vector3(0, s * 0.01, 0),
      opacity,
    }),
  );

  return group;
}

/**
 * Storm Rod: a tapered mast standing off the deck with a splayed crown of
 * pickup tips and a charge coil wound around its base. The lit ring under the
 * crown is the tell that the mast is holding a charge.
 */
export function buildStormRodMesh(
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(placed.orient));
  group.add(signaturePlinth(color, opacity));

  // Charge coil: three windings stacked around the mast foot.
  const winding = new THREE.TorusGeometry(s * 0.17, s * 0.035, 5, 12);
  const coilMaterial = lambert(shade(color, 1.25), opacity);
  for (let i = 0; i < 3; i++) {
    const turn = new THREE.Mesh(winding, coilMaterial);
    turn.rotation.x = Math.PI / 2;
    turn.position.y = s * 0.08 + i * s * 0.11;
    group.add(turn);
  }

  // The mast itself: tapered, so it reads as a lightning rod rather than a pipe.
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.045, s * 0.1, s * 0.9, 7),
    lambert(STEEL, opacity),
  );
  mast.position.y = s * 0.45;
  group.add(mast);

  // Charge band under the crown — the one lit part of the block at level 1.
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.09, s * 0.09, s * 0.07, 8),
    glowLambert(STORM_ARC, opacity, 0.9),
  );
  band.position.y = s * 0.72;
  group.add(band);

  // Crown: four tips splayed outward off the mast head, so the top of the
  // block reads as a thing that catches lightning from any direction.
  const tipMaterial = lambert(shade(color, 1.4), opacity);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(s * 0.035, s * 0.26, 5),
      tipMaterial,
    );
    tip.position.set(
      Math.cos(angle) * s * 0.12,
      s * 0.95,
      Math.sin(angle) * s * 0.12,
    );
    tip.rotation.set(Math.sin(angle) * 0.45, 0, -Math.cos(angle) * 0.45);
    group.add(tip);
  }

  return group;
}

/**
 * Pyre Core: a barrel furnace lying across the cell with a grated mouth facing
 * forward, a stoked glow behind the grate, and a pair of pressure bottles
 * strapped down the flanks.
 */
export function buildPyreCoreMesh(
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(placed.orient));
  group.add(signaturePlinth(color, opacity));

  // Furnace drum, lying along the part's forward axis with its mouth on +Z.
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.26, s * 0.26, s * 0.62, 10),
    lambert(shade(color, 0.85), opacity),
  );
  drum.rotation.x = Math.PI / 2;
  drum.position.y = s * 0.28;
  group.add(drum);
  group.add(edgesOf(drum.geometry, opacity * 0.7));

  // Banding around the drum, so it reads as a riveted vessel under pressure.
  const bandGeometry = new THREE.TorusGeometry(s * 0.27, s * 0.028, 5, 12);
  const bandMaterial = lambert(DARK_STEEL, opacity);
  for (const z of [-0.18, 0.18]) {
    const band = new THREE.Mesh(bandGeometry, bandMaterial);
    band.position.set(0, s * 0.28, z * s);
    group.add(band);
  }

  // The mouth: a lit throat behind a grate of vertical bars.
  const throat = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.2, s * 0.2, s * 0.06, 10),
    glowLambert(PYRE_FIRE, opacity, 1),
  );
  throat.rotation.x = Math.PI / 2;
  throat.position.set(0, s * 0.28, s * 0.31);
  group.add(throat);
  const barGeometry = new THREE.BoxGeometry(s * 0.035, s * 0.36, s * 0.035);
  const barMaterial = lambert(DARK_STEEL, opacity);
  for (const x of [-0.11, 0, 0.11]) {
    const bar = new THREE.Mesh(barGeometry, barMaterial);
    bar.position.set(x * s, s * 0.28, s * 0.33);
    group.add(bar);
  }

  // Pressure bottles down both flanks, feeding the drum.
  const bottleGeometry = new THREE.CylinderGeometry(
    s * 0.07,
    s * 0.07,
    s * 0.44,
    8,
  );
  const bottleMaterial = lambert(shade(color, 0.55), opacity);
  for (const x of [-1, 1]) {
    const bottle = new THREE.Mesh(bottleGeometry, bottleMaterial);
    bottle.rotation.x = Math.PI / 2;
    bottle.position.set(x * s * 0.34, s * 0.16, -s * 0.04);
    group.add(bottle);
  }

  // Stack: the furnace has to vent somewhere, and the stub reads as heat.
  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.06, s * 0.08, s * 0.24, 7),
    lambert(STEEL, opacity),
  );
  stack.position.set(0, s * 0.62, -s * 0.16);
  group.add(stack);

  return group;
}

/**
 * Fallout Silo: a four-cell barbette carrying a launch tube on a raised
 * cradle, angled up the way a mortar is, with a blast collar at the muzzle and
 * a hazard-lit breech at the back.
 *
 * The part's footprint is a 2x2 pad whose origin sits at one corner, not in
 * the middle, so everything above the plinths is built about the pad's centre
 * — half a cell across and half a cell forward of the origin. The upgrade kit
 * in `upgradeKit.ts` is anchored on that same centre (`footprintCentreM`), so
 * the two agree without either having to know the other's offsets.
 */
export function buildFalloutSiloMesh(
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(placed.orient));

  // One plinth per cell of the pad, laid out from the origin corner.
  for (const [px, pz] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    const plinth = signaturePlinth(color, opacity);
    plinth.position.set(px * s, 0, pz * s);
    group.add(plinth);
  }

  // Everything from here up is centred on the pad rather than the origin cell.
  const deck = new THREE.Group();
  deck.position.set(s * 0.5, 0, s * 0.5);
  group.add(deck);

  // Cradle: four raised trunnion posts the tube rests in, one per corner.
  const postGeometry = new THREE.BoxGeometry(s * 0.16, s * 0.34, s * 0.16);
  const postMaterial = lambert(STEEL, opacity);
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.position.set(x * s * 0.5, s * 0.16, z * s * 0.42);
      deck.add(post);
    }
  }

  // The tube. It spans the pad and tips nose-up, because a mortar that pointed
  // flat would read as a cannon the player could aim by driving.
  const tube = new THREE.Group();
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.3, s * 0.34, s * 1.7, 12),
    lambert(shade(color, 0.75), opacity),
  );
  barrel.rotation.x = Math.PI / 2;
  tube.add(barrel);
  tube.add(edgesOf(barrel.geometry, opacity * 0.7));

  // Blast collar at the muzzle end, and a hazard-lit breech ring at the back.
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.42, s * 0.36, s * 0.16, 12),
    lambert(DARK_STEEL, opacity),
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.z = s * 0.82;
  tube.add(collar);
  const breech = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.31, s * 0.31, s * 0.1, 12),
    glowLambert(FALLOUT_GLOW, opacity, 0.85),
  );
  breech.rotation.x = Math.PI / 2;
  breech.position.z = -s * 0.84;
  tube.add(breech);

  // Reinforcing ribs down the tube, evenly spaced along its length.
  const ribGeometry = new THREE.TorusGeometry(s * 0.32, s * 0.035, 5, 14);
  const ribMaterial = lambert(DARK_STEEL, opacity);
  for (const z of [-0.45, 0, 0.45]) {
    const rib = new THREE.Mesh(ribGeometry, ribMaterial);
    rib.position.z = z * s;
    tube.add(rib);
  }

  tube.position.set(0, s * 0.5, 0);
  tube.rotation.x = -0.34;
  deck.add(tube);

  return group;
}
