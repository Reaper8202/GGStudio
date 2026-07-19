/**
 * Shared part-mesh factory (editor ghost/placed parts and chamber view).
 * Flat-shaded primitives with edge lines — readable block aesthetic.
 */

import * as THREE from 'three';
import { PAINT_COLORS, type PartDefinition, type PlacedPart } from '../core/types.ts';
import { CELL_SIZE } from '../core/types.ts';
import { FACE_VECTORS, rotateFace, rotateVec } from '../core/grid.ts';
import { cellCentreM } from '../core/mass.ts';

const COLORS: Record<string, number> = {
  'chassis-core': 0xd97a2b,
  'frame-box': 0x8a8f98,
  'frame-reinforced': 0x5a606b,
  'driver-seat': 0xc9a227,
  'engine-small': 0xa03c3c,
  'fuel-tank': 0xb0803a,
  'wheel-standard': 0x23262b,
  'wheel-offroad': 0x1b1e22,
  turret: 0x39424e,
  'armour-plate': 0x69737a,
  'cannon-heavy': 0x303840,
  'barrel-drum': 0x7d5a3a,
  'sniper-light': 0x33404f,
  flamethrower: 0x9c3d20,
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
  mesh.userData.placementSurface = true;
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
  const color = placed.config.paint ? PAINT_COLORS[placed.config.paint] : partColor(def);
  const s = CELL_SIZE;

  if (def.wheel) {
    const w = def.wheel;
    const centre = cellCentreM(placed.pos);
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(w.radius, w.radius, w.width, 18),
      new THREE.MeshLambertMaterial({ color: partColor(def), transparent: opacity < 1, opacity }),
    );
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(w.radius * 0.45, w.radius * 0.45, w.width + 0.02, 10),
      new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity }),
    );
    tire.userData.placementSurface = true;
    hub.userData.placementSurface = true;
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

  if (def.melee) {
    // Grinder drum: one cylinder spanning the part's cells along local X,
    // studded with teeth. Local +Y of the drum group is the spin axis.
    const centre = cellCentreM(placed.pos);
    const radius = s * 0.48;
    const length = def.cells.length * s * 0.96;
    const material = new THREE.MeshLambertMaterial({
      color,
      transparent: opacity < 1,
      opacity,
    });
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 14),
      material,
    );
    drum.userData.placementSurface = true;
    const drumGroup = new THREE.Group();
    drumGroup.add(drum);
    const toothMaterial = new THREE.MeshLambertMaterial({
      color: 0x2b2e33,
      transparent: opacity < 1,
      opacity,
    });
    const toothGeometry = new THREE.BoxGeometry(s * 0.14, s * 0.1, s * 0.14);
    const rings = def.cells.length * 2;
    for (let ring = 0; ring < rings; ring++) {
      const y = -length / 2 + ((ring + 0.5) / rings) * length;
      for (let toothIndex = 0; toothIndex < 5; toothIndex++) {
        const angle = (toothIndex / 5) * Math.PI * 2 + ring * 0.55;
        const tooth = new THREE.Mesh(toothGeometry, toothMaterial);
        tooth.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        drumGroup.add(tooth);
      }
    }
    const axle = rotateVec(placed.orient, { x: 1, y: 0, z: 0 });
    drumGroup.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(axle.x, axle.y, axle.z),
    );
    drumGroup.position.set(centre.x, centre.y, centre.z);
    drumGroup.name = 'melee-drum';
    group.add(drumGroup);
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

  if (def.id === 'armour-plate') {
    const centre = cellCentreM(placed.pos);
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(s * 0.98, s * 0.32, s * 0.98, 2, 1, 2),
      new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity }),
    );
    plate.userData.placementSurface = true;
    plate.position.set(centre.x, centre.y, centre.z);
    group.add(plate);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(plate.geometry),
      new THREE.LineBasicMaterial({ color: 0x171b20, transparent: true, opacity: 0.55 * opacity }),
    );
    edges.position.copy(plate.position);
    group.add(edges);
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
      // Barrel silhouette per weapon: [muzzleRadius, breechRadius, cell
      // lengths, segments, forward offset in cells].
      const style =
        def.id === 'cannon-heavy'
          ? { muzzle: 0.07, breech: 0.08, length: 2.6, segments: 10, offset: 1.35 }
          : def.id === 'sniper-light'
            ? { muzzle: 0.03, breech: 0.045, length: 2.2, segments: 8, offset: 1.15 }
            : def.id === 'flamethrower'
              ? { muzzle: 0.1, breech: 0.06, length: 1.0, segments: 10, offset: 0.6 }
              : { muzzle: 0.045, breech: 0.045, length: 1.4, segments: 8, offset: 0.8 };
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(
          style.muzzle,
          style.breech,
          s * style.length,
          style.segments,
        ),
        new THREE.MeshLambertMaterial({ color: 0x22262c, transparent: opacity < 1, opacity }),
      );
      barrel.userData.placementSurface = true;
      barrel.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(fwd.x, fwd.y, fwd.z),
      );
      const barrelOffset = style.offset;
      barrel.position.set(centre.x + fwd.x * s * barrelOffset, centre.y + fwd.y * s * barrelOffset + 0.08, centre.z + fwd.z * s * barrelOffset);
      barrel.name = 'weapon-barrel';
      group.add(barrel);
    }
  }
  return group;
}
