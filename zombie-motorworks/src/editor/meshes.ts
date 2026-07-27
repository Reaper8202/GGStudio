/**
 * Shared part-mesh factory (editor ghost/placed parts and chamber view).
 * Flat-shaded primitives with edge lines — readable block aesthetic.
 *
 * Parts with a modelled silhouette of their own live in `parts/`; what stays
 * here is the generic block treatment plus the ability and weapon greebles that
 * hang off it.
 */

import * as THREE from 'three';
import { PAINT_COLORS, type PartDefinition, type PlacedPart } from '../core/types.ts';
import { CELL_SIZE } from '../core/types.ts';
import { rotateVec } from '../core/grid.ts';
import { cellCentreM } from '../core/mass.ts';
import { boxWithEdges, lambert, partColor } from './parts/shared.ts';
import { buildArmourPlateMesh, buildFaceArmourMesh } from './parts/armourPlate.ts';
import { buildEngineMesh } from './parts/engine.ts';
import { buildFuelTankMesh } from './parts/fuelTank.ts';
import { buildWeaponMesh } from './parts/weapons.ts';
import { buildTreadMesh, buildWheelMesh } from './parts/wheels.ts';

export { partColor };

/**
 * Build a vehicle-local mesh for a placed part. Children sit at cell centres
 * (metres); the returned group is in the vehicle frame.
 */
export function buildPartMesh(def: PartDefinition, placed: PlacedPart, opacity = 1): THREE.Group {
  const color = placed.config.paint ? PAINT_COLORS[placed.config.paint] : partColor(def);
  const s = CELL_SIZE;

  if (def.wheel?.skidSteer) {
    const treads = buildTreadMesh(def, placed, color, opacity);
    treads.name = `part:${placed.id}`;
    return treads;
  }

  if (def.wheel) {
    const wheel = buildWheelMesh(def, placed, color, opacity);
    wheel.name = `part:${placed.id}`;
    return wheel;
  }

  const group = new THREE.Group();
  group.name = `part:${placed.id}`;

  if (def.melee) {
    const visual = def.melee.visual ?? 'drum';
    const centre = cellCentreM(placed.pos);
    // Shared basis: local +Y (the drum/spike/blade spin axis) follows the
    // part's local X once rotated into world space by its placed orientation.
    const axle = rotateVec(placed.orient, { x: 1, y: 0, z: 0 });
    const orientQuat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(axle.x, axle.y, axle.z),
    );

    if (visual === 'spikes') {
      // Long Spikes: a small hub (the "small area" hitbox) with a single
      // long pike jutting straight out along the axle, for reach despite a
      // tight contact area.
      const hubRadius = s * 0.22;
      const pikeLength = s * 1.7;
      const material = lambert(color, opacity);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubRadius, hubRadius, s * 0.4, 10), material);
      hub.userData.placementSurface = true;
      const spikeGroup = new THREE.Group();
      spikeGroup.add(hub);
      const pike = new THREE.Mesh(
        new THREE.ConeGeometry(s * 0.17, pikeLength, 8),
        lambert(0xb7bcc2, opacity),
      );
      pike.position.set(0, hubRadius + pikeLength / 2, 0);
      spikeGroup.add(pike);
      spikeGroup.quaternion.copy(orientQuat);
      spikeGroup.position.set(centre.x, centre.y, centre.z);
      spikeGroup.name = 'melee-spikes';
      group.add(spikeGroup);
      return group;
    }

    if (visual === 'blade') {
      // Sawblade: a big disc lying flat and horizontal (spinning around the
      // vertical axis regardless of mount rotation), sweeping a wide area
      // around the vehicle at ground level, with teeth around the rim.
      const radius = s * 1.05;
      const thickness = s * 0.18;
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, thickness, 28),
        lambert(color, opacity),
      );
      disc.userData.placementSurface = true;
      const bladeGroup = new THREE.Group();
      bladeGroup.add(disc);
      const toothMaterial = lambert(0x2b2e33, opacity);
      const toothCount = 18;
      for (let i = 0; i < toothCount; i++) {
        const angle = (i / toothCount) * Math.PI * 2;
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(s * 0.11, s * 0.22, 4), toothMaterial);
        tooth.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)),
        );
        tooth.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
        bladeGroup.add(tooth);
      }
      // Always flat and horizontal: skip the shared axle orientation so the
      // blade keeps its natural Y-up disc shape no matter how it's mounted.
      bladeGroup.position.set(centre.x, centre.y, centre.z);
      bladeGroup.name = 'melee-blade';
      group.add(bladeGroup);
      return group;
    }

    // Grinder drum (default): one cylinder spanning the part's cells along
    // local X, studded with teeth. Local +Y of the drum group is the spin axis.
    const radius = s * 0.48;
    const length = def.cells.length * s * 0.96;
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 14),
      lambert(color, opacity),
    );
    drum.userData.placementSurface = true;
    const drumGroup = new THREE.Group();
    drumGroup.add(drum);
    const toothMaterial = lambert(0x2b2e33, opacity);
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
    drumGroup.quaternion.copy(orientQuat);
    drumGroup.position.set(centre.x, centre.y, centre.z);
    drumGroup.name = 'melee-drum';
    group.add(drumGroup);
    return group;
  }

  if (def.armour) {
    // Face-mounted armour has no cell of its own; plates occupy one.
    group.add(
      def.cells.length === 0
        ? buildFaceArmourMesh(def, placed, color, opacity)
        : buildArmourPlateMesh(placed, color, opacity),
    );
    return group;
  }

  if (def.id === 'fuel-tank') {
    group.add(buildFuelTankMesh(placed, color, opacity));
    return group;
  }

  if (def.weapon) {
    group.add(buildWeaponMesh(def, placed, color, opacity));
    return group;
  }

  if (def.engine) {
    // The V8 replaces the block at the origin cell; any further cells a bigger
    // engine might occupy keep the plain body.
    for (const local of def.cells) {
      const offset = rotateVec(placed.orient, local);
      const centre = cellCentreM({
        x: placed.pos.x + offset.x,
        y: placed.pos.y + offset.y,
        z: placed.pos.z + offset.z,
      });
      if (local.x === 0 && local.y === 0 && local.z === 0) {
        group.add(buildEngineMesh(centre, placed.orient, color, opacity));
      } else {
        const box = boxWithEdges(s * 0.98, s * 0.98, s * 0.98, color, opacity);
        box.position.set(centre.x, centre.y, centre.z);
        group.add(box);
      }
    }
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

    // Ability-only parts (no barrel to give them away) get an emitter dome, so
    // a shield, pulse, or nitro block reads as a device rather than a crate.
    if (def.ability) {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(s * 0.28, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshLambertMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.35,
          transparent: opacity < 1,
          opacity,
        }),
      );
      dome.userData.placementSurface = true;
      dome.position.set(centre.x, centre.y + s * 0.49, centre.z);
      group.add(dome);
      const collar = boxWithEdges(s * 0.66, s * 0.1, s * 0.66, 0x30343b, opacity);
      collar.position.set(centre.x, centre.y + s * 0.46, centre.z);
      group.add(collar);
    }
  }
  return group;
}
