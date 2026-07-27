import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type {
  FixturePlacement,
  PropScatter,
  Tint,
} from '../../core/biomes.ts';
import { rngInt, rngRange, type Rng } from '../../core/rng.ts';
import type { SurfaceKind } from '../../core/surfaces.ts';
import { GROUP_TERRAIN } from '../../runtime/assembler.ts';
import {
  instantiateVoxelAsset,
  loadVoxelInstanceSource,
} from '../VoxelAssetLoader.ts';
import type { ArenaBounds, MinimapFeature } from './Arena.ts';

type Size3 = readonly [number, number, number];

const TERRAIN_GROUPS = (GROUP_TERRAIN << 16) | 0xffff;
const MAX_SCATTER_ATTEMPTS_PER_PROP = 64;
const MIN_SCATTER_ATTEMPTS = 128;
const FALLBACK_DEFAULT: Size3 = [1, 1, 1];
const FALLBACK_ROAD: Size3 = [1.6, 0.06, 1.6];
const FALLBACK_SIGN: Size3 = [0.45, 1.5, 0.25];
const FALLBACK_FENCE: Size3 = [1.8, 1.35, 0.18];
const FALLBACK_PILLAR: Size3 = [0.8, 2.4, 0.8];
const FALLBACK_TREE: Size3 = [2.2, 4, 2.2];
const FALLBACK_TOMB: Size3 = [0.8, 1.2, 0.45];
const FALLBACK_PERSON: Size3 = [0.8, 1.8, 0.65];
const FALLBACK_BARRICADE: Size3 = [2, 0.75, 0.55];

function isBatchableAsset(
  asset: string,
  scatteredAssets: ReadonlySet<string>,
): boolean {
  const basename = asset.slice(asset.lastIndexOf('/') + 1);
  return (
    scatteredAssets.has(asset) ||
    basename === 'SM-7-Fence' ||
    basename.startsWith('Road-Street') ||
    basename.startsWith('Road-Crossing')
  );
}

function tintKey(tint: Tint | undefined): string {
  if (tint === undefined) return '';
  if (typeof tint === 'number') return `all:${tint}`;
  return Object.entries(tint)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, color]) => `${name}:${color}`)
    .join(',');
}

function voxelBatchKey(placement: FixturePlacement): string {
  return [
    placement.asset,
    tintKey(placement.tint),
    placement.emissive ?? '',
    placement.castShadow ?? true,
  ].join('|');
}

function materialList(
  material: THREE.Material | readonly THREE.Material[],
): readonly THREE.Material[] {
  if (Array.isArray(material)) return material;
  return [material as THREE.Material];
}

function applyMaterialStyle(
  material: THREE.Material | readonly THREE.Material[],
  tint: Tint | undefined,
  emissive: number | undefined,
): void {
  const materials = materialList(material);
  const tintNames =
    tint !== undefined && typeof tint !== 'number' ? Object.keys(tint) : [];
  // The current voxel adapter discards OBJ material names. Its material array
  // retains MTL order, so recover names only for an exact one-to-one table.
  const recoveredNames =
    tintNames.length === materials.length &&
    materials.every((entry) => entry.name === '')
      ? tintNames
      : undefined;

  for (let index = 0; index < materials.length; index++) {
    const entry = materials[index]!;
    const colored = entry as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
    };
    if (typeof tint === 'number') {
      colored.color?.set(tint);
    } else if (tint !== undefined) {
      const override = tint[entry.name || recoveredNames?.[index] || ''];
      if (override !== undefined) colored.color?.set(override);
    }
    if (emissive !== undefined) colored.emissive?.set(emissive);
  }
}

export interface ScatterPosition {
  readonly x: number;
  readonly z: number;
}

/**
 * Deterministically rejection-samples one scatter pass. Previously accepted
 * positions may be supplied so spacing is shared across multiple passes.
 */
export function sampleScatterPositions(
  scatter: PropScatter,
  bounds: ArenaBounds,
  rng: Rng,
  occupied: readonly ScatterPosition[] = [],
): ScatterPosition[] {
  const minimumCount = Math.min(scatter.count[0], scatter.count[1]);
  const maximumCount = Math.max(scatter.count[0], scatter.count[1]);
  const targetCount = rngInt(rng, minimumCount, maximumCount + 1);
  const accepted: ScatterPosition[] = [];
  const minSpacingSquared = scatter.minSpacing * scatter.minSpacing;
  const keepClearSquared = scatter.keepClearRadius * scatter.keepClearRadius;
  const attemptLimit = Math.max(
    MIN_SCATTER_ATTEMPTS,
    targetCount * MAX_SCATTER_ATTEMPTS_PER_PROP,
  );

  for (
    let attempts = 0;
    attempts < attemptLimit && accepted.length < targetCount;
    attempts += 1
  ) {
    const candidate = {
      x: rngRange(rng, bounds.minX, bounds.maxX),
      z: rngRange(rng, bounds.minZ, bounds.maxZ),
    };
    if (
      candidate.x * candidate.x + candidate.z * candidate.z <
      keepClearSquared
    ) {
      continue;
    }
    const overlaps = [...occupied, ...accepted].some((position) => {
      const dx = candidate.x - position.x;
      const dz = candidate.z - position.z;
      return dx * dx + dz * dz < minSpacingSquared;
    });
    if (!overlaps) accepted.push(candidate);
  }

  return accepted;
}

/** Owns every static arena body and its driving-surface registration. */
export class ArenaColliders {
  private readonly bodies: RAPIER.RigidBody[] = [];
  private readonly surfaces = new Map<number, SurfaceKind>();

  constructor(
    private readonly world: RAPIER.World,
    private readonly enabled: boolean,
    private readonly fallbackSurface: SurfaceKind,
    private readonly minimapFeatures: MinimapFeature[],
  ) {}

  surfaceOf(colliderHandle: number): SurfaceKind {
    return this.surfaces.get(colliderHandle) ?? this.fallbackSurface;
  }

  addBox(
    halfExtents: Size3,
    position: Size3,
    surface: SurfaceKind,
    friction: number,
    minimapObstacle: boolean,
  ): void {
    if (minimapObstacle) {
      this.minimapFeatures.push({
        minX: position[0] - halfExtents[0],
        maxX: position[0] + halfExtents[0],
        minZ: position[2] - halfExtents[2],
        maxZ: position[2] + halfExtents[2],
        kind: 'obstacle',
      });
    }
    if (!this.enabled) return;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(...position),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(...halfExtents)
        .setFriction(friction)
        .setCollisionGroups(TERRAIN_GROUPS),
      body,
    );
    this.bodies.push(body);
    this.surfaces.set(collider.handle, surface);
  }

  addCylinder(
    radius: number,
    height: number,
    position: Size3,
    surface: SurfaceKind,
  ): void {
    this.minimapFeatures.push({
      minX: position[0] - radius,
      maxX: position[0] + radius,
      minZ: position[2] - radius,
      maxZ: position[2] + radius,
      kind: 'obstacle',
    });
    if (!this.enabled) return;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(...position),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(height / 2, radius)
        .setFriction(0.15)
        .setCollisionGroups(TERRAIN_GROUPS),
      body,
    );
    this.bodies.push(body);
    this.surfaces.set(collider.handle, surface);
  }

  dispose(): void {
    for (const body of this.bodies) this.world.removeRigidBody(body);
    this.bodies.length = 0;
    this.surfaces.clear();
  }
}

export function addFixturePointLight(
  root: THREE.Group,
  fixture: FixturePlacement,
  color: number,
  intensity: number,
  distance: number,
): void {
  const light = new THREE.PointLight(color, intensity, distance, 2);
  light.position.set(fixture.x, fixture.y ?? 0, fixture.z);
  root.add(light);
}

export function addLantern(
  root: THREE.Group,
  fixture: FixturePlacement,
  geometry: THREE.BoxGeometry,
  postMaterial: THREE.MeshStandardMaterial,
  glowMaterial: THREE.MeshStandardMaterial,
): void {
  const group = new THREE.Group();
  group.position.set(fixture.x, fixture.y ?? 0, fixture.z);
  const post = new THREE.Mesh(geometry, postMaterial);
  post.position.y = 1.25;
  post.scale.set(0.16, 2.5, 0.16);
  post.castShadow = true;
  group.add(post);
  const cap = new THREE.Mesh(geometry, postMaterial);
  cap.position.y = 2.55;
  cap.scale.set(0.56, 0.16, 0.56);
  cap.castShadow = true;
  group.add(cap);
  const glow = new THREE.Mesh(geometry, glowMaterial);
  glow.position.y = 2.28;
  glow.scale.set(0.34, 0.42, 0.34);
  group.add(glow);
  const light = new THREE.PointLight(0xff9d45, 36, 11, 2);
  light.position.y = 2.3;
  group.add(light);
  root.add(group);
}

export interface VoxelPlacementResources {
  fallbackGeometry: THREE.BoxGeometry;
  fallbackMaterial: THREE.MeshLambertMaterial;
  fallbackRoadMaterial: THREE.MeshLambertMaterial;
  fallbackSpectralMaterial: THREE.MeshLambertMaterial;
}

/** Async voxel loading and instanced batching used by arena generation. */
export class VoxelPlacer {
  private readonly voxelBatches = new Map<
    string,
    { asset: string; placements: FixturePlacement[] }
  >();
  private readonly pendingPlacements: Promise<void>[] = [];
  private readonly failedAssets = new Set<string>();

  constructor(
    private readonly root: THREE.Group,
    private readonly assetRoot: string,
    private readonly resources: VoxelPlacementResources,
    private readonly isDisposed: () => boolean,
    private readonly arenaName: string,
    private readonly scatteredAssets: ReadonlySet<string> = new Set(),
  ) {}

  placeVoxel(placement: FixturePlacement): void {
    if (isBatchableAsset(placement.asset, this.scatteredAssets)) {
      const key = voxelBatchKey(placement);
      const batch = this.voxelBatches.get(key);
      if (batch) batch.placements.push(placement);
      else {
        this.voxelBatches.set(key, {
          asset: placement.asset,
          placements: [placement],
        });
      }
      return;
    }
    const pendingPlacement = instantiateVoxelAsset(
      `${this.assetRoot}/${placement.asset}`,
      placement.tint !== undefined || placement.emissive !== undefined,
    )
      .then((object) => {
        if (this.isDisposed()) return;
        const scale = placement.scale ?? 1;
        object.position.set(placement.x, placement.y ?? 0, placement.z);
        object.rotation.y = placement.rotation ?? 0;
        object.scale.set(scale, placement.scaleY ?? scale, scale);
        object.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          child.castShadow = placement.castShadow ?? true;
          if (
            placement.tint === undefined &&
            placement.emissive === undefined
          ) {
            return;
          }
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];
          applyMaterialStyle(materials, placement.tint, placement.emissive);
        });
        this.root.add(object);
      })
      .catch((error: unknown) => {
        if (this.isDisposed()) return;
        this.placeFallback(placement);
        this.reportAssetFailure(placement.asset, error);
      });
    this.pendingPlacements.push(pendingPlacement);
  }

  flushVoxelBatches(): void {
    for (const { asset, placements } of this.voxelBatches.values()) {
      const pendingPlacement = loadVoxelInstanceSource(
        `${this.assetRoot}/${asset}`,
      )
        .then(({ geometry, material, pivot }) => {
          if (this.isDisposed()) return;
          const batchMaterial: THREE.Material | THREE.Material[] =
            Array.isArray(material)
              ? material.map((entry: THREE.Material) => entry.clone())
              : material.clone();
          const style = placements[0]!;
          applyMaterialStyle(batchMaterial, style.tint, style.emissive);

          const mesh = new THREE.InstancedMesh(
            geometry,
            batchMaterial,
            placements.length,
          );
          mesh.name = `${this.arenaName}-batch:${asset}`;
          mesh.castShadow = style.castShadow ?? true;
          mesh.receiveShadow = true;
          const pivotMatrix = new THREE.Matrix4().makeTranslation(
            pivot.x,
            pivot.y,
            pivot.z,
          );
          const matrix = new THREE.Matrix4();
          const quaternion = new THREE.Quaternion();
          const up = new THREE.Vector3(0, 1, 0);
          const position = new THREE.Vector3();
          const scaleVector = new THREE.Vector3();
          for (let i = 0; i < placements.length; i++) {
            const placement = placements[i]!;
            const scale = placement.scale ?? 1;
            position.set(placement.x, placement.y ?? 0, placement.z);
            quaternion.setFromAxisAngle(up, placement.rotation ?? 0);
            scaleVector.set(scale, placement.scaleY ?? scale, scale);
            matrix
              .compose(position, quaternion, scaleVector)
              .multiply(pivotMatrix);
            mesh.setMatrixAt(i, matrix);
          }
          mesh.instanceMatrix.needsUpdate = true;
          this.root.add(mesh);
        })
        .catch((error: unknown) => {
          if (this.isDisposed()) return;
          for (const placement of placements) this.placeFallback(placement);
          this.reportAssetFailure(asset, error);
        });
      this.pendingPlacements.push(pendingPlacement);
    }
    this.voxelBatches.clear();
  }

  whenReady(): Promise<void> {
    if (this.pendingPlacements.length === 0) return Promise.resolve();
    return Promise.allSettled(this.pendingPlacements).then(() => undefined);
  }

  private placeFallback(placement: FixturePlacement): void {
    const dimensions = this.fallbackDimensions(placement.asset);
    const scale = placement.scale ?? 1;
    const scaleY = placement.scaleY ?? scale;
    const height = dimensions[1] * scaleY;
    const basename = placement.asset.slice(
      placement.asset.lastIndexOf('/') + 1,
    );
    const material = basename.startsWith('Road-')
      ? this.resources.fallbackRoadMaterial
      : basename === 'SM-2-Ghost'
        ? this.resources.fallbackSpectralMaterial
        : this.resources.fallbackMaterial;
    const mesh = new THREE.Mesh(this.resources.fallbackGeometry, material);
    mesh.name = `fallback:${placement.asset}`;
    mesh.position.set(
      placement.x,
      (placement.y ?? 0) + height / 2,
      placement.z,
    );
    mesh.rotation.y = placement.rotation ?? 0;
    mesh.scale.set(dimensions[0] * scale, height, dimensions[2] * scale);
    mesh.castShadow = placement.castShadow ?? true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  private fallbackDimensions(asset: string): Size3 {
    const basename = asset.slice(asset.lastIndexOf('/') + 1);
    if (
      basename.startsWith('Road-Street') ||
      basename.startsWith('Road-Crossing')
    ) {
      return FALLBACK_ROAD;
    }
    if (basename === 'RoadSign-66') return FALLBACK_SIGN;
    if (basename === 'SM-7-Fence') return FALLBACK_FENCE;
    if (basename === 'SM-8-Pillar') return FALLBACK_PILLAR;
    if (basename === 'SM-1-Tree') return FALLBACK_TREE;
    if (basename.includes('Tomb')) return FALLBACK_TOMB;
    if (basename === 'SM-2-Ghost' || basename === 'SM-11-Igor_wSpade') {
      return FALLBACK_PERSON;
    }
    if (basename.includes('Barricade') || basename.includes('BarbedWires')) {
      return FALLBACK_BARRICADE;
    }
    return FALLBACK_DEFAULT;
  }

  private reportAssetFailure(asset: string, error: unknown): void {
    if (this.isDisposed() || this.failedAssets.has(asset)) return;
    this.failedAssets.add(asset);
    console.warn(
      `Using fallback for ${this.arenaName} asset "${asset}"`,
      error,
    );
  }
}

export interface WallSpec {
  readonly size: readonly [number, number, number];
  readonly pos: readonly [number, number, number];
}

/**
 * The four boundary walls of an arena, derived purely from its half size.
 *
 * The base ground collider stops exactly at halfSize while the cosmetic ground
 * tiles overhang it, so without these the player drives onto ground that
 * visibly exists and falls through. This used to be authored per-recipe, which
 * meant only the graveyard had a boundary at all.
 */
export function perimeterWalls(halfSize: number): WallSpec[] {
  const span = halfSize + 1;
  return [
    { size: [span, 2, 0.5], pos: [0, 2, -halfSize] },
    { size: [span, 2, 0.5], pos: [0, 2, halfSize] },
    { size: [0.5, 2, span], pos: [-halfSize, 2, 0] },
    { size: [0.5, 2, span], pos: [halfSize, 2, 0] },
  ];
}
