/**
 * Manifest-driven, phased GLTF loader. Boot phase gates first playability;
 * 'main' and 'dinos' stream in the background. Everything is defensive: assets
 * may not exist on disk yet (the pipeline agent runs concurrently), so missing
 * files resolve to null and callers fall back to primitives — the game always boots.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { EventBus } from './EventBus';

export type AssetPhase = 'boot' | 'main' | 'dinos';

interface Manifest {
  phases: Record<AssetPhase, string[]>;
  files: Record<string, { bytes: number }>;
}

interface LoadedModel {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

export interface ModelInstance {
  object: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  clips: THREE.AnimationClip[];
}

export interface GeometrySource {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const CLIP_PREFERENCE = ['idle', 'walk', 'run', 'eat'];

/** Clips that must never leak through the fuzzy resolver (frozen-death-pose bug). */
const HARMFUL_CLIP_TERMS = ['death', 'attack', 'hit', 'jump'];

/** Per-state substring preference chains (case-insensitive). */
const CLIP_CHAINS: Record<string, string[]> = {
  idle: ['idle'],
  walk: ['walk', 'idle'],
  // animal pack has GALLOP instead of Run; dinos have Run
  run: ['run', 'gallop', 'walk'],
  // 'eat' also matches the pack's 'Eating'
  eat: ['eat', 'idle'],
};

export class AssetManager {
  private loader: GLTFLoader;
  private manifest: Manifest | null = null;
  private models = new Map<string, LoadedModel | null>();
  private loadedPhases = new Set<AssetPhase>();
  private base: string;

  constructor(private bus: EventBus) {
    this.base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
    this.loader = new GLTFLoader();
    // MeshoptDecoder may need async init; guard defensively.
    try {
      this.loader.setMeshoptDecoder(MeshoptDecoder);
    } catch {
      /* decoder unavailable — uncompressed assets still load */
    }
  }

  private url(manifestPath: string): string {
    return `${this.base}assets/${manifestPath}`;
  }

  async loadManifest(): Promise<void> {
    try {
      const res = await fetch(`${this.base}assets/manifest.json`);
      if (res.ok) {
        this.manifest = (await res.json()) as Manifest;
      }
    } catch {
      /* no manifest yet */
    }
    if (!this.manifest) {
      this.manifest = { phases: { boot: [], main: [], dinos: [] }, files: {} };
    }
  }

  isPhaseLoaded(phase: AssetPhase): boolean {
    return this.loadedPhases.has(phase);
  }

  private loadOne(path: string): Promise<void> {
    if (this.models.has(path)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.loader.load(
        this.url(path),
        (gltf) => {
          this.models.set(path, {
            scene: gltf.scene,
            clips: gltf.animations ?? [],
          });
          resolve();
        },
        undefined,
        () => {
          // asset missing / not built yet — remember null, fall back later
          this.models.set(path, null);
          resolve();
        },
      );
    });
  }

  async loadPhase(phase: AssetPhase): Promise<void> {
    if (!this.manifest) await this.loadManifest();
    const files = this.manifest?.phases[phase] ?? [];
    await Promise.all(files.map((f) => this.loadOne(f)));
    this.loadedPhases.add(phase);
    this.bus.emit('assets:phaseLoaded', { phase });
  }

  /** Ensure a single model is available even if not in the requested phase list. */
  async ensure(path: string): Promise<void> {
    await this.loadOne(path);
  }

  has(path: string): boolean {
    return !!this.models.get(path);
  }

  /**
   * Instantiate a model. SkeletonUtils.clone preserves skinned rigs so many
   * instances can animate independently. Returns null if the asset is absent.
   *
   * `normalizeHeight` (meters): the source packs are authored at wildly
   * inconsistent scales, so when set we measure the rest-pose bounding box and
   * uniformly scale the clone so its height equals exactly that many meters,
   * grounded at y=0 and centered on x/z.
   */
  instance(
    path: string,
    opts: {
      tint?: string;
      emissive?: string;
      scale?: number;
      normalizeHeight?: number;
    } = {},
  ): ModelInstance | null {
    const model = this.models.get(path);
    if (!model) return null;
    const object = skeletonClone(model.scene) as THREE.Object3D;
    if (opts.scale && opts.scale !== 1) object.scale.setScalar(opts.scale);
    if (opts.normalizeHeight !== undefined) {
      this.normalizeToHeight(object, opts.normalizeHeight, path);
    }
    if (opts.tint || opts.emissive) this.applyTint(object, opts.tint, opts.emissive);
    let mixer: THREE.AnimationMixer | null = null;
    if (model.clips.length > 0) mixer = new THREE.AnimationMixer(object);
    return { object, mixer, clips: model.clips };
  }

  /** Cache of computed normalization factors per (path,targetHeight). */
  private normFactors = new Map<string, number>();

  private normalizeToHeight(object: THREE.Object3D, target: number, path: string): void {
    object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const height = box.max.y - box.min.y; // measured at current scale s0
    if (height <= 1e-4) return;
    const s0 = object.scale.x || 1;
    const factor = (target / height) * s0; // new uniform scale
    const ratio = factor / s0; // how much measured (world) extents shrink/grow
    object.scale.setScalar(factor);
    // ground at y=0 and center on x/z so rotation pivots on the visual center
    object.position.y -= box.min.y * ratio;
    object.position.x -= ((box.min.x + box.max.x) / 2) * ratio;
    object.position.z -= ((box.min.z + box.max.z) / 2) * ratio;
    const key = `${path}@${target}`;
    if (!this.normFactors.has(key)) {
      this.normFactors.set(key, factor);
      console.debug(
        `[assets] normalized ${path}: bboxH=${(height / s0).toFixed(2)} native ×${factor.toFixed(4)} → ${target}m`,
      );
    }
  }

  private applyTint(root: THREE.Object3D, tint?: string, emissive?: string): void {
    const tintColor = tint ? new THREE.Color(tint) : null;
    const emissiveColor = emissive ? new THREE.Color(emissive) : null;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material;
      const mats = Array.isArray(src) ? src : [src];
      mesh.material = mats.map((m) => {
        const c = m.clone() as THREE.MeshStandardMaterial;
        if (tintColor && (c as THREE.MeshStandardMaterial).color) {
          c.color.multiply(tintColor);
        }
        if (emissiveColor && 'emissive' in c) {
          c.emissive = emissiveColor.clone();
          c.emissiveIntensity = 0.6;
        }
        return c;
      });
      if (!Array.isArray(src)) mesh.material = (mesh.material as THREE.Material[])[0];
    });
  }

  /** Resolve an animation clip by case-insensitive substring. */
  findClip(clips: THREE.AnimationClip[], name: string): THREE.AnimationClip | null {
    if (clips.length === 0) return null;
    const lower = name.toLowerCase();
    const match = clips.find((c) => c.name.toLowerCase().includes(lower));
    if (match) return match;
    return null;
  }

  /**
   * Best available clip for a semantic state. Pack clip names are inconsistent
   * (animals: Idle, Idle_2, Walk, GALLOP, Eating, Attack_*, Death, HitReact_*;
   * dinos: "Armature|<Name>_<Idle|Walk|Run|...>"), so each state tries a chain
   * of substrings, and harmful clips (death/attack/hit/jump) are NEVER returned
   * — not even as a last-resort fallback.
   */
  clipFor(clips: THREE.AnimationClip[], preferred: string): THREE.AnimationClip | null {
    if (clips.length === 0) return null;
    const safe = clips.filter((c) => AssetManager.isSafeClip(c.name));
    if (safe.length === 0) return null;
    const chain = CLIP_CHAINS[preferred.toLowerCase()] ?? [preferred.toLowerCase(), 'idle'];
    for (const term of chain) {
      const match = safe.find((c) => c.name.toLowerCase().includes(term));
      if (match) return match;
    }
    // final fallback: anything idle-like, else the first non-harmful clip
    return safe.find((c) => c.name.toLowerCase().includes('idle')) ?? safe[0];
  }

  private static isSafeClip(name: string): boolean {
    const lower = name.toLowerCase();
    return !HARMFUL_CLIP_TERMS.some((t) => lower.includes(t));
  }

  clipPreference(): string[] {
    return CLIP_PREFERENCE;
  }

  /**
   * Extract raw geometry+material pairs from a loaded model, for building
   * InstancedMesh copies of vegetation/fences. Returns [] if absent.
   */
  geometrySources(path: string): GeometrySource[] {
    const model = this.models.get(path);
    if (!model) return [];
    const out: GeometrySource[] = [];
    model.scene.updateWorldMatrix(true, true);
    model.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const geo = mesh.geometry.clone();
      // bake the mesh's local transform into the geometry so instances align
      geo.applyMatrix4(mesh.matrixWorld);
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      out.push({ geometry: geo, material: mat });
    });
    return out;
  }
}
