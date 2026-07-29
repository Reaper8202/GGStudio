import * as THREE from 'three';
import {
  NEEDLE_GRAVITY_SCALE,
  NEEDLE_HIT_RADIUS,
  NEEDLE_HORIZONTAL_SPEED,
  NEEDLE_LENGTH,
  NEEDLE_LIFETIME,
  NEEDLE_MAX_FLIGHT_TIME,
  NEEDLE_MIN_FLIGHT_TIME,
  NEEDLE_THICKNESS,
  PROJECTILE_DAMAGE,
  PROJECTILE_HIT_RADIUS,
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

/** Which look and flight feel a launched projectile uses. */
export type ProjectileVariant = 'box' | 'needle';

/**
 * Everything that differs between a thrower's tumbling box and a boss's needle.
 * Damage lives here rather than in the impact callback so one pool can carry
 * projectiles that hit for different amounts.
 */
export interface ProjectileSpec {
  readonly horizontalSpeed: number;
  readonly minFlightTime: number;
  readonly maxFlightTime: number;
  readonly lifetime: number;
  readonly damage: number;
  readonly hitRadius: number;
  readonly variant: ProjectileVariant;
  /**
   * Fraction of real gravity the shot feels. 1 is a thrown object's lob. Lower
   * flattens the arc, which matters because a *slower* ballistic shot otherwise
   * has to be thrown *higher* to stay airborne long enough to reach the target —
   * a slow needle at full gravity would sail well over the rig on the way in.
   */
  readonly gravityScale: number;
}

/** The thrower's lob — the shape this pool originally existed to fire. */
export const BOX_PROJECTILE: ProjectileSpec = {
  horizontalSpeed: PROJECTILE_HORIZONTAL_SPEED,
  minFlightTime: PROJECTILE_MIN_FLIGHT_TIME,
  maxFlightTime: PROJECTILE_MAX_FLIGHT_TIME,
  lifetime: PROJECTILE_LIFETIME,
  damage: PROJECTILE_DAMAGE,
  hitRadius: PROJECTILE_HIT_RADIUS,
  variant: 'box',
  gravityScale: 1,
};

/**
 * Base needle spec. Callers override `horizontalSpeed` and `damage` from the
 * firing boss's `BossDefinition`, so boss balance stays in one place.
 */
export const NEEDLE_PROJECTILE: ProjectileSpec = {
  horizontalSpeed: NEEDLE_HORIZONTAL_SPEED,
  minFlightTime: NEEDLE_MIN_FLIGHT_TIME,
  maxFlightTime: NEEDLE_MAX_FLIGHT_TIME,
  lifetime: NEEDLE_LIFETIME,
  damage: 0,
  hitRadius: NEEDLE_HIT_RADIUS,
  variant: 'needle',
  gravityScale: NEEDLE_GRAVITY_SCALE,
};

interface Projectile {
  readonly mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  active: boolean;
  damage: number;
  hitRadius: number;
  variant: ProjectileVariant;
  gravity: number;
}

/**
 * Pooled zombie projectiles: placeholder meshes on a purely kinematic ballistic
 * arc (no Rapier body). The owning system supplies the impact test each step; a
 * projectile despawns on impact, on ground contact, or when its lifetime runs
 * out.
 *
 * Two variants share the pool. A thrower's box tumbles and hits for a flat
 * amount; a boss's needle flies point-first along its own velocity and carries
 * the per-shot damage its definition set. Geometry and material are swapped per
 * launch from a small cache, so slots stay interchangeable.
 */
export class ThrowerProjectiles {
  private readonly pool: Projectile[] = [];
  private readonly boxGeometry: THREE.BoxGeometry;
  private readonly needleGeometry: THREE.BoxGeometry;
  private readonly boxMaterial: THREE.MeshLambertMaterial;
  private readonly needleMaterial: THREE.MeshLambertMaterial;
  private disposed = false;

  constructor(private readonly scene: THREE.Scene) {
    this.boxGeometry = new THREE.BoxGeometry(
      PROJECTILE_SIZE,
      PROJECTILE_SIZE,
      PROJECTILE_SIZE,
    );
    // Built along +Z so the mesh can be pointed with lookAt down its flight path.
    this.needleGeometry = new THREE.BoxGeometry(
      NEEDLE_THICKNESS,
      NEEDLE_THICKNESS,
      NEEDLE_LENGTH,
    );
    this.boxMaterial = new THREE.MeshLambertMaterial({
      color: 0x9b4fd6,
      emissive: 0x38175c,
      flatShading: true,
    });
    // Bone-pale with a faint glow, matching The Spire rather than the thrower.
    this.needleMaterial = new THREE.MeshLambertMaterial({
      color: 0xe4ecd8,
      emissive: 0x5d6b4a,
      flatShading: true,
    });
    for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(this.boxGeometry, this.boxMaterial);
      mesh.castShadow = true;
      mesh.visible = false;
      this.scene.add(mesh);
      this.pool.push({
        mesh,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        active: false,
        damage: 0,
        hitRadius: PROJECTILE_HIT_RADIUS,
        variant: 'box',
        gravity: GRAVITY_MPS2,
      });
    }
  }

  /** Active projectiles, for tests and diagnostics. */
  activeProjectiles(): {
    x: number;
    y: number;
    z: number;
    damage: number;
    variant: ProjectileVariant;
  }[] {
    const out = [];
    for (const projectile of this.pool) {
      if (!projectile.active) continue;
      out.push({
        x: projectile.mesh.position.x,
        y: projectile.mesh.position.y,
        z: projectile.mesh.position.z,
        damage: projectile.damage,
        variant: projectile.variant,
      });
    }
    return out;
  }

  /**
   * Lob a projectile from the shooter onto the target point. Defaults to the
   * thrower's box so existing callers are unchanged.
   */
  launch(
    fromX: number,
    fromY: number,
    fromZ: number,
    targetX: number,
    targetY: number,
    targetZ: number,
    spec: ProjectileSpec = BOX_PROJECTILE,
  ): void {
    if (this.disposed) return;
    const slot = this.pool.find((projectile) => !projectile.active);
    if (!slot) return;

    const dx = targetX - fromX;
    const dz = targetZ - fromZ;
    const horizontalDistance = Math.hypot(dx, dz);
    const flightTime = Math.min(
      spec.maxFlightTime,
      Math.max(spec.minFlightTime, horizontalDistance / spec.horizontalSpeed),
    );
    const gravity = GRAVITY_MPS2 * spec.gravityScale;
    slot.vx = dx / flightTime;
    slot.vz = dz / flightTime;
    // Ballistic arc that lands on the target height after flightTime, under
    // whatever gravity this spec flies with.
    slot.vy = (targetY - fromY) / flightTime + 0.5 * gravity * flightTime;
    slot.life = spec.lifetime;
    slot.active = true;
    slot.damage = spec.damage;
    slot.hitRadius = spec.hitRadius;
    slot.variant = spec.variant;
    slot.gravity = gravity;
    slot.mesh.geometry =
      spec.variant === 'needle' ? this.needleGeometry : this.boxGeometry;
    slot.mesh.material =
      spec.variant === 'needle' ? this.needleMaterial : this.boxMaterial;
    slot.mesh.position.set(fromX, fromY, fromZ);
    slot.mesh.rotation.set(0, 0, 0);
    if (spec.variant === 'needle') this.pointAlongVelocity(slot);
    slot.mesh.visible = true;
  }

  /**
   * Integrate active projectiles. `tryImpact` returns true when the point hit the
   * vehicle (and has applied `damage`); the projectile then despawns. The damage
   * and hit radius are passed per projectile so mixed variants share one pool.
   */
  update(
    dt: number,
    tryImpact: (
      x: number,
      y: number,
      z: number,
      damage: number,
      hitRadius: number,
    ) => boolean,
  ): void {
    if (this.disposed) return;
    for (const projectile of this.pool) {
      if (!projectile.active) continue;
      projectile.life -= dt;
      projectile.vy -= projectile.gravity * dt;
      const position = projectile.mesh.position;
      position.x += projectile.vx * dt;
      position.y += projectile.vy * dt;
      position.z += projectile.vz * dt;
      if (projectile.variant === 'needle') {
        // Track the arc so the needle always points where it is going, including
        // nose-down on the way back to the ground.
        this.pointAlongVelocity(projectile);
      } else {
        projectile.mesh.rotation.x += SPIN_RATE * dt;
        projectile.mesh.rotation.y += SPIN_RATE * 0.7 * dt;
      }

      if (
        projectile.life <= 0 ||
        position.y < GROUND_DESPAWN_Y ||
        tryImpact(
          position.x,
          position.y,
          position.z,
          projectile.damage,
          projectile.hitRadius,
        )
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
    this.boxGeometry.dispose();
    this.needleGeometry.dispose();
    this.boxMaterial.dispose();
    this.needleMaterial.dispose();
  }

  /** Aim the mesh's +Z down its current velocity. */
  private pointAlongVelocity(projectile: Projectile): void {
    const { x, y, z } = projectile.mesh.position;
    projectile.mesh.lookAt(
      x + projectile.vx,
      y + projectile.vy,
      z + projectile.vz,
    );
  }

  private despawn(projectile: Projectile): void {
    projectile.active = false;
    projectile.mesh.visible = false;
  }
}
