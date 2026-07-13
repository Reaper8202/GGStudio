/**
 * Automatic roof turret. Owned by Agent C (Combat).
 *
 * The turret's rotating parts are parented under `vehicle.turretMount`
 * (world-parented under the vehicle root per `VehicleApi`), so Three.js's
 * normal scene-graph transform composition keeps them correctly positioned
 * as the vehicle drives/turns — we only ever set the pivot's *local* yaw.
 *
 * Aiming math: we track the barrel's desired absolute (world-space) yaw
 * angle using the same "default +Z forward" convention as `Zombie`
 * (`atan2(dirX, dirZ)`), slew it toward the target at `targetRotationSpeed`
 * rad/s, then convert to a *local* angle by subtracting the vehicle's own
 * world yaw (derived from `vehicle.forward`, whose local-forward convention
 * is -Z — see the sign flip in `vehicleYaw()`). Rotations about a shared
 * axis (Y) compose by addition, so `local = worldTarget - parentWorld`.
 *
 * Turret position for range/hit-testing is approximated as
 * `vehicle.position + up * TURRET_HEIGHT` (see `weaponConfig.ts`) rather
 * than reading the mount's `matrixWorld` — cheap, avoids stale-matrix
 * ordering concerns between fixedUpdate and render, and plenty accurate for
 * XZ-only gameplay math. The visual turret mesh itself is still parented
 * under the real mount, so it always looks correctly attached.
 *
 * Projectiles are pooled, plain data (no Rapier bodies) — per the frozen
 * "no EventQueue" physics constraint, hit detection is a simple per-step XZ
 * distance check against `ZombieQuery` targets, which is exactly the kind of
 * cheap, stable check the constraint calls for.
 */
import * as THREE from "three";
import type { GameContext, GameSystem, RunModifiers, VehicleApi, ZombieQuery, ZombieTarget } from "../types";
import { GamePhase } from "../types";
import {
  AIM_TOLERANCE_RADIANS,
  BARREL_LENGTH,
  MUZZLE_FLASH_DURATION,
  PROJECTILE_HIT_RADIUS,
  PROJECTILE_POOL_SIZE,
  PROJECTILE_RADIUS,
  STARTER_WEAPON,
  TURRET_HEIGHT,
} from "../config/weaponConfig";
import type { EffectsSystem } from "../effects/EffectsSystem";

const PROJECTILE_GEOMETRY = new THREE.SphereGeometry(PROJECTILE_RADIUS, 6, 6);
const BARREL_GEOMETRY = new THREE.BoxGeometry(0.12, 0.12, BARREL_LENGTH);
const HEAD_GEOMETRY = new THREE.BoxGeometry(0.32, 0.22, 0.32);
const FLASH_GEOMETRY = new THREE.SphereGeometry(0.2, 8, 6);

function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

interface Projectile {
  readonly mesh: THREE.Mesh;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  active: boolean;
  traveled: number;
  maxDistance: number;
  damage: number;
}

export class TurretSystem implements GameSystem {
  private readonly ctx: GameContext;
  private readonly vehicle: VehicleApi;
  private readonly zombies: ZombieQuery;
  private readonly effects: EffectsSystem;

  private readonly pivot: THREE.Group;
  private readonly flashMesh: THREE.Mesh;
  private readonly flashMaterial: THREE.MeshBasicMaterial;

  private readonly pool: Projectile[] = [];

  private currentWorldYaw = 0;
  private fireCooldown = 0;
  private flashTimer = 0;

  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchTurretPos = new THREE.Vector3();

  constructor(ctx: GameContext, vehicle: VehicleApi, zombies: ZombieQuery, effects: EffectsSystem) {
    this.ctx = ctx;
    this.vehicle = vehicle;
    this.zombies = zombies;
    this.effects = effects;

    this.pivot = new THREE.Group();
    vehicle.turretMount.add(this.pivot);

    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a4048,
      roughness: 0.55,
      metalness: 0.3,
    });
    const head = new THREE.Mesh(HEAD_GEOMETRY, headMaterial);
    head.position.y = 0.16;
    this.pivot.add(head);

    const barrelMaterial = new THREE.MeshStandardMaterial({
      color: 0x24282c,
      roughness: 0.5,
      metalness: 0.4,
    });
    const barrelMesh = new THREE.Mesh(BARREL_GEOMETRY, barrelMaterial);
    barrelMesh.position.set(0, 0.16, -BARREL_LENGTH / 2);
    this.pivot.add(barrelMesh);

    this.flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcc55,
      transparent: true,
      opacity: 0,
    });
    this.flashMesh = new THREE.Mesh(FLASH_GEOMETRY, this.flashMaterial);
    this.flashMesh.position.set(0, 0.16, -BARREL_LENGTH);
    this.flashMesh.visible = false;
    this.pivot.add(this.flashMesh);

    for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
      const mesh = new THREE.Mesh(PROJECTILE_GEOMETRY, material);
      mesh.visible = false;
      ctx.scene.add(mesh);
      this.pool.push({
        mesh,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        active: false,
        traveled: 0,
        maxDistance: 0,
        damage: 0,
      });
    }

    this.currentWorldYaw = this.vehicleYaw();
  }

  // ---------------------------------------------------------------------
  // GameSystem
  // ---------------------------------------------------------------------

  fixedUpdate(dt: number): void {
    if (this.ctx.state.phase !== GamePhase.WaveActive) return;

    const modifiers = this.ctx.state.modifiers;
    const range = STARTER_WEAPON.range * Math.max(0, modifiers.weaponRangeMultiplier);
    const turretPos = this.turretPosition();

    const target = this.acquireTarget(turretPos, range);
    const vehicleYaw = this.vehicleYaw();

    let desiredYaw = vehicleYaw;
    if (target) {
      const dx = target.position.x - turretPos.x;
      const dz = target.position.z - turretPos.z;
      desiredYaw = Math.atan2(dx, dz);
    }

    const maxStep = STARTER_WEAPON.targetRotationSpeed * dt;
    const diff = wrapAngle(desiredYaw - this.currentWorldYaw);
    const step = Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
    this.currentWorldYaw = wrapAngle(this.currentWorldYaw + step);
    this.pivot.rotation.y = wrapAngle(this.currentWorldYaw - vehicleYaw);

    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (target) {
      const aimError = Math.abs(wrapAngle(desiredYaw - this.currentWorldYaw));
      if (aimError <= AIM_TOLERANCE_RADIANS && this.fireCooldown <= 0) {
        // Only start the cooldown on an ACTUAL shot — if the projectile
        // pool was momentarily exhausted, retry next tick instead of
        // silently swallowing the shot (matters with stacked Fire Rate
        // upgrades, which have no maximum level).
        if (this.fire(turretPos, target, modifiers)) {
          const fireRate = Math.max(0.01, STARTER_WEAPON.fireRate * Math.max(0, modifiers.fireRateMultiplier));
          this.fireCooldown = 1 / fireRate;
        }
      }
    }

    this.updateProjectiles(dt);
  }

  update(dt: number): void {
    if (this.flashTimer <= 0) return;
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    const t = this.flashTimer / MUZZLE_FLASH_DURATION;
    this.flashMaterial.opacity = t;
    this.flashMesh.visible = t > 0;
    this.flashMesh.scale.setScalar(0.6 + t * 0.8);
  }

  reset(): void {
    for (const p of this.pool) {
      p.active = false;
      p.mesh.visible = false;
    }
    this.fireCooldown = 0;
    this.flashTimer = 0;
    this.flashMesh.visible = false;
    this.flashMaterial.opacity = 0;
    this.currentWorldYaw = this.vehicleYaw();
    this.pivot.rotation.y = 0;
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private turretPosition(): THREE.Vector3 {
    this.scratchTurretPos.set(
      this.vehicle.position.x,
      this.vehicle.position.y + TURRET_HEIGHT,
      this.vehicle.position.z
    );
    return this.scratchTurretPos;
  }

  /** World-space yaw of the vehicle, in the same `atan2(dirX, dirZ)`
   *  ("default +Z forward") convention used for `currentWorldYaw`. The
   *  vehicle's own local-forward is -Z (see `Vehicle.ts`), hence the sign
   *  flip on both components here. */
  private vehicleYaw(): number {
    const f = this.vehicle.forward;
    return Math.atan2(-f.x, -f.z);
  }

  private acquireTarget(turretPos: THREE.Vector3, range: number): ZombieTarget | null {
    let best: ZombieTarget | null = null;
    let bestDistSq = range * range;
    for (const z of this.zombies.getActiveZombies()) {
      if (!z.isAlive) continue;
      const dx = z.position.x - turretPos.x;
      const dz = z.position.z - turretPos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq <= bestDistSq) {
        bestDistSq = distSq;
        best = z;
      }
    }
    return best;
  }

  /** Fires one pooled projectile at `target`. Returns false (no cooldown,
   *  no flash/audio) when the projectile pool is momentarily exhausted so
   *  the caller retries on the next tick instead of dropping the shot. */
  private fire(turretPos: THREE.Vector3, target: ZombieTarget, modifiers: RunModifiers): boolean {
    const slot = this.acquireProjectile();
    if (!slot) return false;

    this.scratchDir.set(target.position.x - turretPos.x, 0, target.position.z - turretPos.z);
    const len = this.scratchDir.length() || 1;
    this.scratchDir.multiplyScalar(1 / len);

    slot.active = true;
    slot.position.set(
      turretPos.x + this.scratchDir.x * BARREL_LENGTH,
      turretPos.y,
      turretPos.z + this.scratchDir.z * BARREL_LENGTH
    );
    slot.velocity.set(
      this.scratchDir.x * STARTER_WEAPON.projectileSpeed,
      0,
      this.scratchDir.z * STARTER_WEAPON.projectileSpeed
    );
    slot.traveled = 0;
    slot.maxDistance = STARTER_WEAPON.range * Math.max(0, modifiers.weaponRangeMultiplier) + BARREL_LENGTH;
    slot.damage = STARTER_WEAPON.damage * Math.max(0, modifiers.weaponDamageMultiplier);
    slot.mesh.visible = true;
    slot.mesh.position.copy(slot.position);

    this.flashTimer = MUZZLE_FLASH_DURATION;
    this.flashMesh.visible = true;
    this.flashMaterial.opacity = 1;
    this.flashMesh.scale.setScalar(1.4);

    this.ctx.events.emit("audio:play", { sound: "shot" });
    return true;
  }

  private acquireProjectile(): Projectile | null {
    for (const p of this.pool) {
      if (!p.active) return p;
    }
    return null;
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;

      p.position.addScaledVector(p.velocity, dt);
      p.traveled += STARTER_WEAPON.projectileSpeed * dt;
      p.mesh.position.copy(p.position);

      if (p.traveled >= p.maxDistance) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }

      const hit = this.findHit(p);
      if (hit) {
        this.scratchDir.set(p.velocity.x, 0, p.velocity.z).normalize();
        hit.takeDamage(p.damage, this.scratchDir);
        this.effects.spawnImpactPuff(p.position);
        this.ctx.events.emit("audio:play", { sound: "impact" });
        p.active = false;
        p.mesh.visible = false;
      }
    }
  }

  private findHit(p: Projectile): ZombieTarget | null {
    for (const z of this.zombies.getActiveZombies()) {
      if (!z.isAlive) continue;
      const dx = z.position.x - p.position.x;
      const dz = z.position.z - p.position.z;
      if (dx * dx + dz * dz <= PROJECTILE_HIT_RADIUS * PROJECTILE_HIT_RADIUS) {
        return z;
      }
    }
    return null;
  }
}
