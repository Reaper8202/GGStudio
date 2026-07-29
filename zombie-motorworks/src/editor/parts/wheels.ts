/**
 * Wheel and tank-tread meshes.
 *
 * A wheel is built around its `WheelDefinition` so the drawn radius and width
 * are the ones the physics uses: a black tyre with black tread blocks cut into
 * it, and a painted hub. Tread pattern per part id is a small table, the same
 * shape the weapon barrels use.
 *
 * Everything a wheel draws lives under the `wheel-spin` group, which the shared
 * per-frame code rotates about its local +Y — so the hub and tread turn with
 * the tyre.
 */

import * as THREE from 'three';
import { CELL_SIZE, type PartDefinition, type PlacedPart } from '../../core/types.ts';
import { cellCentreM } from '../../core/mass.ts';
import { rotateVec } from '../../core/grid.ts';
import { lambert, partColor, shade, toVector3 } from './shared.ts';
import { addWheelUpgrades, placedUpgradeLevel } from './upgradeKit.ts';

interface WheelStyle {
  /** Tread blocks per row around the circumference. */
  lugCount: number;
  /** Rows of tread blocks across the tyre. */
  lugRows: number;
  /** Tread block height as a fraction of the wheel radius. */
  lugDepth: number;
  /** Total tread band width as a fraction of the tyre width, split over rows. */
  lugWidth: number;
  /** Skew per row, radians — staggered rows read as an aggressive pattern. */
  lugStagger: number;
}

const DEFAULT_STYLE: WheelStyle = {
  lugCount: 16,
  lugRows: 1,
  lugDepth: 0.2,
  lugWidth: 0.86,
  lugStagger: 0,
};

const WHEEL_STYLES: Record<string, Partial<WheelStyle>> = {
  // Deep staggered paddles across the full tread: the off-road wheel should
  // look like it bites.
  'wheel-offroad': { lugCount: 11, lugRows: 2, lugDepth: 0.32, lugWidth: 0.96, lugStagger: 0.3 },
  // Road tyre: blocky but shallower than the paddles.
  'wheel-standard': { lugCount: 15, lugRows: 1, lugDepth: 0.2, lugWidth: 0.88 },
  // Racing hoop — narrow, so the tread stays fine.
  'wheel-moto': { lugCount: 20, lugRows: 1, lugDepth: 0.14, lugWidth: 0.92 },
};

function styleFor(def: PartDefinition): WheelStyle {
  return { ...DEFAULT_STYLE, ...(WHEEL_STYLES[def.id] ?? {}) };
}

/**
 * Standard road/off-road/motorcycle wheel. `color` is the player's paint (or
 * the part default) and only reaches the hub — tyre and tread stay rubber, so a
 * painted wheel still reads as a wheel.
 */
export function buildWheelMesh(
  def: PartDefinition,
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const group = new THREE.Group();
  const w = def.wheel;
  if (!w) return group;
  const style = styleFor(def);
  const centre = cellCentreM(placed.pos);
  const rubber = partColor(def);
  const wheel = new THREE.Group();
  wheel.name = 'wheel-spin';

  const tyreMaterial = lambert(rubber, opacity);

  // The tread blocks form the outer surface, so the carcass is cut back to the
  // groove floor: the silhouette still tops out at exactly the physics radius,
  // however deep the tread gets, instead of hovering the wheel off the ground.
  const lugHeight = w.radius * style.lugDepth;
  const carcassRadius = w.radius - lugHeight * 0.62;

  const carcass = new THREE.Mesh(
    new THREE.CylinderGeometry(carcassRadius, carcassRadius, w.width, 20),
    tyreMaterial,
  );
  carcass.userData.placementSurface = true;
  wheel.add(carcass);

  // Tread blocks: one InstancedMesh for the whole pattern, in the same rubber
  // as the carcass so the tyre reads as one black mass with cut grooves.
  const lugTotal = style.lugCount * style.lugRows;
  if (lugTotal > 0 && style.lugDepth > 0) {
    // Sized off the arc spacing so a low count means chunky blocks with real
    // gaps between them rather than thin fins on a wide tyre.
    const lugLength = ((Math.PI * 2 * w.radius) / style.lugCount) * 0.58;
    const lugGeometry = new THREE.BoxGeometry(
      lugLength,
      lugHeight * 1.6,
      (w.width * style.lugWidth) / style.lugRows,
    );
    const lugs = new THREE.InstancedMesh(lugGeometry, tyreMaterial, lugTotal);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const rowSpan = w.width * style.lugWidth;
    let index = 0;
    for (let row = 0; row < style.lugRows; row++) {
      const y =
        style.lugRows === 1
          ? 0
          : -rowSpan / 2 + ((row + 0.5) / style.lugRows) * rowSpan;
      for (let i = 0; i < style.lugCount; i++) {
        const angle = (i / style.lugCount) * Math.PI * 2 + row * style.lugStagger;
        // Block +Y points out of the tyre, +X follows the rolling direction and
        // +Z runs across the tread (the wheel's axle, local +Y).
        const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        quat.setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(
            new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)),
            out,
            new THREE.Vector3(0, 1, 0),
          ),
        );
        // Outer face lands on the physics radius; the rest sinks into the carcass.
        position.copy(out).multiplyScalar(w.radius - lugHeight * 0.8);
        position.y = y;
        lugs.setMatrixAt(index++, matrix.compose(position, quat, scale));
      }
    }
    lugs.instanceMatrix.needsUpdate = true;
    wheel.add(lugs);
  }

  // Painted hub, proud of the sidewall on both faces so the wheel has a centre.
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(carcassRadius * 0.5, carcassRadius * 0.5, w.width * 1.12, 14),
    lambert(color, opacity),
  );
  hub.userData.placementSurface = true;
  wheel.add(hub);
  const capMaterial = lambert(shade(color, 0.75), opacity);
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(carcassRadius * 0.2, carcassRadius * 0.2, w.width * 0.16, 10),
      capMaterial,
    );
    cap.position.y = side * w.width * 0.6;
    wheel.add(cap);
  }

  // Unlocked hardware rides inside the spin group, so rims and studs turn with
  // the tyre they are bolted to.
  addWheelUpgrades(wheel, w, placedUpgradeLevel(placed), color, opacity);

  // Cylinder geometry runs along +Y; align that to the placed axle axis.
  const axle = rotateVec(placed.orient, w.axleAxis);
  wheel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toVector3(axle));
  wheel.position.set(centre.x, centre.y, centre.z);
  group.add(wheel);
  return group;
}

/**
 * Tank tread: a static belt spanning the part's cells along local Z, with
 * rollers inside it that spin. Only the rollers go in `wheel-spin` — rotating
 * the belt itself would read as a giant wheel.
 */
export function buildTreadMesh(
  def: PartDefinition,
  placed: PlacedPart,
  color: number,
  opacity = 1,
): THREE.Group {
  const group = new THREE.Group();
  const w = def.wheel;
  if (!w) return group;
  const s = CELL_SIZE;
  const centre = cellCentreM(placed.pos);
  const span = (def.cells.length - 1) * s; // end-roller centre separation
  const rollerR = w.radius * 0.86;
  const beltMaterial = lambert(partColor(def), opacity);
  const treadGroup = new THREE.Group();

  // Belt: a slab between the end caps, plus a rounded cap at each end.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w.width, rollerR * 2, span), beltMaterial);
  slab.userData.placementSurface = true;
  treadGroup.add(slab);
  for (const end of [-1, 1]) {
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(rollerR, rollerR, w.width, 14),
      beltMaterial,
    );
    cap.rotation.z = Math.PI / 2; // cylinder +Y -> local X (the axle)
    cap.position.set(0, 0, (end * span) / 2);
    cap.userData.placementSurface = true;
    treadGroup.add(cap);
  }

  // Cleats around the belt perimeter, in the paint colour so a painted tread
  // still reads as the player's.
  const cleatMaterial = lambert(color, opacity);
  const cleatGeometry = new THREE.BoxGeometry(w.width * 1.08, s * 0.1, s * 0.16);
  const cleatsPerSide = def.cells.length * 2;
  for (let i = 0; i < cleatsPerSide; i++) {
    const z = -span / 2 + ((i + 0.5) / cleatsPerSide) * span;
    for (const side of [-1, 1]) {
      const cleat = new THREE.Mesh(cleatGeometry, cleatMaterial);
      cleat.position.set(0, side * rollerR, z);
      treadGroup.add(cleat);
    }
  }

  // Spinning rollers, visible through the gap between the cleats.
  const rollerGroup = new THREE.Group();
  const rollerMaterial = lambert(0x2b2e33, opacity);
  const rollerGeometry = new THREE.CylinderGeometry(
    rollerR * 0.55,
    rollerR * 0.55,
    w.width * 1.12,
    10,
  );
  for (let i = 0; i < def.cells.length; i++) {
    const roller = new THREE.Mesh(rollerGeometry, rollerMaterial);
    // Cylinder axis is +Y, which the roller basis below puts on the axle.
    roller.position.set(0, 0, -span / 2 + (i / (def.cells.length - 1)) * span);
    rollerGroup.add(roller);
  }
  rollerGroup.name = 'wheel-spin';

  const axleV = toVector3(rotateVec(placed.orient, w.axleAxis)).normalize();
  const longV = toVector3(rotateVec(placed.orient, { x: 0, y: 0, z: 1 })).normalize();
  const upV = new THREE.Vector3().crossVectors(longV, axleV).normalize();

  // Belt basis: local X is the axle, local Z the belt's long axis, matching how
  // the slab and caps were built above.
  treadGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(axleV, upV, longV));
  // Roller basis: local Y is the axle, because the shared per-frame code spins
  // wheels with rotateY.
  rollerGroup.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3().crossVectors(axleV, longV).normalize(),
      axleV,
      longV,
    ),
  );
  for (const part of [treadGroup, rollerGroup]) {
    part.position.set(centre.x, centre.y, centre.z);
    group.add(part);
  }
  return group;
}
