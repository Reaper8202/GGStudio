import * as THREE from 'three';
import {
  ACID_BUBBLE_COLOR,
  ACID_BUBBLE_INTERVAL_MAX,
  ACID_BUBBLE_INTERVAL_MIN,
  ACID_BUBBLE_LIFE_MAX,
  ACID_BUBBLE_LIFE_MIN,
  ACID_BUBBLE_OPACITY,
  ACID_BUBBLE_POOL_SIZE,
  ACID_BUBBLE_RADIUS_MAX,
  ACID_BUBBLE_RADIUS_MIN,
  ACID_BUBBLE_RISE_HEIGHT,
  ACID_PUDDLE_BLOB_JITTER,
  ACID_PUDDLE_COLOR,
  ACID_PUDDLE_FADE_SECONDS,
  ACID_PUDDLE_GRIP_MULTIPLIER,
  ACID_PUDDLE_OPACITY,
  ACID_PUDDLE_POOL_SIZE,
  ACID_PUDDLE_SEGMENTS,
} from './zombieConfig.ts';

interface Puddle {
  readonly mesh: THREE.Mesh;
  x: number;
  z: number;
  radiusM: number;
  life: number;
  totalLife: number;
  active: boolean;
  /** Countdown to this puddle's next bubble spawn. */
  bubbleTimer: number;
}

interface Bubble {
  x: number;
  y: number;
  z: number;
  radiusM: number;
  life: number;
  totalLife: number;
  active: boolean;
}

/**
 * A puddle outline never lands as a true circle — build a triangle fan whose
 * radius wobbles per-vertex from a couple of randomised sine harmonics, the
 * same trick a hand-drawn splash uses. Each pooled mesh gets its own call so
 * the pool's puddles don't all repeat one silhouette.
 */
function buildBlobGeometry(segments: number): THREE.BufferGeometry {
  const amp1 = ACID_PUDDLE_BLOB_JITTER * (0.5 + Math.random() * 0.5);
  const amp2 = ACID_PUDDLE_BLOB_JITTER * (0.3 + Math.random() * 0.4);
  const freq1 = 2 + Math.floor(Math.random() * 2);
  const freq2 = 5 + Math.floor(Math.random() * 3);
  const phase1 = Math.random() * Math.PI * 2;
  const phase2 = Math.random() * Math.PI * 2;

  const positions: number[] = [0, 0, 0];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const r =
      1 +
      amp1 * Math.sin(angle * freq1 + phase1) +
      amp2 * Math.sin(angle * freq2 + phase2);
    positions.push(Math.cos(angle) * r, Math.sin(angle) * r, 0);
  }

  const indices: number[] = [];
  for (let i = 1; i <= segments; i++) indices.push(0, i, i + 1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Pooled acid puddles: flat, irregular ground splats with no Rapier body,
 * left behind by a vial wherever it lands (vehicle or bare ground), plus a
 * pooled swarm of small bubbles that pop up inside whichever puddles are
 * live. A puddle is both a movement hazard and a damage one: it kills grip
 * through `muAt`, and wherever `containsPoint` is true `ZombieSystem` bleeds
 * off speed and burns the parts standing over it
 * (`ACID_PUDDLE_DAMAGE_PER_SECOND`). This class never reaches into the vehicle
 * itself, the same way it reads boss/mine state.
 *
 * Puddles never chase and never grow after they land — the only way one slows
 * you is if you are still inside `radiusM`, so driving clear restores normal
 * handling immediately.
 */
export class AcidPuddles {
  private readonly pool: Puddle[] = [];
  private readonly material: THREE.MeshBasicMaterial;

  private readonly bubblePool: Bubble[] = [];
  private readonly bubbleMesh: THREE.InstancedMesh;
  private readonly bubbleDummy = new THREE.Object3D();
  private disposed = false;

  constructor(private readonly scene: THREE.Scene) {
    this.material = new THREE.MeshBasicMaterial({
      color: ACID_PUDDLE_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < ACID_PUDDLE_POOL_SIZE; i++) {
      // Own geometry per slot (not shared) so each puddle keeps its own
      // splash silhouette instead of one shape stamped everywhere.
      const mesh = new THREE.Mesh(
        buildBlobGeometry(ACID_PUDDLE_SEGMENTS),
        this.material.clone(),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this.pool.push({
        mesh,
        x: 0,
        z: 0,
        radiusM: 0,
        life: 0,
        totalLife: 1,
        active: false,
        bubbleTimer: 0,
      });
    }

    // Faceted little globs (not smooth spheres) to match the game's low-poly
    // voxel-vfx look elsewhere; one instanced draw call for every puddle's
    // bubbles combined.
    this.bubbleMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({
        color: ACID_BUBBLE_COLOR,
        transparent: true,
        opacity: ACID_BUBBLE_OPACITY,
        depthWrite: false,
      }),
      ACID_BUBBLE_POOL_SIZE,
    );
    this.bubbleMesh.frustumCulled = false;
    this.bubbleDummy.scale.setScalar(0);
    // .matrix is only baked from position/scale/rotation on updateMatrix() —
    // skipping this left every instance at the identity matrix (full-size,
    // sitting at the world origin) instead of hidden.
    this.bubbleDummy.updateMatrix();
    for (let i = 0; i < ACID_BUBBLE_POOL_SIZE; i++) {
      this.bubbleMesh.setMatrixAt(i, this.bubbleDummy.matrix);
      this.bubblePool.push({
        x: 0,
        y: 0,
        z: 0,
        radiusM: 0,
        life: 0,
        totalLife: 1,
        active: false,
      });
    }
    this.bubbleMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.bubbleMesh);
  }

  /**
   * Burst a puddle at (x, z), recycling the oldest slot when the pool is full —
   * see `ACID_PUDDLE_POOL_SIZE` for why that should never actually happen in
   * play. `y` only positions the decal just above the ground; it plays no part
   * in who the puddle slows, which is a horizontal-radius test like the boss
   * slam's.
   */
  spawn(
    x: number,
    y: number,
    z: number,
    radiusM: number,
    durationSeconds: number,
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
    slot.life = durationSeconds;
    slot.totalLife = durationSeconds;
    slot.active = true;
    slot.bubbleTimer = 0;
    slot.mesh.position.set(x, y + 0.06, z);
    slot.mesh.scale.setScalar(radiusM);
    slot.mesh.visible = true;
  }

  /**
   * Grip multiplier (0..1) from any acid puddle under this ground point; null
   * outside every active puddle. Wired the same way `IceTrail.muAt` is — read
   * by `RuntimeVehicle.preStep` per wheel contact — so acid reads as sticky
   * mud dragging the vehicle down rather than a damage-only ground marker.
   */
  muAt(x: number, z: number): number | null {
    return this.containsPoint(x, z) ? ACID_PUDDLE_GRIP_MULTIPLIER : null;
  }

  /**
   * Is this ground point inside any live puddle? Read once per step against
   * the chassis so `ZombieSystem` can drag the whole vehicle down while it is
   * crossing — the grip drop alone only limits how hard the wheels can push,
   * it never takes away speed the car already has.
   */
  containsPoint(x: number, z: number): boolean {
    for (const puddle of this.pool) {
      if (!puddle.active) continue;
      const dx = x - puddle.x;
      const dz = z - puddle.z;
      if (dx * dx + dz * dz <= puddle.radiusM * puddle.radiusM) return true;
    }
    return false;
  }

  /** Age puddles and fade them out; the slowdown itself is applied by the caller from `muAt`/`containsPoint`. */
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

      puddle.bubbleTimer -= dt;
      if (puddle.bubbleTimer <= 0) {
        this.spawnBubble(puddle);
        // Bigger puddles roll bubbles faster, floored at the tuned minimum.
        const interval = Math.max(
          ACID_BUBBLE_INTERVAL_MIN,
          ACID_BUBBLE_INTERVAL_MAX / Math.max(1, puddle.radiusM),
        );
        puddle.bubbleTimer = interval * (0.7 + Math.random() * 0.6);
      }
    }

    this.updateBubbles(dt);
  }

  despawnAll(): void {
    for (const puddle of this.pool) this.despawn(puddle);
    for (const bubble of this.bubblePool) bubble.active = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const puddle of this.pool) {
      this.scene.remove(puddle.mesh);
      puddle.mesh.geometry.dispose();
      (puddle.mesh.material as THREE.Material).dispose();
    }
    this.pool.length = 0;
    this.material.dispose();

    this.scene.remove(this.bubbleMesh);
    this.bubbleMesh.geometry.dispose();
    (this.bubbleMesh.material as THREE.Material).dispose();
    this.bubblePool.length = 0;
  }

  private despawn(puddle: Puddle): void {
    puddle.active = false;
    puddle.mesh.visible = false;
  }

  /** Places one bubble at a random point inside `puddle`'s (roughly circular) footprint. */
  private spawnBubble(puddle: Puddle): void {
    let slot: Bubble | null = null;
    for (const bubble of this.bubblePool) {
      if (!bubble.active) {
        slot = bubble;
        break;
      }
      if (!slot || bubble.life < slot.life) slot = bubble;
    }
    if (!slot) return;

    // Uniform-in-disc sample, not uniform-in-radius, so bubbles don't bunch
    // toward the centre.
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * puddle.radiusM * 0.85;
    slot.x = puddle.x + Math.cos(angle) * dist;
    slot.z = puddle.z + Math.sin(angle) * dist;
    slot.y = puddle.mesh.position.y;
    slot.radiusM =
      ACID_BUBBLE_RADIUS_MIN +
      Math.random() * (ACID_BUBBLE_RADIUS_MAX - ACID_BUBBLE_RADIUS_MIN);
    slot.totalLife =
      ACID_BUBBLE_LIFE_MIN + Math.random() * (ACID_BUBBLE_LIFE_MAX - ACID_BUBBLE_LIFE_MIN);
    slot.life = slot.totalLife;
    slot.active = true;
  }

  /** Ages every bubble and rewrites the whole instanced buffer — cheap at this pool size. */
  private updateBubbles(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.bubblePool.length; i++) {
      const bubble = this.bubblePool[i];
      if (!bubble.active) continue;
      dirty = true;
      bubble.life -= dt;
      if (bubble.life <= 0) {
        bubble.active = false;
        this.bubbleDummy.position.set(0, -1000, 0);
        this.bubbleDummy.scale.setScalar(0);
        this.bubbleDummy.updateMatrix();
        this.bubbleMesh.setMatrixAt(i, this.bubbleDummy.matrix);
        continue;
      }

      // Grows quickly, holds near its peak, then pops away fast right at the
      // end of its life rather than fading — a bubble bursts, it doesn't dim.
      const age = 1 - bubble.life / bubble.totalLife;
      const scale =
        age < 0.25
          ? bubble.radiusM * (age / 0.25)
          : age > 0.85
            ? bubble.radiusM * (1 - (age - 0.85) / 0.15)
            : bubble.radiusM;

      this.bubbleDummy.position.set(
        bubble.x,
        bubble.y + ACID_BUBBLE_RISE_HEIGHT * age,
        bubble.z,
      );
      this.bubbleDummy.scale.setScalar(Math.max(0, scale));
      this.bubbleDummy.updateMatrix();
      this.bubbleMesh.setMatrixAt(i, this.bubbleDummy.matrix);
    }
    if (dirty) this.bubbleMesh.instanceMatrix.needsUpdate = true;
  }
}
