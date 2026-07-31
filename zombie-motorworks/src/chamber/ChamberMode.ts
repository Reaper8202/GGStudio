/**
 * Test chamber: Rapier world with selectable scenarios, the runtime vehicle,
 * zombies, HUD, and a chase camera. The blueprint is cloned on entry and
 * never mutated — returning to the editor restores the saved design.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleBlueprint } from '../core/types.ts';
import { getPartDef } from '../core/parts.ts';
import { deriveConnections } from '../core/structural.ts';
import {
  RuntimeVehicle,
  brakeInputWithAutoHold,
  type VehicleControls,
} from '../runtime/vehicle.ts';
import {
  lowestPointM,
  GROUP_TERRAIN,
  GROUP_ZOMBIE,
} from '../runtime/assembler.ts';
import type { SurfaceKind } from '../core/surfaces.ts';
import {
  NEUTRAL_ENVIRONMENT,
  type BiomeId,
  type EnvironmentModifiers,
} from '../core/biomes.ts';
import { getBiome } from '../survival/arena/recipes/index.ts';
import { applyWeaponAim, buildPartMesh } from '../editor/meshes.ts';
import { wheelVisualCentre } from '../runtime/wheels.ts';
import { ScopeCursor } from '../ui/ScopeCursor.ts';
import type { TracerShot } from '../runtime/weapons.ts';
import { VfxSystem } from '../vfx/VfxSystem.ts';
import {
  impactKindForShot,
  muzzleStyleForShot,
  tracerStyleForShot,
} from '../vfx/shotVfx.ts';
import { VFX_PALETTE } from '../vfx/vfxConfig.ts';
import {
  playImpactSfx,
  playExplosionSfx,
  playSfx,
  playVehicleDamageSfx,
  playWeaponSfx,
  syncDriveSfx,
  stopDriveSfx,
  unlockAudio,
} from '../app/sfx.ts';

export type ScenarioName =
  | 'flat'
  | 'ramp'
  | 'side-slope'
  | 'bumps'
  | 'zombies'
  | 'drop'
  | 'snow'
  | 'sand';

const TERRAIN_GROUPS = (GROUP_TERRAIN << 16) | 0xffff;
const ZOMBIE_GROUPS = (GROUP_ZOMBIE << 16) | 0xffff;
const FIXED_DT = 1 / 60;
/** Chamber dummies are plain boxes; their gibs borrow the walker body green. */
const CHAMBER_ZOMBIE_TINT = 0x4c6b3f;

interface Zombie {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  health: number;
  alive: boolean;
}

export class ChamberMode {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private world!: RAPIER.World;
  private eventQueue!: RAPIER.EventQueue;
  private vehicle!: RuntimeVehicle;
  private vehicleGroup = new THREE.Group();
  private wheelMeshes = new Map<string, THREE.Group>();
  private islandGroups = new Map<number, THREE.Group>();
  private surfaceByCollider = new Map<number, SurfaceKind>();
  private zombies: Zombie[] = [];
  /** Recreated with the world: `resetWorld` clears and disposes the whole scene. */
  private vfx!: VfxSystem;
  private tracers: { line: THREE.Line; ttl: number }[] = [];
  private scenario: ScenarioName = 'flat';
  /**
   * Biome whose handling a scenario is standing in for. A biome is more than
   * its ground: snow only drifts because the biome also relaxes the
   * anti-sideslip assist. Replicating the surface alone would let the player
   * tune a rig here that behaves differently in the real run.
   */
  private static readonly SCENARIO_BIOME: Partial<
    Record<ScenarioName, BiomeId>
  > = {
    snow: 'snowfield',
    sand: 'desert',
  };
  // The test chamber has no zombies and so no auto-aim: the player's own aim
  // is the only aim there is, and the guns follow it at full slew rate.
  private controls: VehicleControls = {
    throttle: 0,
    brake: 0,
    steer: 0,
    fire: false,
    aimYawWorld: 0,
    manualAim: true,
  };
  private keys = new Set<string>();
  private accumulator = 0;
  private lastTime = performance.now();
  private debugPaused = false;
  private hud!: HTMLDivElement;
  private banner!: HTMLDivElement;
  private failTimers = { flipped: 0, noTraction: 0, airborne: 0 };
  private ui!: HTMLDivElement;
  private scopeCursor!: ScopeCursor;
  private disposed = false;
  private lastVehicleHealth = -1;
  private readonly onUiButtonClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    unlockAudio();
    playSfx('uiClick');
  };
  private readonly keydown = (e: KeyboardEvent) => {
    unlockAudio();
    this.keys.add(e.key.toLowerCase());
    if (e.key.toLowerCase() === 'f') this.controls.fire = true;
  };
  private readonly keyup = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
    if (e.key.toLowerCase() === 'f') this.controls.fire = false;
  };

  constructor(
    private readonly container: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly bp: VehicleBlueprint,
    private readonly onBackToEditor: () => void,
  ) {
    this.scene.background = new THREE.Color(0x22303f);
    this.scene.fog = new THREE.Fog(0x22303f, 60, 140);
    this.scene.add(new THREE.HemisphereLight(0xd8e2f0, 0x33291f, 1.0));
    const dir = new THREE.DirectionalLight(0xfff2dd, 1.6);
    dir.position.set(20, 30, 10);
    this.scene.add(dir);
    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      300,
    );
    this.buildUI();
    this.resetWorld();
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
  }

  // ---------- world/scenario ----------

  private resetWorld(): void {
    this.lastVehicleHealth = -1;
    if (this.eventQueue) this.eventQueue.free();
    if (this.world) this.world.free();
    // Detach the VFX layers before the sweep so their pooled geometry and
    // materials are disposed once, by their owner.
    this.vfx?.dispose();
    disposeSceneAssets(this.scene);
    this.tracers.length = 0;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.eventQueue = new RAPIER.EventQueue(true);
    this.surfaceByCollider.clear();
    this.zombies = [];
    this.islandGroups.clear();
    this.scene.clear();
    this.scene.background = new THREE.Color(0x22303f);
    this.scene.fog = new THREE.Fog(0x22303f, 60, 140);
    this.scene.add(new THREE.HemisphereLight(0xd8e2f0, 0x33291f, 1.0));
    const dir = new THREE.DirectionalLight(0xfff2dd, 1.6);
    dir.position.set(20, 30, 10);
    this.scene.add(dir);

    this.vfx = new VfxSystem(this.scene);
    this.buildTerrain();
    this.spawnVehicle();
  }

  private ground(
    x: number,
    y: number,
    z: number,
    hx: number,
    hy: number,
    hz: number,
    surface: SurfaceKind,
    color: number,
    rotZ = 0,
    rotX = 0,
  ): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z),
    );
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotX, 0, rotZ),
    );
    body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, false);
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setFriction(0.9)
        .setCollisionGroups(TERRAIN_GROUPS),
      body,
    );
    this.surfaceByCollider.set(col.handle, surface);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2),
      new THREE.MeshLambertMaterial({ color }),
    );
    mesh.position.set(x, y, z);
    mesh.quaternion.copy(q);
    this.scene.add(mesh);
  }

  private buildTerrain(): void {
    // Base asphalt pad for every scenario.
    this.ground(0, -0.5, 0, 60, 0.5, 60, 'asphalt', 0x3c4148);

    switch (this.scenario) {
      case 'flat':
        // Mud and dirt strips for traction comparison.
        this.ground(0, -0.49, 18, 8, 0.52, 6, 'mud', 0x4a3d2a);
        this.ground(0, -0.49, 32, 8, 0.52, 6, 'dirt', 0x5a4d36);
        break;
      case 'ramp': {
        const angle = (18 * Math.PI) / 180;
        this.ground(0, 1.2, 22, 5, 0.3, 12, 'asphalt', 0x4a5058, 0, -angle);
        const angle2 = (30 * Math.PI) / 180;
        this.ground(14, 2.0, 22, 5, 0.3, 12, 'dirt', 0x5a4d36, 0, -angle2);
        break;
      }
      case 'side-slope': {
        const angle = (16 * Math.PI) / 180;
        this.ground(0, 0.8, 25, 14, 0.3, 14, 'dirt', 0x5a4d36, angle, 0);
        break;
      }
      case 'bumps':
        for (let i = 0; i < 10; i++) {
          this.ground(
            ((i % 2) * 2 - 1) * 1.2,
            0.06,
            8 + i * 3.2,
            3.4,
            0.09 + (i % 3) * 0.05,
            0.5,
            'rubble',
            0x555a61,
          );
        }
        break;
      case 'zombies':
        for (let i = 0; i < 14; i++) {
          this.spawnZombie(
            (Math.random() - 0.5) * 20,
            10 + i * 2.5 + Math.random() * 2,
          );
        }
        this.ground(6, 0.4, 20, 1.5, 0.4, 1.5, 'asphalt', 0x6b4a3a); // obstacle block
        this.ground(-6, 0.4, 28, 1.5, 0.4, 1.5, 'asphalt', 0x6b4a3a);
        break;
      case 'drop':
        this.ground(0, 3.2, 14, 6, 0.3, 10, 'asphalt', 0x4a5058);
        break;
      // The contrasting surface sits beside the centre lane, not across it, so
      // a straight run stays on one surface and hitting the ice or the firm
      // lane is a choice the player steers into.
      case 'snow':
        this.ground(0, -0.49, 22, 20, 0.52, 38, 'snow', 0xdce8f7);
        this.ground(-12, -0.485, 26, 5, 0.525, 24, 'ice', 0x9fc7e8);
        this.ground(12, -0.485, 26, 5, 0.525, 24, 'ice', 0x9fc7e8);
        break;
      case 'sand':
        this.ground(0, -0.49, 22, 20, 0.52, 38, 'sand', 0xc4a575);
        this.ground(-12, -0.485, 26, 5, 0.525, 24, 'hardpan', 0x7d6a52);
        this.ground(12, -0.485, 26, 5, 0.525, 24, 'hardpan', 0x7d6a52);
        break;
    }
  }

  private spawnZombie(x: number, z: number): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.8, z).lockRotations(),
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.4, 0.28)
        .setMass(70)
        .setFriction(0.8)
        .setCollisionGroups(ZOMBIE_GROUPS),
      body,
    );
    void col;
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.8, 4, 8),
      new THREE.MeshLambertMaterial({ color: 0x5d8a4a }),
    );
    this.scene.add(mesh);
    this.zombies.push({ body, mesh, health: 25, alive: true });
  }

  private spawnVehicle(): void {
    // Deep clone: runtime must never touch the editor blueprint.
    const clone = JSON.parse(JSON.stringify(this.bp)) as VehicleBlueprint;
    const connections = deriveConnections(clone, getPartDef);
    const yLow = lowestPointM(clone, getPartDef);
    const spawnY = this.scenario === 'drop' ? 6.5 : -yLow + 0.32;
    this.vehicle = new RuntimeVehicle(
      this.world,
      clone,
      getPartDef,
      connections,
      {
        translation: { x: 0, y: spawnY, z: this.scenario === 'drop' ? 14 : 0 },
      },
    );

    this.vehicleGroup = new THREE.Group();
    this.wheelMeshes.clear();
    for (const [id, part] of this.vehicle.assembled.parts) {
      const mesh = buildPartMesh(part.def, part.placed);
      if (part.def.wheel) {
        // Wheels are positioned per-frame in world space (suspension travel).
        const spin = mesh.getObjectByName('wheel-spin');
        if (spin) spin.userData.baseQuat = spin.quaternion.clone();
        // Outer group is placed at the wheel centre, so every child sits on
        // the origin — a tread's static belt as well as its spinning rollers.
        for (const child of mesh.children) child.position.set(0, 0, 0);
        this.wheelMeshes.set(id, mesh);
        this.scene.add(mesh);
      } else {
        mesh.name = `part:${id}`;
        this.vehicleGroup.add(mesh);
      }
    }
    this.scene.add(this.vehicleGroup);
    this.camera.position.set(0, 3, -7);
  }

  // ---------- UI ----------

  private buildUI(): void {
    this.ui = document.createElement('div');
    this.ui.className = 'ui-layer';
    this.container.appendChild(this.ui);
    this.ui.addEventListener('click', this.onUiButtonClick, true);

    const top = document.createElement('div');
    top.className = 'topbar';
    this.ui.appendChild(top);

    const back = document.createElement('button');
    back.textContent = '← Back to editor';
    back.className = 'primary';
    back.addEventListener('click', () => this.onBackToEditor());
    top.appendChild(back);

    const reset = document.createElement('button');
    reset.textContent = 'Reset vehicle';
    reset.addEventListener('click', () => this.reset());
    top.appendChild(reset);

    for (const s of [
      'flat',
      'ramp',
      'side-slope',
      'bumps',
      'zombies',
      'drop',
      'snow',
      'sand',
    ] as ScenarioName[]) {
      const b = document.createElement('button');
      b.textContent = s;
      b.classList.toggle('active', s === this.scenario);
      b.addEventListener('click', () => {
        this.scenario = s;
        for (const child of top.querySelectorAll('button'))
          child.classList.remove('active');
        b.classList.add('active');
        this.reset();
      });
      top.appendChild(b);
    }

    this.hud = document.createElement('div');
    this.hud.className = 'panel';
    this.hud.style.position = 'absolute';
    this.hud.style.left = '8px';
    this.hud.style.bottom = '8px';
    this.hud.style.minWidth = '210px';
    this.ui.appendChild(this.hud);

    const help = document.createElement('div');
    help.className = 'hud-note';
    help.textContent =
      'W throttle · S brake/reverse · A/D steer · Space brake · F or click: fire · mouse: aim';
    this.ui.appendChild(help);

    this.banner = document.createElement('div');
    this.banner.className = 'panel';
    this.banner.style.cssText =
      'position:absolute;left:50%;top:38%;transform:translateX(-50%);font-size:20px;font-weight:700;color:#ffb44d;display:none;padding:10px 18px';
    this.ui.appendChild(this.banner);

    this.renderer.domElement.addEventListener('pointermove', this.onAim);
    this.renderer.domElement.addEventListener('pointerdown', this.onFireDown);
    this.renderer.domElement.addEventListener('pointerup', this.onFireUp);

    this.scopeCursor = new ScopeCursor(this.ui, this.renderer.domElement);
  }

  private onAim = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    // Aim yaw relative to camera heading.
    const camYaw = Math.atan2(
      this.camera.getWorldDirection(new THREE.Vector3()).x,
      this.camera.getWorldDirection(new THREE.Vector3()).z,
    );
    this.controls.aimYawWorld = camYaw - nx * 1.2;
  };

  private onFireDown = (): void => {
    unlockAudio();
    this.controls.fire = true;
  };

  private onFireUp = (): void => {
    this.controls.fire = false;
  };

  reset(): void {
    this.vehicle?.dispose();
    for (const m of this.wheelMeshes.values()) this.scene.remove(m);
    this.resetWorld();
  }

  // ---------- loop ----------

  update(): void {
    if (this.disposed) return;
    const now = performance.now();
    let frameDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (this.debugPaused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    frameDt = Math.min(frameDt, 0.1);
    this.accumulator += frameDt;

    while (this.accumulator >= FIXED_DT) {
      this.accumulator -= FIXED_DT;
      this.stepPhysics();
    }
    this.syncView(frameDt);
    this.vfx.setViewpoint(this.camera.position);
    this.vfx.update(frameDt);
    this.renderer.render(this.scene, this.camera);
  }

  private stepPhysics(): void {
    // Controls from keys.
    const k = this.keys;
    const fwd = k.has('w') || k.has('arrowup') ? 1 : 0;
    const rev = k.has('s') || k.has('arrowdown') ? 1 : 0;
    // S brakes while rolling forward, reverses once (near-)stopped.
    const forwardSpeed = this.vehicle.forwardSpeed();
    const movingForward = forwardSpeed > 0.6;
    this.controls.throttle = fwd;
    this.controls.reverse = rev && !fwd && !movingForward ? 1 : 0;
    this.controls.brake = k.has(' ') ? 1 : rev && movingForward ? 1 : 0;
    this.controls.brake = brakeInputWithAutoHold(this.controls, forwardSpeed);
    this.controls.steer =
      (k.has('a') || k.has('arrowleft') ? -1 : 0) +
      (k.has('d') || k.has('arrowright') ? 1 : 0);

    this.vehicle.preStep(
      FIXED_DT,
      this.controls,
      (h) => this.surfaceByCollider.get(h) ?? 'asphalt',
      this.scenarioEnvironment(),
    );
    const driveTelemetry = this.vehicle.telemetry();
    syncDriveSfx({
      rpm: driveTelemetry.rpm,
      speedKmh: driveTelemetry.speedKmh,
      throttle: this.controls.throttle,
      groundedWheels: driveTelemetry.groundedWheels,
      wheelSlip: driveTelemetry.wheelSlip,
    });
    this.stepZombies();
    this.world.step(this.eventQueue);
    this.vehicle.postStepStability(FIXED_DT);

    // Damage from contact forces on vehicle colliders.
    this.eventQueue.drainContactForceEvents((ev) => {
      const f = ev.totalForceMagnitude();
      playImpactSfx(f);
      this.vehicle.onContactForce(ev.collider1(), f);
      this.vehicle.onContactForce(ev.collider2(), f);
    });
    const newIslands = this.vehicle.finishStep();
    if (newIslands.length > 0) playSfx('partBreak');
    this.trackDamageTaken();
    for (const isle of newIslands) {
      // Re-parent detached part meshes to an island group synced to its body.
      const group = new THREE.Group();
      for (const partId of isle.partIds) {
        const mesh = this.vehicleGroup.getObjectByName(`part:${partId}`);
        if (mesh) {
          this.vehicleGroup.remove(mesh);
          group.add(mesh);
        }
        const wheelMesh = this.wheelMeshes.get(partId);
        if (wheelMesh) {
          // Freeze detached wheels into the island group (local frame matches).
          this.wheelMeshes.delete(partId);
          this.scene.remove(wheelMesh);
          group.add(wheelMesh);
        }
      }
      this.islandGroups.set(isle.body.handle, group);
      this.scene.add(group);
    }

    // Weapon hits on zombies.
    for (const shot of this.vehicle.telemetry().shotsThisStep) {
      // Flame-volume burns carry damage only; the cone's own jets already drew
      // the fire that produced them.
      if (!shot.damageOnly) {
        playWeaponSfx(shot.weaponDefId, { overcharged: shot.overcharged });
        this.emitShotVfx(shot);
      }
      if (shot.hitZombieHandle === null) continue;
      for (const z of this.zombies) {
        if (!z.alive) continue;
        for (let i = 0; i < z.body.numColliders(); i++) {
          if (z.body.collider(i).handle === shot.hitZombieHandle) {
            z.health -= 12;
            if (z.health <= 0) {
              z.alive = false;
              const p = z.body.translation();
              this.vfx.zombieGib(p.x, p.y, p.z, CHAMBER_ZOMBIE_TINT);
            }
          }
        }
      }
    }
  }

  private trackDamageTaken(): void {
    let health = 0;
    for (const part of this.vehicle.assembled.parts.values()) {
      if (!part.alive || part.detached) continue;
      health += Math.max(0, part.health);
    }
    if (this.lastVehicleHealth >= 0 && health < this.lastVehicleHealth) {
      playVehicleDamageSfx(this.lastVehicleHealth - health);
    }
    this.lastVehicleHealth = health;
  }

  /**
   * Same gun feedback the graveyard plays, so a weapon looks in the test
   * chamber exactly as it will in a wave. Chamber dummies are never shielded.
   */
  private emitShotVfx(shot: TracerShot): void {
    this.vfx.muzzleFlash(shot.from, shot.to, muzzleStyleForShot(shot));
    if (shot.damageType === 'aoe') {
      this.vfx.flameJet(shot.from, shot.to, shot.overcharged);
    }
    // Explosive shells detonate here too. The chamber has no splash damage
    // model, but the blast has to look identical to the graveyard or the test
    // drive misrepresents the weapon.
    if (shot.splashRadiusM > 0) {
      this.vfx.shellBurst(shot.to.x, shot.to.y, shot.to.z, shot.splashRadiusM);
      playExplosionSfx({ gain: 0.3, playbackRate: 0.92 });
    }
    const impact = impactKindForShot(shot, false);
    if (impact === null) return;
    let dirX = shot.to.x - shot.from.x;
    let dirY = shot.to.y - shot.from.y;
    let dirZ = shot.to.z - shot.from.z;
    const length = Math.hypot(dirX, dirY, dirZ) || 1;
    dirX /= length;
    dirY /= length;
    dirZ /= length;
    this.vfx.bulletImpact(
      shot.to.x,
      shot.to.y,
      shot.to.z,
      dirX,
      dirY,
      dirZ,
      impact,
    );
  }

  private stepZombies(): void {
    const vp = this.vehicle.body.translation();
    for (const z of this.zombies) {
      if (!z.alive) {
        if (z.mesh.parent) {
          this.world.removeRigidBody(z.body);
          this.scene.remove(z.mesh);
        }
        continue;
      }
      const zp = z.body.translation();
      const dx = vp.x - zp.x;
      const dz = vp.z - zp.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.5) {
        const speed = 1.6;
        const v = z.body.linvel();
        z.body.setLinvel(
          { x: (dx / d) * speed, y: v.y, z: (dz / d) * speed },
          true,
        );
      }
    }
  }

  private syncView(frameDt: number): void {
    // Vehicle body meshes.
    const pos = this.vehicle.body.translation();
    const rot = this.vehicle.body.rotation();
    this.vehicleGroup.position.set(pos.x, pos.y, pos.z);
    this.vehicleGroup.quaternion.set(rot.x, rot.y, rot.z, rot.w);

    // Hide destroyed parts.
    for (const [id, part] of this.vehicle.assembled.parts) {
      if (!part.alive) {
        const mesh = this.vehicleGroup.getObjectByName(`part:${id}`);
        if (mesh) mesh.visible = false;
        const wm = this.wheelMeshes.get(id);
        if (wm) wm.visible = false;
      }
    }

    // Turn each gun to where it is actually shooting.
    for (const weapon of this.vehicle.weaponStates()) {
      const mesh = this.vehicleGroup.getObjectByName(`part:${weapon.partId}`);
      if (mesh)
        applyWeaponAim(mesh, weapon.forwardLocal, weapon.yaw, weapon.pitch);
    }

    // Wheels: world-space position with suspension travel + spin.
    for (const w of this.vehicle.wheels()) {
      const mesh = this.wheelMeshes.get(w.partId);
      if (!mesh || w.broken) continue;
      const c = wheelVisualCentre(this.vehicle.body, w);
      mesh.position.set(c.x, c.y, c.z);
      // Body orientation, then steer yaw, then spin around the axle.
      mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      const state = w as unknown as { visualSpin?: number };
      state.visualSpin = (state.visualSpin ?? 0) + w.omega * frameDt;
      const spin = mesh.getObjectByName('wheel-spin');
      const baseQuat = spin?.userData.baseQuat as THREE.Quaternion | undefined;
      if (spin && baseQuat) {
        const steerQ = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          -w.steerAngle,
        );
        spin.quaternion.copy(steerQ).multiply(baseQuat);
        spin.rotateY(state.visualSpin ?? 0); // local Y = cylinder axis = axle
      }
    }

    // Island groups follow their bodies.
    for (const [handle, group] of this.islandGroups) {
      const body = this.world.getRigidBody(handle);
      if (!body) continue;
      const p = body.translation();
      const q = body.rotation();
      group.position.set(p.x, p.y, p.z);
      group.quaternion.set(q.x, q.y, q.z, q.w);
    }

    // Zombies.
    for (const z of this.zombies) {
      if (!z.alive) continue;
      const p = z.body.translation();
      z.mesh.position.set(p.x, p.y, p.z);
    }

    // Tracers.
    for (const shot of this.vehicle.telemetry().shotsThisStep) {
      if (shot.damageOnly) continue;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(shot.from.x, shot.from.y, shot.from.z),
        new THREE.Vector3(shot.to.x, shot.to.y, shot.to.z),
      ]);
      // Cryo fire draws turquoise, matching survival's Ice Cannon ray.
      const color =
        tracerStyleForShot(shot) === 'ice' ? VFX_PALETTE.ice : 0xffd76e;
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
      this.scene.add(line);
      this.tracers.push({ line, ttl: 0.08 });
    }
    this.tracers = this.tracers.filter((t) => {
      t.ttl -= frameDt;
      if (t.ttl <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        if (Array.isArray(t.line.material)) {
          for (const material of t.line.material) material.dispose();
        } else {
          t.line.material.dispose();
        }
        return false;
      }
      return true;
    });

    // Chase camera.
    const bodyQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const behind = new THREE.Vector3(0, 2.6, -6.5).applyQuaternion(bodyQuat);
    const target = new THREE.Vector3(pos.x, pos.y, pos.z);
    const desired = target.clone().add(behind);
    desired.y = Math.max(desired.y, 1.2);
    this.camera.position.lerp(desired, Math.min(1, frameDt * 4));
    this.camera.lookAt(target);

    // Failure banners: name the failure the physics just produced.
    const tf = this.vehicle.telemetry();
    const uy = 1 - 2 * (rot.x * rot.x + rot.z * rot.z);
    const throttleOn = this.keys.has('w') || this.keys.has('arrowup');
    this.failTimers.flipped = uy < 0.15 ? this.failTimers.flipped + frameDt : 0;
    this.failTimers.noTraction =
      throttleOn && tf.speedKmh < 2 && tf.rpm > 1800 && tf.groundedWheels > 0
        ? this.failTimers.noTraction + frameDt
        : 0;
    this.failTimers.airborne =
      throttleOn && tf.groundedWheels === 0 && uy > 0.5
        ? this.failTimers.airborne + frameDt
        : 0;
    let bannerText = '';
    if (this.failTimers.flipped > 0.6)
      bannerText = 'VEHICLE FLIPPED — press Reset';
    else if (tf.fuelCapacity > 0 && tf.fuel <= 0) bannerText = 'OUT OF FUEL';
    else if (this.failTimers.noTraction > 1.2)
      bannerText = 'WHEELS SPINNING — no traction';
    else if (this.failTimers.airborne > 0.8)
      bannerText = 'WHEELS OFF THE GROUND';
    this.banner.textContent = bannerText;
    this.banner.style.display = bannerText ? 'block' : 'none';

    // HUD.
    const t = this.vehicle.telemetry();
    this.hud.innerHTML = [
      `<div class="stat-row"><span>Speed</span><span>${t.speedKmh.toFixed(0)} km/h</span></div>`,
      `<div class="stat-row"><span>RPM</span><span>${t.rpm.toFixed(0)} (gear ${t.gear + 1})</span></div>`,
      `<div class="stat-row"><span>Fuel</span><span>${t.fuel.toFixed(1)} / ${t.fuelCapacity.toFixed(0)} L</span></div>`,
      `<div class="stat-row"><span>Wheels grounded</span><span>${t.groundedWheels}/${t.totalWheels}</span></div>`,
      `<div class="stat-row"><span>Parts</span><span>${t.aliveParts} alive · ${t.detachedParts} lost</span></div>`,
      t.overloadedWheels.length > 0
        ? `<div class="issue-warning">Wheel load exceeded</div>`
        : '',
    ].join('');
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    stopDriveSfx();
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    this.renderer.domElement.removeEventListener('pointermove', this.onAim);
    this.renderer.domElement.removeEventListener(
      'pointerdown',
      this.onFireDown,
    );
    this.renderer.domElement.removeEventListener('pointerup', this.onFireUp);
    this.ui.removeEventListener('click', this.onUiButtonClick, true);
    this.scopeCursor.dispose();
    this.vfx?.dispose();
    this.vehicle?.dispose();
    this.eventQueue?.free();
    this.world?.free();
    disposeSceneAssets(this.scene);
    this.scene.clear();
    this.tracers.length = 0;
    this.wheelMeshes.clear();
    this.islandGroups.clear();
    this.ui.remove();
  }

  /** Debug seam. */
  debugSetSimPaused(paused: boolean): void {
    this.debugPaused = paused;
    this.accumulator = 0;
    this.lastTime = performance.now();
  }

  debugStepSim(steps: number): void {
    if (this.disposed) return;
    const count = Math.max(0, Math.floor(Number.isFinite(steps) ? steps : 0));
    for (let i = 0; i < count; i++) this.stepPhysics();
    this.syncView(count * FIXED_DT);
    this.renderer.render(this.scene, this.camera);
  }

  debugSetControls(c: Partial<VehicleControls>): void {
    Object.assign(this.controls, c);
    if (c.throttle !== undefined && c.throttle > 0) this.keys.add('w');
    if (c.throttle === 0) this.keys.delete('w');
    if (c.steer !== undefined) {
      this.keys.delete('a');
      this.keys.delete('d');
      if (c.steer < 0) this.keys.add('a');
      if (c.steer > 0) this.keys.add('d');
    }
    if (c.brake !== undefined) {
      if (c.brake > 0) this.keys.add(' ');
      else this.keys.delete(' ');
    }
    if (c.reverse !== undefined) {
      if (c.reverse > 0) this.keys.add('s');
      else this.keys.delete('s');
    }
  }

  debugTelemetry(): Record<string, unknown> {
    const p = this.vehicle.body.translation();
    const r = this.vehicle.body.rotation();
    const av = this.vehicle.body.angvel();
    return {
      ...this.vehicle.telemetry(),
      shotsThisStep: undefined,
      position: { x: p.x, y: p.y, z: p.z },
      rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
      angvel: { x: av.x, y: av.y, z: av.z },
      scenario: this.scenario,
    };
  }

  /** Base drive modifiers of the biome this scenario stands in for, if any. */
  private scenarioEnvironment(): EnvironmentModifiers {
    const biomeId = ChamberMode.SCENARIO_BIOME[this.scenario];
    return biomeId === undefined
      ? NEUTRAL_ENVIRONMENT
      : getBiome(biomeId).drive;
  }

  debugSetScenario(s: ScenarioName): void {
    this.scenario = s;
    this.reset();
  }
}

function disposeSceneAssets(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line))
      return;
    const renderable = object as THREE.Mesh | THREE.Line;
    geometries.add(renderable.geometry);
    const renderableMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : [renderable.material];
    for (const material of renderableMaterials) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}
