import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type {
  BiomeDefinition,
  BiomeLayout,
  FixturePlacement,
} from '../../core/biomes.ts';
import {
  makeRng,
  rngInt,
  rngRange,
  rngWeighted,
  type Rng,
} from '../../core/rng.ts';
import type { SurfaceKind } from '../../core/surfaces.ts';
import {
  clearVoxelAssetCache,
  loadVoxelInstanceSource,
} from '../VoxelAssetLoader.ts';
import type { Arena, ArenaBounds, MinimapFeature } from './Arena.ts';
import {
  addFixturePointLight,
  addLantern,
  ArenaColliders,
  sampleScatterPositions,
  VoxelPlacer,
  type ScatterPosition,
} from './placement.ts';

const SPAWN_RADIUS_VARIATION = 10;
const ROAD_TILE_SIZE = 1.6;
const ROAD_TILE_SPACING = ROAD_TILE_SIZE - 0.15;
const SURFACE_PATCH_HALF_HEIGHT = 0.005;

const COLLIDER_FIXTURE_ASSET = '@arena/collider';
const FIRE_FIXTURE_ASSET = '@arena/fire';
const GHOST_LIGHT_FIXTURE_ASSET = '@arena/ghost-light';
const LANTERN_FIXTURE_ASSET = '@arena/lantern';

interface TileTransform {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
  readonly scaleY: number;
}

interface CrossRoadLayout {
  readonly roadX: number;
  readonly sideRoadZ: number;
  readonly roadHalfWidth: number;
}

export interface ArenaBuilderOptions {
  /** False builds visuals only, skipping Rapier collider/rigid-body creation. */
  collidersEnabled?: boolean;
}

export class ArenaBuilder implements Arena {
  readonly bounds: ArenaBounds;
  readonly minimapFeatures: readonly MinimapFeature[];
  readonly spawnPoints: readonly THREE.Vector3[];

  private readonly root = new THREE.Group();
  private readonly minimapFeatureList: MinimapFeature[] = [];
  private readonly pendingPlacements: Promise<void>[] = [];
  private readonly followPosition = new THREE.Vector3();
  private readonly fallbackGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly fallbackMaterial = new THREE.MeshLambertMaterial({
    color: 0x596159,
    flatShading: true,
  });
  private readonly fallbackRoadMaterial = new THREE.MeshLambertMaterial({
    color: 0x343b37,
    flatShading: true,
  });
  private readonly fallbackGroundMaterial: THREE.MeshLambertMaterial;
  private readonly fallbackSpectralMaterial = new THREE.MeshLambertMaterial({
    color: 0x478c82,
    emissive: 0x245c56,
    flatShading: true,
  });
  private readonly lanternPostMaterial = new THREE.MeshStandardMaterial({
    color: 0x211b1b,
    roughness: 0.8,
  });
  private readonly lanternGlowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffb34f,
    emissive: 0xff7a21,
    emissiveIntensity: 5,
    roughness: 0.25,
  });
  private readonly previousBackground:
    THREE.Color | THREE.Texture | THREE.CubeTexture | null;
  private readonly previousFog: THREE.Fog | THREE.FogExp2 | null;
  private readonly background: THREE.Color;
  private readonly fog: THREE.FogExp2;
  private readonly focusLight: THREE.SpotLight;
  private readonly focusLightTarget: THREE.Object3D;
  private readonly moon: THREE.DirectionalLight;
  private readonly groundFallback: THREE.Mesh;
  private readonly rng: Rng;
  private readonly voxelPlacer: VoxelPlacer;
  private readonly colliders: ArenaColliders;
  private readonly roadLayout: CrossRoadLayout | null;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    world: RAPIER.World,
    private readonly biome: BiomeDefinition,
    seed: number,
    options: ArenaBuilderOptions = {},
  ) {
    const { layout, look } = biome;
    const collidersEnabled = options.collidersEnabled ?? true;
    this.rng = makeRng(seed);
    this.roadLayout = this.readRoadLayout(layout);
    this.bounds = {
      minX: -layout.halfSize,
      maxX: layout.halfSize,
      minZ: -layout.halfSize,
      maxZ: layout.halfSize,
    };
    this.root.name = biome.id;
    this.scene.add(this.root);

    this.previousBackground = scene.background;
    this.previousFog = scene.fog;
    this.background = new THREE.Color(look.background);
    this.fog = new THREE.FogExp2(look.fogColor, look.fogDensity);
    scene.background = this.background;
    scene.fog = this.fog;

    this.fallbackGroundMaterial = new THREE.MeshLambertMaterial({
      color: look.groundTint,
      flatShading: true,
    });
    this.voxelPlacer = new VoxelPlacer(
      this.root,
      layout.assetRoot,
      {
        fallbackGeometry: this.fallbackGeometry,
        fallbackMaterial: this.fallbackMaterial,
        fallbackRoadMaterial: this.fallbackRoadMaterial,
        fallbackSpectralMaterial: this.fallbackSpectralMaterial,
      },
      () => this.disposed,
      biome.id,
      new Set(
        layout.scatters.flatMap((scatter) =>
          scatter.table.map((entry) => entry.asset),
        ),
      ),
    );
    this.colliders = new ArenaColliders(
      world,
      collidersEnabled,
      layout.baseSurface,
      this.minimapFeatureList,
    );

    const lighting = this.buildLighting();
    this.focusLight = lighting.focusLight;
    this.focusLightTarget = lighting.focusTarget;
    this.moon = lighting.moon;

    this.buildBaseGroundCollider();
    this.groundFallback = this.buildGroundVisual();
    this.buildRoads();
    this.buildSurfacePatches();
    this.buildFixtures();
    this.buildScatters();
    this.voxelPlacer.flushVoxelBatches();

    this.minimapFeatures = Object.freeze(this.minimapFeatureList);
    this.spawnPoints = this.computeSpawnPoints();
  }

  surfaceOf(colliderHandle: number): SurfaceKind {
    return this.colliders.surfaceOf(colliderHandle);
  }

  /** Resolves once every async prop, road and ground tile has been added. */
  whenReady(): Promise<void> {
    return Promise.allSettled([
      ...this.pendingPlacements,
      this.voxelPlacer.whenReady(),
    ]).then(() => undefined);
  }

  /** Move the warm focus pool to the supplied vehicle visual. Call per frame. */
  follow(vehicleObj: THREE.Object3D): void {
    if (this.disposed) return;
    vehicleObj.getWorldPosition(this.followPosition);
    const { x, y, z } = this.followPosition;
    this.focusLight.position.set(x, y + 13, z + 5);
    this.focusLightTarget.position.set(x, Math.max(y, 0), z);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.colliders.dispose();

    const geometries = new Set<THREE.BufferGeometry>([this.fallbackGeometry]);
    const materials = new Set<THREE.Material>([
      this.fallbackMaterial,
      this.fallbackRoadMaterial,
      this.fallbackGroundMaterial,
      this.fallbackSpectralMaterial,
      this.lanternPostMaterial,
      this.lanternGlowMaterial,
    ]);
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      if (Array.isArray(object.material)) {
        for (const material of object.material) materials.add(material);
      } else {
        materials.add(object.material);
      }
    });

    const textures = new Set<THREE.Texture>();
    for (const material of materials) {
      const mapped = material as THREE.Material & {
        map?: THREE.Texture | null;
      };
      if (mapped.map) textures.add(mapped.map);
      material.dispose();
    }
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    this.moon.shadow.map?.dispose();
    this.focusLight.shadow.map?.dispose();

    this.scene.remove(this.root);
    this.root.clear();
    if (this.scene.background === this.background) {
      this.scene.background = this.previousBackground;
    }
    if (this.scene.fog === this.fog) this.scene.fog = this.previousFog;
    clearVoxelAssetCache();
  }

  private readRoadLayout(layout: BiomeLayout): CrossRoadLayout | null {
    if (layout.roadRule !== 'cross') return null;
    const candidate = layout as BiomeLayout & Partial<CrossRoadLayout>;
    if (
      !Number.isFinite(candidate.roadX) ||
      !Number.isFinite(candidate.sideRoadZ) ||
      !Number.isFinite(candidate.roadHalfWidth)
    ) {
      throw new Error(
        `Biome "${this.biome.id}" is missing its cross-road layout.`,
      );
    }
    return {
      roadX: candidate.roadX!,
      sideRoadZ: candidate.sideRoadZ!,
      roadHalfWidth: candidate.roadHalfWidth!,
    };
  }

  private buildLighting(): {
    focusLight: THREE.SpotLight;
    focusTarget: THREE.Object3D;
    moon: THREE.DirectionalLight;
  } {
    const { look } = this.biome;
    const ambientFill = new THREE.HemisphereLight(
      look.hemiSky,
      look.hemiGround,
      look.hemiIntensity,
    );
    this.root.add(ambientFill);

    const moon = new THREE.DirectionalLight(look.keyColor, look.keyIntensity);
    moon.position.set(29, 42, 24);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -42;
    moon.shadow.camera.right = 42;
    moon.shadow.camera.top = 42;
    moon.shadow.camera.bottom = -42;
    moon.shadow.camera.near = 8;
    moon.shadow.camera.far = 100;
    moon.shadow.bias = -0.0008;
    moon.shadow.normalBias = 0.035;
    this.root.add(moon, moon.target);

    const focusTarget = new THREE.Object3D();
    const focusLight = new THREE.SpotLight(
      look.focusColor,
      look.focusIntensity,
      26,
      Math.PI / 5.2,
      0.82,
      1.45,
    );
    focusLight.position.set(0, 14, 5);
    focusLight.target = focusTarget;
    this.root.add(focusLight, focusTarget);
    return { focusLight, focusTarget, moon };
  }

  private buildBaseGroundCollider(): void {
    const halfSize = this.biome.layout.halfSize;
    this.colliders.addBox(
      [halfSize, 0.5, halfSize],
      [0, -0.5, 0],
      this.biome.layout.baseSurface,
      0.9,
      false,
    );
  }

  private buildGroundVisual(): THREE.Mesh {
    const { layout } = this.biome;
    const halfSize = layout.halfSize;
    const fallback = new THREE.Mesh(
      this.fallbackGeometry,
      this.fallbackGroundMaterial,
    );
    fallback.name = `${this.biome.id}-ground-fallback`;
    fallback.position.y = -0.06;
    fallback.scale.set(halfSize * 2, 0.08, halfSize * 2);
    fallback.receiveShadow = true;
    this.root.add(fallback);

    const groundTileBaseOffset = -2.4;
    const footprintScale = 2.4;
    const tileSize = 8 * footprintScale;
    const tileSpacing = tileSize - footprintScale;
    const tileSpan = Math.ceil((halfSize * 2) / tileSpacing) + 2;
    const tileStart = -((tileSpan - 1) * tileSpacing) / 2 - tileSpacing / 2;
    const smoothZones = [
      { x: 0, z: 0, flatRadius: 9, blendRadius: 24, squash: 0.22 },
    ];
    const extraZoneCount = 4 + Math.floor(this.rng() * 4);
    for (let i = 0; i < extraZoneCount; i++) {
      const angle = this.rng() * Math.PI * 2;
      const radius = 10 + this.rng() * (halfSize - 14);
      const flatRadius = 3 + this.rng() * 6;
      smoothZones.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        flatRadius,
        blendRadius: flatRadius + 8 + this.rng() * 14,
        squash: 0.16 + this.rng() * 0.3,
      });
    }

    const tiles: TileTransform[] = [];
    for (let iz = 0; iz < tileSpan; iz++) {
      const rowStagger = (iz % 4) * (tileSpacing / 4);
      for (let ix = 0; ix < tileSpan; ix++) {
        const x = tileStart + ix * tileSpacing + rowStagger;
        const z = tileStart + iz * tileSpacing;
        const roughScaleY = 0.82 + this.rng() * 0.55;
        let scaleY =
          layout.terrainRoughness === 1
            ? roughScaleY
            : 1 + (roughScaleY - 1) * layout.terrainRoughness;
        for (const zone of smoothZones) {
          const dist = Math.hypot(x - zone.x, z - zone.z);
          const blend = THREE.MathUtils.smoothstep(
            dist,
            zone.flatRadius,
            zone.blendRadius,
          );
          scaleY = Math.min(
            scaleY,
            THREE.MathUtils.lerp(zone.squash, scaleY, blend),
          );
        }

        if (this.roadLayout !== null) {
          const mainRoadDist = Math.abs(x - this.roadLayout.roadX);
          const sideRoadDist =
            x > this.roadLayout.roadX
              ? Math.abs(z - this.roadLayout.sideRoadZ)
              : Infinity;
          const roadDist = Math.min(mainRoadDist, sideRoadDist);
          const roadBlend = THREE.MathUtils.smoothstep(
            roadDist,
            this.roadLayout.roadHalfWidth,
            this.roadLayout.roadHalfWidth + 5,
          );
          scaleY = Math.min(
            scaleY,
            THREE.MathUtils.lerp(0.04, scaleY, roadBlend),
          );
        }

        const overlapDepthBias = ((ix & 1) * 2 + (iz & 1)) * 0.02;
        tiles.push({
          x,
          z,
          y: groundTileBaseOffset * scaleY - overlapDepthBias,
          rotation: (Math.floor(this.rng() * 4) * Math.PI) / 2,
          scale: (0.92 + this.rng() * 0.24) * footprintScale,
          scaleY,
        });
      }
    }

    const pendingPlacement = loadVoxelInstanceSource(
      `${layout.assetRoot}/${layout.groundAsset}`,
    )
      .then(({ geometry, material, pivot }) => {
        if (this.disposed) return;
        // Every biome shares one ground mesh, so the tint is the only thing
        // making snow white and sand tan. Clone before recolouring: the loader
        // caches materials per asset, so mutating this one would repaint the
        // ground of every arena built afterwards.
        // Only recolour when the recipe drops the texture. A tint multiplies
        // against the map, so applying it to a textured ground can only darken
        // it — that silently crushed the graveyard, whose look depends on the
        // texture showing through untouched.
        let groundMaterial = material;
        if (layout.groundUntextured === true) {
          const tinted = material.clone() as THREE.Material & {
            color?: THREE.Color;
            map?: THREE.Texture | null;
          };
          tinted.map = null;
          tinted.color?.set(this.biome.look.groundTint);
          groundMaterial = tinted;
        }
        const mesh = new THREE.InstancedMesh(
          geometry,
          groundMaterial,
          tiles.length,
        );
        mesh.name = `${this.biome.id}-ground`;
        const pivotMatrix = new THREE.Matrix4().makeTranslation(
          pivot.x,
          pivot.y,
          pivot.z,
        );
        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        const position = new THREE.Vector3();
        const scale = new THREE.Vector3();
        for (let i = 0; i < tiles.length; i++) {
          const tile = tiles[i]!;
          position.set(tile.x, tile.y, tile.z);
          quaternion.setFromAxisAngle(up, tile.rotation);
          scale.set(tile.scale, tile.scaleY, tile.scale);
          matrix.compose(position, quaternion, scale).multiply(pivotMatrix);
          mesh.setMatrixAt(i, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        this.root.remove(this.groundFallback);
        this.root.add(mesh);
      })
      .catch((error: unknown) => {
        if (this.disposed) return;
        console.warn(
          `Using fallback for ${this.biome.id} asset "${layout.groundAsset}"`,
          error,
        );
      });
    this.pendingPlacements.push(pendingPlacement);
    return fallback;
  }

  private buildRoads(): void {
    if (this.roadLayout === null) return;
    const { assetRoot, halfSize } = this.biome.layout;
    const { roadX, sideRoadZ } = this.roadLayout;
    const laneHalfWidth = ROAD_TILE_SIZE / 2;
    const roadAsset = (asset: string): string =>
      assetRoot.replace(/\/+$/, '').endsWith('/graveyard')
        ? asset
        : `graveyard/${asset}`;

    this.minimapFeatureList.push(
      {
        minX: roadX - ROAD_TILE_SIZE,
        maxX: roadX + ROAD_TILE_SIZE,
        minZ: -halfSize,
        maxZ: halfSize,
        kind: 'road',
      },
      {
        minX: roadX,
        maxX: halfSize,
        minZ: sideRoadZ - ROAD_TILE_SIZE,
        maxZ: sideRoadZ + ROAD_TILE_SIZE,
        kind: 'road',
      },
    );

    this.placeRoadTile({
      asset: roadAsset('Road-Crossing-A'),
      x: roadX - laneHalfWidth,
      y: 0.02,
      z: sideRoadZ,
      castShadow: false,
      tint: this.biome.look.roadTint,
    });
    this.placeRoadTile({
      asset: roadAsset('Road-Crossing-B'),
      x: roadX + laneHalfWidth,
      y: 0.02,
      z: sideRoadZ,
      castShadow: false,
      tint: this.biome.look.roadTint,
    });

    const arms = [
      { dirX: 0, dirZ: -1, length: sideRoadZ + halfSize },
      { dirX: 0, dirZ: 1, length: halfSize - sideRoadZ },
      { dirX: 1, dirZ: 0, length: halfSize - roadX },
    ] as const;
    for (const arm of arms) {
      const tileCount = Math.max(
        0,
        Math.ceil((arm.length - laneHalfWidth) / ROAD_TILE_SPACING),
      );
      for (let i = 0; i < tileCount; i++) {
        const offset =
          laneHalfWidth + ROAD_TILE_SPACING / 2 + i * ROAD_TILE_SPACING;
        const z = sideRoadZ + arm.dirZ * offset;
        const gateCrosswalk =
          arm.dirZ === -1 && Math.abs(z + 29) < ROAD_TILE_SPACING / 2;
        const assetA = gateCrosswalk
          ? 'Road-Crossing-A'
          : i % 2 === 0
            ? 'Road-Street6-A'
            : 'Road-Street8-A';
        const assetB = gateCrosswalk
          ? 'Road-Crossing-B'
          : i % 2 === 0
            ? 'Road-Street6-B'
            : 'Road-Street8-B';
        const y = 0.025 + (i % 2) * 0.005;
        if (arm.dirZ !== 0) {
          this.placeRoadTile({
            asset: roadAsset(assetA),
            x: roadX - laneHalfWidth,
            y,
            z,
            castShadow: false,
            tint: this.biome.look.roadTint,
          });
          this.placeRoadTile({
            asset: roadAsset(assetB),
            x: roadX + laneHalfWidth,
            y,
            z,
            castShadow: false,
            tint: this.biome.look.roadTint,
          });
        } else {
          const x = roadX + arm.dirX * offset;
          this.placeRoadTile({
            asset: roadAsset(assetA),
            x,
            y,
            z: sideRoadZ + laneHalfWidth,
            rotation: Math.PI / 2,
            castShadow: false,
            tint: this.biome.look.roadTint,
          });
          this.placeRoadTile({
            asset: roadAsset(assetB),
            x,
            y,
            z: sideRoadZ - laneHalfWidth,
            rotation: Math.PI / 2,
            castShadow: false,
            tint: this.biome.look.roadTint,
          });
        }
      }
    }
  }

  private placeRoadTile(placement: FixturePlacement): void {
    this.voxelPlacer.placeVoxel(placement);
    this.colliders.addBox(
      [ROAD_TILE_SIZE / 2, SURFACE_PATCH_HALF_HEIGHT, ROAD_TILE_SIZE / 2],
      [placement.x, SURFACE_PATCH_HALF_HEIGHT, placement.z],
      this.biome.layout.roadSurface,
      0.9,
      false,
    );
  }

  private buildSurfacePatches(): void {
    const { halfSize, patches } = this.biome.layout;
    for (const patch of patches) {
      const minimumCount = Math.min(patch.count[0], patch.count[1]);
      const maximumCount = Math.max(patch.count[0], patch.count[1]);
      const count = rngInt(this.rng, minimumCount, maximumCount + 1);
      for (let i = 0; i < count; i++) {
        const radius = rngRange(
          this.rng,
          Math.min(patch.radius[0], patch.radius[1]),
          Math.max(patch.radius[0], patch.radius[1]),
        );
        const clampedRadius = Math.min(Math.max(radius, 0), halfSize);
        this.colliders.addBox(
          [clampedRadius, SURFACE_PATCH_HALF_HEIGHT, clampedRadius],
          [
            rngRange(
              this.rng,
              -halfSize + clampedRadius,
              halfSize - clampedRadius,
            ),
            SURFACE_PATCH_HALF_HEIGHT,
            rngRange(
              this.rng,
              -halfSize + clampedRadius,
              halfSize - clampedRadius,
            ),
          ],
          patch.surface,
          0.9,
          false,
        );
      }
    }
  }

  private buildFixtures(): void {
    for (const fixture of this.biome.layout.fixtures ?? []) {
      this.placeFixture(fixture);
    }
  }

  private placeFixture(fixture: FixturePlacement): void {
    switch (fixture.asset) {
      case COLLIDER_FIXTURE_ASSET:
        break;
      case FIRE_FIXTURE_ASSET:
        addFixturePointLight(this.root, fixture, 0xff6a2b, 30, 10);
        break;
      case GHOST_LIGHT_FIXTURE_ASSET:
        addFixturePointLight(this.root, fixture, 0x66ffe0, 22, 11);
        break;
      case LANTERN_FIXTURE_ASSET:
        addLantern(
          this.root,
          fixture,
          this.fallbackGeometry,
          this.lanternPostMaterial,
          this.lanternGlowMaterial,
        );
        break;
      default:
        this.voxelPlacer.placeVoxel(fixture);
    }

    if (fixture.collider === undefined || fixture.collider === 'none') return;
    const size = fixture.colliderSize;
    if (size === undefined) return;
    if (fixture.collider === 'box') {
      this.colliders.addBox(
        size,
        [fixture.x, (fixture.y ?? 0) + size[1], fixture.z],
        this.biome.layout.baseSurface,
        0.2,
        true,
      );
      return;
    }
    this.colliders.addCylinder(
      size[0],
      size[1],
      [fixture.x, (fixture.y ?? 0) + size[1] / 2, fixture.z],
      this.biome.layout.baseSurface,
    );
  }

  private buildScatters(): void {
    const occupied: ScatterPosition[] = [];
    for (const scatter of this.biome.layout.scatters) {
      const positions = sampleScatterPositions(
        scatter,
        this.bounds,
        this.rng,
        occupied,
      );
      occupied.push(...positions);
      for (const position of positions) {
        const prop = rngWeighted(
          this.rng,
          scatter.table.map((entry) => ({
            item: entry,
            weight: entry.weight,
          })),
        );
        const scale =
          prop.scale === undefined
            ? 1
            : rngRange(this.rng, prop.scale[0], prop.scale[1]);
        const scaleY =
          prop.scaleY === undefined
            ? undefined
            : rngRange(this.rng, prop.scaleY[0], prop.scaleY[1]);
        const colliderSize =
          prop.colliderSize === undefined
            ? undefined
            : prop.collider === 'cylinder'
              ? ([
                  prop.colliderSize[0] * scale,
                  prop.colliderSize[1] * (scaleY ?? scale),
                  0,
                ] as const)
              : ([
                  prop.colliderSize[0] * scale,
                  prop.colliderSize[1] * (scaleY ?? scale),
                  prop.colliderSize[2] * scale,
                ] as const);
        this.placeFixture({
          asset: prop.asset,
          x: position.x,
          z: position.z,
          rotation: rngRange(this.rng, 0, Math.PI * 2),
          scale,
          scaleY,
          tint: prop.tint,
          collider: prop.collider,
          colliderSize,
        });
      }
    }
  }

  /** Ring of horde anchors around the map centre with organic angle/radius jitter. */
  private computeSpawnPoints(): THREE.Vector3[] {
    const { halfSize, spawnPointCount } = this.biome.layout;
    const points: THREE.Vector3[] = [];
    const slice = (Math.PI * 2) / spawnPointCount;
    const spawnRadius = halfSize - 3;
    for (let i = 0; i < spawnPointCount; i++) {
      const angle = i * slice + (this.rng() - 0.5) * slice * 0.7;
      const radius = spawnRadius - this.rng() * SPAWN_RADIUS_VARIATION;
      points.push(
        new THREE.Vector3(
          Math.cos(angle) * radius,
          0,
          Math.sin(angle) * radius,
        ),
      );
    }
    return points;
  }
}
