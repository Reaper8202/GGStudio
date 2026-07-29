import * as THREE from 'three';
import type { RuntimeVehicle } from '../runtime/vehicle.ts';

export interface FollowBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

// Camera sits behind the vehicle. This engine's vehicles face local +Z
// (zombie-car, where this was ported from, used -Z forward), so "behind"
// is negative Z — otherwise W drives the vehicle straight at the camera.
const BASE_OFFSET = new THREE.Vector3(0, 20, -12);
const LOOK_AHEAD_TIME = 0.5;
const MAX_LOOK_AHEAD_DISTANCE = 6;
const MAX_ZOOM_OUT = 0.25;
const MAX_SPEED_MPS = 14;
const POSITION_DAMPING = 4.5;
const LOOK_AT_DAMPING = 6;
const BOUNDS_MARGIN = 4;
/** Seconds for a shake impulse to decay to nothing. */
const SHAKE_DECAY_SECONDS = 0.42;
/** Metres of camera displacement at full shake strength. */
const SHAKE_AMPLITUDE_M = 0.85;
/** Oscillations per second while a shake is running. */
const SHAKE_FREQUENCY_HZ = 26;
/** Ceiling on stacked shakes, so a cannon volley never becomes unreadable. */
const MAX_SHAKE = 1.4;

/** Allocation-free, world-aligned follow camera ported from zombie-car. */
export class FollowCamera {
  private readonly currentPosition = new THREE.Vector3();
  private readonly currentLookAt = new THREE.Vector3();
  private readonly targetPosition = new THREE.Vector3();
  private readonly targetLookAt = new THREE.Vector3();
  private readonly scratchOffset = new THREE.Vector3();
  private initialized = false;
  /** Remaining shake strength; decays every frame once kicked. */
  private shake = 0;
  private shakePhase = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly vehicle: RuntimeVehicle,
    private readonly bounds: FollowBounds,
  ) {
    this.snap();
  }

  update(frameDt: number): void {
    this.computeTargets();
    const dt = Math.min(Math.max(frameDt, 0), 0.1);
    if (!this.initialized) {
      this.currentPosition.copy(this.targetPosition);
      this.currentLookAt.copy(this.targetLookAt);
      this.initialized = true;
    } else {
      this.currentPosition.lerp(
        this.targetPosition,
        1 - Math.exp(-POSITION_DAMPING * dt),
      );
      this.currentLookAt.lerp(
        this.targetLookAt,
        1 - Math.exp(-LOOK_AT_DAMPING * dt),
      );
    }
    this.camera.position.copy(this.currentPosition);
    if (this.shake > 0) this.applyShake(dt);
    this.camera.lookAt(this.currentLookAt);
  }

  /**
   * Kick the camera. `strength` is a 0..1 measure of how hard the hit was;
   * repeated kicks stack up to a ceiling rather than replacing one another.
   */
  addShake(strength: number): void {
    if (strength <= 0) return;
    this.shake = Math.min(MAX_SHAKE, this.shake + strength);
  }

  snap(): void {
    this.shake = 0;
    this.computeTargets();
    this.currentPosition.copy(this.targetPosition);
    this.currentLookAt.copy(this.targetLookAt);
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
    this.initialized = true;
  }

  /**
   * Displace the camera along two out-of-phase sine waves. Only the camera
   * position moves — the look-at target is left alone, so the world shudders
   * around whatever the player is watching instead of the aim drifting off it.
   */
  private applyShake(dt: number): void {
    this.shake = Math.max(0, this.shake - dt / SHAKE_DECAY_SECONDS);
    this.shakePhase += dt * SHAKE_FREQUENCY_HZ;
    // Square the falloff so the kick lands hard and settles quickly.
    const amount = this.shake * this.shake * SHAKE_AMPLITUDE_M;
    this.camera.position.x += Math.sin(this.shakePhase) * amount;
    this.camera.position.y += Math.sin(this.shakePhase * 1.7 + 1.1) * amount;
    this.camera.position.z += Math.cos(this.shakePhase * 1.3) * amount;
  }

  private computeTargets(): void {
    const position = this.vehicle.body.translation();
    const velocity = this.vehicle.body.linvel();
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    const zoomScale =
      1 + MAX_ZOOM_OUT * Math.min(horizontalSpeed / MAX_SPEED_MPS, 1);
    const targetX = clamp(
      position.x +
        clamp(
          velocity.x * LOOK_AHEAD_TIME,
          -MAX_LOOK_AHEAD_DISTANCE,
          MAX_LOOK_AHEAD_DISTANCE,
        ),
      this.bounds.minX + BOUNDS_MARGIN,
      this.bounds.maxX - BOUNDS_MARGIN,
    );
    const targetZ = clamp(
      position.z +
        clamp(
          velocity.z * LOOK_AHEAD_TIME,
          -MAX_LOOK_AHEAD_DISTANCE,
          MAX_LOOK_AHEAD_DISTANCE,
        ),
      this.bounds.minZ + BOUNDS_MARGIN,
      this.bounds.maxZ - BOUNDS_MARGIN,
    );
    this.targetLookAt.set(targetX, position.y, targetZ);
    this.scratchOffset.copy(BASE_OFFSET).multiplyScalar(zoomScale);
    this.targetPosition.copy(this.targetLookAt).add(this.scratchOffset);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
