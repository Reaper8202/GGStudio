/**
 * Minimal zombie-survival tracer bullet: a flat Rapier arena, the editor's
 * blueprint vehicle, a continuous zombie trickle, HUD, and chase camera.
 *
 * Vehicle visual synchronisation intentionally mirrors ChamberMode for this
 * phase. Extracting the duplicated mesh/island sync into a shared renderer is
 * deferred until another runtime mode needs it.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleBlueprint } from '../core/types.ts';
import { getPartDef } from '../core/parts.ts';
import { deriveConnections } from '../core/structural.ts';
import { buildPartMesh } from '../editor/meshes.ts';
import { lowestPointM, GROUP_TERRAIN } from '../runtime/assembler.ts';
import type { SurfaceKind } from '../runtime/surfaces.ts';
import { RuntimeVehicle, type VehicleControls } from '../runtime/vehicle.ts';
import type { TracerShot } from '../runtime/weapons.ts';
import { wheelVisualCentre } from '../runtime/wheels.ts';
import { SurvivalZombies } from './SurvivalZombies.ts';

const FIXED_DT = 1 / 60;
const TERRAIN_GROUPS = (GROUP_TERRAIN << 16) | 0xffff;
const GROUND_HALF_SIZE = 500;

export interface SurvivalCallbacks {
  onExit(): void;
  onGameOver(): void;
}

export interface SurvivalTelemetry {
  mode: 'survival';
  kills: number;
  zombiesAlive: number;
  integrityPct: number;
  vehiclePos: [number, number, number];
}

interface TracerVisual {
  line: THREE.Line;
  ttl: number;
}

export class SurvivalMode {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world: RAPIER.World;
  private readonly eventQueue: RAPIER.EventQueue;
  private readonly surfaceByCollider = new Map<number, SurfaceKind>();
  private readonly vehicle: RuntimeVehicle;
  private readonly zombies: SurvivalZombies;
  private readonly vehicleGroup = new THREE.Group();
  private readonly wheelMeshes = new Map<string, THREE.Group>();
  private readonly islandGroups = new Map<number, THREE.Group>();
  private readonly keys = new Set<string>();
  private readonly controls: VehicleControls = {
    throttle: 0,
    brake: 0,
    steer: 0,
    fire: false,
    aimYawWorld: 0,
  };
  private readonly ui: HTMLDivElement;
  private readonly hud: HTMLDivElement;
  private readonly gameOverOverlay: HTMLDivElement;
  private readonly gameOverKills: HTMLDivElement;
  private tracers: TracerVisual[] = [];
  private pendingShots: TracerShot[] = [];
  private accumulator = 0;
  private lastTime = performance.now();
  private kills = 0;
  private gameOver = false;
  private pointerFiring = false;
  private disposed = false;

  private readonly keydown = (event: KeyboardEvent): void => {
    if (this.gameOver) return;
    const key = event.key.toLowerCase();
    this.keys.add(key);
  };

  private readonly keyup = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    this.keys.delete(key);
  };

  private readonly blur = (): void => {
    this.keys.clear();
    this.pointerFiring = false;
    this.controls.fire = false;
  };

  constructor(
    private readonly container: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    bp: VehicleBlueprint,
    private readonly callbacks: SurvivalCallbacks,
  ) {
    this.scene.background = new THREE.Color(0x171b1d);
    this.scene.fog = new THREE.Fog(0x171b1d, 65, 170);
    this.scene.add(new THREE.HemisphereLight(0xc8d3d8, 0x29231d, 1.05));
    const sun = new THREE.DirectionalLight(0xffe4bc, 1.7);
    sun.position.set(24, 34, 16);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      320,
    );
    this.camera.position.set(0, 3, -7);

    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.eventQueue = new RAPIER.EventQueue(true);
    this.buildGround();
    this.vehicle = this.spawnVehicle(bp);
    const vehiclePos = this.vehicle.body.translation();
    this.zombies = new SurvivalZombies(this.world, this.scene, vehiclePos);

    const builtUi = this.buildUI();
    this.ui = builtUi.ui;
    this.hud = builtUi.hud;
    this.gameOverOverlay = builtUi.gameOverOverlay;
    this.gameOverKills = builtUi.gameOverKills;

    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.blur);
    window.addEventListener('pointerup', this.onFireUp);
    window.addEventListener('pointercancel', this.onFireUp);
    this.renderer.domElement.addEventListener('pointermove', this.onAim);
    this.renderer.domElement.addEventListener('pointerdown', this.onFireDown);
  }

  private buildGround(): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(GROUND_HALF_SIZE, 0.5, GROUND_HALF_SIZE)
        .setFriction(0.9)
        .setCollisionGroups(TERRAIN_GROUPS),
      body,
    );
    this.surfaceByCollider.set(collider.handle, 'asphalt');

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(GROUND_HALF_SIZE * 2, 1, GROUND_HALF_SIZE * 2),
      new THREE.MeshLambertMaterial({ color: 0x34393e }),
    );
    mesh.position.set(0, -0.5, 0);
    this.scene.add(mesh);
  }

  private spawnVehicle(bp: VehicleBlueprint): RuntimeVehicle {
    const clone = JSON.parse(JSON.stringify(bp)) as VehicleBlueprint;
    const connections = deriveConnections(clone, getPartDef);
    const spawnY = -lowestPointM(clone, getPartDef) + 0.32;
    const vehicle = new RuntimeVehicle(this.world, clone, getPartDef, connections, {
      translation: { x: 0, y: spawnY, z: 0 },
    });

    for (const [id, part] of vehicle.assembled.parts) {
      const mesh = buildPartMesh(part.def, part.placed);
      if (part.def.wheel) {
        const spin = mesh.getObjectByName('wheel-spin');
        if (spin) {
          spin.userData.baseQuat = spin.quaternion.clone();
          spin.position.set(0, 0, 0);
        }
        this.wheelMeshes.set(id, mesh);
        this.scene.add(mesh);
      } else {
        mesh.name = `part:${id}`;
        this.vehicleGroup.add(mesh);
      }
    }
    this.scene.add(this.vehicleGroup);
    return vehicle;
  }

  private buildUI(): {
    ui: HTMLDivElement;
    hud: HTMLDivElement;
    gameOverOverlay: HTMLDivElement;
    gameOverKills: HTMLDivElement;
  } {
    const ui = document.createElement('div');
    ui.className = 'ui-layer';
    this.container.appendChild(ui);

    const top = document.createElement('div');
    top.className = 'topbar';
    ui.appendChild(top);

    const back = document.createElement('button');
    back.className = 'primary';
    back.textContent = 'Back to Garage';
    back.addEventListener('click', () => this.callbacks.onExit());
    top.appendChild(back);

    const title = document.createElement('div');
    title.className = 'panel';
    title.textContent = 'ZOMBIE SURVIVAL';
    title.style.cssText = 'padding:7px 12px;font-weight:800;letter-spacing:.08em;color:#ffb44d';
    top.appendChild(title);

    const hud = document.createElement('div');
    hud.className = 'panel';
    hud.style.cssText = 'position:absolute;left:8px;bottom:8px;min-width:230px';
    ui.appendChild(hud);

    const help = document.createElement('div');
    help.className = 'hud-note';
    help.textContent = 'W/S drive + brake · A/D steer · Space brake · F or click fire · mouse aim';
    ui.appendChild(help);

    const gameOverOverlay = document.createElement('div');
    gameOverOverlay.className = 'panel';
    gameOverOverlay.style.cssText =
      'display:none;position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);min-width:280px;padding:24px;text-align:center;z-index:20';
    const gameOverTitle = document.createElement('div');
    gameOverTitle.textContent = 'VEHICLE DESTROYED';
    gameOverTitle.style.cssText = 'font-size:24px;font-weight:900;color:#ff7b63;margin-bottom:10px';
    const gameOverKills = document.createElement('div');
    gameOverKills.style.cssText = 'font-size:17px;margin-bottom:16px';
    const returnButton = document.createElement('button');
    returnButton.className = 'primary';
    returnButton.textContent = 'Return to Garage';
    returnButton.addEventListener('click', () => this.callbacks.onGameOver());
    gameOverOverlay.append(gameOverTitle, gameOverKills, returnButton);
    ui.appendChild(gameOverOverlay);

    return { ui, hud, gameOverOverlay, gameOverKills };
  }

  private readonly onAim = (event: PointerEvent): void => {
    if (this.gameOver) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const normalizedX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const cameraDirection = this.camera.getWorldDirection(new THREE.Vector3());
    const cameraYaw = Math.atan2(cameraDirection.x, cameraDirection.z);
    this.controls.aimYawWorld = cameraYaw - normalizedX * 1.2;
  };

  private readonly onFireDown = (event: PointerEvent): void => {
    if (!this.gameOver && event.button === 0) this.pointerFiring = true;
  };

  private readonly onFireUp = (): void => {
    this.pointerFiring = false;
  };

  update(dtMs?: number): void {
    if (this.disposed) return;
    const now = performance.now();
    let frameDt = dtMs === undefined ? (now - this.lastTime) / 1000 : dtMs / 1000;
    this.lastTime = now;
    frameDt = Math.min(Math.max(frameDt, 0), 0.1);
    this.accumulator += frameDt;

    while (this.accumulator >= FIXED_DT) {
      this.accumulator -= FIXED_DT;
      if (!this.gameOver) this.stepPhysics();
    }
    this.syncView(frameDt);
    this.renderer.render(this.scene, this.camera);
  }

  private stepPhysics(): void {
    const forward = this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0;
    const reverse = this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0;
    const movingForward = this.vehicle.telemetry().speedKmh > 2;
    this.controls.throttle = forward;
    this.controls.brake = this.keys.has(' ') ? 1 : reverse && movingForward ? 1 : 0;
    this.controls.steer =
      (this.keys.has('a') || this.keys.has('arrowleft') ? -1 : 0) +
      (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0);
    this.controls.fire = this.keys.has('f') || this.pointerFiring;

    this.vehicle.preStep(
      FIXED_DT,
      this.controls,
      (colliderHandle) => this.surfaceByCollider.get(colliderHandle) ?? 'asphalt',
    );
    this.kills += this.zombies.step(FIXED_DT, this.vehicle);
    this.world.step(this.eventQueue);

    this.eventQueue.drainContactForceEvents((event) => {
      const force = event.totalForceMagnitude();
      this.vehicle.onContactForce(event.collider1(), force);
      this.vehicle.onContactForce(event.collider2(), force);
    });

    const shots = this.vehicle.telemetry().shotsThisStep;
    this.pendingShots.push(...shots);
    for (const shot of shots) {
      if (
        shot.hitZombieHandle !== null &&
        this.zombies.hitZombieHandle(shot.hitZombieHandle, shot.damage)
      ) {
        this.kills++;
      }
    }

    this.attachNewIslands(this.vehicle.finishStep());
    if (this.vehicle.isDestroyed()) this.showGameOver();
  }

  private attachNewIslands(islands: ReturnType<RuntimeVehicle['finishStep']>): void {
    for (const island of islands) {
      const group = new THREE.Group();
      const position = island.body.translation();
      const rotation = island.body.rotation();
      group.position.set(position.x, position.y, position.z);
      group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      this.scene.add(group);
      group.updateMatrixWorld(true);
      for (const partId of island.partIds) {
        const mesh = this.vehicleGroup.getObjectByName(`part:${partId}`);
        if (mesh) {
          this.vehicleGroup.remove(mesh);
          group.add(mesh);
        }
        const wheelMesh = this.wheelMeshes.get(partId);
        if (wheelMesh) {
          this.wheelMeshes.delete(partId);
          group.attach(wheelMesh);
        }
      }
      this.islandGroups.set(island.body.handle, group);
    }
  }

  private showGameOver(): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.controls.throttle = 0;
    this.controls.brake = 1;
    this.controls.steer = 0;
    this.controls.fire = false;
    this.pointerFiring = false;
    this.keys.clear();
    this.gameOverKills.textContent = `${this.kills} zombie${this.kills === 1 ? '' : 's'} destroyed`;
    this.gameOverOverlay.style.display = 'block';
  }

  private syncView(frameDt: number): void {
    const position = this.vehicle.body.translation();
    const rotation = this.vehicle.body.rotation();
    this.vehicleGroup.position.set(position.x, position.y, position.z);
    this.vehicleGroup.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

    for (const [id, part] of this.vehicle.assembled.parts) {
      if (part.alive) continue;
      const mesh = this.vehicleGroup.getObjectByName(`part:${id}`);
      if (mesh) mesh.visible = false;
      const wheelMesh = this.wheelMeshes.get(id);
      if (wheelMesh) wheelMesh.visible = false;
    }

    for (const wheel of this.vehicle.wheels()) {
      const mesh = this.wheelMeshes.get(wheel.partId);
      if (!mesh || wheel.broken) continue;
      const centre = wheelVisualCentre(this.vehicle.body, wheel);
      mesh.position.set(centre.x, centre.y, centre.z);
      mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      const state = wheel as unknown as { visualSpin?: number };
      state.visualSpin = (state.visualSpin ?? 0) + wheel.omega * frameDt;
      const spin = mesh.getObjectByName('wheel-spin');
      const baseQuaternion = spin?.userData.baseQuat as THREE.Quaternion | undefined;
      if (spin && baseQuaternion) {
        const steerQuaternion = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          -wheel.steerAngle,
        );
        spin.quaternion.copy(steerQuaternion).multiply(baseQuaternion);
        spin.rotateY(state.visualSpin ?? 0);
      }
    }

    for (const [handle, group] of this.islandGroups) {
      const body = this.world.getRigidBody(handle);
      if (!body) continue;
      const islandPosition = body.translation();
      const islandRotation = body.rotation();
      group.position.set(islandPosition.x, islandPosition.y, islandPosition.z);
      group.quaternion.set(
        islandRotation.x,
        islandRotation.y,
        islandRotation.z,
        islandRotation.w,
      );
    }

    this.zombies.syncVisuals();
    this.syncTracers(frameDt);

    const bodyQuaternion = new THREE.Quaternion(
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
    );
    const behind = new THREE.Vector3(0, 2.6, -6.5).applyQuaternion(bodyQuaternion);
    const target = new THREE.Vector3(position.x, position.y, position.z);
    const desired = target.clone().add(behind);
    desired.y = Math.max(desired.y, 1.2);
    this.camera.position.lerp(desired, Math.min(1, frameDt * 4));
    this.camera.lookAt(target);

    const integrity = this.vehicle.integrityPct();
    this.hud.innerHTML = [
      `<div class="stat-row"><span>Vehicle integrity</span><span>${integrity.toFixed(0)}%</span></div>`,
      `<div class="stat-row"><span>Kills</span><span>${this.kills}</span></div>`,
      `<div class="stat-row"><span>Zombies alive</span><span>${this.zombies.aliveCount()}</span></div>`,
    ].join('');
  }

  private syncTracers(frameDt: number): void {
    this.tracers = this.tracers.filter((tracer) => {
      tracer.ttl -= frameDt;
      if (tracer.ttl > 0) return true;
      this.scene.remove(tracer.line);
      tracer.line.geometry.dispose();
      disposeMaterial(tracer.line.material);
      return false;
    });

    for (const shot of this.pendingShots) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(shot.from.x, shot.from.y, shot.from.z),
        new THREE.Vector3(shot.to.x, shot.to.y, shot.to.z),
      ]);
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: 0xffd76e }),
      );
      this.scene.add(line);
      this.tracers.push({ line, ttl: 0.08 });
    }
    this.pendingShots = [];
  }

  /** Debug seam control injection, matching ChamberMode's key-backed path. */
  debugSetControls(controls: Partial<VehicleControls>): void {
    Object.assign(this.controls, controls);
    if (controls.throttle !== undefined && controls.throttle > 0) this.keys.add('w');
    if (controls.throttle === 0) this.keys.delete('w');
    if (controls.steer !== undefined) {
      this.keys.delete('a');
      this.keys.delete('d');
      if (controls.steer < 0) this.keys.add('a');
      if (controls.steer > 0) this.keys.add('d');
    }
    if (controls.brake !== undefined) {
      if (controls.brake > 0) this.keys.add(' ');
      else this.keys.delete(' ');
    }
    if (controls.fire !== undefined) {
      if (controls.fire) this.keys.add('f');
      else this.keys.delete('f');
    }
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  debugTelemetry(): SurvivalTelemetry {
    const position = this.vehicle.body.translation();
    return {
      mode: 'survival',
      kills: this.kills,
      zombiesAlive: this.zombies.aliveCount(),
      integrityPct: this.vehicle.integrityPct(),
      vehiclePos: [position.x, position.y, position.z],
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.blur);
    window.removeEventListener('pointerup', this.onFireUp);
    window.removeEventListener('pointercancel', this.onFireUp);
    this.renderer.domElement.removeEventListener('pointermove', this.onAim);
    this.renderer.domElement.removeEventListener('pointerdown', this.onFireDown);
    this.zombies.dispose();
    this.vehicle.dispose();
    this.eventQueue.free();
    this.world.free();
    this.ui.remove();
    disposeObject(this.scene);
    this.scene.clear();
    this.wheelMeshes.clear();
    this.islandGroups.clear();
    this.surfaceByCollider.clear();
    this.tracers = [];
    this.pendingShots = [];
  }
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const line = object as THREE.Line;
    if (!mesh.isMesh && !line.isLine) return;
    const renderable = object as THREE.Mesh;
    renderable.geometry.dispose();
    disposeMaterial(renderable.material);
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material.dispose();
  }
}
