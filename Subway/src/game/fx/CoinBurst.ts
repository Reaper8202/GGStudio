import * as THREE from 'three';
import { Palette } from '../../config/constants';

/** Pool size — comfortably covers overlapping pickups in a coin run. */
const POOL_SIZE = 8;
const SPARKLE_COUNT = 6;
/** Burst lifetime (ms): ring expand/fade + sparkles fly out/fade. */
const LIFE_MS = 400;
const RING_GROW = 3.2;
const SPARKLE_DISTANCE = 0.85;
/** Golden angle — spreads fixed per-sparkle directions evenly, no RNG needed. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const RING_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// RingGeometry UVs are a planar projection centered at (0.5, 0.5), so
// distance from center in UV space (scaled by 2) is the fraction of the
// outer radius — a cheap, allocation-free way to get a soft radial band.
const RING_FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float glow = smoothstep(1.0, 0.55, d) * smoothstep(0.0, 0.12, d);
  gl_FragColor = vec4(uColor, glow * uOpacity);
}
`;

const ringGeo = new THREE.RingGeometry(0.02, 0.4, 24, 1);
const sparkleGeo = new THREE.PlaneGeometry(0.12, 0.12);

interface BurstInstance {
  readonly group: THREE.Group;
  readonly ring: THREE.Mesh;
  readonly ringMat: THREE.ShaderMaterial;
  readonly sparkles: THREE.Mesh[];
  readonly sparkleMats: THREE.MeshBasicMaterial[];
  /** Fixed outward direction per sparkle, precomputed once. */
  readonly dirs: THREE.Vector3[];
  /** ms remaining; <= 0 means free/inactive. */
  life: number;
}

/**
 * Pooled coin-pickup burst: a soft expanding ring plus a handful of gold
 * sparkles flying outward on fixed directions. Everything is preallocated
 * in the constructor — burst()/update() only mutate existing objects, so
 * rapid pickups never allocate. Both the ring (RingGeometry, +z normal)
 * and the sparkle quads (PlaneGeometry, +z normal) face the camera by
 * construction since the camera looks down -z and the burst group carries
 * no rotation — no per-frame billboarding needed.
 */
export class CoinBurst {
  private readonly instances: BurstInstance[] = [];

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const group = new THREE.Group();
      group.visible = false;

      const ringMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(Palette.coin) },
          uOpacity: { value: 0 },
        },
        vertexShader: RING_VERTEX_SHADER,
        fragmentShader: RING_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      group.add(ring);

      const sparkles: THREE.Mesh[] = [];
      const sparkleMats: THREE.MeshBasicMaterial[] = [];
      const dirs: THREE.Vector3[] = [];
      for (let s = 0; s < SPARKLE_COUNT; s++) {
        const mat = new THREE.MeshBasicMaterial({
          color: Palette.coin,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const mesh = new THREE.Mesh(sparkleGeo, mat);
        group.add(mesh);
        sparkles.push(mesh);
        sparkleMats.push(mat);

        const angle = (i * SPARKLE_COUNT + s) * GOLDEN_ANGLE;
        const upBias = 0.5 + 0.4 * Math.abs(Math.sin(s * 1.7 + i));
        dirs.push(new THREE.Vector3(Math.cos(angle), upBias, Math.sin(angle)).normalize());
      }

      scene.add(group);
      this.instances.push({ group, ring, ringMat, sparkles, sparkleMats, dirs, life: 0 });
    }
  }

  /** Acquires the oldest-free (or, if none free, the soonest-to-finish) instance. */
  burst(x: number, y: number, z: number): void {
    let chosen = this.instances[0];
    for (const inst of this.instances) {
      if (inst.life <= 0) {
        chosen = inst;
        break;
      }
      if (inst.life < chosen.life) chosen = inst;
    }
    chosen.group.position.set(x, y, z);
    chosen.group.visible = true;
    chosen.life = LIFE_MS;
  }

  /** Advances all active bursts: ring grows + fades, sparkles fly out + fade. */
  update(dtMs: number): void {
    for (const inst of this.instances) {
      if (inst.life <= 0) continue;
      inst.life -= dtMs;
      if (inst.life <= 0) {
        inst.life = 0;
        inst.group.visible = false;
        continue;
      }

      const t = 1 - inst.life / LIFE_MS;
      inst.ring.scale.setScalar(1 + t * RING_GROW);
      inst.ringMat.uniforms.uOpacity.value = 1 - t;

      const dist = t * SPARKLE_DISTANCE;
      const fade = (1 - t) * (1 - t);
      for (let s = 0; s < inst.sparkles.length; s++) {
        const dir = inst.dirs[s];
        inst.sparkles[s].position.set(dir.x * dist, dir.y * dist, dir.z * dist);
        inst.sparkleMats[s].opacity = fade;
      }
    }
  }
}
