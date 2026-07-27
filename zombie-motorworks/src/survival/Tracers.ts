import * as THREE from 'three';
import { VFX_PALETTE } from '../vfx/vfxConfig.ts';

export type TracerStyle =
  'standard' | 'heavy' | 'sniper' | 'ice' | 'emp' | 'pierce';

export interface TracerStyleTuning {
  /** Full width of the coloured halo, in world metres. */
  readonly width: number;
  /** Seconds the streak remains visible. */
  readonly lifeSeconds: number;
  /** Seconds before the travelling head reaches the impact point. */
  readonly travelSeconds: number;
  /** The tail-to-head width ratio makes the streak read as travelling forward. */
  readonly tailScale: number;
  /** The hot core stays inside the coloured halo. */
  readonly coreScale: number;
  /** Additive opacity before the lifetime fade. */
  readonly alpha: number;
  readonly color: number;
}

/**
 * Presentation-only shot character. Keeping every value together makes weapon
 * feel tuning independent from the runtime weapon balance.
 */
export const TRACER_STYLE_TUNING: Readonly<
  Record<TracerStyle, TracerStyleTuning>
> = {
  standard: {
    width: 0.17,
    lifeSeconds: 0.14,
    travelSeconds: 0.035,
    tailScale: 0.28,
    coreScale: 0.38,
    alpha: 0.9,
    color: VFX_PALETTE.spark,
  },
  heavy: {
    width: 0.3,
    lifeSeconds: 0.2,
    travelSeconds: 0.045,
    tailScale: 0.36,
    coreScale: 0.42,
    alpha: 1,
    color: VFX_PALETTE.ember,
  },
  sniper: {
    width: 0.13,
    lifeSeconds: 0.26,
    travelSeconds: 0.045,
    tailScale: 0.18,
    coreScale: 0.36,
    alpha: 0.82,
    color: VFX_PALETTE.sparkHot,
  },
  ice: {
    width: 0.22,
    lifeSeconds: 0.17,
    travelSeconds: 0.04,
    tailScale: 0.3,
    coreScale: 0.42,
    alpha: 0.78,
    color: VFX_PALETTE.ice,
  },
  emp: {
    width: 0.2,
    lifeSeconds: 0.12,
    travelSeconds: 0.025,
    tailScale: 0.22,
    coreScale: 0.38,
    alpha: 0.8,
    color: VFX_PALETTE.shield,
  },
  pierce: {
    width: 0.12,
    lifeSeconds: 0.11,
    travelSeconds: 0.025,
    tailScale: 0.24,
    coreScale: 0.34,
    alpha: 0.4,
    color: VFX_PALETTE.spark,
  },
};

export interface TracerRendererOptions {
  /** Max simultaneous tracers. Default 64. */
  capacity?: number;
}

export interface TracerSpawnOptions {
  /** Misses remain visible, but should not compete visually with a connection. */
  readonly faded?: boolean;
}

const DEFAULT_CAPACITY = 64;
const FADED_ALPHA_SCALE = 0.5;
const FADED_LIFE_SCALE = 0.6;
const QUADS_PER_TRACER = 2;
const VERTICES_PER_QUAD = 4;
const INDICES_PER_QUAD = 6;
const MIN_SEGMENT_LENGTH_SQ = 1e-8;
const HOT_R = ((VFX_PALETTE.sparkHot >> 16) & 0xff) / 0xff;
const HOT_G = ((VFX_PALETTE.sparkHot >> 8) & 0xff) / 0xff;
const HOT_B = (VFX_PALETTE.sparkHot & 0xff) / 0xff;

const VERTEX_SHADER = `
attribute vec3 tracerColor;
attribute float tracerAlpha;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = tracerColor;
  vAlpha = tracerAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

varying vec3 vColor;
varying float vAlpha;

void main() {
  gl_FragColor = vec4(vColor, vAlpha);
}
`;

/**
 * One dynamic ribbon mesh for all hitscan streaks. The two quads per slot keep
 * a white-hot centre wrapped in colour without adding a draw call.
 */
export class TracerRenderer {
  private readonly capacity: number;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly alphas: Float32Array;
  private readonly positionAttribute: THREE.BufferAttribute;
  private readonly colorAttribute: THREE.BufferAttribute;
  private readonly alphaAttribute: THREE.BufferAttribute;
  private readonly active: Uint8Array;
  private readonly ages: Float32Array;
  private readonly fromX: Float32Array;
  private readonly fromY: Float32Array;
  private readonly fromZ: Float32Array;
  private readonly toX: Float32Array;
  private readonly toY: Float32Array;
  private readonly toZ: Float32Array;
  private readonly widths: Float32Array;
  private readonly lives: Float32Array;
  private readonly travels: Float32Array;
  private readonly tailScales: Float32Array;
  private readonly coreScales: Float32Array;
  private readonly styleAlphas: Float32Array;
  private readonly styleR: Float32Array;
  private readonly styleG: Float32Array;
  private readonly styleB: Float32Array;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly viewDirection = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly fallbackAxis = new THREE.Vector3();
  private cursor = 0;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    options: TracerRendererOptions = {},
  ) {
    const requestedCapacity = options.capacity ?? DEFAULT_CAPACITY;
    this.capacity = Math.max(
      1,
      Math.floor(
        Number.isFinite(requestedCapacity)
          ? requestedCapacity
          : DEFAULT_CAPACITY,
      ),
    );
    const quadCount = this.capacity * QUADS_PER_TRACER;
    const vertexCount = quadCount * VERTICES_PER_QUAD;

    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 3);
    this.alphas = new Float32Array(vertexCount);
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.colorAttribute = new THREE.BufferAttribute(this.colors, 3);
    this.alphaAttribute = new THREE.BufferAttribute(this.alphas, 1);
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.colorAttribute.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttribute.setUsage(THREE.DynamicDrawUsage);

    const indices = new Uint32Array(quadCount * INDICES_PER_QUAD);
    for (let quad = 0; quad < quadCount; quad++) {
      const vertex = quad * VERTICES_PER_QUAD;
      const index = quad * INDICES_PER_QUAD;
      indices[index] = vertex;
      indices[index + 1] = vertex + 1;
      indices[index + 2] = vertex + 2;
      indices[index + 3] = vertex;
      indices[index + 4] = vertex + 2;
      indices[index + 5] = vertex + 3;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute('tracerColor', this.colorAttribute);
    this.geometry.setAttribute('tracerAlpha', this.alphaAttribute);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    // Dynamic positions make bounds stale immediately; culling a whole volley
    // because its construction-time bounds were at the origin looks worse than
    // the tiny culling cost this pooled mesh avoids.
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    this.active = new Uint8Array(this.capacity);
    this.ages = new Float32Array(this.capacity);
    this.fromX = new Float32Array(this.capacity);
    this.fromY = new Float32Array(this.capacity);
    this.fromZ = new Float32Array(this.capacity);
    this.toX = new Float32Array(this.capacity);
    this.toY = new Float32Array(this.capacity);
    this.toZ = new Float32Array(this.capacity);
    this.widths = new Float32Array(this.capacity);
    this.lives = new Float32Array(this.capacity);
    this.travels = new Float32Array(this.capacity);
    this.tailScales = new Float32Array(this.capacity);
    this.coreScales = new Float32Array(this.capacity);
    this.styleAlphas = new Float32Array(this.capacity);
    this.styleR = new Float32Array(this.capacity);
    this.styleG = new Float32Array(this.capacity);
    this.styleB = new Float32Array(this.capacity);
  }

  /** Fire one tracer from muzzle to impact. */
  spawn(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    style: TracerStyle,
    options?: TracerSpawnOptions,
  ): void {
    if (this.disposed) return;
    const slot = this.cursor;
    this.cursor = (slot + 1) % this.capacity;
    const tuning = TRACER_STYLE_TUNING[style];

    this.active[slot] = 1;
    this.ages[slot] = 0;
    this.fromX[slot] = from.x;
    this.fromY[slot] = from.y;
    this.fromZ[slot] = from.z;
    this.toX[slot] = to.x;
    this.toY[slot] = to.y;
    this.toZ[slot] = to.z;
    this.widths[slot] = tuning.width;
    const faded = options?.faded === true;
    this.lives[slot] = tuning.lifeSeconds * (faded ? FADED_LIFE_SCALE : 1);
    this.travels[slot] = tuning.travelSeconds;
    this.tailScales[slot] = tuning.tailScale;
    this.coreScales[slot] = tuning.coreScale;
    this.styleAlphas[slot] = tuning.alpha * (faded ? FADED_ALPHA_SCALE : 1);
    this.styleR[slot] = ((tuning.color >> 16) & 0xff) / 0xff;
    this.styleG[slot] = ((tuning.color >> 8) & 0xff) / 0xff;
    this.styleB[slot] = (tuning.color & 0xff) / 0xff;
  }

  /** Advance every live tracer. Call once per rendered frame. */
  update(frameDt: number, camera: THREE.Camera): void {
    if (this.disposed) return;
    const dt = Math.max(0, Math.min(frameDt, 0.1));
    camera.getWorldPosition(this.cameraPosition);
    let wroteGeometry = false;

    for (let slot = 0; slot < this.capacity; slot++) {
      if (this.active[slot] === 0) continue;
      const age = this.ages[slot] + dt;
      this.ages[slot] = age;
      if (age >= this.lives[slot]) {
        this.active[slot] = 0;
        this.collapse(slot);
        wroteGeometry = true;
        continue;
      }

      this.writeTracer(slot, age);
      wroteGeometry = true;
    }

    if (!wroteGeometry) return;
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
    this.alphaAttribute.needsUpdate = true;
  }

  /** Hide everything immediately (wave reset, teardown). */
  reset(): void {
    if (this.disposed) return;
    this.active.fill(0);
    this.ages.fill(0);
    this.positions.fill(0);
    this.alphas.fill(0);
    this.positionAttribute.needsUpdate = true;
    this.alphaAttribute.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }

  private writeTracer(slot: number, age: number): void {
    const fromX = this.fromX[slot];
    const fromY = this.fromY[slot];
    const fromZ = this.fromZ[slot];
    const travel = Math.min(1, age / this.travels[slot]);
    const toX = fromX + (this.toX[slot] - fromX) * travel;
    const toY = fromY + (this.toY[slot] - fromY) * travel;
    const toZ = fromZ + (this.toZ[slot] - fromZ) * travel;

    this.direction.set(toX - fromX, toY - fromY, toZ - fromZ);
    if (this.direction.lengthSq() < MIN_SEGMENT_LENGTH_SQ) {
      this.collapse(slot);
      return;
    }
    this.direction.normalize();
    this.viewDirection.set(
      this.cameraPosition.x - (fromX + toX) * 0.5,
      this.cameraPosition.y - (fromY + toY) * 0.5,
      this.cameraPosition.z - (fromZ + toZ) * 0.5,
    );
    this.offset.crossVectors(this.direction, this.viewDirection);
    if (this.offset.lengthSq() < MIN_SEGMENT_LENGTH_SQ) {
      this.fallbackAxis.set(0, Math.abs(this.direction.y) < 0.95 ? 1 : 0, 0);
      if (this.fallbackAxis.y === 0) this.fallbackAxis.x = 1;
      this.offset.crossVectors(this.direction, this.fallbackAxis);
    }
    this.offset.normalize();

    const fadeStart = this.travels[slot];
    const fadeDuration = this.lives[slot] - fadeStart;
    const fade =
      age <= fadeStart ? 1 : Math.max(0, 1 - (age - fadeStart) / fadeDuration);
    const headWidth = this.widths[slot] * fade * 0.5;
    const tailWidth = headWidth * this.tailScales[slot];
    const styleAlpha = this.styleAlphas[slot] * fade;

    this.writeQuad(
      slot,
      0,
      fromX,
      fromY,
      fromZ,
      toX,
      toY,
      toZ,
      tailWidth,
      headWidth,
      this.styleR[slot],
      this.styleG[slot],
      this.styleB[slot],
      styleAlpha * 0.62,
    );
    this.writeQuad(
      slot,
      1,
      fromX,
      fromY,
      fromZ,
      toX,
      toY,
      toZ,
      tailWidth * this.coreScales[slot],
      headWidth * this.coreScales[slot],
      HOT_R,
      HOT_G,
      HOT_B,
      styleAlpha,
    );
  }

  private writeQuad(
    slot: number,
    layer: number,
    fromX: number,
    fromY: number,
    fromZ: number,
    toX: number,
    toY: number,
    toZ: number,
    tailWidth: number,
    headWidth: number,
    r: number,
    g: number,
    b: number,
    alpha: number,
  ): void {
    const vertex = (slot * QUADS_PER_TRACER + layer) * VERTICES_PER_QUAD;
    const position = vertex * 3;
    const tailX = this.offset.x * tailWidth;
    const tailY = this.offset.y * tailWidth;
    const tailZ = this.offset.z * tailWidth;
    const headX = this.offset.x * headWidth;
    const headY = this.offset.y * headWidth;
    const headZ = this.offset.z * headWidth;

    this.writePosition(position, fromX - tailX, fromY - tailY, fromZ - tailZ);
    this.writePosition(
      position + 3,
      fromX + tailX,
      fromY + tailY,
      fromZ + tailZ,
    );
    this.writePosition(position + 6, toX + headX, toY + headY, toZ + headZ);
    this.writePosition(position + 9, toX - headX, toY - headY, toZ - headZ);

    for (let vertexIndex = vertex; vertexIndex < vertex + 4; vertexIndex++) {
      const color = vertexIndex * 3;
      this.colors[color] = r;
      this.colors[color + 1] = g;
      this.colors[color + 2] = b;
      this.alphas[vertexIndex] = alpha;
    }
  }

  private writePosition(
    position: number,
    x: number,
    y: number,
    z: number,
  ): void {
    this.positions[position] = x;
    this.positions[position + 1] = y;
    this.positions[position + 2] = z;
  }

  private collapse(slot: number): void {
    const vertex = slot * QUADS_PER_TRACER * VERTICES_PER_QUAD;
    this.positions.fill(0, vertex * 3, (vertex + 8) * 3);
    this.alphas.fill(0, vertex, vertex + 8);
  }
}
