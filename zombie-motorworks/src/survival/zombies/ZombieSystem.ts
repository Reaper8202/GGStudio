import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { DamageType, MeleeDefinition } from '../../core/types.ts';
import { empShieldLeak } from '../../core/turretModules.ts';
import type { RuntimePart } from '../../runtime/assembler.ts';
import type { RuntimeVehicle } from '../../runtime/vehicle.ts';
import { vehicleImpactMassFactor } from '../../core/mass.ts';
import type { MeleeVfxKind, VfxSystem } from '../../vfx/VfxSystem.ts';
import {
  Zombie,
  ZombieState,
  type Vector3Like,
  type ZombieKind,
  type ZombieKilledCallback,
} from './Zombie.ts';
import { Landmines, type MineSnapshot } from './Landmines.ts';
import { ThrowerProjectiles } from './ThrowerProjectiles.ts';
import {
  HORDE_SCATTER_RADIUS,
  IMPACT_DAMAGE_PER_SPEED,
  LANDMINE_BLAST_RADIUS,
  LANDMINE_TRIGGER_RADIUS,
  LETHAL_IMPACT_SPEED,
  MAXIMUM_SWARM_DRAG,
  MIN_IMPACT_SPEED,
  MIN_SPAWN_DISTANCE_FROM_VEHICLE,
  PROJECTILE_HIT_RADIUS,
  PROJECTILE_LAUNCH_HEIGHT,
  SEPARATION_RADIUS,
  SEPARATION_STRENGTH,
  STUCK_TELEPORT_DISPLACEMENT,
  STUCK_TELEPORT_SECONDS,
  SWARM_DRAG_ACCELERATION,
  SWARM_DRAG_PER_CONTACT,
  ZOMBIE_CONTACT_RADIUS,
  ZOMBIE_HALF_HEIGHT,
  ZOMBIE_POOL_COUNTS,
  ZOMBIE_POOL_SIZE,
  ZOMBIE_RADIUS,
} from './zombieConfig.ts';
import { devTuning } from '../devtuning/DevTuning.ts';

interface VehiclePartAnchor {
  readonly partId: string;
  readonly part: RuntimePart;
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
  worldX: number;
  worldY: number;
  worldZ: number;
}

export type ZombieHitResult = 'miss' | 'shielded' | 'damaged' | 'killed';

/** Contact effect for a touched part: its melee visual, or a bare ram. */
function meleeVfxKindFor(visual: string | undefined): MeleeVfxKind {
  if (visual === 'blade') return 'blade';
  if (visual === 'spikes') return 'spikes';
  return 'drum';
}

/** Pooled zombie AI, handle routing, vehicle contacts, and spawn selection. */
export class ZombieSystem {
  private readonly pool: Zombie[] = [];
  private readonly colliderToZombie = new Map<number, Zombie>();
  private readonly activeScratch: Zombie[] = [];
  private readonly aliveTargets: Zombie[] = [];
  private readonly separationX = new Float32Array(ZOMBIE_POOL_SIZE);
  private readonly separationZ = new Float32Array(ZOMBIE_POOL_SIZE);
  private readonly watchdogX = new Float32Array(ZOMBIE_POOL_SIZE);
  private readonly watchdogZ = new Float32Array(ZOMBIE_POOL_SIZE);
  private readonly watchdogTimer = new Float32Array(ZOMBIE_POOL_SIZE);
  private readonly vehicleAnchors: VehiclePartAnchor[] = [];
  private readonly spawnCandidateIndices: Int16Array;
  private readonly spawnCandidateDistances: Float32Array;
  private readonly spawnScratch = new THREE.Vector3();
  private readonly swarmForce = { x: 0, y: 0, z: 0 };
  private readonly blastDirection = { x: 0, y: 0, z: 0 };
  private readonly fallbackGeometry: THREE.CapsuleGeometry;
  private readonly projectiles: ThrowerProjectiles;
  private readonly landmines: Landmines;
  private readonly tryProjectileImpact = (
    x: number,
    y: number,
    z: number,
  ): boolean => {
    const radiusSq = PROJECTILE_HIT_RADIUS * PROJECTILE_HIT_RADIUS;
    for (const anchor of this.vehicleAnchors) {
      if (!anchor.part.alive || anchor.part.detached || anchor.part.health <= 0)
        continue;
      const dx = anchor.worldX - x;
      const dy = anchor.worldY - y;
      const dz = anchor.worldZ - z;
      if (dx * dx + dy * dy + dz * dz > radiusSq) continue;
      this.vehicle.applyDirectDamage(
        anchor.partId,
        devTuning.specialist.projectileDamage,
      );
      return true;
    }
    return false;
  };
  /** Mine trigger checks the vehicle proximity; blast damage then uses its own radius. */
  private readonly tryMineDetonation = (
    x: number,
    y: number,
    z: number,
  ): boolean => {
    const triggerRadiusSq = LANDMINE_TRIGGER_RADIUS * LANDMINE_TRIGGER_RADIUS;
    let detonated = false;
    for (const anchor of this.vehicleAnchors) {
      if (!anchor.part.alive || anchor.part.detached || anchor.part.health <= 0)
        continue;
      const dx = anchor.worldX - x;
      const dy = anchor.worldY - y;
      const dz = anchor.worldZ - z;
      if (dx * dx + dy * dy + dz * dz > triggerRadiusSq) continue;
      detonated = true;
      break;
    }
    if (!detonated) return false;

    this.vfx?.explosion(x, y, z, LANDMINE_BLAST_RADIUS * 0.5);
    const blastRadiusSq = LANDMINE_BLAST_RADIUS * LANDMINE_BLAST_RADIUS;
    for (const anchor of this.vehicleAnchors) {
      if (!anchor.part.alive || anchor.part.detached || anchor.part.health <= 0)
        continue;
      const dx = anchor.worldX - x;
      const dy = anchor.worldY - y;
      const dz = anchor.worldZ - z;
      if (dx * dx + dy * dy + dz * dz > blastRadiusSq) continue;
      this.vehicle.applyDirectDamage(
        anchor.partId,
        devTuning.specialist.landmineDamage,
      );
    }
    return detonated;
  };
  private healthMultiplier = 1;
  private speedMultiplier = 1;
  private attackDamageMultiplier = 1;
  private mineRevealRadiusM = 0;
  private currentWave = 1;
  private disposed = false;

  constructor(
    world: RAPIER.World,
    scene: THREE.Scene,
    private readonly spawnPoints: readonly THREE.Vector3[],
    private readonly vehicle: RuntimeVehicle,
    onKilled: ZombieKilledCallback,
    /** Optional so headless tests can drive the system without a scene budget. */
    private readonly vfx: VfxSystem | null = null,
  ) {
    this.fallbackGeometry = new THREE.CapsuleGeometry(
      ZOMBIE_RADIUS,
      ZOMBIE_HALF_HEIGHT * 2,
      4,
      8,
    );
    this.projectiles = new ThrowerProjectiles(scene);
    this.landmines = new Landmines(scene);
    const poolKinds: ZombieKind[] = [];
    for (const [kind, count] of Object.entries(ZOMBIE_POOL_COUNTS) as [
      ZombieKind,
      number,
    ][]) {
      for (let i = 0; i < count; i++) poolKinds.push(kind);
    }
    for (let i = 0; i < poolKinds.length; i++) {
      const zombie = new Zombie(
        world,
        scene,
        i,
        poolKinds[i],
        this.fallbackGeometry,
        onKilled,
        vfx,
      );
      zombie.onThrow = (thrower) => this.launchProjectileFrom(thrower);
      zombie.onPlantMine = (worker) =>
        this.landmines.plant(worker.position.x, worker.position.z);
      this.pool.push(zombie);
      this.colliderToZombie.set(zombie.collider.handle, zombie);
    }

    this.spawnCandidateIndices = new Int16Array(spawnPoints.length);
    this.spawnCandidateDistances = new Float32Array(spawnPoints.length);
    this.buildVehicleAnchors();
  }

  /** Applies only to zombies spawned after this call. */
  setWaveMultipliers(
    healthMultiplier: number,
    speedMultiplier: number,
    attackDamageMultiplier: number,
  ): void {
    this.healthMultiplier = Math.max(0, healthMultiplier);
    this.speedMultiplier = Math.max(0, speedMultiplier);
    this.attackDamageMultiplier = Math.max(0, attackDamageMultiplier);
  }

  /**
   * Dev-tuner live apply: recompute every living zombie's stats from the current
   * tuning + stored wave multipliers, preserving each one's health fraction.
   * New spawns already read the tuning, so this only touches those on the field.
   */
  reapplyTuningToAlive(): void {
    for (const zombie of this.pool) {
      if (!zombie.isAlive) continue;
      zombie.reapplyStats(
        this.healthMultiplier,
        this.speedMultiplier,
        this.attackDamageMultiplier,
      );
    }
  }

  getActiveCount(): number {
    let count = 0;
    for (const zombie of this.pool) if (zombie.isAlive) count++;
    return count;
  }

  /** Targetable zombies, backed by a stable reused array. */
  getAliveTargets(): readonly Zombie[] {
    return this.aliveTargets;
  }

  /** 0 disables reveal; SurvivalMode recomputes it from the live Mine Sweeper part. */
  setMineRevealRadius(radiusM: number): void {
    this.mineRevealRadiusM = Math.max(
      0,
      Number.isFinite(radiusM) ? radiusM : 0,
    );
  }

  /** Wave number, so the wave-7 tutorial rule can be evaluated. */
  setCurrentWave(wave: number): void {
    this.currentWave = Math.max(
      1,
      Math.floor(Number.isFinite(wave) ? wave : 1),
    );
  }

  /** Pass-through for the minimap. */
  activeMines(): readonly MineSnapshot[] {
    return this.landmines.activeMines();
  }

  /** Debug seam positions from the current Rapier body translations. */
  debugAlivePositions(limit = 6): [number, number, number][] {
    const positions: [number, number, number][] = [];
    const count = Math.min(
      this.aliveTargets.length,
      Math.max(0, Math.floor(limit)),
    );
    for (let i = 0; i < count; i++) {
      const position = this.aliveTargets[i].body.translation();
      positions.push([position.x, position.y, position.z]);
    }
    return positions;
  }

  /** Spawn the requested kinds around one eligible far-away anchor. */
  trySpawnHorde(kinds: readonly ZombieKind[]): number {
    if (this.disposed || kinds.length === 0) return 0;
    const anchor = this.pickSpawnPoint();
    if (!anchor) return 0;

    let spawned = 0;
    for (const kind of kinds) {
      const zombie = this.pool.find(
        (candidate) => !candidate.active && candidate.kind === kind,
      );
      // Preserve prefix semantics for WaveManager: it only advances past the
      // requests that were actually fulfilled.
      if (!zombie) break;

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * HORDE_SCATTER_RADIUS;
      this.spawnScratch.set(
        anchor.x + Math.cos(angle) * radius,
        anchor.y,
        anchor.z + Math.sin(angle) * radius,
      );
      zombie.spawn(
        this.spawnScratch,
        this.healthMultiplier,
        this.speedMultiplier,
        this.attackDamageMultiplier,
      );
      this.resetWatchdog(zombie);
      spawned++;
    }
    return spawned;
  }

  /** Advance AI and forces before the owning mode calls world.step(). */
  step(dt: number): void {
    if (this.disposed || dt <= 0) return;
    this.updateVehicleAnchors();
    this.activeScratch.length = 0;
    for (const zombie of this.pool) {
      if (zombie.isAlive) this.activeScratch.push(zombie);
    }

    this.applySeparation(this.activeScratch);
    for (const zombie of this.activeScratch) {
      this.findNearestVehiclePart(zombie);
      zombie.fixedUpdate(
        dt,
        this.vehicle,
        this.separationX[zombie.index],
        this.separationZ[zombie.index],
      );
      this.updateWatchdog(zombie, dt);
    }

    this.processVehicleContacts(this.activeScratch, dt);
    this.projectiles.update(dt, this.tryProjectileImpact);
    const vehiclePosition = this.vehicle.body.translation();
    this.landmines.update(dt, this.tryMineDetonation, {
      vehicleX: vehiclePosition.x,
      vehicleZ: vehiclePosition.z,
      wave: this.currentWave,
      radiusM: this.mineRevealRadiusM,
    });
    this.rebuildAliveTargets();
  }

  /** SurvivalMode clears surviving mines the moment a wave completes. */
  clearLandmines(): void {
    if (this.disposed) return;
    this.landmines.despawnAll();
  }

  private launchProjectileFrom(zombie: Zombie): void {
    const target = zombie.vehicleTarget;
    if (target.partId === null) return;
    this.projectiles.launch(
      zombie.position.x,
      zombie.position.y + PROJECTILE_LAUNCH_HEIGHT,
      zombie.position.z,
      target.x,
      target.y,
      target.z,
    );
  }

  /** Advance render-rate feedback after physics has moved the bodies. */
  updateVisuals(dt: number): void {
    if (this.disposed) return;
    for (const zombie of this.pool) zombie.updateVisuals(dt);
  }

  /** Stop active AI without advancing any state timers. */
  freeze(): void {
    if (this.disposed) return;
    for (const zombie of this.pool) zombie.freeze();
    this.vehicle.body.resetForces(false);
    this.swarmForce.x = 0;
    this.swarmForce.y = 0;
    this.swarmForce.z = 0;
  }

  /**
   * Ice Cannon activation: flash-freeze up to `maxCount` currently-unfrozen,
   * targetable zombies within `radiusM` of the origin, nearest first, for
   * `seconds`. Returns how many were frozen. Runs rarely (once per cooldown),
   * so the small sort allocation is not a concern.
   */
  freezeNearest(
    origin: { x: number; z: number },
    maxCount: number,
    radiusM: number,
    seconds: number,
  ): number {
    if (this.disposed || maxCount <= 0 || radiusM <= 0 || seconds <= 0)
      return 0;
    const radiusSq = radiusM * radiusM;
    const candidates: { zombie: Zombie; distSq: number }[] = [];
    for (const zombie of this.aliveTargets) {
      if (zombie.isFrozen) continue;
      const dx = zombie.position.x - origin.x;
      const dz = zombie.position.z - origin.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > radiusSq) continue;
      candidates.push({ zombie, distSq });
    }
    candidates.sort((a, b) => a.distSq - b.distSq);
    const limit = Math.min(Math.floor(maxCount), candidates.length);
    for (let i = 0; i < limit; i++) candidates[i].zombie.applyFreeze(seconds);
    return limit;
  }

  /** True when the collider belongs to a shielded (Phone Addict) zombie. */
  isShieldedTarget(handle: number): boolean {
    return this.colliderToZombie.get(handle)?.kind === 'phone-addict';
  }

  /**
   * Ice Cannon normal fire: slow the zombie behind a weapon-hit collider to
   * `factor` of its speed for `seconds`. No-op when the handle is unknown.
   */
  slowZombieHandle(handle: number, factor: number, seconds: number): void {
    if (this.disposed || seconds <= 0) return;
    this.colliderToZombie.get(handle)?.applySlow(factor, seconds);
  }

  /** Route a RuntimeVehicle hit while preserving shield and kill outcomes. */
  hitZombieHandle(
    handle: number,
    damage: number,
    direction?: Vector3Like,
    damageType: DamageType = 'hitscan',
    empLevel = 0,
  ): ZombieHitResult {
    if (this.disposed || damage <= 0) return 'miss';
    const zombie = this.colliderToZombie.get(handle);
    if (!zombie) return 'miss';
    // Gun damage leaks through the bubble according to EMP level, while aoe
    // damage continues to wash around it at full strength.
    if (zombie.kind === 'phone-addict' && damageType !== 'aoe') {
      zombie.flashShield();
      const killed = zombie.takeDamage(
        damage * empShieldLeak(empLevel),
        direction,
      );
      if (killed) this.rebuildAliveTargets();
      return killed ? 'killed' : 'shielded';
    }
    const killed = zombie.takeDamage(damage, direction);
    if (killed) this.rebuildAliveTargets();
    return killed ? 'killed' : 'damaged';
  }

  /**
   * Explosive blast at a world point: every targetable zombie inside `radiusM`
   * takes `centreDamage` scaled linearly down to nothing at the rim. Returns
   * how many were hit.
   *
   * Blast damage is `aoe`, so — like flame — it washes around the phone
   * addict's bubble instead of being absorbed by it. A zombie the shell hit
   * directly can be excluded via `skipHandle` so it is not damaged twice.
   */
  explodeAt(
    x: number,
    y: number,
    z: number,
    radiusM: number,
    centreDamage: number,
    skipHandle: number | null = null,
  ): number {
    if (this.disposed || radiusM <= 0 || centreDamage <= 0) return 0;
    const radiusSq = radiusM * radiusM;
    let hit = 0;
    let killedAny = false;
    for (const zombie of this.aliveTargets) {
      if (skipHandle !== null && zombie.collider.handle === skipHandle) continue;
      const dx = zombie.position.x - x;
      const dy = zombie.position.y - y;
      const dz = zombie.position.z - z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq > radiusSq) continue;
      const falloff = 1 - Math.sqrt(distanceSq) / radiusM;
      const damage = centreDamage * falloff;
      if (damage <= 0) continue;
      hit++;
      // Push survivors away from the blast so the explosion reads physically.
      const distance = Math.sqrt(distanceSq) || 1;
      this.blastDirection.x = dx / distance;
      this.blastDirection.y = 0;
      this.blastDirection.z = dz / distance;
      if (zombie.takeDamage(damage, this.blastDirection)) killedAny = true;
    }
    if (killedAny) this.rebuildAliveTargets();
    return hit;
  }

  /** Debug seam: kill every active slot, including zombies still spawning. */
  forceKillAll(): number {
    if (this.disposed) return 0;
    let killed = 0;
    for (const zombie of this.pool) if (zombie.forceKill()) killed++;
    this.rebuildAliveTargets();
    return killed;
  }

  reset(): void {
    if (this.disposed) return;
    this.projectiles.despawnAll();
    this.landmines.despawnAll();
    for (const zombie of this.pool) zombie.forceReturnToPool();
    this.healthMultiplier = 1;
    this.speedMultiplier = 1;
    this.activeScratch.length = 0;
    this.aliveTargets.length = 0;
    this.separationX.fill(0);
    this.separationZ.fill(0);
    this.watchdogTimer.fill(0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.projectiles.dispose();
    this.landmines.dispose();
    for (const zombie of this.pool) zombie.dispose();
    this.pool.length = 0;
    this.colliderToZombie.clear();
    this.activeScratch.length = 0;
    this.aliveTargets.length = 0;
    this.vehicleAnchors.length = 0;
    this.fallbackGeometry.dispose();
  }

  private buildVehicleAnchors(): void {
    for (const [partId, part] of this.vehicle.assembled.parts) {
      const count = part.colliderCentresM.length;
      if (count === 0) continue;
      let localX = 0;
      let localY = 0;
      let localZ = 0;
      for (const centre of part.colliderCentresM) {
        localX += centre.x;
        localY += centre.y;
        localZ += centre.z;
      }
      this.vehicleAnchors.push({
        partId,
        part,
        localX: localX / count,
        localY: localY / count,
        localZ: localZ / count,
        worldX: 0,
        worldY: 0,
        worldZ: 0,
      });
    }
  }

  /** Transform every attached part centroid once, not once per zombie. */
  private updateVehicleAnchors(): void {
    const position = this.vehicle.body.translation();
    const rotation = this.vehicle.body.rotation();
    const qx = rotation.x;
    const qy = rotation.y;
    const qz = rotation.z;
    const qw = rotation.w;

    for (const anchor of this.vehicleAnchors) {
      const x = anchor.localX;
      const y = anchor.localY;
      const z = anchor.localZ;
      const tx = 2 * (qy * z - qz * y);
      const ty = 2 * (qz * x - qx * z);
      const tz = 2 * (qx * y - qy * x);
      anchor.worldX = position.x + x + qw * tx + qy * tz - qz * ty;
      anchor.worldY = position.y + y + qw * ty + qz * tx - qx * tz;
      anchor.worldZ = position.z + z + qw * tz + qx * ty - qy * tx;
    }
  }

  private findNearestVehiclePart(zombie: Zombie): void {
    const target = zombie.vehicleTarget;
    let nearestDistanceSq = Infinity;
    target.partId = null;
    target.distance = Infinity;

    for (const anchor of this.vehicleAnchors) {
      if (!anchor.part.alive || anchor.part.detached || anchor.part.health <= 0)
        continue;
      const dx = anchor.worldX - zombie.position.x;
      const dy = anchor.worldY - zombie.position.y;
      const dz = anchor.worldZ - zombie.position.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq >= nearestDistanceSq) continue;
      nearestDistanceSq = distanceSq;
      target.partId = anchor.partId;
      target.x = anchor.worldX;
      target.y = anchor.worldY;
      target.z = anchor.worldZ;
    }
    if (target.partId !== null) target.distance = Math.sqrt(nearestDistanceSq);
  }

  private applySeparation(active: readonly Zombie[]): void {
    this.separationX.fill(0);
    this.separationZ.fill(0);
    const radiusSq = SEPARATION_RADIUS * SEPARATION_RADIUS;

    for (let i = 0; i < active.length; i++) {
      const first = active[i];
      for (let j = i + 1; j < active.length; j++) {
        const second = active[j];
        const dx = first.position.x - second.position.x;
        const dz = first.position.z - second.position.z;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq >= radiusSq || distanceSq < 1e-6) continue;

        const distance = Math.sqrt(distanceSq);
        const strength = (SEPARATION_RADIUS - distance) * SEPARATION_STRENGTH;
        const pushX = (dx / distance) * strength;
        const pushZ = (dz / distance) * strength;
        this.separationX[first.index] += pushX;
        this.separationZ[first.index] += pushZ;
        this.separationX[second.index] -= pushX;
        this.separationZ[second.index] -= pushZ;
      }
    }
  }

  private processVehicleContacts(active: readonly Zombie[], dt: number): void {
    // addForce is user-force state in Rapier; clear last step's swarm force
    // even when the final contact just ended. Wheel/weapon runtime uses
    // impulses, so this only resets the force owned by this system.
    this.vehicle.body.resetForces(false);
    const velocity = this.vehicle.body.linvel();
    const vehicleSpeed = Math.hypot(velocity.x, velocity.y, velocity.z);
    // Heavier builds ram harder, lighter ones softer; the speed side of the
    // formula below is unchanged.
    const massFactor = vehicleImpactMassFactor(this.vehicle.body.mass());
    let contacts = 0;

    for (const zombie of active) {
      if (!zombie.isTargetable || zombie.vehicleTarget.partId === null)
        continue;
      if (zombie.vehicleTarget.distance > ZOMBIE_CONTACT_RADIUS) continue;
      contacts++;

      // Grinder drums shred on contact regardless of vehicle speed.
      const touchedPart = this.vehicle.assembled.parts.get(
        zombie.vehicleTarget.partId,
      );
      const melee = touchedPart?.def.melee;
      if (melee === undefined && vehicleSpeed < MIN_IMPACT_SPEED) continue;

      let awayX = zombie.position.x - zombie.vehicleTarget.x;
      let awayZ = zombie.position.z - zombie.vehicleTarget.z;
      if (Math.hypot(awayX, awayZ) < 1e-4) {
        const horizontalVehicleSpeed = Math.hypot(velocity.x, velocity.z);
        awayX =
          horizontalVehicleSpeed > 1e-4
            ? velocity.x / horizontalVehicleSpeed
            : 1;
        awayZ =
          horizontalVehicleSpeed > 1e-4
            ? velocity.z / horizontalVehicleSpeed
            : 0;
      }
      const impactDamage =
        vehicleSpeed >= LETHAL_IMPACT_SPEED
          ? Number.MAX_SAFE_INTEGER
          : vehicleSpeed >= MIN_IMPACT_SPEED
            ? vehicleSpeed * IMPACT_DAMAGE_PER_SPEED * massFactor
            : 0;
      const landed = zombie.applyVehicleImpact(
        Math.max(impactDamage, melee?.damage ?? 0),
        awayX,
        awayZ,
      );
      // The per-zombie impact cooldown inside applyVehicleImpact is also what
      // paces the shred bursts: a drum touching a packed horde emits once per
      // zombie per cooldown, never once per fixed step.
      if (landed !== 'ignored') this.emitShredVfx(zombie, melee, awayX, awayZ, vehicleSpeed);
    }

    if (contacts === 0) return;
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    if (horizontalSpeed < 1e-4) return;

    const dragFraction = Math.min(
      contacts * SWARM_DRAG_PER_CONTACT,
      MAXIMUM_SWARM_DRAG,
    );
    const maximumDeceleration = horizontalSpeed / dt;
    const deceleration = Math.min(
      SWARM_DRAG_ACCELERATION * dragFraction,
      maximumDeceleration,
    );
    const forceMagnitude = this.vehicle.body.mass() * deceleration;
    this.swarmForce.x = -(velocity.x / horizontalSpeed) * forceMagnitude;
    this.swarmForce.y = 0;
    this.swarmForce.z = -(velocity.z / horizontalSpeed) * forceMagnitude;
    this.vehicle.body.addForce(this.swarmForce, true);
  }

  /**
   * Play the contact effect for a landed hit. The weapon that was touched
   * picks the effect — sawblade, spikes, and grinder drum each spray
   * differently — and a part with no melee weapon plays a blunt ram.
   */
  private emitShredVfx(
    zombie: Zombie,
    melee: MeleeDefinition | undefined,
    awayX: number,
    awayZ: number,
    vehicleSpeed: number,
  ): void {
    if (this.vfx === null) return;
    const length = Math.hypot(awayX, awayZ) || 1;
    const target = zombie.vehicleTarget;
    // Halfway between the weapon and the zombie it bit into, never below the
    // ground plane the settled splats land on.
    const contactX = (zombie.position.x + target.x) * 0.5;
    const contactY = Math.max(0.25, (zombie.position.y + target.y) * 0.5);
    const contactZ = (zombie.position.z + target.z) * 0.5;
    const kind: MeleeVfxKind =
      melee === undefined ? 'ram' : meleeVfxKindFor(melee.visual);
    const power =
      melee === undefined
        ? Math.min(1.3, 0.5 + vehicleSpeed / LETHAL_IMPACT_SPEED)
        : Math.min(1.4, 0.55 + melee.damage / 60);
    this.vfx.meleeShred(
      kind,
      contactX,
      contactY,
      contactZ,
      awayX / length,
      awayZ / length,
      power,
    );
  }

  private resetWatchdog(zombie: Zombie): void {
    this.watchdogX[zombie.index] = zombie.position.x;
    this.watchdogZ[zombie.index] = zombie.position.z;
    this.watchdogTimer[zombie.index] = 0;
  }

  private updateWatchdog(zombie: Zombie, dt: number): void {
    // Workers deliberately stand still (arming, holding range); never teleport
    // them for lack of progress toward the vehicle.
    if (zombie.state !== ZombieState.Chasing || zombie.kind === 'worker') {
      this.resetWatchdog(zombie);
      return;
    }

    const index = zombie.index;
    const dx = zombie.position.x - this.watchdogX[index];
    const dz = zombie.position.z - this.watchdogZ[index];
    const displacementSq = dx * dx + dz * dz;
    if (
      displacementSq >=
      STUCK_TELEPORT_DISPLACEMENT * STUCK_TELEPORT_DISPLACEMENT
    ) {
      this.resetWatchdog(zombie);
      return;
    }

    this.watchdogTimer[index] += dt;
    if (this.watchdogTimer[index] < STUCK_TELEPORT_SECONDS) return;
    const point = this.pickSpawnPoint();
    if (point) zombie.teleportTo(point);
    this.resetWatchdog(zombie);
  }

  /** Strictly excludes anchors closer than 18u, then picks among the farthest half. */
  private pickSpawnPoint(): THREE.Vector3 | null {
    const vehiclePosition = this.vehicle.body.translation();
    const minimumDistanceSq =
      MIN_SPAWN_DISTANCE_FROM_VEHICLE * MIN_SPAWN_DISTANCE_FROM_VEHICLE;
    let candidateCount = 0;

    for (
      let pointIndex = 0;
      pointIndex < this.spawnPoints.length;
      pointIndex++
    ) {
      const point = this.spawnPoints[pointIndex];
      const dx = point.x - vehiclePosition.x;
      const dz = point.z - vehiclePosition.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < minimumDistanceSq) continue;

      let insertion = candidateCount;
      while (
        insertion > 0 &&
        this.spawnCandidateDistances[insertion - 1] < distanceSq
      ) {
        this.spawnCandidateDistances[insertion] =
          this.spawnCandidateDistances[insertion - 1];
        this.spawnCandidateIndices[insertion] =
          this.spawnCandidateIndices[insertion - 1];
        insertion--;
      }
      this.spawnCandidateDistances[insertion] = distanceSq;
      this.spawnCandidateIndices[insertion] = pointIndex;
      candidateCount++;
    }

    if (candidateCount === 0) return null;
    const topHalfCount = Math.ceil(candidateCount / 2);
    const candidate = Math.floor(Math.random() * topHalfCount);
    return this.spawnPoints[this.spawnCandidateIndices[candidate]];
  }

  private rebuildAliveTargets(): void {
    this.aliveTargets.length = 0;
    for (const zombie of this.pool) {
      if (zombie.isTargetable) this.aliveTargets.push(zombie);
    }
  }
}
