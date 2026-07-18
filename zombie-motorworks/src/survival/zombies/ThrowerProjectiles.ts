import * as THREE from 'three';
import {
  PROJECTILE_HORIZONTAL_SPEED,
  PROJECTILE_LIFETIME,
  PROJECTILE_MAX_FLIGHT_TIME,
  PROJECTILE_MIN_FLIGHT_TIME,
  PROJECTILE_POOL_SIZE,
  PROJECTILE_SIZE,
} from './zombieConfig.ts';

const GRAVITY_MPS2 = 9.81;
const GROUND_DESPAWN_Y = 0.1;
const SPIN_RATE = 5; // rad/s, visual only

interface Projectile {
  readonly mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  active: boolean;
}

/**
 * Pooled thrower projectiles: placeholder boxes on a purely kinematic
 * ballistic arc (no Rapier body). The owning system supplies the impact test
 * each step; a projectile despawns on impact, on ground contact, or when its
 * lifetime runs out.
 */
export class ThrowerProjectiles {
  private readonly pool: Projectile[] = [];
  private readonly geometry: THREE.BoxGeometry;
  private readonly material: THREE.MeshLambertMaterial;
  private disposed = false;

  constructor(private readonly scene: THREE.Scene) {
    this.geometry = new THREE.BoxGeometry(
      PROJECTILE_SIZE,
      PROJECTILE_SIZE,
      PROJECTILE_SIZE,
    );
    this.material = new THREE.MeshLambertMaterial({
      color: 0x9b4fd6,
      emissive: 0x38175c,
      flatShading: true,
    });
    for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.castShadow = true;
      mesh.visible = false;
      this.scene.add(mesh);
      this.pool.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, active: false });
    }
  }

  /** Lob a projectile from the thrower's hands onto the target point. */
  launch(
    fromX: number,
    fromY: number,
    fromZ: number,
    targetX: number,
    targetY: number,
    targetZ: number,
  ): void {
    if (this.disposed) return;
    const slot = this.pool.find((projectile) => !projectile.active);
    if (!slot) return;

    const dx = targetX - fromX;
    const dz = targetZ - fromZ;
    const horizontalDistance = Math.hypot(dx, dz);
    const flightTime = Math.min(
      PROJECTILE_MAX_FLIGHT_TIME,
      Math.max(
        PROJECTILE_MIN_FLIGHT_TIME,
        horizontalDistance / PROJECTILE_HORIZONTAL_SPEED,
      ),
    );
    slot.vx = dx / flightTime;
    slot.vz = dz / flightTime;
    // Ballistic arc that lands on the target height after flightTime.
    slot.vy = (targetY - fromY) / flightTime + 0.5 * GRAVITY_MPS2 * flightTime;
    slot.life = PROJECTILE_LIFETIME;
    slot.active = true;
    slot.mesh.position.set(fromX, fromY, fromZ);
    slot.mesh.rotation.set(0, 0, 0);
    slot.mesh.visible = true;
  }

  /**
   * Integrate active projectiles. `tryImpact` returns true when the point
   * hit the vehicle (and has applied damage); the projectile then despawns.
   */
  update(
    dt: number,
    tryImpact: (x: number, y: number, z: number) => boolean,
  ): void {
    if (this.disposed) return;
    for (const projectile of this.pool) {
      if (!projectile.active) continue;
      projectile.life -= dt;
      projectile.vy -= GRAVITY_MPS2 * dt;
      const position = projectile.mesh.position;
      position.x += projectile.vx * dt;
      position.y += projectile.vy * dt;
      position.z += projectile.vz * dt;
      projectile.mesh.rotation.x += SPIN_RATE * dt;
      projectile.mesh.rotation.y += SPIN_RATE * 0.7 * dt;

      if (
        projectile.life <= 0 ||
        position.y < GROUND_DESPAWN_Y ||
        tryImpact(position.x, position.y, position.z)
      ) {
        this.despawn(projectile);
      }
    }
  }

  despawnAll(): void {
    for (const projectile of this.pool) this.despawn(projectile);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const projectile of this.pool) this.scene.remove(projectile.mesh);
    this.pool.length = 0;
    this.geometry.dispose();
    this.material.dispose();
  }

  private despawn(projectile: Projectile): void {
    projectile.active = false;
    projectile.mesh.visible = false;
  }
}
