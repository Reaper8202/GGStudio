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

/** Allocation-free, world-aligned follow camera ported from zombie-car. */
export class FollowCamera {
  private readonly currentPosition = new THREE.Vector3();
  private readonly currentLookAt = new THREE.Vector3();
  private readonly targetPosition = new THREE.Vector3();
  private readonly targetLookAt = new THREE.Vector3();
  private readonly scratchOffset = new THREE.Vector3();
  private initialized = false;

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
    this.camera.lookAt(this.currentLookAt);
  }

  snap(): void {
    this.computeTargets();
    this.currentPosition.copy(this.targetPosition);
    this.currentLookAt.copy(this.targetLookAt);
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
    this.initialized = true;
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
