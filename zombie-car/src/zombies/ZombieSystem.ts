/**
 * Owns the zombie pool: spawning, the per-frame state-machine/movement pass,
 * cheap separation, vehicle-impact detection, and swarm-contact reporting.
 *
 * IMPORTANT: `ctx.physics.step()` runs without an `EventQueue` (see
 * `docs/STATUS.md`), so nothing here can listen for collision-start/-end
 * events. Vehicle-zombie "contact" (for both impact damage and swarm-contact
 * counting) is a plain XZ distance check against `vehicle.position` each
 * fixedUpdate — cheap, stable, and framerate-independent since it runs at
 * the fixed physics rate. Physical collision response (zombies bumping the
 * vehicle/each other/geometry) still happens automatically via Rapier's
 * solver every `physics.step()`; we just can't query *events* for it.
 */
import * as THREE from "three";
import type { GameContext, GameSystem, VehicleApi, WorldApi, ZombieQuery, ZombieTarget } from "../types";
import { GamePhase, ZombieState } from "../types";
import type { EffectsSystem } from "../effects/EffectsSystem";
import { Zombie } from "./Zombie";
import {
  IMPACT_DAMAGE_PER_SPEED,
  MIN_IMPACT_SPEED,
  SEPARATION_RADIUS,
  SEPARATION_STRENGTH,
  STUCK_TELEPORT_DISPLACEMENT,
  STUCK_TELEPORT_SECONDS,
  ZOMBIE_CONTACT_RADIUS,
  ZOMBIE_POOL_SIZE,
} from "../config/zombieConfig";
import { MIN_SPAWN_DISTANCE_FROM_VEHICLE } from "../config/waveConfig";

export class ZombieSystem implements GameSystem, ZombieQuery {
  private readonly ctx: GameContext;
  private readonly world: WorldApi;
  private readonly vehicle: VehicleApi;
  private readonly effects: EffectsSystem;

  private readonly pool: Zombie[];
  private readonly sepX: Float32Array;
  private readonly sepZ: Float32Array;
  private readonly liveTargets: Zombie[] = [];
  private readonly activeScratch: Zombie[] = [];

  /** No-progress watchdog (per pool slot): anchor position + seconds spent
   *  within `STUCK_TELEPORT_DISPLACEMENT` of it while Chasing. Once the
   *  timer exceeds `STUCK_TELEPORT_SECONDS` the zombie is teleported to a
   *  fresh spawn point — the hard guarantee that geometry traps can never
   *  stall a wave forever. */
  private readonly watchdogX: Float32Array;
  private readonly watchdogZ: Float32Array;
  private readonly watchdogTimer: Float32Array;

  private healthMultiplier = 1;
  private speedMultiplier = 1;

  constructor(ctx: GameContext, world: WorldApi, vehicle: VehicleApi, effects: EffectsSystem) {
    this.ctx = ctx;
    this.world = world;
    this.vehicle = vehicle;
    this.effects = effects;

    this.pool = [];
    for (let i = 0; i < ZOMBIE_POOL_SIZE; i++) {
      this.pool.push(new Zombie(ctx, effects, i));
    }
    this.sepX = new Float32Array(ZOMBIE_POOL_SIZE);
    this.sepZ = new Float32Array(ZOMBIE_POOL_SIZE);
    this.watchdogX = new Float32Array(ZOMBIE_POOL_SIZE);
    this.watchdogZ = new Float32Array(ZOMBIE_POOL_SIZE);
    this.watchdogTimer = new Float32Array(ZOMBIE_POOL_SIZE);
  }

  // ---------------------------------------------------------------------
  // ZombieQuery
  // ---------------------------------------------------------------------

  getActiveZombies(): readonly ZombieTarget[] {
    return this.liveTargets;
  }

  // ---------------------------------------------------------------------
  // WaveManager-facing API
  // ---------------------------------------------------------------------

  /** Applies this wave's health/speed multipliers to every zombie spawned
   *  from now on (existing active zombies keep their already-scaled stats). */
  setWaveMultipliers(healthMultiplier: number, speedMultiplier: number): void {
    this.healthMultiplier = healthMultiplier;
    this.speedMultiplier = speedMultiplier;
  }

  getActiveCount(): number {
    let count = 0;
    for (const z of this.pool) if (z.isAlive) count++;
    return count;
  }

  /** Attempts to spawn one zombie at a valid, far-enough spawn point.
   *  Returns false if the pool is full or no spawn point currently
   *  qualifies (both treated as "try again next tick" by the caller). */
  trySpawn(): boolean {
    let slot: Zombie | null = null;
    for (const z of this.pool) {
      if (!z.active) {
        slot = z;
        break;
      }
    }
    if (!slot) return false;

    const point = this.pickSpawnPoint();
    if (!point) return false;

    slot.spawn(point, this.healthMultiplier, this.speedMultiplier);
    this.resetWatchdog(slot);
    return true;
  }

  private pickSpawnPoint(): THREE.Vector3 | null {
    const points = this.world.spawnPoints;
    if (points.length === 0) return null;

    const far = points.filter(
      (p) => p.distanceTo(this.vehicle.position) >= MIN_SPAWN_DISTANCE_FROM_VEHICLE
    );
    const candidates = far.length > 0 ? far : points;

    // Prefer the farthest-from-vehicle points (off-view), with a little
    // randomness among the top half so spawns don't all cluster at one
    // point on the ring.
    const sorted = [...candidates].sort(
      (a, b) => b.distanceTo(this.vehicle.position) - a.distanceTo(this.vehicle.position)
    );
    const topN = Math.max(1, Math.ceil(sorted.length / 2));
    return sorted[Math.floor(Math.random() * topN)];
  }

  // ---------------------------------------------------------------------
  // GameSystem
  // ---------------------------------------------------------------------

  fixedUpdate(dt: number): void {
    if (this.ctx.state.phase !== GamePhase.WaveActive) {
      for (const z of this.pool) z.freeze();
      this.vehicle.setSwarmContacts(0);
      this.rebuildLiveTargets();
      return;
    }

    this.activeScratch.length = 0;
    for (const z of this.pool) {
      if (z.active && z.state !== ZombieState.Dead) this.activeScratch.push(z);
    }

    this.applySeparation(this.activeScratch);

    for (const z of this.activeScratch) {
      z.fixedUpdate(dt, this.vehicle, this.world, this.sepX[z.index], this.sepZ[z.index]);
      this.updateWatchdog(z, dt);
    }

    this.processVehicleContacts(this.activeScratch);
    this.rebuildLiveTargets();
  }

  update(dt: number): void {
    for (const z of this.pool) z.update(dt);
  }

  reset(): void {
    for (const z of this.pool) z.forceReturnToPool();
    this.healthMultiplier = 1;
    this.speedMultiplier = 1;
    this.liveTargets.length = 0;
    this.activeScratch.length = 0;
    this.watchdogTimer.fill(0);
    this.vehicle.setSwarmContacts(0);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private resetWatchdog(z: Zombie): void {
    this.watchdogX[z.index] = z.position.x;
    this.watchdogZ[z.index] = z.position.z;
    this.watchdogTimer[z.index] = 0;
  }

  /** No-progress failsafe: only armed while Chasing (Attacking/Spawning are
   *  intentionally stationary; KnockedBack is sub-second). If the zombie
   *  hasn't moved `STUCK_TELEPORT_DISPLACEMENT` from its anchor within
   *  `STUCK_TELEPORT_SECONDS`, teleport-respawn it at a far spawn point
   *  (health/stats preserved) so a geometry trap can never stall the wave. */
  private updateWatchdog(z: Zombie, dt: number): void {
    const i = z.index;
    if (z.state !== ZombieState.Chasing) {
      this.resetWatchdog(z);
      return;
    }

    const dx = z.position.x - this.watchdogX[i];
    const dz = z.position.z - this.watchdogZ[i];
    if (dx * dx + dz * dz >= STUCK_TELEPORT_DISPLACEMENT * STUCK_TELEPORT_DISPLACEMENT) {
      this.resetWatchdog(z);
      return;
    }

    this.watchdogTimer[i] += dt;
    if (this.watchdogTimer[i] < STUCK_TELEPORT_SECONDS) return;

    const point = this.pickSpawnPoint();
    if (point) z.teleportTo(point);
    // Re-anchor either way; if no point qualified we retry after another
    // full window rather than hammering every step.
    this.resetWatchdog(z);
  }

  /** Cheap O(n^2) pairwise push-apart (n <= ~30 active zombies at once). */
  private applySeparation(active: readonly Zombie[]): void {
    this.sepX.fill(0);
    this.sepZ.fill(0);

    for (let i = 0; i < active.length; i++) {
      const a = active[i];
      for (let j = i + 1; j < active.length; j++) {
        const b = active[j];
        const dx = a.position.x - b.position.x;
        const dz = a.position.z - b.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq >= SEPARATION_RADIUS * SEPARATION_RADIUS || distSq < 1e-6) continue;

        const dist = Math.sqrt(distSq);
        const push = (SEPARATION_RADIUS - dist) * SEPARATION_STRENGTH;
        const nx = (dx / dist) * push;
        const nz = (dz / dist) * push;
        this.sepX[a.index] += nx;
        this.sepZ[a.index] += nz;
        this.sepX[b.index] -= nx;
        this.sepZ[b.index] -= nz;
      }
    }
  }

  /** XZ-distance-based vehicle contact: drives both swarm-contact counting
   *  and speed-scaled impact damage/knockback. */
  private processVehicleContacts(active: readonly Zombie[]): void {
    const speed = this.vehicle.speed;
    const vx = this.vehicle.position.x;
    const vz = this.vehicle.position.z;
    let contacts = 0;

    for (const z of active) {
      if (z.state === ZombieState.Spawning) continue;

      const dx = z.position.x - vx;
      const dz = z.position.z - vz;
      const dist = Math.hypot(dx, dz);
      if (dist > ZOMBIE_CONTACT_RADIUS) continue;

      contacts++;

      if (speed >= MIN_IMPACT_SPEED) {
        const dirX = dist > 1e-4 ? dx / dist : 1;
        const dirZ = dist > 1e-4 ? dz / dist : 0;
        const damage = speed * IMPACT_DAMAGE_PER_SPEED;
        z.applyVehicleImpact(damage, dirX, dirZ);
        this.effects.spawnImpactPuff(z.position);
        this.ctx.events.emit("audio:play", { sound: "impact" });
      }
    }

    this.vehicle.setSwarmContacts(contacts);
  }

  private rebuildLiveTargets(): void {
    this.liveTargets.length = 0;
    for (const z of this.pool) {
      if (z.active && z.state !== ZombieState.Dead && z.state !== ZombieState.Spawning) {
        this.liveTargets.push(z);
      }
    }
  }
}
