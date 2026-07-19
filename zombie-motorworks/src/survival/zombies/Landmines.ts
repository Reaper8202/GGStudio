import * as THREE from 'three';
import {
  LANDMINE_EXPLOSION_DURATION,
  LANDMINE_EXPLOSION_POOL_SIZE,
  LANDMINE_EXPLOSION_RADIUS,
  LANDMINE_HEIGHT,
  LANDMINE_POOL_SIZE,
  LANDMINE_PULSE_AMPLITUDE,
  LANDMINE_PULSE_FREQUENCY,
  LANDMINE_RADIUS,
} from './zombieConfig.ts';

interface Landmine {
  readonly mesh: THREE.Mesh;
  pulsePhase: number;
  age: number;
  active: boolean;
}

interface MineBlast {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  timer: number;
  active: boolean;
}

/**
 * Pooled worker landmines: stationary placeholder pulsing red cylinders with
 * no Rapier body. The owning system supplies the detonation test each step; a
 * triggered mine plays an expanding flash-sphere blast and despawns. Mines
 * never time out — survivors are cleared in bulk when the wave completes.
 */
export class Landmines {
  private readonly pool: Landmine[] = [];
  private readonly blasts: MineBlast[] = [];
  private readonly geometry: THREE.CylinderGeometry;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly blastGeometry: THREE.SphereGeometry;
  private disposed = false;

  constructor(private readonly scene: THREE.Scene) {
    this.geometry = new THREE.CylinderGeometry(
      LANDMINE_RADIUS,
      LANDMINE_RADIUS,
      LANDMINE_HEIGHT,
      14,
    );
    this.material = new THREE.MeshLambertMaterial({
      color: 0xd91f1f,
      emissive: 0x7a0505,
      flatShading: true,
    });
    for (let i = 0; i < LANDMINE_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.castShadow = true;
      mesh.visible = false;
      this.scene.add(mesh);
      this.pool.push({ mesh, pulsePhase: 0, age: 0, active: false });
    }

    this.blastGeometry = new THREE.SphereGeometry(1, 16, 12);
    for (let i = 0; i < LANDMINE_EXPLOSION_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xff6a1f,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.blastGeometry, material);
      mesh.visible = false;
      this.scene.add(mesh);
      this.blasts.push({ mesh, material, timer: 0, active: false });
    }
  }

  /** Drop a mine at the worker's feet, recycling the oldest when full. */
  plant(x: number, z: number): void {
    if (this.disposed) return;
    let slot: Landmine | null = null;
    for (const mine of this.pool) {
      if (!mine.active) {
        slot = mine;
        break;
      }
      if (!slot || mine.age > slot.age) slot = mine;
    }
    if (!slot) return;

    slot.pulsePhase = Math.random() * Math.PI * 2;
    slot.age = 0;
    slot.active = true;
    slot.mesh.position.set(x, LANDMINE_HEIGHT / 2, z);
    slot.mesh.scale.setScalar(1);
    slot.mesh.visible = true;
  }

  /**
   * Pulse active mines and advance blast flashes. `tryDetonate` returns true
   * when the mine hit the vehicle (and has applied damage); the mine then
   * plays its blast and despawns.
   */
  update(
    dt: number,
    tryDetonate: (x: number, y: number, z: number) => boolean,
  ): void {
    if (this.disposed) return;
    for (const mine of this.pool) {
      if (!mine.active) continue;
      mine.age += dt;
      mine.pulsePhase += LANDMINE_PULSE_FREQUENCY * dt;

      const pulse = 1 + Math.sin(mine.pulsePhase) * LANDMINE_PULSE_AMPLITUDE;
      mine.mesh.scale.set(pulse, 1, pulse);

      const position = mine.mesh.position;
      if (tryDetonate(position.x, position.y, position.z)) {
        this.spawnBlast(position.x, position.z);
        this.despawn(mine);
      }
    }

    for (const blast of this.blasts) {
      if (!blast.active) continue;
      blast.timer = Math.max(0, blast.timer - dt);
      const progress = 1 - blast.timer / LANDMINE_EXPLOSION_DURATION;
      blast.mesh.scale.setScalar(
        Math.max(0.1, LANDMINE_EXPLOSION_RADIUS * progress),
      );
      blast.material.opacity = 0.9 * (1 - progress);
      if (blast.timer <= 0) {
        blast.active = false;
        blast.mesh.visible = false;
      }
    }
  }

  despawnAll(): void {
    for (const mine of this.pool) this.despawn(mine);
    for (const blast of this.blasts) {
      blast.active = false;
      blast.timer = 0;
      blast.mesh.visible = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mine of this.pool) this.scene.remove(mine.mesh);
    for (const blast of this.blasts) {
      this.scene.remove(blast.mesh);
      blast.material.dispose();
    }
    this.pool.length = 0;
    this.blasts.length = 0;
    this.geometry.dispose();
    this.material.dispose();
    this.blastGeometry.dispose();
  }

  private spawnBlast(x: number, z: number): void {
    let slot: MineBlast | null = null;
    for (const blast of this.blasts) {
      if (!blast.active) {
        slot = blast;
        break;
      }
      if (!slot || blast.timer < slot.timer) slot = blast;
    }
    if (!slot) return;
    slot.timer = LANDMINE_EXPLOSION_DURATION;
    slot.active = true;
    slot.mesh.position.set(x, LANDMINE_HEIGHT, z);
    slot.mesh.scale.setScalar(0.1);
    slot.material.opacity = 0.9;
    slot.mesh.visible = true;
  }

  private despawn(mine: Landmine): void {
    mine.active = false;
    mine.mesh.visible = false;
  }
}
