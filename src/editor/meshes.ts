/**
 * Shared part-mesh factory (editor ghost/placed parts and chamber view).
 * Simple flat-shaded primitives with edge lines — readable block aesthetic.
 */

import * as THREE from 'three';
import type { PartDefinition, PlacedPart } from '../core/types.ts';
import { CELL_SIZE } from '../core/types.ts';
import { FACE_VECTORS, rotateFace, rotateVec } from '../core/grid.ts';
import { cellCentreM } from '../core/mass.ts';

const COLORS: Record<string, number> = {
  'chassis-core': 0xd97a2b,
  'frame-box': 0x8a8f98,
  'frame-light': 0xb9bec7,
  'frame-reinforced': 0x5a606b,
  'beam-long': 0x7d8695,
  'wheel-mount': 0x4f8a8b,
  'engine-mount': 0x8b6a4f,
  hardpoint: 0x8b4f6b,
  'driver-seat': 0xc9a227,
  'engine-small': 0xa03c3c,
  'engine-big': 0x7c2929,
  'fuel-tank': 0xb0803a,
  battery: 0x3a6ab0,
  'ammo-box': 0x6b7a3a,
  'cargo-crate': 0x9a7b5a,
  'wheel-standard': 0x23262b,
  'wheel-offroad': 0x1b1e22,
  'armour-panel': 0x606d60,
  'shell-panel': 0x88b0c8,
  'gun-fixed': 0x3f4750,
  turret: 0x39424e,
};

const CATEGORY_FALLBACK: Record<string, number> = {
  structural: 0x8a8f98,
  functional: 0xa08a4a,
  movement: 0x23262b,
  protection: 0x606d60,
  weapon: 0x3f4750,
};

export function partColor(def: PartDefinition): number {
  return COLORS[def.id] ?? CATEGORY_FALLBACK[def.category] ?? 0x999999;
}

function boxWithEdges(w: number, h: number, d: number, color: number, opacity = 1): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  g.add(mesh);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color: 0x11141a, transparent: true, opacity: 0.55 * opacity }),
  );
  g.add(edges);
  return g;
}

/**
 * Build a vehicle-local mesh for a placed part. Children sit at cell centres
 * (metres); the returned group is in the vehicle frame.
 */
export function buildPartMesh(def: PartDefinition, placed: PlacedPart, opacity = 1): THREE.Group {
  const group = new THREE.Group();
  group.name = `part:${placed.id}`;
  const color = partColor(def);
  const s = CELL_SIZE;

  if (def.wheel) {
    const w = def.wheel;
    const centre = cellCentreM(placed.pos);
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(w.radius, w.radius, w.width, 18),
      new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity }),
    );
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(w.radius * 0.45, w.radius * 0.45, w.width + 0.02, 10),
      new THREE.MeshLambertMaterial({ color: 0x9aa0aa, transparent: opacity < 1, opacity }),
    );
    const wheelGroup = new THREE.Group();
    wheelGroup.add(tire, hub);
    // Cylinder axis is +Y; align to placed axle axis.
    const axle = rotateVec(placed.orient, w.axleAxis);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(axle.x, axle.y, axle.z),
    );
    wheelGroup.quaternion.copy(q);
    wheelGroup.position.set(centre.x, centre.y, centre.z);
    wheelGroup.name = 'wheel-spin';
    group.add(wheelGroup);
    return group;
  }

  if (def.cells.length === 0 && def.armour) {
    // Face-mounted slab on the covered face of the host cell.
    const face = rotateFace(placed.orient, def.sockets[0]?.face ?? 'pz');
    const fv = FACE_VECTORS[face];
    const centre = cellCentreM(placed.pos);
    const t = 0.07;
    const slab = boxWithEdges(
      fv.x !== 0 ? t : s * 0.98,
      fv.y !== 0 ? t : s * 0.98,
      fv.z !== 0 ? t : s * 0.98,
      color,
      def.armour.cosmetic ? Math.min(opacity, 0.9) : opacity,
    );
    slab.position.set(
      centre.x + fv.x * (s / 2 - t / 2),
      centre.y + fv.y * (s / 2 - t / 2),
      centre.z + fv.z * (s / 2 - t / 2),
    );
    group.add(slab);
    return group;
  }

  let first = true;
  for (const local of def.cells) {
    const cell = {
      x: placed.pos.x + rotateVec(placed.orient, local).x,
      y: placed.pos.y + rotateVec(placed.orient, local).y,
      z: placed.pos.z + rotateVec(placed.orient, local).z,
    };
    const centre = cellCentreM(cell);
    const box = boxWithEdges(s * 0.98, s * 0.98, s * 0.98, color, opacity);
    box.position.set(centre.x, centre.y, centre.z);
    group.add(box);

    // Orientation decal: a bright notch on the part's local +Z face of its
    // origin cell, so R/F rotation reads spatially instead of by trial.
    if (first && !def.wheel) {
      first = false;
      const fwd = rotateVec(placed.orient, { x: 0, y: 0, z: 1 });
      const notch = new THREE.Mesh(
        new THREE.BoxGeometry(s * 0.18, s * 0.18, s * 0.18),
        new THREE.MeshBasicMaterial({ color: 0xf0e35a, transparent: opacity < 1, opacity }),
      );
      notch.position.set(
        centre.x + fwd.x * (s / 2),
        centre.y + fwd.y * (s / 2),
        centre.z + fwd.z * (s / 2),
      );
      group.add(notch);
    }

    if (def.engine) {
      const cap = boxWithEdges(s * 0.6, s * 0.25, s * 0.6, 0x30343b, opacity);
      cap.position.set(centre.x, centre.y + s * 0.45, centre.z);
      group.add(cap);
    }
    if (def.providesControl) {
      const back = boxWithEdges(s * 0.8, s * 0.5, s * 0.18, 0x8a6d1f, opacity);
      back.position.set(centre.x, centre.y + s * 0.55, centre.z - s * 0.35);
      group.add(back);
    }
    if (def.weapon) {
      const fwd = rotateVec(placed.orient, { x: 0, y: 0, z: 1 });
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, s * 1.4, 8),
        new THREE.MeshLambertMaterial({ color: 0x22262c, transparent: opacity < 1, opacity }),
      );
      barrel.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(fwd.x, fwd.y, fwd.z),
      );
      barrel.position.set(centre.x + fwd.x * s * 0.8, centre.y + fwd.y * s * 0.8 + 0.08, centre.z + fwd.z * s * 0.8);
      barrel.name = 'weapon-barrel';
      group.add(barrel);
    }
  }
  return group;
}
