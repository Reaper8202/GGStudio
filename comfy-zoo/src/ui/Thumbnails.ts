/**
 * ONE shared secondary WebGLRenderer + GLTFLoader (with MeshoptDecoder, since
 * the pipeline agent ships meshopt-compressed models) that renders queued model
 * snapshots into per-card <canvas> elements via renderer.render → drawImage.
 *
 * Modes: 'static' (build menu — render once), 'turntable' (zoopedia — continuous
 * rotation, only while visible), 'bounce' (reward modal — gentle bob, only while
 * visible). Loaded models are cached. Missing models draw a cute paw-print
 * placeholder and retry on the next open. Shared offscreen canvas capped 256².
 *
 * Rendering is serialized: a single RAF loop reuses one shared scene, swapping in
 * the cached model for whichever handle it is drawing, so no per-handle clones.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const MAX = 256; // shared offscreen size cap

export type ThumbMode = 'static' | 'turntable' | 'bounce';

export interface ThumbOpts {
  /** Render every mesh in charcoal (uncaught ZooPedia silhouette). */
  silhouette?: boolean;
  /** Multiply base material colors by this hex (legendary/skin tint preview). */
  tint?: string;
  /** Emissive hex for aura skins. */
  emissive?: string;
}

export interface ThumbHandle {
  /** Turntable/bounce only render while visible; toggle here. */
  setVisible(v: boolean): void;
  /** Swap the model shown in this canvas (e.g. skin preview) — reuses the canvas. */
  setModel(path: string, opts?: ThumbOpts): void;
  /** Force a re-render (static handles after a resize). */
  invalidate(): void;
  dispose(): void;
}

interface Handle {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  path: string;
  mode: ThumbMode;
  opts: ThumbOpts;
  visible: boolean;
  angle: number;
  phase: number;
  needsRender: boolean; // static: draw once when ready
  dead: boolean;
}

const CHARCOAL = new THREE.Color('#3a342e');

export class Thumbnails {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  private root = new THREE.Group();
  private loader: GLTFLoader;
  private models = new Map<string, THREE.Object3D | 'error'>();
  private loading = new Map<string, Promise<void>>();
  private handles = new Set<Handle>();
  private raf = 0;
  private current: THREE.Object3D | null = null;

  constructor() {
    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);

    this.scene.add(this.root);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a6b4d, 1.15);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfff3dc, 1.4);
    dir.position.set(2.5, 4, 2);
    this.scene.add(dir);
    this.camera.position.set(0, 0.6, 4.2);
    this.camera.lookAt(0, 0, 0);
  }

  private ensureRenderer(): THREE.WebGLRenderer | null {
    if (this.renderer) return this.renderer;
    try {
      const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true });
      r.setClearColor(0x000000, 0);
      r.setPixelRatio(1);
      r.setSize(MAX, MAX, false);
      this.renderer = r;
      return r;
    } catch (e) {
      console.debug('[thumbs] no WebGL2 secondary renderer', e);
      return null;
    }
  }

  private normalizePath(path: string): string {
    // buildCatalog().modelPath / animals.json are manifest-relative
    // ("models/..."); prefix assets/ and root it.
    let p = path.replace(/^\/+/, '');
    if (!p.startsWith('assets/')) p = 'assets/' + p;
    return '/' + p;
  }

  private load(path: string): Promise<void> {
    if (this.models.has(path)) return Promise.resolve();
    const existing = this.loading.get(path);
    if (existing) return existing;
    const url = this.normalizePath(path);
    const p = new Promise<void>((resolve) => {
      this.loader.load(
        url,
        (gltf) => {
          const obj = gltf.scene;
          this.frameModel(obj);
          this.models.set(path, obj);
          this.loading.delete(path);
          resolve();
        },
        undefined,
        (err) => {
          console.debug(`[thumbs] failed ${url}`, err);
          this.models.set(path, 'error');
          this.loading.delete(path);
          resolve();
        },
      );
    });
    this.loading.set(path, p);
    return p;
  }

  /** Center + scale a model so it fits a unit-ish view box. */
  private frameModel(obj: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2.2 / maxDim;
    obj.scale.setScalar(scale);
    obj.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    // Snapshot original material colors for reversible overrides.
    obj.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const sm = m as THREE.MeshStandardMaterial;
        if (sm && 'color' in sm && sm.color) {
          sm.userData.__baseColor = sm.color.clone();
          if (sm.emissive) sm.userData.__baseEmissive = sm.emissive.clone();
        }
      }
    });
  }

  private applyOverrides(obj: THREE.Object3D, opts: ThumbOpts): void {
    const tint = opts.tint ? new THREE.Color(opts.tint) : null;
    const emissive = opts.emissive ? new THREE.Color(opts.emissive) : null;
    obj.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const sm = m as THREE.MeshStandardMaterial;
        if (!sm || !('color' in sm) || !sm.color) continue;
        const base = (sm.userData.__baseColor as THREE.Color) ?? sm.color;
        if (opts.silhouette) {
          sm.color.copy(CHARCOAL);
          if (sm.emissive) sm.emissive.setRGB(0, 0, 0);
        } else if (tint) {
          sm.color.copy(base).multiply(tint);
          if (sm.emissive && emissive) sm.emissive.copy(emissive).multiplyScalar(0.5);
        } else {
          sm.color.copy(base);
          if (sm.emissive) {
            const be = sm.userData.__baseEmissive as THREE.Color | undefined;
            if (be) sm.emissive.copy(be);
          }
        }
      }
    });
  }

  private drawPlaceholder(h: Handle): void {
    const ctx = h.ctx;
    if (!ctx) return;
    const w = h.canvas.width;
    const s = w;
    ctx.clearRect(0, 0, w, h.canvas.height);
    ctx.save();
    ctx.translate(s * 0.5, s * 0.54);
    ctx.scale(s / 24, s / 24);
    ctx.fillStyle = 'rgba(138,107,77,0.32)';
    const pad = (cx: number, cy: number, r: number) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    ctx.beginPath();
    ctx.ellipse(0, 3.5, 5.2, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    pad(-6.4, -1.2, 2.3);
    pad(-2.5, -5.2, 2.4);
    pad(2.5, -5.2, 2.4);
    pad(6.4, -1.2, 2.3);
    ctx.restore();
  }

  private ensureLoop(): void {
    if (this.raf) return;
    const tick = (t: number) => {
      this.raf = 0;
      let anyContinuous = false;
      const r = this.ensureRenderer();
      for (const h of this.handles) {
        if (h.dead) continue;
        const continuous = h.mode !== 'static';
        if (continuous && !h.visible) continue;
        if (!continuous && !h.needsRender) continue;

        const model = this.models.get(h.path);
        if (model === undefined) {
          void this.load(h.path).then(() => this.kick());
          this.drawPlaceholder(h);
          continue;
        }
        if (model === 'error' || !r) {
          this.drawPlaceholder(h);
          h.needsRender = false;
          continue;
        }
        // Swap the shared root's child to this handle's model.
        if (this.current !== model) {
          if (this.current) this.root.remove(this.current);
          this.root.add(model);
          this.current = model;
        }
        this.applyOverrides(model, h.opts);
        // Pose per mode.
        if (h.mode === 'turntable') {
          h.angle += 0.012;
          model.rotation.set(0, h.angle, 0);
          anyContinuous = true;
        } else if (h.mode === 'bounce') {
          h.phase = t * 0.004;
          model.rotation.set(0, 0.5, 0);
          anyContinuous = true;
        } else {
          model.rotation.set(0, 0.6, 0);
        }
        const bob = h.mode === 'bounce' ? Math.sin(h.phase) * 0.18 : 0;
        this.root.position.setY(bob);
        r.render(this.scene, this.camera);
        this.blit(h, r.domElement);
        this.root.position.setY(0);
        if (!continuous) h.needsRender = false;
      }
      if (anyContinuous) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Wake the loop (after async load resolves or a handle becomes visible). */
  private kick(): void {
    this.ensureLoop();
  }

  private blit(h: Handle, src: HTMLCanvasElement): void {
    const ctx = h.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, h.canvas.width, h.canvas.height);
    ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, h.canvas.width, h.canvas.height);
  }

  /** Attach a live thumbnail to a canvas element. */
  attach(canvas: HTMLCanvasElement, path: string, mode: ThumbMode, opts: ThumbOpts = {}): ThumbHandle {
    // Size the backing store (capped) from CSS size × DPR.
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.max(1, Math.min(MAX, Math.round((rect.width || 96) * dpr)));
    canvas.width = px;
    canvas.height = px;
    const h: Handle = {
      canvas,
      ctx: canvas.getContext('2d'),
      path,
      mode,
      opts,
      visible: mode === 'static',
      angle: 0,
      phase: 0,
      needsRender: true,
      dead: false,
    };
    this.handles.add(h);
    this.kick();
    const handle: ThumbHandle = {
      setVisible: (v) => {
        h.visible = v;
        if (v) {
          h.needsRender = true;
          this.kick();
        }
      },
      setModel: (p, o) => {
        h.path = p;
        h.opts = o ?? {};
        h.needsRender = true;
        this.kick();
      },
      invalidate: () => {
        h.needsRender = true;
        this.kick();
      },
      dispose: () => {
        h.dead = true;
        this.handles.delete(h);
      },
    };
    return handle;
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.handles.clear();
    this.renderer?.dispose();
  }
}
