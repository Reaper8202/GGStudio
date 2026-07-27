import type * as THREE from 'three';
import type { SurfaceKind } from '../../core/surfaces.ts';

export interface MinimapFeature {
  /** Axis-aligned world-space footprint, metres. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  kind: 'road' | 'obstacle';
}

export interface ArenaBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Arena {
  readonly bounds: ArenaBounds;
  readonly spawnPoints: readonly THREE.Vector3[];
  readonly minimapFeatures: readonly MinimapFeature[];
  /** Surface kind for every collider this arena created. */
  surfaceOf(colliderHandle: number): SurfaceKind;
  whenReady(): Promise<void>;
  follow(vehicleObj: THREE.Object3D): void;
  dispose(): void;
}
