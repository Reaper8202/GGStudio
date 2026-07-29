/**
 * Shared palette, materials and greeble primitives for the per-part mesh
 * builders in this folder.
 *
 * Two rules keep these usable everywhere a part is drawn:
 * - Only a part's structural body carries `userData.placementSurface`. Detail
 *   geometry is skipped by the editor's face raycast, so a bolt or a strap can
 *   never be mistaken for a build face.
 * - A placement surface must reach the cell boundary. The editor turns a hit
 *   into a target cell by nudging the hit point 2 cm along the face normal, so
 *   a body inset from its cell would resolve back onto itself and refuse
 *   neighbours.
 */

import * as THREE from 'three';
import type { OrientationIndex, PartDefinition, Vec3i } from '../../core/types.ts';
import { rotateVec } from '../../core/grid.ts';

const COLORS: Record<string, number> = {
  'chassis-core': 0xd97a2b,
  'frame-box': 0x8a8f98,
  'frame-reinforced': 0x5a606b,
  'engine-small': 0xa03c3c,
  'fuel-tank': 0xb0803a,
  'wheel-standard': 0x23262b,
  'wheel-offroad': 0x1b1e22,
  'wheel-moto': 0x2c3038,
  'tread-tank': 0x3a3f36,
  turret: 0x39424e,
  'armour-plate': 0x69737a,
  'cannon-heavy': 0x303840,
  'ice-cannon': 0x4db8e0,
  'tesla-coil': 0x5ac8ff,
  'shield-generator': 0x2f7bd6,
  'pulse-emitter': 0x7a53c8,
  // Bare bottle metal with a green tint left in it: the injector's colour is
  // the charge decal and the armed light, not the tanks (see `parts/mobility.ts`).
  'nitro-injector': 0x76837c,
  // Chrome, not cyan: the phase drive's colour lives in the lit gaps between
  // its vertebrae, so the body itself stays grey (see `parts/mobility.ts`).
  'phase-drive': 0x939ca6,
  'mind-control-beam': 0xc060ff,
  'missile-launcher': 0x8a5a2b,
  'nitro-booster': 0x2a8cff,
  thumper: 0xffcf80,
  'barrel-drum': 0x7d5a3a,
  // Plant yellow: the one part on the rig that is site machinery, not scrap.
  'dozer-blade': 0xc9a227,
  'spike-ram': 0x8a8f98,
  sawblade: 0x5c6570,
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

/** Bare metal accents shared by every part's detail geometry. */
export const STEEL = 0x3a3f47;
export const DARK_STEEL = 0x22262c;
export const EDGE_COLOR = 0x11141a;

export function partColor(def: PartDefinition): number {
  return COLORS[def.id] ?? CATEGORY_FALLBACK[def.category] ?? 0x999999;
}

/** Standard part material; `opacity < 1` is the editor's ghost pass. */
export function lambert(color: number, opacity = 1): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity });
}

/** Self-lit accent (gauge windows, emitter domes). */
export function glowLambert(
  color: number,
  opacity = 1,
  intensity = 0.6,
): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    transparent: opacity < 1,
    opacity,
  });
}

/** Shift a hex colour towards black (factor < 1) or white (factor > 1). */
export function shade(color: number, factor: number): number {
  const c = new THREE.Color(color);
  if (factor >= 1) c.lerp(new THREE.Color(0xffffff), Math.min(factor - 1, 1));
  else c.multiplyScalar(factor);
  return c.getHex();
}

/** Solid block with dark contour lines — the game's base part silhouette. */
export function boxWithEdges(
  w: number,
  h: number,
  d: number,
  color: number,
  opacity = 1,
): THREE.Group {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color, opacity));
  mesh.userData.placementSurface = true;
  g.add(mesh);
  g.add(edgesOf(mesh.geometry, opacity));
  return g;
}

/** Contour lines for a geometry, matching the ghost pass's transparency. */
export function edgesOf(
  geometry: THREE.BufferGeometry,
  opacity = 1,
  color = EDGE_COLOR,
): THREE.LineSegments {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 * opacity }),
  );
}

export function toVector3(v: Vec3i): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

/** The placed orientation as a rotation, so a part can be modelled at orient 0. */
export function orientationQuaternion(orient: OrientationIndex): THREE.Quaternion {
  const basis = new THREE.Matrix4().makeBasis(
    toVector3(rotateVec(orient, { x: 1, y: 0, z: 0 })),
    toVector3(rotateVec(orient, { x: 0, y: 1, z: 0 })),
    toVector3(rotateVec(orient, { x: 0, y: 0, z: 1 })),
  );
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

/** Two unit vectors spanning the plane perpendicular to `axis`. */
function basisFor(axis: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const seed =
    Math.abs(axis.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(seed, axis).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  return [u, v];
}

export interface BoltRingOptions {
  /** Bolts evenly spaced around the ring. Four with `phase: PI/4` = corners. */
  count: number;
  /** Ring radius from `centre`, metres. */
  radius: number;
  /** Hex head radius, metres. */
  headRadius: number;
  /** Shank length along `axis`, metres. */
  length: number;
  /** Shank direction; heads point along it. */
  axis: THREE.Vector3;
  /** Ring centre in the parent's local space. */
  centre: THREE.Vector3;
  /** Angular offset of the first bolt, radians. */
  phase?: number;
  color?: number;
  opacity?: number;
}

/**
 * A ring of hex-head bolts as a single InstancedMesh. Bolts are the cheapest
 * way to make a slab read as fabricated rather than extruded, and a rig can
 * carry dozens of plates — one draw call per ring keeps that affordable.
 */
export function boltRing(options: BoltRingOptions): THREE.InstancedMesh {
  const {
    count,
    radius,
    headRadius,
    length,
    axis,
    centre,
    phase = 0,
    color = DARK_STEEL,
    opacity = 1,
  } = options;
  const geometry = new THREE.CylinderGeometry(headRadius * 0.86, headRadius, length, 6);
  const mesh = new THREE.InstancedMesh(geometry, lambert(color, opacity), count);
  const dir = axis.clone().normalize();
  const [u, v] = basisFor(dir);
  // Cylinder geometry runs along +Y; stand each bolt up along the ring axis.
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const scale = new THREE.Vector3(1, 1, 1);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const angle = phase + (i / count) * Math.PI * 2;
    position
      .copy(centre)
      .addScaledVector(u, Math.cos(angle) * radius)
      .addScaledVector(v, Math.sin(angle) * radius);
    mesh.setMatrixAt(i, matrix.compose(position, quat, scale));
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
