/**
 * Small dynamic prop factories (traffic cones, pallets, debris chunks).
 * Each is a low-mass Rapier dynamic body in `CollisionGroups.prop` with a
 * matching low-poly mesh. `ConstructionSite` tracks the returned handles so
 * it can sync mesh transforms each frame and restore initial poses on
 * `reset()`.
 */
import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { GameContext } from "../types";
import { CollisionGroups } from "../types/collision";
import { Materials } from "./materials";

export interface DynamicProp {
  readonly mesh: THREE.Object3D;
  readonly body: RAPIER.RigidBody;
}

/** Small dynamic traffic cone; low mass, easily knocked around. */
export function createTrafficCone(
  ctx: GameContext,
  x: number,
  z: number,
  rotationY = 0
): DynamicProp {
  const height = 0.7;
  const radius = 0.28;
  const y = height / 2;

  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 8), Materials.caution);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotationY;
  ctx.scene.add(mesh);

  const body = ctx.physics.createRigidBody(
    ctx.rapier.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(0.6)
      .setAngularDamping(0.6)
  );
  ctx.physics.createCollider(
    ctx.rapier.ColliderDesc.cone(height / 2, radius)
      .setDensity(15)
      .setFriction(0.9)
      .setCollisionGroups(CollisionGroups.prop),
    body
  );

  return { mesh, body };
}

/** Small dynamic wooden pallet slab. */
export function createPallet(
  ctx: GameContext,
  x: number,
  z: number,
  rotationY = 0
): DynamicProp {
  const size: readonly [number, number, number] = [1.2, 0.18, 1.0];
  const y = size[1] / 2;

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), Materials.wood);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotationY;
  ctx.scene.add(mesh);

  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0));
  const body = ctx.physics.createRigidBody(
    ctx.rapier.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.4)
      .setAngularDamping(0.6)
  );
  ctx.physics.createCollider(
    ctx.rapier.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
      .setDensity(30)
      .setFriction(0.8)
      .setCollisionGroups(CollisionGroups.prop),
    body
  );

  return { mesh, body };
}

/** Small dynamic rubble/debris chunk. */
export function createDebrisChunk(
  ctx: GameContext,
  x: number,
  z: number,
  scale = 1
): DynamicProp {
  const size = 0.45 * scale;
  const y = size / 2;

  const mesh = new THREE.Mesh(
    new THREE.DodecahedronGeometry(size * 0.6, 0),
    Materials.concreteDark
  );
  mesh.position.set(x, y, z);
  mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
  ctx.scene.add(mesh);

  const body = ctx.physics.createRigidBody(
    ctx.rapier.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(0.5)
      .setAngularDamping(0.5)
  );
  ctx.physics.createCollider(
    ctx.rapier.ColliderDesc.ball(size * 0.55)
      .setDensity(25)
      .setFriction(0.9)
      .setCollisionGroups(CollisionGroups.prop),
    body
  );

  return { mesh, body };
}
