/**
 * Rendering + fixed-timestep loop. Owns the WebGLRenderer on #game-canvas,
 * warm cozy lighting (hemisphere + one directional, NO shadow maps — entities
 * carry procedural blob shadows), a ~50°-pitch follow camera, and pause/resume
 * on visibilitychange + adapter.onPause/onResume.
 *
 * Sim runs at a fixed 60 Hz regardless of display refresh; rendering happens
 * every rAF with the latest sim state (interpolation intentionally skipped —
 * movement speeds are gentle enough that it reads smooth).
 */
import * as THREE from 'three';
import type { GameContext } from './GameContext';
import type { SaveSystem } from './SaveSystem';
import type { EconomySystem } from '../systems/EconomySystem';
import type { HerdingSystem } from '../systems/HerdingSystem';
import type { HungerSystem } from '../systems/HungerSystem';
import type { SpawnSystem } from '../systems/SpawnSystem';
import type { AdEventSystem } from '../systems/AdEventSystem';
import type { BuildSystem } from '../systems/BuildSystem';
import type { InteractionSystem } from '../systems/InteractionSystem';
import type { ProgressionSystem } from '../systems/ProgressionSystem';

const FIXED_DT = 1 / 60;
const MAX_ACCUM = 0.25; // avoid spiral-of-death after tab stalls

const SKY = 0xe9c9a3;
const FOG_COLOR = 0xe6cfa9;

export interface GameSystems {
  economy: EconomySystem;
  herding: HerdingSystem;
  hunger: HungerSystem;
  spawner: SpawnSystem;
  adEvents: AdEventSystem;
  build: BuildSystem;
  interaction: InteractionSystem;
  progression: ProgressionSystem;
  save: SaveSystem;
}

/** Create the renderer/scene/camera trio before the GameContext exists. */
export function createRenderContext(): {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
} {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const renderer = new THREE.WebGLRenderer({
    canvas: canvas ?? undefined,
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(FOG_COLOR, 38, 85);

  // golden-hour cozy lighting — warm key light, cool ambient shadow fill, low contrast
  const hemi = new THREE.HemisphereLight(0xffe9c9, 0x7391a8, 1.15);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xbcd4ff, 0.35);
  fill.position.set(-10, 12, -10);
  scene.add(fill);
  const sun = new THREE.DirectionalLight(0xffb87a, 1.0);
  sun.position.set(20, 12, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 34;
  sun.shadow.camera.bottom = -34;
  sun.shadow.bias = -0.0015;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  );
  return { renderer, scene, camera };
}

export class Game {
  private accum = 0;
  private lastTime = 0;
  private running = false;
  private pausedByAdapter = false;
  private pausedByVisibility = false;
  private wasPaused = false;
  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  /** camera offset ≈ 50° pitch, top-down third person */
  private camOffset = new THREE.Vector3(0, 15, 12);
  private firstFollow = true;

  constructor(
    private ctx: GameContext,
    private systems: GameSystems,
  ) {
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', () => {
      this.pausedByVisibility = document.visibilityState === 'hidden';
      this.applyPause();
    });
    ctx.adapter.onPause(() => {
      this.pausedByAdapter = true;
      this.applyPause();
    });
    ctx.adapter.onResume(() => {
      this.pausedByAdapter = false;
      this.applyPause();
    });

    // action input: E key (core-side) + UI action button via bus
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key.toLowerCase() === 'e') this.ctx.actionHeld = true;
      // R releases the follower chain back to the wild
      if (e.key.toLowerCase() === 'r') this.systems.herding.releaseAll();
    });
    window.addEventListener('keyup', (e) => {
      if (e.key.toLowerCase() === 'e') this.ctx.actionHeld = false;
    });
    ctx.bus.on('ui:actionPressed', () => (this.ctx.actionHeld = true));
    ctx.bus.on('ui:actionReleased', () => (this.ctx.actionHeld = false));
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.ctx.renderer.setSize(w, h);
    this.ctx.camera.aspect = w / h;
    this.ctx.camera.updateProjectionMatrix();
  };

  private applyPause(): void {
    const paused = this.pausedByAdapter || this.pausedByVisibility;
    if (paused === this.wasPaused) return;
    this.wasPaused = paused;
    this.ctx.paused = paused;
    if (paused) {
      this.ctx.bus.emit('game:pause', {});
      void this.systems.save.saveNow();
    } else {
      this.lastTime = performance.now(); // don't integrate the away time
      this.ctx.bus.emit('game:resume', {});
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (t: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);

    const dt = Math.min((t - this.lastTime) / 1000, MAX_ACCUM);
    this.lastTime = t;

    if (!this.ctx.paused) {
      this.accum = Math.min(this.accum + dt, MAX_ACCUM);
      while (this.accum >= FIXED_DT) {
        this.accum -= FIXED_DT;
        this.step(FIXED_DT);
      }
      this.ctx.fx.update(dt);
    }

    this.followCamera(dt);
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
  };

  /** One fixed sim step. Order matters: input → entities → systems → save. */
  private step(dt: number): void {
    const ctx = this.ctx;
    ctx.now += dt;

    ctx.player.update(dt, ctx.joystick, ctx.hash);

    for (const animal of ctx.animals) animal.update(dt, ctx);
    for (const node of ctx.resourceNodes) node.update(ctx.now);

    const s = this.systems;
    s.herding.update(dt);
    s.interaction.update(dt);
    s.hunger.update(dt);
    s.economy.update(dt);
    s.spawner.update(dt);
    s.adEvents.update(dt);
    s.progression.update();
    s.build.update();
    s.save.update(dt);
  }

  private followCamera(dt: number): void {
    this.camTarget.set(this.ctx.player.x, 0, this.ctx.player.z);
    this.camPos.copy(this.camTarget).add(this.camOffset);
    if (this.firstFollow) {
      this.firstFollow = false;
      this.ctx.camera.position.copy(this.camPos);
    } else {
      // frame-rate independent exponential lerp
      const k = 1 - Math.exp(-4 * dt);
      this.ctx.camera.position.lerp(this.camPos, k);
    }
    this.ctx.camera.lookAt(
      this.ctx.camera.position.x - this.camOffset.x,
      0.8,
      this.ctx.camera.position.z - this.camOffset.z,
    );
  }
}
