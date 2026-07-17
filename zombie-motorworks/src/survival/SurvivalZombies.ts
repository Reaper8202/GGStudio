import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GROUP_ZOMBIE } from '../runtime/assembler.ts';
import type { RuntimeVehicle } from '../runtime/vehicle.ts';

const ZOMBIE_COUNT = 8;
const ZOMBIE_HEALTH = 25;
const ZOMBIE_SPEED = 1.6;
const ZOMBIE_Y = 0.8;
const SPAWN_RADIUS_MIN = 25;
const SPAWN_RADIUS_MAX = 35;
const RESPAWN_SECONDS = 2;
const ATTACK_RANGE = 2.4;
const ATTACK_INTERVAL = 1;
const ATTACK_DAMAGE = 6;
const RAM_SPEED_THRESHOLD = 5;
const RAM_CONTACT_RANGE = 1.1;
const RAM_DAMAGE_PER_MPS = 3.5;
const RAM_COOLDOWN = 0.65;
const RAM_STUN_SECONDS = 0.45;
const ZOMBIE_GROUPS = (GROUP_ZOMBIE << 16) | 0xffff;

type ZombieMesh = THREE.Mesh<
  THREE.CapsuleGeometry,
  THREE.MeshLambertMaterial
>;

interface ZombieSlot {
  body: RAPIER.RigidBody | null;
  colliderHandle: number | null;
  mesh: ZombieMesh;
  health: number;
  respawnTimer: number;
  attackCooldown: number;
  ramCooldown: number;
  stunTimer: number;
}

interface Position {
  x: number;
  y: number;
  z: number;
}

/** Fixed-size zombie pool used by the tracer-bullet survival mode. */
export class SurvivalZombies {
  private readonly slots: ZombieSlot[] = [];
  private readonly colliderToZombie = new Map<number, ZombieSlot>();
  private readonly geometry: THREE.CapsuleGeometry;
  private readonly material: THREE.MeshLambertMaterial;
  private disposed = false;

  constructor(
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    initialVehiclePos: Position,
  ) {
    this.geometry = new THREE.CapsuleGeometry(0.28, 0.8, 4, 8);
    this.material = new THREE.MeshLambertMaterial({ color: 0x5d8a4a });

    for (let i = 0; i < ZOMBIE_COUNT; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      this.scene.add(mesh);
      const slot: ZombieSlot = {
        body: null,
        colliderHandle: null,
        mesh,
        health: 0,
        respawnTimer: 0,
        attackCooldown: 0,
        ramCooldown: 0,
        stunTimer: 0,
      };
      this.slots.push(slot);
      this.spawn(slot, initialVehiclePos);
    }
  }

  /** Advance pursuit, attacks, ram interactions, and delayed respawns. */
  step(dt: number, vehicle: RuntimeVehicle): number {
    if (this.disposed) return 0;

    const vehiclePos = vehicle.body.translation();
    const vehicleVelocity = vehicle.body.linvel();
    const vehicleSpeed = Math.hypot(
      vehicleVelocity.x,
      vehicleVelocity.y,
      vehicleVelocity.z,
    );
    let ramKills = 0;

    for (const slot of this.slots) {
      if (!slot.body) {
        slot.respawnTimer -= dt;
        if (slot.respawnTimer <= 0) this.spawn(slot, vehiclePos);
        continue;
      }

      slot.attackCooldown = Math.max(0, slot.attackCooldown - dt);
      slot.ramCooldown = Math.max(0, slot.ramCooldown - dt);
      slot.stunTimer = Math.max(0, slot.stunTimer - dt);

      const zombiePos = slot.body.translation();
      const nearestPart = vehicle.nearestLivePart(zombiePos);
      if (!nearestPart) continue;
      const dx = nearestPart.position.x - zombiePos.x;
      const dz = nearestPart.position.z - zombiePos.z;
      const horizontalDistance = Math.hypot(dx, dz);

      if (slot.stunTimer <= 0 && horizontalDistance > 0.5) {
        const velocity = slot.body.linvel();
        slot.body.setLinvel(
          {
            x: (dx / horizontalDistance) * ZOMBIE_SPEED,
            y: velocity.y,
            z: (dz / horizontalDistance) * ZOMBIE_SPEED,
          },
          true,
        );
      }

      if (
        nearestPart.distance <= RAM_CONTACT_RANGE &&
        vehicleSpeed >= RAM_SPEED_THRESHOLD &&
        slot.ramCooldown <= 0
      ) {
        const killed = this.damage(slot, vehicleSpeed * RAM_DAMAGE_PER_MPS);
        if (killed) {
          ramKills++;
          continue;
        }
        this.knockBack(
          slot,
          zombiePos,
          nearestPart.position,
          vehicleVelocity,
          vehicleSpeed,
        );
      }

      if (
        nearestPart.distance <= ATTACK_RANGE &&
        slot.stunTimer <= 0 &&
        slot.attackCooldown <= 0
      ) {
        vehicle.applyDirectDamage(nearestPart.partId, ATTACK_DAMAGE);
        slot.attackCooldown = ATTACK_INTERVAL;
      }
    }

    return ramKills;
  }

  /** Apply a weapon hit by collider handle; true only on the killing hit. */
  hitZombieHandle(handle: number, damage: number): boolean {
    if (this.disposed || damage <= 0) return false;
    const slot = this.colliderToZombie.get(handle);
    return slot ? this.damage(slot, damage) : false;
  }

  aliveCount(): number {
    let count = 0;
    for (const slot of this.slots) {
      if (slot.body) count++;
    }
    return count;
  }

  syncVisuals(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (!slot.body) continue;
      const position = slot.body.translation();
      slot.mesh.position.set(position.x, position.y, position.z);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) {
      if (slot.body) this.world.removeRigidBody(slot.body);
      slot.body = null;
      slot.colliderHandle = null;
      this.scene.remove(slot.mesh);
    }
    this.colliderToZombie.clear();
    this.geometry.dispose();
    this.material.dispose();
  }

  private spawn(slot: ZombieSlot, centre: Position): void {
    const angle = Math.random() * Math.PI * 2;
    const radius =
      SPAWN_RADIUS_MIN + Math.random() * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN);
    const x = centre.x + Math.cos(angle) * radius;
    const z = centre.z + Math.sin(angle) * radius;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, ZOMBIE_Y, z)
        .lockRotations(),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.4, 0.28)
        .setMass(70)
        .setFriction(0.8)
        .setCollisionGroups(ZOMBIE_GROUPS),
      body,
    );

    slot.body = body;
    slot.colliderHandle = collider.handle;
    slot.health = ZOMBIE_HEALTH;
    slot.respawnTimer = 0;
    slot.attackCooldown = 0;
    slot.ramCooldown = 0;
    slot.stunTimer = 0;
    slot.mesh.visible = true;
    slot.mesh.position.set(x, ZOMBIE_Y, z);
    this.colliderToZombie.set(collider.handle, slot);
  }

  private damage(slot: ZombieSlot, amount: number): boolean {
    if (!slot.body || amount <= 0) return false;
    slot.health -= amount;
    if (slot.health > 0) return false;

    if (slot.colliderHandle !== null) {
      this.colliderToZombie.delete(slot.colliderHandle);
    }
    this.world.removeRigidBody(slot.body);
    slot.body = null;
    slot.colliderHandle = null;
    slot.health = 0;
    slot.respawnTimer = RESPAWN_SECONDS;
    slot.mesh.visible = false;
    return true;
  }

  private knockBack(
    slot: ZombieSlot,
    zombiePos: Position,
    targetPosition: Position,
    vehicleVelocity: Position,
    vehicleSpeed: number,
  ): void {
    if (!slot.body) return;
    const awayX = zombiePos.x - targetPosition.x;
    const awayZ = zombiePos.z - targetPosition.z;
    const awayLength = Math.hypot(awayX, awayZ);
    const horizontalVehicleSpeed = Math.hypot(vehicleVelocity.x, vehicleVelocity.z);
    const nx = awayLength > 1e-4
      ? awayX / awayLength
      : horizontalVehicleSpeed > 1e-4
        ? vehicleVelocity.x / horizontalVehicleSpeed
        : 1;
    const nz = awayLength > 1e-4
      ? awayZ / awayLength
      : horizontalVehicleSpeed > 1e-4
        ? vehicleVelocity.z / horizontalVehicleSpeed
        : 0;
    const knockbackSpeed = Math.max(4, vehicleSpeed * 0.8);
    const currentVelocity = slot.body.linvel();
    slot.body.setLinvel(
      {
        x: nx * knockbackSpeed,
        y: Math.max(2, currentVelocity.y),
        z: nz * knockbackSpeed,
      },
      true,
    );
    slot.ramCooldown = RAM_COOLDOWN;
    slot.stunTimer = RAM_STUN_SECONDS;
  }
}
