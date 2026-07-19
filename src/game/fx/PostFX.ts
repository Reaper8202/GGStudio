import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Bloom tuning — bright emissive surfaces (coins, gate glow) bleed softly. */
const BLOOM_STRENGTH = 0.55;
const BLOOM_RADIUS = 0.6;
const BLOOM_THRESHOLD = 0.6;

/**
 * Exponential decay time constants (ms): how long each juice uniform takes
 * to fall to ~1% of its kicked value (i.e. "near zero").
 */
const PULSE_DECAY_MS = 250;
const DANGER_DECAY_MS = 600;
const REVIVE_DECAY_MS = 700;

const JUICE_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const JUICE_FRAGMENT_SHADER = `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uSpeed01;
uniform float uPulse;
uniform float uDanger;
uniform float uRevive;
uniform float uAspect;
varying vec2 vUv;

void main() {
  vec2 centered = vUv - 0.5;
  // Aspect-corrected radius so the vignette/aberration falloff reads as
  // circular in screen space rather than stretched to the viewport shape.
  vec2 corrected = vec2(centered.x * uAspect, centered.y);
  float dist = length(corrected);
  vec2 dir = dist > 0.0001 ? normalize(centered) : vec2(0.0);

  // Chromatic aberration: radial RGB split, stronger near the edges and
  // kicked up by coin pulses / run speed.
  float caMag = (0.0015 + 0.004 * uPulse + 0.002 * uSpeed01) * dist;
  vec2 offset = dir * caMag;
  float r = texture2D(tDiffuse, vUv + offset).r;
  float g = texture2D(tDiffuse, vUv).g;
  float b = texture2D(tDiffuse, vUv - offset).b;
  vec3 color = vec3(r, g, b);

  // Vignette — speed narrows your vision.
  float vigStrength = 0.35 + 0.18 * uSpeed01;
  float vig = 1.0 - vigStrength * smoothstep(0.35, 0.95, dist);
  color *= vig;

  // Coin-pulse brightness/saturation lift — subtle, ~+8% at uPulse = 1.
  float lift = 0.08 * uPulse;
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(luma), color, 1.0 + lift) + lift * 0.35;

  // Danger: additive red glow blooming in from the screen edges.
  float edge = smoothstep(0.3, 0.95, dist);
  color += vec3(1.0, 0.08, 0.12) * edge * uDanger * 0.55;

  // Revive: additive teal/white soft flash across the whole frame.
  color += vec3(0.55, 1.0, 0.92) * uRevive * 0.4;

  gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * Post-processing pipeline: RenderPass -> UnrealBloomPass -> a custom
 * "juice" ShaderPass (chromatic aberration, vignette, coin-pulse lift,
 * danger edge, revive flash) -> OutputPass (handles sRGB/tone-mapping
 * output conversion; must stay last).
 *
 * The run loop drives it via setSpeed01()/kick*() and calls render() once
 * per frame instead of renderer.render(). All juice uniforms decay on
 * their own inside render(), so callers never reset anything.
 */
export class PostFX {
  /** When false, render() falls back to a plain renderer.render() call. */
  enabled = true;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;

  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly juicePass: ShaderPass;

  private readonly uTime: { value: number };
  private readonly uSpeed01: { value: number };
  private readonly uPulse: { value: number };
  private readonly uDanger: { value: number };
  private readonly uRevive: { value: number };
  private readonly uAspect: { value: number };

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const size = renderer.getSize(new THREE.Vector2());

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    this.composer.addPass(this.bloomPass);

    this.juicePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uSpeed01: { value: 0 },
        uPulse: { value: 0 },
        uDanger: { value: 0 },
        uRevive: { value: 0 },
        uAspect: { value: size.x / size.y },
      },
      vertexShader: JUICE_VERTEX_SHADER,
      fragmentShader: JUICE_FRAGMENT_SHADER,
    });
    this.composer.addPass(this.juicePass);

    this.composer.addPass(new OutputPass());

    // Cache uniform refs so render()/setSize()/kick*() never touch a map.
    const u = this.juicePass.uniforms;
    this.uTime = u.uTime as { value: number };
    this.uSpeed01 = u.uSpeed01 as { value: number };
    this.uPulse = u.uPulse as { value: number };
    this.uDanger = u.uDanger as { value: number };
    this.uRevive = u.uRevive as { value: number };
    this.uAspect = u.uAspect as { value: number };
  }

  /** Resizes the composer, bloom render targets, and the aspect uniform. */
  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.uAspect.value = width / height;
  }

  /** 0 (stopped) .. 1 (max run speed) — widens the vignette a touch. */
  setSpeed01(v: number): void {
    this.uSpeed01.value = v;
  }

  /** Coin pickup: brief bloom-y brightness/saturation lift + CA kick. */
  kickCoin(): void {
    this.uPulse.value = 1;
  }

  /** Death: red edge glow slams in, then decays. */
  kickDeath(): void {
    this.uDanger.value = 1;
  }

  /** Revive: soft teal/white flash across the frame. */
  kickRevive(): void {
    this.uRevive.value = 1;
  }

  /** Advances time, decays the juice uniforms, and draws the frame. */
  render(dtMs: number): void {
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.uTime.value += dtMs / 1000;
    this.uPulse.value *= Math.pow(0.01, dtMs / PULSE_DECAY_MS);
    this.uDanger.value *= Math.pow(0.01, dtMs / DANGER_DECAY_MS);
    this.uRevive.value *= Math.pow(0.01, dtMs / REVIVE_DECAY_MS);
    this.composer.render();
  }
}
