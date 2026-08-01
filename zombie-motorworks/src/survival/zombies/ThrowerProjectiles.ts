import * as THREE from 'three';
import {
  BEHEMOTH_BOULDER_BLAST_RADIUS,
  BEHEMOTH_BOULDER_COLOR,
  BEHEMOTH_BOULDER_DAMAGE,
  BEHEMOTH_BOULDER_HIT_RADIUS,
  BEHEMOTH_BOULDER_LIFETIME,
  BEHEMOTH_BOULDER_MAX_FLIGHT_TIME,
  BEHEMOTH_BOULDER_MIN_FLIGHT_TIME,
  BEHEMOTH_BOULDER_SIZE,
  BEHEMOTH_BOULDER_SPEED,
  BEHEMOTH_BOULDER_STUN_SECONDS,
  PROJECTILE_DAMAGE,
  PROJECTILE_HIT_RADIUS,
  PROJECTILE_HORIZONTAL_SPEED,
  PROJECTILE_LIFETIME,
  PROJECTILE_MAX_FLIGHT_TIME,
  PROJECTILE_MIN_FLIGHT_TIME,
  PROJECTILE_POOL_SIZE,
  PROJECTILE_SIZE,
  VIAL_CAPSULE_LENGTH,
  VIAL_CAPSULE_RADIUS,
  VIAL_GRAVITY_SCALE,
  VIAL_HIT_RADIUS,
  VIAL_HORIZONTAL_SPEED,
  VIAL_LIFETIME,
  VIAL_MAX_FLIGHT_TIME,
  VIAL_MIN_FLIGHT_TIME,
} from './zombieConfig.ts';
import { VFX_PALETTE } from '../../vfx/vfxConfig.ts';
import type { VfxSystem } from '../../vfx/VfxSystem.ts';

const GRAVITY_MPS2 = 9.81;
const GROUND_DESPAWN_Y = 0.1;
const SPIN_RATE = 5; // rad/s, visual only
/** How often a box vents a trail mote, seconds. Independent of the step rate
 * so a physics substep never doubles the emission. */
const BOX_TRAIL_INTERVAL = 0.045;

/** Which look and flight feel a launched projectile uses. */
export type ProjectileVariant = 'box' | 'vial' | 'boulder';

/**
 * Everything that differs between a thrower's tumbling box and a boss's vial.
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
   * Fraction of real gravity the shot feels. 1 is a thrown object's lob, what
   * both current variants use. Lower would flatten the arc, which matters for
   * a hypothetical *slower* ballistic shot: at full gravity it would have to be
   * thrown *higher* to stay airborne long enough to reach the target, and a
   * slow enough shot would sail well over the rig on the way in.
   */
  readonly gravityScale: number;
  /**
   * Acid-puddle payload a vial carries to wherever it lands; undefined for
   * every other variant. Carried on the spec (set from the firing boss's
   * `BossVialAttack`) rather than looked up again at landing time, so a puddle
   * always matches the throw that made it even if the wave's boss definition
   * has since changed (e.g. the boss died and the wave cleared mid-flight).
   */
  readonly puddle?: {
    readonly radiusM: number;
    readonly durationSeconds: number;
    readonly poisonDamagePerSecond: number;
  };
  /**
   * Landing blast a behemoth's boulder carries; undefined for every other
   * variant. Like `puddle` it rides on the spec rather than being looked up at
   * landing time, so the shot that is already in the air keeps the numbers it
   * was thrown with even if its thrower has since died.
   */
  readonly aoe?: {
    readonly radiusM: number;
    readonly damage: number;
    readonly stunSeconds: number;
  };
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
 * Base vial spec. Callers override `horizontalSpeed` and `damage` from the
 * firing boss's `BossDefinition`, so boss balance stays in one place.
 */
export const VIAL_PROJECTILE: ProjectileSpec = {
  horizontalSpeed: VIAL_HORIZONTAL_SPEED,
  minFlightTime: VIAL_MIN_FLIGHT_TIME,
  maxFlightTime: VIAL_MAX_FLIGHT_TIME,
  lifetime: VIAL_LIFETIME,
  damage: 0,
  hitRadius: VIAL_HIT_RADIUS,
  variant: 'vial',
  gravityScale: VIAL_GRAVITY_SCALE,
};

/**
 * The behemoth's boulder. Slow, heavy, and the only shot in the pool that
 * carries a landing blast — see `ProjectileSpec.aoe`.
 */
export const BOULDER_PROJECTILE: ProjectileSpec = {
  horizontalSpeed: BEHEMOTH_BOULDER_SPEED,
  minFlightTime: BEHEMOTH_BOULDER_MIN_FLIGHT_TIME,
  maxFlightTime: BEHEMOTH_BOULDER_MAX_FLIGHT_TIME,
  lifetime: BEHEMOTH_BOULDER_LIFETIME,
  // The direct hit is the small half of it; the blast below is the payload.
  damage: BEHEMOTH_BOULDER_DAMAGE * 0.5,
  hitRadius: BEHEMOTH_BOULDER_HIT_RADIUS,
  variant: 'boulder',
  gravityScale: 1,
  aoe: {
    radiusM: BEHEMOTH_BOULDER_BLAST_RADIUS,
    damage: BEHEMOTH_BOULDER_DAMAGE,
    stunSeconds: BEHEMOTH_BOULDER_STUN_SECONDS,
  },
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
  puddle: ProjectileSpec['puddle'];
  aoe: ProjectileSpec['aoe'];
  trailTimer: number;
}

/**
 * Pooled zombie projectiles: placeholder meshes on a purely kinematic ballistic
 * arc (no Rapier body). The owning system supplies the impact test each step; a
 * projectile despawns on impact, on ground contact, or when its lifetime runs
 * out.
 *
 * Two variants share the pool. Both tumble in flight and hit for a flat amount
 * — a thrower's box, and a boss's acid vial, which additionally bursts into a
 * puddle wherever it ends up (see `onLand` on `update`). Geometry and material
 * are swapped per launch from a small cache, so slots stay interchangeable.
 */
export class ThrowerProjectiles {
  private readonly pool: Projectile[] = [];
  private readonly boxGeometry: THREE.BoxGeometry;
  private readonly vialGeometry: THREE.CapsuleGeometry;
  private readonly boulderGeometry: THREE.IcosahedronGeometry;
  private readonly boxMaterial: THREE.MeshLambertMaterial;
  private readonly vialMaterial: THREE.MeshLambertMaterial;
  private readonly boulderMaterial: THREE.MeshLambertMaterial;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly vfx: VfxSystem | null = null,
  ) {
    this.boxGeometry = new THREE.BoxGeometry(
      PROJECTILE_SIZE,
      PROJECTILE_SIZE,
      PROJECTILE_SIZE,
    );
    // A primitive capsule, same shape family as the boss's own body and held
    // prop — no art asset, by design. It tumbles like the box rather than
    // flying point-first, so no fixed orientation is baked in here.
    this.vialGeometry = new THREE.CapsuleGeometry(
      VIAL_CAPSULE_RADIUS,
      VIAL_CAPSULE_LENGTH,
      3,
      6,
    );
    // Lit to the same violet as the trail it trails, and emissive enough to
    // stay legible against a dark arena while it is still far enough out to be
    // dodged — an incoming lob the player never picks up is just unexplained
    // damage. The glow is the light-independent half of that read; the
    // per-mote trail on top is what makes the arc itself readable.
    this.boxMaterial = new THREE.MeshLambertMaterial({
      color: VFX_PALETTE.necro,
      emissive: 0x6b23c4,
      flatShading: true,
    });
    // Glassy acid green with a faint glow, matching the alchemist and the
    // puddle its vials leave behind.
    this.vialMaterial = new THREE.MeshLambertMaterial({
      color: 0x74ff3a,
      emissive: 0x2c5a12,
      flatShading: true,
    });
    // A single-subdivision icosahedron: chunky rock facets with no art asset,
    // matching the ground-smash rubble the behemoth already kicks up.
    this.boulderGeometry = new THREE.IcosahedronGeometry(
      BEHEMOTH_BOULDER_SIZE,
      0,
    );
    // Dull, unlit stone — it must NOT glow like the box does. The read on this
    // shot is its size and its arc, and it is the one incoming projectile the
    // player is meant to feel is worth outrunning rather than tanking.
    this.boulderMaterial = new THREE.MeshLambertMaterial({
      color: BEHEMOTH_BOULDER_COLOR,
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
        puddle: undefined,
        aoe: undefined,
        trailTimer: 0,
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
    slot.puddle = spec.puddle;
    slot.aoe = spec.aoe;
    slot.trailTimer = 0;
    slot.mesh.geometry =
      spec.variant === 'vial'
        ? this.vialGeometry
        : spec.variant === 'boulder'
          ? this.boulderGeometry
          : this.boxGeometry;
    slot.mesh.material =
      spec.variant === 'vial'
        ? this.vialMaterial
        : spec.variant === 'boulder'
          ? this.boulderMaterial
          : this.boxMaterial;
    slot.mesh.position.set(fromX, fromY, fromZ);
    slot.mesh.rotation.set(0, 0, 0);
    slot.mesh.visible = true;
  }

  /**
   * Integrate active projectiles. `tryImpact` returns true when the point hit the
   * vehicle (and has applied `damage`); the projectile then despawns. The damage
   * and hit radius are passed per projectile so mixed variants share one pool.
   *
   * `onLand`, if given, fires once for every projectile that despawns this step —
   * ground contact, a vehicle hit, or running out of lifetime — with where it
   * ended up, its variant, and its `puddle` payload (only ever set for a vial).
   * Only a vial boss's caller does anything with it (bursting a puddle there);
   * every other variant's caller can ignore it.
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
    onLand?: (
      x: number,
      y: number,
      z: number,
      variant: ProjectileVariant,
      puddle: ProjectileSpec['puddle'],
      aoe: ProjectileSpec['aoe'],
    ) => void,
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
      // Both variants tumble in flight; neither flies point-first any more now
      // that the needle bolt (the one shot that needed to) is gone.
      projectile.mesh.rotation.x += SPIN_RATE * dt;
      projectile.mesh.rotation.y += SPIN_RATE * 0.7 * dt;

      // Boxes stream witch-light along the arc; a vial already reads on its own
      // and carries the boss's gas trail besides.
      if (projectile.variant === 'box') {
        projectile.trailTimer -= dt;
        if (projectile.trailTimer <= 0) {
          projectile.trailTimer = BOX_TRAIL_INTERVAL;
          this.vfx?.throwerTrail(position.x, position.y, position.z);
        }
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
        if (projectile.variant === 'box') {
          this.vfx?.throwerImpact(position.x, position.y, position.z);
        }
        onLand?.(
          position.x,
          position.y,
          position.z,
          projectile.variant,
          projectile.puddle,
          projectile.aoe,
        );
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
    this.vialGeometry.dispose();
    this.boulderGeometry.dispose();
    this.boxMaterial.dispose();
    this.vialMaterial.dispose();
    this.boulderMaterial.dispose();
  }

  private despawn(projectile: Projectile): void {
    projectile.active = false;
    projectile.mesh.visible = false;
  }
}
