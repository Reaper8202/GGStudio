import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { RuntimePart } from '../../runtime/assembler.ts';
import type { RuntimeVehicle } from '../../runtime/vehicle.ts';
import {
  Zombie,
  ZombieState,
  type Vector3Like,
  type ZombieKilledCallback,
} from './Zombie.ts';
import {
  HORDE_SCATTER_RADIUS,
  IMPACT_DAMAGE_PER_SPEED,
  MAXIMUM_SWARM_DRAG,
  MIN_IMPACT_SPEED,
  MIN_SPAWN_DISTANCE_FROM_VEHICLE,
  SEPARATION_RADIUS,
  SEPARATION_STRENGTH,
  STUCK_TELEPORT_DISPLACEMENT,
  STUCK_TELEPORT_SECONDS,
  SWARM_DRAG_ACCELERATION,
  SWARM_DRAG_PER_CONTACT,
  ZOMBIE_CONTACT_RADIUS,
  ZOMBIE_HALF_HEIGHT,
  ZOMBIE_POOL_SIZE,
  ZOMBIE_RADIUS,
} from './zombieConfig.ts';

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
  private readonly fallbackGeometry: THREE.CapsuleGeometry;
  private healthMultiplier = 1;
  private speedMultiplier = 1;
  private disposed = false;

  constructor(
    world: RAPIER.World,
    scene: THREE.Scene,
    private readonly spawnPoints: readonly THREE.Vector3[],
    private readonly vehicle: RuntimeVehicle,
    onKilled: ZombieKilledCallback,
  ) {
    this.fallbackGeometry = new THREE.CapsuleGeometry(
      ZOMBIE_RADIUS,
      ZOMBIE_HALF_HEIGHT * 2,
      4,
      8,
    );
    for (let i = 0; i < ZOMBIE_POOL_SIZE; i++) {
      const zombie = new Zombie(
        world,
        scene,
        i,
        this.fallbackGeometry,
        onKilled,
      );
      this.pool.push(zombie);
      this.colliderToZombie.set(zombie.collider.handle, zombie);
    }

    this.spawnCandidateIndices = new Int16Array(spawnPoints.length);
    this.spawnCandidateDistances = new Float32Array(spawnPoints.length);
    this.buildVehicleAnchors();
  }

  /** Applies only to zombies spawned after this call. */
  setWaveMultipliers(healthMultiplier: number, speedMultiplier: number): void {
    this.healthMultiplier = Math.max(0, healthMultiplier);
    this.speedMultiplier = Math.max(0, speedMultiplier);
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

  /** Spawn up to count pooled zombies around one eligible far-away anchor. */
  trySpawnHorde(count: number): number {
    if (this.disposed || count <= 0) return 0;
    const anchor = this.pickSpawnPoint();
    if (!anchor) return 0;

    let spawned = 0;
    for (const zombie of this.pool) {
      if (spawned >= count) break;
      if (zombie.active) continue;

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
    this.rebuildAliveTargets();
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

  /** Route a RuntimeVehicle hitscan handle. Returns true only for a killing hit. */
  hitZombieHandle(
    handle: number,
    damage: number,
    direction?: Vector3Like,
  ): boolean {
    if (this.disposed || damage <= 0) return false;
    const zombie = this.colliderToZombie.get(handle);
    if (!zombie) return false;
    const killed = zombie.takeDamage(damage, direction);
    if (killed) this.rebuildAliveTargets();
    return killed;
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
    let contacts = 0;

    for (const zombie of active) {
      if (!zombie.isTargetable || zombie.vehicleTarget.partId === null)
        continue;
      if (zombie.vehicleTarget.distance > ZOMBIE_CONTACT_RADIUS) continue;
      contacts++;
      if (vehicleSpeed < MIN_IMPACT_SPEED) continue;

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
      zombie.applyVehicleImpact(
        vehicleSpeed * IMPACT_DAMAGE_PER_SPEED,
        awayX,
        awayZ,
      );
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

  private resetWatchdog(zombie: Zombie): void {
    this.watchdogX[zombie.index] = zombie.position.x;
    this.watchdogZ[zombie.index] = zombie.position.z;
    this.watchdogTimer[zombie.index] = 0;
  }

  private updateWatchdog(zombie: Zombie, dt: number): void {
    if (zombie.state !== ZombieState.Chasing) {
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
