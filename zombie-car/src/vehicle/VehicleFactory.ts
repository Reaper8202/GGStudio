/**
 * Builds a drivable vehicle (visual meshes + one Rapier rigid body) from a
 * data-driven `VehicleBlueprint`. Does NOT assume any fixed component count
 * or layout — it unions the local bounding boxes of whatever components the
 * blueprint contains to size the single arcade collider.
 */
import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type {
  GameContext,
  VehicleBlueprint,
  VehicleComponentBlueprint,
} from "../types";
import { CollisionGroups } from "../types/collision";
import { GRID_CELL_SIZE } from "../config/blueprints";

/** Small vertical gap kept between the lowest component and the ground at spawn. */
const SPAWN_GROUND_CLEARANCE = 0.05;

export interface WheelVisual {
  readonly mesh: THREE.Object3D;
  readonly radius: number;
  readonly isFront: boolean;
}

export interface VehicleBuild {
  /** Visual root — follows the physics body every render frame. */
  readonly root: THREE.Object3D;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly turretMount: THREE.Object3D;
  readonly wheels: readonly WheelVisual[];
  /** Chassis-type meshes, used for the damage flash. */
  readonly chassisMeshes: readonly THREE.Mesh[];
  readonly totalMass: number;
  readonly spawnPosition: THREE.Vector3;
  readonly spawnYaw: number;
}

interface BoxConfig {
  width: number;
  height: number;
  depth: number;
  color: number;
}

function readNumber(
  config: VehicleComponentBlueprint["configuration"],
  key: string,
  fallback: number
): number {
  const value = config?.[key];
  return typeof value === "number" ? value : fallback;
}

function readColor(
  config: VehicleComponentBlueprint["configuration"],
  fallback: number
): number {
  const value = config?.color;
  return typeof value === "number" ? value : fallback;
}

function boxConfigFor(component: VehicleComponentBlueprint): BoxConfig {
  const cfg = component.configuration;
  return {
    width: readNumber(cfg, "width", 1),
    height: readNumber(cfg, "height", 0.5),
    depth: readNumber(cfg, "depth", 1),
    color: readColor(cfg, 0x777777),
  };
}

function localCenter(component: VehicleComponentBlueprint): THREE.Vector3 {
  return new THREE.Vector3(
    component.gridPosition.x * GRID_CELL_SIZE,
    component.gridPosition.y * GRID_CELL_SIZE,
    component.gridPosition.z * GRID_CELL_SIZE
  );
}

/** Local (unrotated) half-extents used purely for the union bounding box. */
function componentHalfExtents(component: VehicleComponentBlueprint): THREE.Vector3 {
  if (component.type === "wheel") {
    const radius = readNumber(component.configuration, "radius", 0.3);
    const thickness = readNumber(component.configuration, "thickness", 0.28);
    return new THREE.Vector3(thickness / 2, radius, radius);
  }
  if (component.type === "weapon") {
    const radius = readNumber(component.configuration, "radius", 0.25);
    const thickness = readNumber(component.configuration, "thickness", 0.15);
    return new THREE.Vector3(radius, thickness, radius);
  }
  const box = boxConfigFor(component);
  return new THREE.Vector3(box.width / 2, box.height / 2, box.depth / 2);
}

function buildWheelMesh(component: VehicleComponentBlueprint): THREE.Mesh {
  const radius = readNumber(component.configuration, "radius", 0.3);
  const thickness = readNumber(component.configuration, "thickness", 0.28);
  const color = readColor(component.configuration, 0x1a1a1a);
  const geometry = new THREE.CylinderGeometry(radius, radius, thickness, 14);
  // Cylinder's default axis is local Y; rotate so its axis is local X (wheel
  // spin axis running left/right across the vehicle).
  geometry.rotateZ(Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  return new THREE.Mesh(geometry, material);
}

function buildBoxMesh(component: VehicleComponentBlueprint): THREE.Mesh {
  const box = boxConfigFor(component);
  const geometry = new THREE.BoxGeometry(box.width, box.height, box.depth);
  const material = new THREE.MeshStandardMaterial({
    color: box.color,
    roughness: 0.7,
    metalness: 0.15,
  });
  return new THREE.Mesh(geometry, material);
}

function buildWeaponMount(component: VehicleComponentBlueprint): THREE.Group {
  const radius = readNumber(component.configuration, "radius", 0.25);
  const thickness = readNumber(component.configuration, "thickness", 0.1);
  const color = readColor(component.configuration, 0x33383d);
  const mount = new THREE.Group();
  const baseGeometry = new THREE.CylinderGeometry(radius, radius, thickness, 12);
  const baseMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = thickness / 2;
  mount.add(base);
  return mount;
}

export function buildVehicle(
  ctx: GameContext,
  blueprint: VehicleBlueprint,
  spawnXZ: { x: number; z: number },
  spawnYaw = 0
): VehicleBuild {
  const RAPIER_NS = ctx.rapier;

  // --- union bounding box (drives the single arcade collider) ------------
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let totalMass = 0;

  for (const component of blueprint.components) {
    const center = localCenter(component);
    const half = componentHalfExtents(component);
    minX = Math.min(minX, center.x - half.x);
    maxX = Math.max(maxX, center.x + half.x);
    minY = Math.min(minY, center.y - half.y);
    maxY = Math.max(maxY, center.y + half.y);
    minZ = Math.min(minZ, center.z - half.z);
    maxZ = Math.max(maxZ, center.z + half.z);
    totalMass += component.mass;
  }

  const halfExtents = new THREE.Vector3(
    Math.max((maxX - minX) / 2, 0.1),
    Math.max((maxY - minY) / 2, 0.1),
    Math.max((maxZ - minZ) / 2, 0.1)
  );
  const centerLocal = new THREE.Vector3(
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2
  );

  // Body origin height so the lowest component sits `SPAWN_GROUND_CLEARANCE`
  // above the ground plane (y = 0) at spawn.
  const spawnY = SPAWN_GROUND_CLEARANCE - minY;
  const spawnPosition = new THREE.Vector3(spawnXZ.x, spawnY, spawnXZ.z);
  const spawnQuat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    spawnYaw
  );

  // --- visuals -------------------------------------------------------------
  const root = new THREE.Object3D();
  root.position.copy(spawnPosition);
  root.quaternion.copy(spawnQuat);
  ctx.scene.add(root);

  const wheels: WheelVisual[] = [];
  const chassisMeshes: THREE.Mesh[] = [];
  let turretMount: THREE.Object3D | null = null;

  // Front wheels = the wheel components with the most negative local z
  // (blueprint forward axis is local -Z).
  let minWheelZ = Infinity;
  for (const component of blueprint.components) {
    if (component.type === "wheel") {
      minWheelZ = Math.min(minWheelZ, component.gridPosition.z);
    }
  }

  for (const component of blueprint.components) {
    const center = localCenter(component);
    const rot = component.localRotation;

    if (component.type === "wheel") {
      const mesh = buildWheelMesh(component);
      mesh.position.copy(center);
      mesh.rotation.set(rot.x, rot.y, rot.z);
      root.add(mesh);
      wheels.push({
        mesh,
        radius: readNumber(component.configuration, "radius", 0.3),
        isFront: component.gridPosition.z === minWheelZ,
      });
      continue;
    }

    if (component.type === "weapon") {
      const mount = buildWeaponMount(component);
      mount.position.copy(center);
      mount.rotation.set(rot.x, rot.y, rot.z);
      root.add(mount);
      turretMount = mount;
      continue;
    }

    const mesh = buildBoxMesh(component);
    mesh.position.copy(center);
    mesh.rotation.set(rot.x, rot.y, rot.z);
    root.add(mesh);
    if (component.type === "chassis") {
      chassisMeshes.push(mesh);
    }
  }

  if (!turretMount) {
    // Blueprint had no weapon component — still expose a mount so the
    // combat system has somewhere to attach a turret.
    turretMount = new THREE.Group();
    turretMount.position.set(0, halfExtents.y * 2, 0);
    root.add(turretMount);
  }

  // --- physics ---------------------------------------------------------
  const bodyDesc = RAPIER_NS.RigidBodyDesc.dynamic()
    .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
    .setRotation({ x: spawnQuat.x, y: spawnQuat.y, z: spawnQuat.z, w: spawnQuat.w })
    // Lock pitch/roll so the vehicle can never flip — only yaw (steering)
    // is simulated. This is the "strong upright stability" mechanism.
    .enabledRotations(false, true, false)
    // Near-zero: coast-down is handled explicitly by the controller's
    // rollingResistance, not by solver damping.
    .setLinearDamping(0.01)
    .setAngularDamping(2.5)
    .setCcdEnabled(true)
    .setAdditionalMass(totalMass);

  const body = ctx.physics.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER_NS.ColliderDesc.cuboid(
    halfExtents.x,
    halfExtents.y,
    halfExtents.z
  )
    .setTranslation(centerLocal.x, centerLocal.y, centerLocal.z)
    .setDensity(0) // mass fully controlled by setAdditionalMass above
    // Zero contact friction: the arcade model slides its box along the
    // ground (wheels are visual only), so solver friction would act as a
    // constant ~mu*g brake fighting engine acceleration. Rolling
    // resistance, braking, and lateral grip are all applied explicitly by
    // the controller instead. Min combine rule keeps the ground's own
    // friction coefficient from reintroducing it.
    .setFriction(0)
    .setFrictionCombineRule(RAPIER_NS.CoefficientCombineRule.Min)
    .setRestitution(0.02)
    .setCollisionGroups(CollisionGroups.vehicle);

  const collider = ctx.physics.createCollider(colliderDesc, body);

  return {
    root,
    body,
    collider,
    turretMount,
    wheels,
    chassisMeshes,
    totalMass,
    spawnPosition,
    spawnYaw,
  };
}
