/**
 * One pooled, instanced layer of tumbling voxel cubes.
 *
 * Everything the VFX layer draws is a cube: gore chunks, sparks, embers,
 * smoke, shell casings, ground splats. Keeping them in a single InstancedMesh
 * per blend mode means the whole effects budget costs two draw calls and no
 * per-frame allocation — live particles stay packed in `[0, count)` and are
 * removed by swapping the tail down.
 */

import * as THREE from 'three';
import { SPLAT_FLATTEN, SPLAT_SPREAD, VFX_GROUND_Y } from './vfxConfig.ts';

/** Blend mode of a layer. `lit` takes scene lighting; `glow` is additive. */
export type ParticleLayerKind = 'lit' | 'glow';

/**
 * One particle's birth state. Emitters own a scratch instance and mutate it,
 * so spawning never allocates. `VoxelParticles` copies every field out.
 */
export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Cube edge length at birth, m. */
  size: number;
  /** Cube edge length at death, m. 0 dissolves the cube away. */
  endSize: number;
  lifeSeconds: number;
  /** sRGB hex at birth. */
  colorStart: number;
  /** sRGB hex at death. On the glow layer, black is a clean fade-out. */
  colorEnd: number;
  /** Vertical acceleration, m/s^2. Negative falls, positive rises. */
  gravity: number;
  /** Fraction of speed shed per second. 0 keeps momentum, 4 kills it fast. */
  drag: number;
  /** Peak tumble rate about each axis, rad/s. */
  spin: number;
  /** Ground restitution. 0 settles on contact; negative ignores the ground. */
  bounce: number;
  /** Settle flat on the ground as a splat instead of stopping upright. */
  stick: boolean;
}

const FLAG_GROUND = 1;
const FLAG_STICK = 2;
const FLAG_STUCK = 4;

/** Below this vertical speed a bouncing cube gives up and settles. */
const SETTLE_SPEED = 1.1;
/** Horizontal speed retained across a ground bounce. */
const GROUND_FRICTION = 0.55;
/** Lift settled splats off the ground plane to avoid z-fighting. */
const SPLAT_EPSILON = 0.015;

export function defaultParticleSpec(): ParticleSpec {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    size: 0.1,
    endSize: 0,
    lifeSeconds: 0.5,
    colorStart: 0xffffff,
    colorEnd: 0x000000,
    gravity: -18,
    drag: 0,
    spin: 0,
    bounce: -1,
    stick: false,
  };
}

export class VoxelParticles {
  readonly mesh: THREE.InstancedMesh;

  private readonly geometry: THREE.BoxGeometry;
  private readonly material: THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
  private readonly colorAttribute: THREE.InstancedBufferAttribute;

  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly rx: Float32Array;
  private readonly ry: Float32Array;
  private readonly rz: Float32Array;
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;
  private readonly sz: Float32Array;
  private readonly life: Float32Array;
  private readonly invLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly bounce: Float32Array;
  private readonly startColor: Float32Array;
  private readonly endColor: Float32Array;
  private readonly flags: Uint8Array;

  private readonly matrix = new THREE.Matrix4();
  private readonly euler = new THREE.Euler();
  private readonly scaleScratch = new THREE.Vector3();
  private readonly colorScratch = new THREE.Color();

  private count = 0;
  private disposed = false;

  constructor(
    kind: ParticleLayerKind,
    readonly capacity: number,
    private readonly groundY = VFX_GROUND_Y,
  ) {
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material =
      kind === 'glow'
        ? new THREE.MeshBasicMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          })
        : new THREE.MeshLambertMaterial({ flatShading: true });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colorAttribute = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 3),
      3,
    );
    this.colorAttribute.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = this.colorAttribute;
    // Instance positions are world-space and unrelated to the mesh's own
    // bounds, so culling would pop the whole layer in and out.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.name = `vfx-${kind}`;

    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.pz = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.rx = new Float32Array(capacity);
    this.ry = new Float32Array(capacity);
    this.rz = new Float32Array(capacity);
    this.sx = new Float32Array(capacity);
    this.sy = new Float32Array(capacity);
    this.sz = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.invLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.bounce = new Float32Array(capacity);
    this.startColor = new Float32Array(capacity * 3);
    this.endColor = new Float32Array(capacity * 3);
    this.flags = new Uint8Array(capacity);
  }

  /** Live particle count; also the InstancedMesh draw count. */
  get activeCount(): number {
    return this.count;
  }

  /**
   * Add one particle. When the pool is saturated the particle closest to death
   * is recycled, so a fresh burst always shows rather than silently vanishing.
   */
  spawn(spec: ParticleSpec): void {
    if (this.disposed || spec.lifeSeconds <= 0) return;

    let index: number;
    if (this.count < this.capacity) {
      index = this.count++;
    } else {
      index = 0;
      for (let i = 1; i < this.count; i++) {
        if (this.life[i] < this.life[index]) index = i;
      }
    }

    this.px[index] = spec.x;
    this.py[index] = spec.y;
    this.pz[index] = spec.z;
    this.vx[index] = spec.vx;
    this.vy[index] = spec.vy;
    this.vz[index] = spec.vz;
    this.rx[index] = Math.random() * Math.PI * 2;
    this.ry[index] = Math.random() * Math.PI * 2;
    this.rz[index] = Math.random() * Math.PI * 2;
    this.sx[index] = (Math.random() * 2 - 1) * spec.spin;
    this.sy[index] = (Math.random() * 2 - 1) * spec.spin;
    this.sz[index] = (Math.random() * 2 - 1) * spec.spin;
    this.life[index] = spec.lifeSeconds;
    this.invLife[index] = 1 / spec.lifeSeconds;
    this.size0[index] = spec.size;
    this.size1[index] = spec.endSize;
    this.gravity[index] = spec.gravity;
    this.drag[index] = spec.drag;
    this.bounce[index] = spec.bounce;
    this.flags[index] =
      (spec.bounce >= 0 ? FLAG_GROUND : 0) | (spec.stick ? FLAG_STICK : 0);

    this.colorScratch.setHex(spec.colorStart);
    this.startColor[index * 3] = this.colorScratch.r;
    this.startColor[index * 3 + 1] = this.colorScratch.g;
    this.startColor[index * 3 + 2] = this.colorScratch.b;
    this.colorScratch.setHex(spec.colorEnd);
    this.endColor[index * 3] = this.colorScratch.r;
    this.endColor[index * 3 + 1] = this.colorScratch.g;
    this.endColor[index * 3 + 2] = this.colorScratch.b;
  }

  /** Integrate, retire expired particles, and rewrite the instance buffers. */
  update(dt: number): void {
    if (this.disposed) return;
    const colors = this.colorAttribute.array as Float32Array;

    for (let i = 0; i < this.count; ) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.remove(i);
        continue;
      }

      const flags = this.flags[i];
      const stuck = (flags & FLAG_STUCK) !== 0;
      // 0 at birth, 1 at death — the curve parameter for size and colour.
      const t = 1 - this.life[i] * this.invLife[i];
      const size = this.size0[i] + (this.size1[i] - this.size0[i]) * t;

      if (!stuck) {
        this.vy[i] += this.gravity[i] * dt;
        const damp = Math.max(0, 1 - this.drag[i] * dt);
        this.vx[i] *= damp;
        this.vy[i] *= damp;
        this.vz[i] *= damp;
        this.px[i] += this.vx[i] * dt;
        this.py[i] += this.vy[i] * dt;
        this.pz[i] += this.vz[i] * dt;
        this.rx[i] += this.sx[i] * dt;
        this.ry[i] += this.sy[i] * dt;
        this.rz[i] += this.sz[i] * dt;

        if ((flags & FLAG_GROUND) !== 0) {
          const rest = this.groundY + size * 0.5;
          if (this.py[i] <= rest && this.vy[i] <= 0) {
            const bounce = this.bounce[i];
            if (bounce > 0 && -this.vy[i] > SETTLE_SPEED) {
              this.py[i] = rest;
              this.vy[i] = -this.vy[i] * bounce;
              this.vx[i] *= GROUND_FRICTION;
              this.vz[i] *= GROUND_FRICTION;
              this.sx[i] *= 0.5;
              this.sy[i] *= 0.5;
              this.sz[i] *= 0.5;
            } else if ((flags & FLAG_STICK) !== 0) {
              this.flags[i] |= FLAG_STUCK;
              this.vx[i] = 0;
              this.vy[i] = 0;
              this.vz[i] = 0;
              // Lie flat: keep only the yaw so the splat still looks scattered.
              this.rx[i] = 0;
              this.rz[i] = 0;
            } else {
              this.py[i] = rest;
              this.vx[i] = 0;
              this.vy[i] = 0;
              this.vz[i] = 0;
            }
          }
        }
      }

      const flat = (this.flags[i] & FLAG_STUCK) !== 0;
      if (flat) {
        this.py[i] = this.groundY + size * SPLAT_FLATTEN * 0.5 + SPLAT_EPSILON;
        this.scaleScratch.set(
          size * SPLAT_SPREAD,
          size * SPLAT_FLATTEN,
          size * SPLAT_SPREAD,
        );
      } else {
        this.scaleScratch.setScalar(size);
      }

      this.euler.set(this.rx[i], this.ry[i], this.rz[i]);
      this.matrix.makeRotationFromEuler(this.euler);
      this.matrix.scale(this.scaleScratch);
      this.matrix.setPosition(this.px[i], this.py[i], this.pz[i]);
      this.mesh.setMatrixAt(i, this.matrix);

      const c = i * 3;
      colors[c] =
        this.startColor[c] + (this.endColor[c] - this.startColor[c]) * t;
      colors[c + 1] =
        this.startColor[c + 1] +
        (this.endColor[c + 1] - this.startColor[c + 1]) * t;
      colors[c + 2] =
        this.startColor[c + 2] +
        (this.endColor[c + 2] - this.startColor[c + 2]) * t;

      i++;
    }

    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.colorAttribute.needsUpdate = true;
    }
  }

  /** Drop every live particle without tearing down the pool. */
  reset(): void {
    this.count = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.count = 0;
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  /** Swap-remove: the tail particle takes the retired slot. */
  private remove(index: number): void {
    const last = --this.count;
    if (index === last) return;
    this.px[index] = this.px[last];
    this.py[index] = this.py[last];
    this.pz[index] = this.pz[last];
    this.vx[index] = this.vx[last];
    this.vy[index] = this.vy[last];
    this.vz[index] = this.vz[last];
    this.rx[index] = this.rx[last];
    this.ry[index] = this.ry[last];
    this.rz[index] = this.rz[last];
    this.sx[index] = this.sx[last];
    this.sy[index] = this.sy[last];
    this.sz[index] = this.sz[last];
    this.life[index] = this.life[last];
    this.invLife[index] = this.invLife[last];
    this.size0[index] = this.size0[last];
    this.size1[index] = this.size1[last];
    this.gravity[index] = this.gravity[last];
    this.drag[index] = this.drag[last];
    this.bounce[index] = this.bounce[last];
    this.flags[index] = this.flags[last];
    for (let c = 0; c < 3; c++) {
      this.startColor[index * 3 + c] = this.startColor[last * 3 + c];
      this.endColor[index * 3 + c] = this.endColor[last * 3 + c];
    }
  }
}
