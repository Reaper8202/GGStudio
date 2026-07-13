/**
 * World-aligned angled top-down follow camera. Runs entirely in `update()`
 * (render rate) so it stays smooth even if fixedUpdate ticks are jittery.
 */
import * as THREE from "three";
import type { GameContext, GameSystem, VehicleApi, WorldApi } from "../types";
import { STARTER_TUNING } from "../config/vehicleTuning";

/** Base offset from the followed point, before speed-based zoom-out. */
const BASE_OFFSET = new THREE.Vector3(0, 20, 12);
/** Seconds of velocity to look ahead by. */
const LOOK_AHEAD_TIME = 0.5;
const MAX_LOOK_AHEAD_DISTANCE = 6;
/** Up to +25% offset scale at max speed. */
const MAX_ZOOM_OUT = 0.25;
/** Exponential-damping rates (per second). */
const POSITION_DAMPING = 4.5;
const LOOK_AT_DAMPING = 6;
/** Camera-shake decay on `impact:major`. */
const SHAKE_DURATION = 0.35;
const SHAKE_AMPLITUDE = 0.6;
/** Keep the followed target this far inside the world bounds. */
const BOUNDS_MARGIN = 4;

export class FollowCamera implements GameSystem {
  private readonly ctx: GameContext;
  private readonly vehicle: VehicleApi;
  private readonly bounds: WorldApi["bounds"];

  private readonly currentPosition = new THREE.Vector3();
  private readonly currentLookAt = new THREE.Vector3();
  private readonly targetPosition = new THREE.Vector3();
  private readonly targetLookAt = new THREE.Vector3();
  private readonly scratchOffset = new THREE.Vector3();
  private readonly scratchShake = new THREE.Vector3();

  private shakeTime = 0;
  private shakeIntensity = 0;
  private initialized = false;

  constructor(ctx: GameContext, vehicle: VehicleApi, world: WorldApi) {
    this.ctx = ctx;
    this.vehicle = vehicle;
    this.bounds = world.bounds;

    ctx.events.on("impact:major", (payload) => {
      this.shakeTime = SHAKE_DURATION;
      this.shakeIntensity = payload.intensity;
    });

    window.addEventListener("resize", this.handleResize);
    this.handleResize();

    this.snapToVehicle();
  }

  update(_dt: number): void {
    this.computeTargets();

    const dt = Math.min(_dt, 0.1);
    if (!this.initialized) {
      this.currentPosition.copy(this.targetPosition);
      this.currentLookAt.copy(this.targetLookAt);
      this.initialized = true;
    } else {
      const posT = 1 - Math.exp(-POSITION_DAMPING * dt);
      const lookT = 1 - Math.exp(-LOOK_AT_DAMPING * dt);
      this.currentPosition.lerp(this.targetPosition, posT);
      this.currentLookAt.lerp(this.targetLookAt, lookT);
    }

    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const decay = this.shakeTime / SHAKE_DURATION;
      const amp = SHAKE_AMPLITUDE * this.shakeIntensity * decay;
      this.scratchShake.set(
        (Math.random() * 2 - 1) * amp,
        (Math.random() * 2 - 1) * amp * 0.5,
        (Math.random() * 2 - 1) * amp
      );
    } else {
      this.scratchShake.set(0, 0, 0);
    }

    this.ctx.camera.position.copy(this.currentPosition).add(this.scratchShake);
    this.ctx.camera.lookAt(this.currentLookAt);
  }

  reset(): void {
    this.shakeTime = 0;
    this.shakeIntensity = 0;
    this.initialized = false;
    this.snapToVehicle();
  }

  private snapToVehicle(): void {
    this.computeTargets();
    this.currentPosition.copy(this.targetPosition);
    this.currentLookAt.copy(this.targetLookAt);
    this.ctx.camera.position.copy(this.currentPosition);
    this.ctx.camera.lookAt(this.currentLookAt);
    this.initialized = true;
  }

  private computeTargets(): void {
    const speedFactor = Math.min(
      this.vehicle.speed / Math.max(STARTER_TUNING.maximumForwardSpeed, 0.001),
      1
    );
    const zoomScale = 1 + MAX_ZOOM_OUT * speedFactor;

    const lookAheadX = clampMagnitude(
      this.vehicle.velocity.x * LOOK_AHEAD_TIME,
      MAX_LOOK_AHEAD_DISTANCE
    );
    const lookAheadZ = clampMagnitude(
      this.vehicle.velocity.z * LOOK_AHEAD_TIME,
      MAX_LOOK_AHEAD_DISTANCE
    );

    let targetX = this.vehicle.position.x + lookAheadX;
    let targetZ = this.vehicle.position.z + lookAheadZ;

    targetX = clamp(
      targetX,
      this.bounds.minX + BOUNDS_MARGIN,
      this.bounds.maxX - BOUNDS_MARGIN
    );
    targetZ = clamp(
      targetZ,
      this.bounds.minZ + BOUNDS_MARGIN,
      this.bounds.maxZ - BOUNDS_MARGIN
    );

    this.targetLookAt.set(targetX, this.vehicle.position.y, targetZ);

    this.scratchOffset.copy(BASE_OFFSET).multiplyScalar(zoomScale);
    this.targetPosition.copy(this.targetLookAt).add(this.scratchOffset);
  }

  private handleResize = (): void => {
    this.ctx.camera.aspect = window.innerWidth / window.innerHeight;
    this.ctx.camera.updateProjectionMatrix();
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampMagnitude(value: number, max: number): number {
  return clamp(value, -max, max);
}
