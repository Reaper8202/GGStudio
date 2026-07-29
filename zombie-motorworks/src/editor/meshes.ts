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
import { boxWithEdges, partColor } from './parts/shared.ts';
import { buildArmourPlateMesh, buildFaceArmourMesh } from './parts/armourPlate.ts';
import { buildPulseEmitterMesh, buildShieldGeneratorMesh } from './parts/defence.ts';
import { buildEngineMesh } from './parts/engine.ts';
import { buildFuelTankMesh } from './parts/fuelTank.ts';
import { buildMeleeMesh } from './parts/melee.ts';
import { buildNitroInjectorMesh, buildPhaseDriveMesh } from './parts/mobility.ts';
import { buildWeaponMesh } from './parts/weapons.ts';
import { buildTreadMesh, buildWheelMesh } from './parts/wheels.ts';
import { buildBlockUpgrades } from './parts/upgradeKit.ts';

export { partColor };
export { applyWeaponAim } from './parts/weapons.ts';

/**
 * Bolt on whatever the part's upgrade level has unlocked and hand the group
 * back, so a builder can end with `return withUpgradeKit(...)`.
 *
 * Guns, wheels and armour plates are absent from here on purpose: their kits go
 * inside the aiming group, the spinning group and the slab respectively, so the
 * hardware moves with the thing it is bolted to.
 */
function withUpgradeKit(
  group: THREE.Group,
  def: PartDefinition,
  placed: PlacedPart,
  color: number,
  opacity: number,
): THREE.Group {
  const kit = buildBlockUpgrades(def, placed, color, opacity);
  if (kit) group.add(kit);
  return group;
}

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
    // Terminal part: the editor's build raycast skips these surfaces, so a
    // spinning drum or blade can never become the face a neighbour is dropped
    // onto. Selection still hits them.
    group.userData.blocksAttachments = true;
    group.add(buildMeleeMesh(def, placed, color, opacity));
    return withUpgradeKit(group, def, placed, color, opacity);
  }

  if (def.armour) {
    // Face-mounted armour has no cell of its own; plates occupy one.
    group.add(
      def.cells.length === 0
        ? buildFaceArmourMesh(def, placed, color, opacity)
        : buildArmourPlateMesh(placed, color, opacity),
    );
    // Plates carry their own kit inside the slab, in the slab's frame.
    return group;
  }

  // Ability parts with a modelled device of their own: defence emitters and
  // mobility hardware. Anything else with an ability falls through to the
  // generic block-plus-dome treatment at the bottom of this function.
  if (def.id === 'shield-generator') {
    group.add(buildShieldGeneratorMesh(placed, color, opacity));
    return withUpgradeKit(group, def, placed, color, opacity);
  }

  if (def.id === 'pulse-emitter') {
    group.add(buildPulseEmitterMesh(placed, color, opacity));
    return withUpgradeKit(group, def, placed, color, opacity);
  }

  if (def.id === 'nitro-injector') {
    group.add(buildNitroInjectorMesh(placed, color, opacity));
    return withUpgradeKit(group, def, placed, color, opacity);
  }

  if (def.id === 'phase-drive') {
    group.add(buildPhaseDriveMesh(placed, color, opacity));
    return withUpgradeKit(group, def, placed, color, opacity);
  }

  if (def.id === 'fuel-tank') {
    group.add(buildFuelTankMesh(placed, color, opacity));
    return withUpgradeKit(group, def, placed, color, opacity);
  }

  if (def.weapon) {
    // Guns bolt their own kit onto the aiming group, so it swings with them.
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
    return withUpgradeKit(group, def, placed, color, opacity);
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
  return withUpgradeKit(group, def, placed, color, opacity);
}
