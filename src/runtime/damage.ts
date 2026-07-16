/**
 * Collision damage and structural island splitting.
 *
 * Connections are tracked logically; when one fails, connected components are
 * recomputed. The component containing the root keeps the main body; every
 * other island becomes a new compound rigid body with preserved point
 * velocity (v + ω×r). Debris colliders are slightly shrunk instead of using a
 * collision-group grace period — break-plane neighbours then never spawn
 * interpenetrating, which avoids solver pop (documented deviation from
 * PHYSICS_MODEL.md's grace-period suggestion).
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type { AssembledVehicle } from './assembler.ts';
import { DEBRIS_GROUPS } from './assembler.ts';
import { CELL_SIZE } from '../core/types.ts';
import { computeIslands } from '../core/structural.ts';
import { add, cross, scale, sub, v3 } from './vec.ts';

export interface DetachedIsland {
  body: RAPIER.RigidBody;
  partIds: string[];
}

export interface DamageEvents {
  destroyedParts: string[];
  detachedIslands: DetachedIsland[];
}

const IMPACT_DAMAGE_SCALE = 1 / 900; // hp per N of contact force
const CONNECTION_DAMAGE_SCALE = 1 / 55000; // connection health per N

/** Apply impact damage to a part (by collider handle) and its connections. */
export function applyImpactDamage(
  vehicle: AssembledVehicle,
  colliderToPart: Map<number, string>,
  colliderHandle: number,
  forceMagnitude: number,
): void {
  const partId = colliderToPart.get(colliderHandle);
  if (!partId) return;
  const part = vehicle.parts.get(partId);
  if (!part || !part.alive) return;
  part.health -= forceMagnitude * IMPACT_DAMAGE_SCALE;
  for (const ci of vehicle.connectionsByPart.get(partId) ?? []) {
    const conn = vehicle.connections[ci];
    if (conn.health <= 0) continue;
    // Stronger joints shed proportionally less health.
    conn.health -= (forceMagnitude * CONNECTION_DAMAGE_SCALE * 30000) / conn.maxForce;
  }
}

export function applyDirectDamage(vehicle: AssembledVehicle, partId: string, amount: number): void {
  const part = vehicle.parts.get(partId);
  if (!part || !part.alive) return;
  const absorb = part.def.armour && !part.def.armour.cosmetic ? part.def.armour.protection : 0;
  part.health -= Math.max(1, amount - absorb);
}

/**
 * Resolve deaths and splits after damage was applied this step.
 * Removes dead parts' colliders, recomputes islands, spawns debris bodies.
 */
export function resolveStructure(
  world: RAPIER.World,
  vehicle: AssembledVehicle,
  colliderToPart: Map<number, string>,
): DamageEvents {
  const destroyed: string[] = [];

  for (const [id, part] of vehicle.parts) {
    if (part.alive && part.health <= 0) {
      part.alive = false;
      destroyed.push(id);
      for (const h of part.colliderHandles) {
        const col = world.getCollider(h);
        if (col) world.removeCollider(col, true);
        colliderToPart.delete(h);
      }
      part.colliderHandles = [];
      for (const ci of vehicle.connectionsByPart.get(id) ?? []) {
        vehicle.connections[ci].health = 0;
      }
    }
  }

  // Recompute islands over alive, still-attached parts.
  const attached = [...vehicle.parts.values()].filter((p) => p.alive && !p.detached);
  const liveConns = vehicle.connections.filter((c) => {
    if (c.health <= 0) return false;
    const a = vehicle.parts.get(c.aId);
    const b = vehicle.parts.get(c.bId);
    return !!a && !!b && a.alive && !a.detached && b.alive && !b.detached;
  });
  const islands = computeIslands(
    attached.map((p) => p.placed.id),
    liveConns,
  );

  const detachedIslands: DetachedIsland[] = [];
  if (islands.length <= 1) return { destroyedParts: destroyed, detachedIslands };

  const rootIsland = islands.find((isle) => isle.includes(vehicle.rootPartId)) ?? islands[0];
  const body = vehicle.body;
  const bodyPos = body.translation();
  const bodyRot = body.rotation();
  const linvel = body.linvel();
  const angvel = body.angvel();
  const com = body.worldCom();

  for (const isle of islands) {
    if (isle === rootIsland) continue;
    const newBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(bodyPos.x, bodyPos.y, bodyPos.z)
        .setRotation(bodyRot)
        .setAngvel(angvel)
        .setLinvel(linvel.x, linvel.y, linvel.z),
    );
    const half = (CELL_SIZE / 2) * 0.94; // shrunk: no break-plane interpenetration pop
    const islandCentres: { x: number; y: number; z: number }[] = [];
    for (const partId of isle) {
      const part = vehicle.parts.get(partId)!;
      part.detached = true;
      for (const h of part.colliderHandles) {
        const col = world.getCollider(h);
        if (col) world.removeCollider(col, true);
        colliderToPart.delete(h);
      }
      const newHandles: number[] = [];
      for (const centre of part.colliderCentresM) {
        const desc = RAPIER.ColliderDesc.cuboid(half, half, half)
          .setTranslation(centre.x, centre.y, centre.z)
          .setMass(part.def.massKg / part.colliderCentresM.length)
          .setFriction(0.6)
          .setCollisionGroups(DEBRIS_GROUPS);
        const col = world.createCollider(desc, newBody);
        newHandles.push(col.handle);
        islandCentres.push(centre);
      }
      part.colliderHandles = newHandles;
      const wheel = vehicle.wheels.find((w) => w.partId === partId);
      if (wheel) wheel.broken = true;
    }
    // Point velocity at the island CoM: v + ω × r (not a plain linvel copy).
    if (islandCentres.length > 0) {
      const centroid = islandCentres.reduce(
        (acc, c) => ({ x: acc.x + c.x / islandCentres.length, y: acc.y + c.y / islandCentres.length, z: acc.z + c.z / islandCentres.length }),
        { x: 0, y: 0, z: 0 },
      );
      // centroid is body-local; rotate into world.
      const qv = { x: bodyRot.x, y: bodyRot.y, z: bodyRot.z };
      const t = scale(cross(v3(qv.x, qv.y, qv.z), v3(centroid.x, centroid.y, centroid.z)), 2);
      const centroidW = add(
        v3(bodyPos.x, bodyPos.y, bodyPos.z),
        add(v3(centroid.x, centroid.y, centroid.z), add(scale(t, bodyRot.w), cross(v3(qv.x, qv.y, qv.z), t))),
      );
      const r = sub(centroidW, v3(com.x, com.y, com.z));
      const pointVel = add(v3(linvel.x, linvel.y, linvel.z), cross(v3(angvel.x, angvel.y, angvel.z), r));
      newBody.setLinvel({ x: pointVel.x, y: pointVel.y, z: pointVel.z }, true);
    }
    detachedIslands.push({ body: newBody, partIds: isle });
  }

  return { destroyedParts: destroyed, detachedIslands };
}
