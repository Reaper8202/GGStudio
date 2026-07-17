/**
 * Survival runtime: the editor blueprint vehicle, the graveyard world,
 * pooled zombie AI, wave pacing, HUD, and the existing fixed-step damage path.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { getPartDef } from '../core/parts.ts';
import { deriveConnections } from '../core/structural.ts';
import type { VehicleBlueprint } from '../core/types.ts';
import { buildPartMesh } from '../editor/meshes.ts';
import { GROUP_TERRAIN, lowestPointM } from '../runtime/assembler.ts';
import type { SurfaceKind } from '../runtime/surfaces.ts';
import { RuntimeVehicle, type VehicleControls } from '../runtime/vehicle.ts';
import type { TracerShot } from '../runtime/weapons.ts';
import { wheelVisualCentre } from '../runtime/wheels.ts';
import { FollowCamera } from './FollowCamera.ts';
import { Graveyard } from './Graveyard.ts';
import { WaveManager } from './WaveManager.ts';
import { ZombieSystem } from './zombies/ZombieSystem.ts';
import { BASE_ZOMBIE_STATS } from './zombies/zombieConfig.ts';

const FIXED_DT = 1 / 60;
const TERRAIN_GROUPS = (GROUP_TERRAIN << 16) | 0xffff;
const GROUND_HALF_SIZE = 35;
const COUNTDOWN_SECONDS = 3;
const TRACER_POOL_SIZE = 32;

export interface SurvivalCallbacks {
  onExit(): void;
  onGameOver(): void;
}

export interface SurvivalTelemetry {
  mode: 'survival';
  kills: number;
  wave: number;
  zombiesAlive: number;
  runMoney: number;
  integrityPct: number;
  vehiclePos: [number, number, number];
}

interface TracerVisual {
  line: THREE.Line;
  positionAttribute: THREE.BufferAttribute;
  ttl: number;
}

interface SurvivalUi {
  root: HTMLDivElement;
  integrityValue: HTMLSpanElement;
  waveValue: HTMLSpanElement;
  remainingValue: HTMLSpanElement;
  moneyValue: HTMLSpanElement;
  countdownOverlay: HTMLDivElement;
  countdownValue: HTMLDivElement;
  waveClearOverlay: HTMLDivElement;
  waveClearText: HTMLDivElement;
  gameOverOverlay: HTMLDivElement;
  gameOverSummary: HTMLDivElement;
}

type SurvivalPhase = 'countdown' | 'active' | 'cleared' | 'gameOver';

export class SurvivalMode {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world: RAPIER.World;
  private readonly eventQueue: RAPIER.EventQueue;
  private readonly surfaceByCollider = new Map<number, SurfaceKind>();
  private readonly graveyard: Graveyard;
  private readonly vehicle: RuntimeVehicle;
  private readonly zombies: ZombieSystem;
  private readonly waves: WaveManager;
  private readonly followCamera: FollowCamera;
  private readonly vehicleGroup = new THREE.Group();
  private readonly wheelMeshes = new Map<string, THREE.Group>();
  private readonly wheelSpin = new Map<string, number>();
  private readonly islandGroups = new Map<number, THREE.Group>();
  private readonly keys = new Set<string>();
  private readonly controls: VehicleControls = {
    throttle: 0,
    brake: 0,
    steer: 0,
    fire: false,
    aimYawWorld: 0,
  };
  private readonly tracers: TracerVisual[] = [];
  private readonly tracerMaterial = new THREE.LineBasicMaterial({
    color: 0xffd76e,
  });
  private readonly wheelSteerQuaternion = new THREE.Quaternion();
  private readonly wheelSteerAxis = new THREE.Vector3(0, 1, 0);
  private readonly pointerNdc = new THREE.Vector2();
  private readonly aimRaycaster = new THREE.Raycaster();
  private readonly aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly aimPoint = new THREE.Vector3();
  private readonly shotDirection = new THREE.Vector3();
  private readonly stoppedVelocity = { x: 0, y: 0, z: 0 };
  private readonly ui: HTMLDivElement;
  private readonly integrityValue: HTMLSpanElement;
  private readonly waveValue: HTMLSpanElement;
  private readonly remainingValue: HTMLSpanElement;
  private readonly moneyValue: HTMLSpanElement;
  private readonly countdownOverlay: HTMLDivElement;
  private readonly countdownValue: HTMLDivElement;
  private readonly waveClearOverlay: HTMLDivElement;
  private readonly waveClearText: HTMLDivElement;
  private readonly gameOverOverlay: HTMLDivElement;
  private readonly gameOverSummary: HTMLDivElement;

  private accumulator = 0;
  private lastTime = performance.now();
  private kills = 0;
  private runMoney = 0;
  private currentWave = 1;
  private zombiesRemaining = 0;
  private countdownRemaining = COUNTDOWN_SECONDS;
  private phase: SurvivalPhase = 'countdown';
  private pointerFiring = false;
  private disposed = false;
  private lastHudIntegrity = -1;
  private lastHudWave = -1;
  private lastHudRemaining = -1;
  private lastHudMoney = -1;
  private lastCountdownSecond = -1;
  private tracerCursor = 0;

  private readonly keydown = (event: KeyboardEvent): void => {
    if (this.phase === 'gameOver') return;
    this.keys.add(event.key.toLowerCase());
  };

  private readonly keyup = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
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
    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      320,
    );
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.eventQueue = new RAPIER.EventQueue(true);
    this.buildGround();
    this.graveyard = new Graveyard(this.scene, this.world);
    this.vehicle = this.spawnVehicle(bp);
    this.followCamera = new FollowCamera(
      this.camera,
      this.vehicle,
      this.graveyard.bounds,
    );
    this.zombies = new ZombieSystem(
      this.world,
      this.scene,
      this.graveyard.spawnPoints,
      this.vehicle,
      this.handleZombieKilled,
    );
    this.waves = new WaveManager(this.zombies, {
      onRemainingChanged: (remaining) => {
        this.zombiesRemaining = remaining;
      },
      onWaveComplete: (wave, reward) => this.onWaveComplete(wave, reward),
    });
    this.buildTracerPool();

    const builtUi = this.buildUI();
    this.ui = builtUi.root;
    this.integrityValue = builtUi.integrityValue;
    this.waveValue = builtUi.waveValue;
    this.remainingValue = builtUi.remainingValue;
    this.moneyValue = builtUi.moneyValue;
    this.countdownOverlay = builtUi.countdownOverlay;
    this.countdownValue = builtUi.countdownValue;
    this.waveClearOverlay = builtUi.waveClearOverlay;
    this.waveClearText = builtUi.waveClearText;
    this.gameOverOverlay = builtUi.gameOverOverlay;
    this.gameOverSummary = builtUi.gameOverSummary;

    this.beginCountdown(1);
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
  }

  private spawnVehicle(bp: VehicleBlueprint): RuntimeVehicle {
    const clone = JSON.parse(JSON.stringify(bp)) as VehicleBlueprint;
    const connections = deriveConnections(clone, getPartDef);
    const spawnY = -lowestPointM(clone, getPartDef) + 0.32;
    const vehicle = new RuntimeVehicle(
      this.world,
      clone,
      getPartDef,
      connections,
      {
        translation: { x: 0, y: spawnY, z: 0 },
      },
    );

    for (const [id, part] of vehicle.assembled.parts) {
      const mesh = buildPartMesh(part.def, part.placed);
      if (part.def.wheel) {
        const spin = mesh.getObjectByName('wheel-spin');
        if (spin) {
          spin.userData.baseQuat = spin.quaternion.clone();
          spin.position.set(0, 0, 0);
        }
        this.wheelMeshes.set(id, mesh);
        this.wheelSpin.set(id, 0);
        this.scene.add(mesh);
      } else {
        mesh.name = `part:${id}`;
        this.vehicleGroup.add(mesh);
      }
    }
    this.scene.add(this.vehicleGroup);
    return vehicle;
  }

  private buildTracerPool(): void {
    for (let i = 0; i < TRACER_POOL_SIZE; i++) {
      const positionAttribute = new THREE.BufferAttribute(
        new Float32Array(6),
        3,
      );
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', positionAttribute);
      const line = new THREE.Line(geometry, this.tracerMaterial);
      line.frustumCulled = false;
      line.visible = false;
      this.scene.add(line);
      this.tracers.push({ line, positionAttribute, ttl: 0 });
    }
  }

  private buildUI(): SurvivalUi {
    const root = document.createElement('div');
    root.className = 'ui-layer';
    this.container.appendChild(root);

    const top = document.createElement('div');
    top.className = 'topbar';
    root.appendChild(top);

    const back = document.createElement('button');
    back.className = 'primary';
    back.textContent = 'Back to Garage';
    back.addEventListener('click', () => this.callbacks.onExit());

    const title = document.createElement('div');
    title.className = 'panel';
    title.textContent = 'ZOMBIE SURVIVAL';
    title.style.cssText =
      'padding:7px 12px;font-weight:800;letter-spacing:.08em;color:#ffb44d';
    top.append(back, title);

    const hud = document.createElement('div');
    hud.className = 'panel';
    hud.style.cssText = 'position:absolute;left:8px;bottom:8px;min-width:245px';
    const integrityValue = addStatRow(hud, 'Vehicle integrity');
    const waveValue = addStatRow(hud, 'Wave');
    const remainingValue = addStatRow(hud, 'Zombies remaining');
    const moneyValue = addStatRow(hud, 'Run money');
    root.appendChild(hud);

    const help = document.createElement('div');
    help.className = 'hud-note';
    help.textContent =
      'W/S drive + brake · A/D steer · Space brake · F or click fire · mouse aim';
    root.appendChild(help);

    const countdownOverlay = overlayPanel();
    countdownOverlay.style.pointerEvents = 'none';
    const countdownLabel = document.createElement('div');
    countdownLabel.textContent = 'WAVE STARTING';
    countdownLabel.style.cssText =
      'font-size:15px;font-weight:800;letter-spacing:.12em;color:#ffb44d';
    const countdownValue = document.createElement('div');
    countdownValue.style.cssText =
      'font-size:54px;font-weight:900;line-height:1.1';
    countdownOverlay.append(countdownLabel, countdownValue);
    root.appendChild(countdownOverlay);

    const waveClearOverlay = overlayPanel();
    waveClearOverlay.style.display = 'none';
    const waveClearText = document.createElement('div');
    waveClearText.style.cssText =
      'font-size:22px;font-weight:900;color:#9bd76e;margin-bottom:14px';
    const nextWave = document.createElement('button');
    nextWave.className = 'primary';
    nextWave.textContent = 'Next Wave';
    nextWave.addEventListener('click', () => {
      if (this.phase === 'cleared') this.beginCountdown(this.currentWave + 1);
    });
    waveClearOverlay.append(waveClearText, nextWave);
    root.appendChild(waveClearOverlay);

    const gameOverOverlay = overlayPanel();
    gameOverOverlay.style.display = 'none';
    const gameOverTitle = document.createElement('div');
    gameOverTitle.textContent = 'VEHICLE DESTROYED';
    gameOverTitle.style.cssText =
      'font-size:24px;font-weight:900;color:#ff7b63;margin-bottom:10px';
    const gameOverSummary = document.createElement('div');
    gameOverSummary.style.cssText =
      'font-size:17px;line-height:1.5;margin-bottom:16px';
    const returnButton = document.createElement('button');
    returnButton.className = 'primary';
    returnButton.textContent = 'Return to Garage';
    returnButton.addEventListener('click', () => this.callbacks.onGameOver());
    gameOverOverlay.append(gameOverTitle, gameOverSummary, returnButton);
    root.appendChild(gameOverOverlay);

    return {
      root,
      integrityValue,
      waveValue,
      remainingValue,
      moneyValue,
      countdownOverlay,
      countdownValue,
      waveClearOverlay,
      waveClearText,
      gameOverOverlay,
      gameOverSummary,
    };
  }

  private readonly onAim = (event: PointerEvent): void => {
    if (this.phase !== 'active') return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.aimRaycaster.setFromCamera(this.pointerNdc, this.camera);
    if (!this.aimRaycaster.ray.intersectPlane(this.aimPlane, this.aimPoint))
      return;
    const position = this.vehicle.body.translation();
    this.controls.aimYawWorld = Math.atan2(
      this.aimPoint.x - position.x,
      this.aimPoint.z - position.z,
    );
  };

  private readonly onFireDown = (event: PointerEvent): void => {
    if (this.phase === 'active' && event.button === 0)
      this.pointerFiring = true;
  };

  private readonly onFireUp = (): void => {
    this.pointerFiring = false;
  };

  update(dtMs?: number): void {
    if (this.disposed) return;
    const now = performance.now();
    let frameDt =
      dtMs === undefined ? (now - this.lastTime) / 1000 : dtMs / 1000;
    this.lastTime = now;
    frameDt = Math.min(Math.max(frameDt, 0), 0.1);
    this.accumulator += frameDt;

    while (this.accumulator >= FIXED_DT) {
      this.accumulator -= FIXED_DT;
      if (this.phase === 'countdown') {
        this.countdownRemaining -= FIXED_DT;
        if (this.countdownRemaining <= 0) this.startCurrentWave();
      } else if (this.phase === 'active') {
        this.stepPhysics();
      }
    }
    this.syncView(frameDt);
    this.renderer.render(this.scene, this.camera);
  }

  private stepPhysics(): void {
    this.updateControls();
    this.vehicle.preStep(
      FIXED_DT,
      this.controls,
      (colliderHandle) =>
        this.surfaceByCollider.get(colliderHandle) ?? 'asphalt',
    );

    this.waves.fixedUpdate(FIXED_DT);
    this.zombies.step(FIXED_DT);

    this.world.step(this.eventQueue);
    this.eventQueue.drainContactForceEvents((event) => {
      const force = event.totalForceMagnitude();
      this.vehicle.onContactForce(event.collider1(), force);
      this.vehicle.onContactForce(event.collider2(), force);
    });

    const shots = this.vehicle.shotsThisStep();
    for (const shot of shots) {
      this.showTracer(shot);
      if (shot.hitZombieHandle === null) continue;
      this.shotDirection.set(
        shot.to.x - shot.from.x,
        shot.to.y - shot.from.y,
        shot.to.z - shot.from.z,
      );
      if (this.shotDirection.lengthSq() > 1e-8) this.shotDirection.normalize();
      this.zombies.hitZombieHandle(
        shot.hitZombieHandle,
        shot.damage,
        this.shotDirection,
      );
    }

    this.attachNewIslands(this.vehicle.finishStep());
    if (this.vehicle.isDestroyed()) this.showGameOver();
    else if (this.phase === 'cleared') this.stopVehicleMotion();
  }

  private updateControls(): void {
    if (this.phase !== 'active') {
      this.controls.throttle = 0;
      this.controls.brake = 1;
      this.controls.steer = 0;
      this.controls.fire = false;
      return;
    }

    const forward = this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0;
    const reverse = this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0;
    const velocity = this.vehicle.body.linvel();
    const moving = Math.hypot(velocity.x, velocity.y, velocity.z) > 0.56;
    this.controls.throttle = forward;
    this.controls.brake = this.keys.has(' ') ? 1 : reverse && moving ? 1 : 0;
    this.controls.steer =
      (this.keys.has('a') || this.keys.has('arrowleft') ? -1 : 0) +
      (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0);
    this.controls.fire = this.keys.has('f') || this.pointerFiring;
  }

  private attachNewIslands(
    islands: ReturnType<RuntimeVehicle['finishStep']>,
  ): void {
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
          this.wheelSpin.delete(partId);
          group.attach(wheelMesh);
        }
      }
      this.islandGroups.set(island.body.handle, group);
    }
  }

  private beginCountdown(wave: number): void {
    this.currentWave = Math.max(1, Math.floor(wave));
    this.phase = 'countdown';
    this.countdownRemaining = COUNTDOWN_SECONDS;
    this.lastCountdownSecond = -1;
    this.zombiesRemaining = 0;
    this.pointerFiring = false;
    this.keys.clear();
    this.waveClearOverlay.style.display = 'none';
    this.gameOverOverlay.style.display = 'none';
    this.countdownOverlay.style.display = 'block';
  }

  private startCurrentWave(): void {
    this.phase = 'active';
    this.countdownOverlay.style.display = 'none';
    this.waves.startWave(this.currentWave);
  }

  private readonly handleZombieKilled = (reward: number): void => {
    this.kills++;
    this.runMoney += reward;
    this.waves.recordZombieKilled();
  };

  private onWaveComplete(wave: number, reward: number): void {
    if (this.phase === 'gameOver') return;
    this.currentWave = wave;
    this.runMoney += reward;
    this.phase = 'cleared';
    this.pointerFiring = false;
    this.keys.clear();
    this.countdownOverlay.style.display = 'none';
    this.waveClearText.textContent = `Wave ${wave} cleared`;
    this.waveClearOverlay.style.display = 'block';
    this.stopVehicleMotion();
    // TODO(Phase 5): hand the repaired/pruned blueprint and run state to onBuildPhase.
  }

  private stopVehicleMotion(): void {
    this.vehicle.body.setLinvel(this.stoppedVelocity, false);
    this.vehicle.body.setAngvel(this.stoppedVelocity, false);
    this.vehicle.body.resetForces(false);
    this.vehicle.body.resetTorques(false);
    for (const island of this.vehicle.islands) {
      island.body.setLinvel(this.stoppedVelocity, false);
      island.body.setAngvel(this.stoppedVelocity, false);
      island.body.resetForces(false);
      island.body.resetTorques(false);
    }
    for (const wheel of this.vehicle.wheels()) wheel.omega = 0;
  }

  private showGameOver(): void {
    if (this.phase === 'gameOver') return;
    this.phase = 'gameOver';
    this.controls.throttle = 0;
    this.controls.brake = 1;
    this.controls.steer = 0;
    this.controls.fire = false;
    this.pointerFiring = false;
    this.keys.clear();
    this.countdownOverlay.style.display = 'none';
    this.waveClearOverlay.style.display = 'none';
    this.gameOverSummary.textContent =
      `Wave ${this.currentWave} reached · $${this.runMoney} earned · ` +
      `${this.kills} zombie${this.kills === 1 ? '' : 's'} destroyed`;
    this.gameOverOverlay.style.display = 'block';
  }

  private syncView(frameDt: number): void {
    const position = this.vehicle.body.translation();
    const rotation = this.vehicle.body.rotation();
    this.vehicleGroup.position.set(position.x, position.y, position.z);
    this.vehicleGroup.quaternion.set(
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
    );

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
      const visualSpin =
        (this.wheelSpin.get(wheel.partId) ?? 0) + wheel.omega * frameDt;
      this.wheelSpin.set(wheel.partId, visualSpin);
      const spin = mesh.getObjectByName('wheel-spin');
      const baseQuaternion = spin?.userData.baseQuat as
        THREE.Quaternion | undefined;
      if (spin && baseQuaternion) {
        this.wheelSteerQuaternion.setFromAxisAngle(
          this.wheelSteerAxis,
          -wheel.steerAngle,
        );
        spin.quaternion
          .copy(this.wheelSteerQuaternion)
          .multiply(baseQuaternion);
        spin.rotateY(visualSpin);
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

    this.zombies.updateVisuals(frameDt);
    this.syncTracers(frameDt);
    this.followCamera.update(frameDt);
    this.graveyard.follow(this.vehicleGroup);
    this.syncHud();
  }

  private syncHud(): void {
    const integrity = Math.round(this.vehicle.integrityPct());
    if (integrity !== this.lastHudIntegrity) {
      this.lastHudIntegrity = integrity;
      this.integrityValue.textContent = `${integrity}%`;
    }
    if (this.currentWave !== this.lastHudWave) {
      this.lastHudWave = this.currentWave;
      this.waveValue.textContent = String(this.currentWave);
    }
    if (this.zombiesRemaining !== this.lastHudRemaining) {
      this.lastHudRemaining = this.zombiesRemaining;
      this.remainingValue.textContent = String(this.zombiesRemaining);
    }
    if (this.runMoney !== this.lastHudMoney) {
      this.lastHudMoney = this.runMoney;
      this.moneyValue.textContent = `$${this.runMoney}`;
    }
    if (this.phase === 'countdown') {
      const second = Math.max(1, Math.ceil(this.countdownRemaining));
      if (second !== this.lastCountdownSecond) {
        this.lastCountdownSecond = second;
        this.countdownValue.textContent = String(second);
      }
    }
  }

  private syncTracers(frameDt: number): void {
    for (const tracer of this.tracers) {
      if (!tracer.line.visible) continue;
      tracer.ttl -= frameDt;
      if (tracer.ttl > 0) continue;
      tracer.line.visible = false;
      tracer.ttl = 0;
    }
  }

  private showTracer(shot: TracerShot): void {
    const tracer = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % this.tracers.length;
    const positions = tracer.positionAttribute.array as Float32Array;
    positions[0] = shot.from.x;
    positions[1] = shot.from.y;
    positions[2] = shot.from.z;
    positions[3] = shot.to.x;
    positions[4] = shot.to.y;
    positions[5] = shot.to.z;
    tracer.positionAttribute.needsUpdate = true;
    tracer.ttl = 0.08;
    tracer.line.visible = true;
  }

  /** Debug seam control injection, matching ChamberMode's key-backed path. */
  debugSetControls(controls: Partial<VehicleControls>): void {
    Object.assign(this.controls, controls);
    if (controls.throttle !== undefined && controls.throttle > 0)
      this.keys.add('w');
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

  debugStartWave(wave: number): void {
    if (this.disposed || this.phase === 'gameOver') return;
    this.zombies.reset();
    this.waves.reset();
    this.currentWave = Math.max(
      1,
      Math.floor(Number.isFinite(wave) ? wave : 1),
    );
    this.zombiesRemaining = 0;
    this.phase = 'active';
    this.pointerFiring = false;
    this.keys.clear();
    this.countdownOverlay.style.display = 'none';
    this.waveClearOverlay.style.display = 'none';
    this.gameOverOverlay.style.display = 'none';
    this.waves.startWave(this.currentWave);
  }

  debugKillAllZombies(): void {
    if (this.disposed || this.phase !== 'active') return;
    const unspawnedKills = this.waves.prepareDebugKillAll();
    this.kills += unspawnedKills;
    this.runMoney += unspawnedKills * BASE_ZOMBIE_STATS.reward;
    this.zombies.forceKillAll();
    this.waves.fixedUpdate(0);
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
      wave: this.currentWave,
      zombiesAlive: this.zombies.getActiveCount(),
      runMoney: this.runMoney,
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
    this.renderer.domElement.removeEventListener(
      'pointerdown',
      this.onFireDown,
    );
    this.zombies.dispose();
    this.graveyard.dispose();
    this.vehicle.dispose();
    this.eventQueue.free();
    this.world.free();
    this.ui.remove();
    disposeObject(this.scene);
    this.scene.clear();
    this.tracerMaterial.dispose();
    this.wheelMeshes.clear();
    this.wheelSpin.clear();
    this.islandGroups.clear();
    this.surfaceByCollider.clear();
    this.tracers.length = 0;
  }
}

function addStatRow(parent: HTMLElement, label: string): HTMLSpanElement {
  const row = document.createElement('div');
  row.className = 'stat-row';
  const name = document.createElement('span');
  name.textContent = label;
  const value = document.createElement('span');
  row.append(name, value);
  parent.appendChild(row);
  return value;
}

function overlayPanel(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.className = 'panel';
  overlay.style.cssText =
    'position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);' +
    'min-width:290px;padding:24px;text-align:center;z-index:20';
  return overlay;
}

function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line))
      return;
    const renderable = object as THREE.Mesh | THREE.Line;
    geometries.add(renderable.geometry);
    if (Array.isArray(renderable.material)) {
      for (const material of renderable.material) materials.add(material);
    } else {
      materials.add(renderable.material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}
