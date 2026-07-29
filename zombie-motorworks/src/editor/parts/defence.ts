/**
 * Defence emitter meshes: the shield generator and the pulse emitter.
 *
 * Both are ability-only blocks with no barrel to give them away, so they share a
 * skeleton that says "field device bolted to a rig" — an armoured plinth with a
 * machined deck and a bolt ring, four tapered cage posts, and hardware standing
 * in the cage. What tells them apart is what the cage holds: a caged, gyro-ringed
 * shield core, or a stacked concussion coil with a striker on top.
 *
 * Only the plinth carries `placementSurface`; it spans the cell footprint so the
 * flanks and the underside still resolve as build faces. Both parts reserve the
 * cell above (`clearanceCells`), which is what lets the emitter hardware stand
 * slightly proud of the cell without ever colliding with a neighbour.
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

/** Height of the cage posts' top, in cell units above the cell centre. */
const CAGE_TOP = 0.3;

/**
 * The shared lower half: armoured plinth, machined deck, bolt ring and the four
 * tapered posts that cage whatever the part emits.
 */
function emitterBase(color: number, opacity: number, accent: number): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();

  // Plinth: the block itself. Full footprint so the flanks reach the cell
  // boundary and neighbours can still be dropped against them.
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(s * 0.98, s * 0.4, s * 0.98),
    lambert(shade(color, 0.62), opacity),
  );
  plinth.position.y = -s * 0.5 + s * 0.2;
  plinth.userData.placementSurface = true;
  group.add(plinth);
  const plinthEdges = edgesOf(plinth.geometry, opacity);
  plinthEdges.position.copy(plinth.position);
  group.add(plinthEdges);

  // Cooling louvres on each flank — three slots per side, standing a little
  // proud of the plinth so they read as raised fins rather than z-fighting
  // decals, and still short of the cell boundary so they never clip a
  // neighbouring block.
  const louvre = new THREE.BoxGeometry(s * 0.62, s * 0.045, s * 0.03);
  const louvreMaterial = lambert(DARK_STEEL, opacity);
  for (const turn of [0, 1, 2, 3]) {
    const bank = new THREE.Group();
    bank.rotation.y = (turn * Math.PI) / 2;
    for (const row of [-1, 0, 1]) {
      const slot = new THREE.Mesh(louvre, louvreMaterial);
      slot.position.set(0, -s * 0.4 + row * s * 0.08, s * 0.48);
      bank.add(slot);
    }
    group.add(bank);
  }

  // Machined deck: a stepped collar on top of the plinth, the surface the cage
  // and the emitter hardware are bolted through.
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.42, s * 0.46, s * 0.1, 8),
    lambert(STEEL, opacity),
  );
  deck.position.y = -s * 0.06;
  group.add(deck);
  group.add(
    boltRing({
      count: 8,
      radius: s * 0.38,
      headRadius: s * 0.04,
      length: s * 0.05,
      axis: new THREE.Vector3(0, 1, 0),
      centre: new THREE.Vector3(0, -s * 0.01, 0),
      phase: Math.PI / 8,
      opacity,
    }),
  );

  // Cage posts: tapered four-sided pillars at the deck corners, each capped by
  // a lit node so the device reads as powered from any angle.
  const post = new THREE.CylinderGeometry(s * 0.045, s * 0.075, s * 0.36, 4);
  const postMaterial = lambert(DARK_STEEL, opacity);
  const nodeGeometry = new THREE.OctahedronGeometry(s * 0.05);
  const nodeMaterial = glowLambert(accent, opacity, 0.85);
  for (const turn of [0, 1, 2, 3]) {
    const angle = Math.PI / 4 + (turn * Math.PI) / 2;
    const x = Math.cos(angle) * s * 0.34;
    const z = Math.sin(angle) * s * 0.34;

    const pillar = new THREE.Mesh(post, postMaterial);
    pillar.position.set(x, s * 0.12, z);
    pillar.rotation.y = angle;
    group.add(pillar);

    const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
    node.position.set(x, s * CAGE_TOP, z);
    group.add(node);
  }

  return group;
}

/**
 * Shield generator: a caged field core with a gyro ring cluster.
 *
 * The core is a faceted crystal rather than a dome — it catches the flat-shaded
 * lighting from every angle, and the three rings around it read as a projector
 * even when the shield itself is down.
 */
export function buildShieldGeneratorMesh(
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(placed.orient));
  group.add(emitterBase(color, opacity, shade(color, 1.5)));

  const coreY = s * 0.15;

  // Field core: a small, bright crystal floating on a projector stem.
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.07, s * 0.12, s * 0.14, 8),
    lambert(STEEL, opacity),
  );
  stem.position.y = s * 0.01;
  group.add(stem);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(s * 0.19, 0),
    glowLambert(shade(color, 1.45), opacity, 1.1),
  );
  core.position.y = coreY;
  core.rotation.set(0.4, 0.6, 0);
  group.add(core);

  // Gyro rings: one horizontal, two upright and crossed. Steel with a lit
  // inner band, so the cluster still reads as hardware in flat light.
  const ringMaterial = lambert(shade(color, 0.78), opacity);
  const ringGeometry = new THREE.TorusGeometry(s * 0.31, s * 0.022, 6, 20);
  const rings: [number, number, number][] = [
    [Math.PI / 2, 0, 0],
    [0, 0, 0.22],
    [0, Math.PI / 2, -0.22],
  ];
  for (const [rx, ry, rz] of rings) {
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.y = coreY;
    ring.rotation.set(rx, ry, rz);
    group.add(ring);
  }

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(s * 0.26, s * 0.012, 6, 20),
    glowLambert(shade(color, 1.6), opacity, 0.95),
  );
  halo.position.y = coreY;
  halo.rotation.x = Math.PI / 2;
  group.add(halo);

  return group;
}

/**
 * Pulse emitter: a stacked concussion coil under a striker.
 *
 * Three coil plates of shrinking radius separated by lit gaps, braced by radial
 * vanes, with a hex-headed striker sitting on top of the stack — a part that
 * looks like it slams downwards, which is exactly what the ability does.
 */
export function buildPulseEmitterMesh(
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const s = CELL_SIZE;
  const group = new THREE.Group();
  const centre = cellCentreM(placed.pos);
  group.position.set(centre.x, centre.y, centre.z);
  group.quaternion.copy(orientationQuaternion(placed.orient));
  group.add(emitterBase(color, opacity, shade(color, 1.55)));

  // Coil stack: plate, lit gap, plate — each tier narrower than the one below.
  const plateMaterial = lambert(shade(color, 0.9), opacity);
  const gapMaterial = glowLambert(shade(color, 1.55), opacity, 1);
  const tiers: [number, number][] = [
    [0.34, 0.03],
    [0.28, 0.14],
    [0.21, 0.24],
  ];
  for (const [radius, y] of tiers) {
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * s, radius * s * 1.06, s * 0.07, 12),
      plateMaterial,
    );
    plate.position.y = y * s;
    group.add(plate);

    const gap = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * s * 0.94, radius * s * 0.94, s * 0.035, 12),
      gapMaterial,
    );
    gap.position.y = (y + 0.05) * s;
    group.add(gap);
  }

  // Radial vanes bracing the stack to the deck: what takes the recoil when the
  // ring goes off.
  const vaneGeometry = new THREE.BoxGeometry(s * 0.035, s * 0.26, s * 0.16);
  const vaneMaterial = lambert(DARK_STEEL, opacity);
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const vane = new THREE.Mesh(vaneGeometry, vaneMaterial);
    vane.position.set(Math.cos(angle) * s * 0.3, s * 0.06, Math.sin(angle) * s * 0.3);
    vane.rotation.y = -angle;
    group.add(vane);
  }

  // Striker: a short ram under a hex head, standing in the cage.
  const ram = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.07, s * 0.09, s * 0.12, 8),
    lambert(STEEL, opacity),
  );
  ram.position.y = s * 0.32;
  group.add(ram);

  const head = new THREE.Mesh(
    new THREE.CylinderGeometry(s * 0.15, s * 0.11, s * 0.09, 6),
    lambert(shade(color, 0.7), opacity),
  );
  head.position.y = s * (CAGE_TOP + 0.08);
  group.add(head);

  return group;
}
