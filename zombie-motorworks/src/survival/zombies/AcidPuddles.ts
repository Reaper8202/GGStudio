import * as THREE from 'three';
import {
  ACID_PUDDLE_COLOR,
  ACID_PUDDLE_FADE_SECONDS,
  ACID_PUDDLE_OPACITY,
  ACID_PUDDLE_POOL_SIZE,
  ACID_PUDDLE_SEGMENTS,
} from './zombieConfig.ts';

/** Read-only snapshot of one live puddle, for ZombieSystem's poison tick. */
export interface AcidPuddleSnapshot {
  readonly x: number;
  readonly z: number;
  readonly radiusM: number;
  readonly poisonDamagePerSecond: number;
}

interface Puddle {
  readonly mesh: THREE.Mesh;
  x: number;
  z: number;
  radiusM: number;
  poisonDamagePerSecond: number;
  life: number;
  totalLife: number;
  active: boolean;
}

/**
 * Pooled acid puddles: flat ground discs with no Rapier body, left behind by a
 * vial wherever it lands (vehicle or bare ground). Purely a visual + a radius
 * and a DPS value; ZombieSystem reads `activePuddles()` each poison tick and
 * decides who is standing in one, the same way it reads boss/mine state rather
 * than this class reaching into the vehicle itself.
 *
 * Puddles never chase and never grow after they land — the only way one hurts
 * you is if you are still inside `radiusM` when the tick lands, so driving out
 * stops the damage immediately.
 */
export class AcidPuddles {
  private readonly pool: Puddle[] = [];
  private readonly geometry: THREE.CircleGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly snapshots: AcidPuddleSnapshot[] = [];
  private disposed = false;

  constructor(private readonly scene: THREE.Scene) {
    // Unit radius; each puddle scales the mesh to its own radiusM instead of
    // rebuilding geometry per spawn, the same trick the boss slam ring uses.
    this.geometry = new THREE.CircleGeometry(1, ACID_PUDDLE_SEGMENTS);
    this.material = new THREE.MeshBasicMaterial({
      color: ACID_PUDDLE_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < ACID_PUDDLE_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this.pool.push({
        mesh,
        x: 0,
        z: 0,
        radiusM: 0,
        poisonDamagePerSecond: 0,
        life: 0,
        totalLife: 1,
        active: false,
      });
    }
  }

  /**
   * Burst a puddle at (x, z), recycling the oldest slot when the pool is full —
   * see `ACID_PUDDLE_POOL_SIZE` for why that should never actually happen in
   * play. `y` only positions the decal just above the ground; it plays no part
   * in who the puddle can hit, which is a horizontal-radius test like the boss
   * slam's.
   */
  spawn(
    x: number,
    y: number,
    z: number,
    radiusM: number,
    durationSeconds: number,
    poisonDamagePerSecond: number,
  ): void {
    if (this.disposed || radiusM <= 0 || durationSeconds <= 0) return;
    let slot: Puddle | null = null;
    for (const puddle of this.pool) {
      if (!puddle.active) {
        slot = puddle;
        break;
      }
      if (!slot || puddle.life < slot.life) slot = puddle;
    }
    if (!slot) return;

    slot.x = x;
    slot.z = z;
    slot.radiusM = radiusM;
    slot.poisonDamagePerSecond = poisonDamagePerSecond;
    slot.life = durationSeconds;
    slot.totalLife = durationSeconds;
    slot.active = true;
    slot.mesh.position.set(x, y + 0.06, z);
    slot.mesh.scale.setScalar(radiusM);
    slot.mesh.visible = true;
  }

  /** Live puddles for this tick's poison pass. Reuses its array; do not retain it. */
  activePuddles(): readonly AcidPuddleSnapshot[] {
    this.snapshots.length = 0;
    for (const puddle of this.pool) {
      if (puddle.active) {
        this.snapshots.push({
          x: puddle.x,
          z: puddle.z,
          radiusM: puddle.radiusM,
          poisonDamagePerSecond: puddle.poisonDamagePerSecond,
        });
      }
    }
    return this.snapshots;
  }

  /** Age puddles and fade them out; damage itself is applied by the caller from `activePuddles()`. */
  update(dt: number): void {
    if (this.disposed) return;
    for (const puddle of this.pool) {
      if (!puddle.active) continue;
      puddle.life -= dt;
      if (puddle.life <= 0) {
        this.despawn(puddle);
        continue;
      }
      // Steady while it is dangerous, fading only in its last second so the
      // fade itself becomes part of the telegraph that it is about to clear.
      const fadeIn = Math.min(1, (puddle.totalLife - puddle.life) / 0.3);
      const fadeOut = Math.min(1, puddle.life / ACID_PUDDLE_FADE_SECONDS);
      const material = puddle.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = ACID_PUDDLE_OPACITY * Math.min(fadeIn, fadeOut);
    }
  }

  despawnAll(): void {
    for (const puddle of this.pool) this.despawn(puddle);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const puddle of this.pool) {
      this.scene.remove(puddle.mesh);
      (puddle.mesh.material as THREE.Material).dispose();
    }
    this.pool.length = 0;
    this.snapshots.length = 0;
    this.geometry.dispose();
    this.material.dispose();
  }

  private despawn(puddle: Puddle): void {
    puddle.active = false;
    puddle.mesh.visible = false;
  }
}
