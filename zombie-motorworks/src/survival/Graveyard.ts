import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GROUP_TERRAIN } from '../runtime/assembler.ts';
import {
  clearVoxelAssetCache,
  instantiateVoxelAsset,
  loadVoxelInstanceSource,
} from './VoxelAssetLoader.ts';

const ASSET_ROOT = `${import.meta.env.BASE_URL}assets/graveyard`;
const HALF_SIZE = 35;
const SPAWN_RADIUS = 32;
const SPAWN_POINT_COUNT = 14;
const ROAD_HALF_WIDTH = 1.7;
const ROAD_X = -6;
const SIDE_ROAD_Z = 8;
const TERRAIN_GROUPS = (GROUP_TERRAIN << 16) | 0xffff;

interface VoxelPlacement {
  readonly asset: string;
  readonly x: number;
  readonly z: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly scale?: number;
  readonly scaleY?: number;
  readonly castShadow?: boolean;
  readonly tint?: THREE.ColorRepresentation;
  readonly emissive?: THREE.ColorRepresentation;
}

export interface GraveyardOptions {
  /** False builds visuals only, skipping Rapier collider/rigid-body creation. Defaults to true. */
  collidersEnabled?: boolean;
}

interface TileTransform {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
  readonly scaleY: number;
}

function isBatchableAsset(asset: string): boolean {
  return (
    asset === 'SM-7-Fence' ||
    asset.startsWith('Road-Street') ||
    asset.startsWith('Road-Crossing')
  );
}

type Size3 = readonly [number, number, number];

const FALLBACK_DEFAULT: Size3 = [1, 1, 1];
const FALLBACK_ROAD: Size3 = [1.6, 0.06, 1.6];
const FALLBACK_SIGN: Size3 = [0.45, 1.5, 0.25];
const FALLBACK_FENCE: Size3 = [1.8, 1.35, 0.18];
const FALLBACK_PILLAR: Size3 = [0.8, 2.4, 0.8];
const FALLBACK_TREE: Size3 = [2.2, 4, 2.2];
const FALLBACK_TOMB: Size3 = [0.8, 1.2, 0.45];
const FALLBACK_PERSON: Size3 = [0.8, 1.8, 0.65];
const FALLBACK_BARRICADE: Size3 = [2, 0.75, 0.55];

export class Graveyard {
  readonly bounds = {
    minX: -HALF_SIZE,
    maxX: HALF_SIZE,
    minZ: -HALF_SIZE,
    maxZ: HALF_SIZE,
  };
  readonly spawnPoints: readonly THREE.Vector3[];

  private readonly root = new THREE.Group();
  private readonly staticBodies: RAPIER.RigidBody[] = [];
  private readonly voxelBatches = new Map<string, VoxelPlacement[]>();
  private readonly failedAssets = new Set<string>();
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
  private readonly fallbackGroundMaterial = new THREE.MeshLambertMaterial({
    color: 0x1f3029,
    flatShading: true,
  });
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
  private readonly background = new THREE.Color(0x080b14);
  private readonly fog = new THREE.FogExp2(0x080b14, 0.012);
  private readonly focusLight: THREE.SpotLight;
  private readonly focusLightTarget: THREE.Object3D;
  private readonly moon: THREE.DirectionalLight;
  private readonly groundFallback: THREE.Mesh;
  private readonly collidersEnabled: boolean;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: RAPIER.World,
    options: GraveyardOptions = {},
  ) {
    this.collidersEnabled = options.collidersEnabled ?? true;
    this.root.name = 'graveyard';
    this.scene.add(this.root);
    this.previousBackground = scene.background;
    this.previousFog = scene.fog;
    scene.background = this.background;
    scene.fog = this.fog;

    const lighting = this.buildLighting();
    this.focusLight = lighting.focusLight;
    this.focusLightTarget = lighting.focusTarget;
    this.moon = lighting.moon;

    this.groundFallback = this.buildGroundVisual();
    this.buildRoads();
    this.buildPerimeter();
    this.buildGate();
    this.buildBurialPlot();
    this.buildCaretakerCorner();
    this.buildAncientTree();
    this.buildCheckpointAndMonument();
    this.buildScatter();
    this.buildRoadSigns();
    this.buildLanterns();
    this.flushVoxelBatches();
    this.spawnPoints = this.computeSpawnPoints();
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

    for (const body of this.staticBodies) this.world.removeRigidBody(body);
    this.staticBodies.length = 0;

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

  private buildLighting(): {
    focusLight: THREE.SpotLight;
    focusTarget: THREE.Object3D;
    moon: THREE.DirectionalLight;
  } {
    const ambientFill = new THREE.HemisphereLight(0x6c84b5, 0x2d243e, 1.08);
    this.root.add(ambientFill);

    const moon = new THREE.DirectionalLight(0x9cbcff, 2.75);
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
      0xffd6a0,
      58,
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

  private buildGroundVisual(): THREE.Mesh {
    const fallback = new THREE.Mesh(
      this.fallbackGeometry,
      this.fallbackGroundMaterial,
    );
    fallback.name = 'graveyard-ground-fallback';
    fallback.position.y = -0.06;
    fallback.scale.set(HALF_SIZE * 2, 0.08, HALF_SIZE * 2);
    fallback.receiveShadow = true;
    this.root.add(fallback);

    const groundTileBaseOffset = -2.4;
    const footprintScale = 2.4;
    const tileSize = 8 * footprintScale;
    const tileSpacing = tileSize - footprintScale;
    const tileSpan = Math.ceil((HALF_SIZE * 2) / tileSpacing) + 2;
    const tileStart = -((tileSpan - 1) * tileSpacing) / 2 - tileSpacing / 2;
    const smoothZones = [
      { x: 0, z: 0, flatRadius: 9, blendRadius: 24, squash: 0.22 },
    ];
    const extraZoneCount = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < extraZoneCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 10 + Math.random() * (HALF_SIZE - 14);
      const flatRadius = 3 + Math.random() * 6;
      smoothZones.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        flatRadius,
        blendRadius: flatRadius + 8 + Math.random() * 14,
        squash: 0.16 + Math.random() * 0.3,
      });
    }

    const tiles: TileTransform[] = [];
    for (let iz = 0; iz < tileSpan; iz++) {
      const rowStagger = (iz % 4) * (tileSpacing / 4);
      for (let ix = 0; ix < tileSpan; ix++) {
        const x = tileStart + ix * tileSpacing + rowStagger;
        const z = tileStart + iz * tileSpacing;
        let scaleY = 0.82 + Math.random() * 0.55;
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

        const mainRoadDist = Math.abs(x - ROAD_X);
        const sideRoadDist = x > ROAD_X ? Math.abs(z - SIDE_ROAD_Z) : Infinity;
        const roadDist = Math.min(mainRoadDist, sideRoadDist);
        const roadBlend = THREE.MathUtils.smoothstep(
          roadDist,
          ROAD_HALF_WIDTH,
          ROAD_HALF_WIDTH + 5,
        );
        scaleY = Math.min(
          scaleY,
          THREE.MathUtils.lerp(0.04, scaleY, roadBlend),
        );

        const overlapDepthBias = ((ix & 1) * 2 + (iz & 1)) * 0.02;
        tiles.push({
          x,
          z,
          y: groundTileBaseOffset * scaleY - overlapDepthBias,
          rotation: (Math.floor(Math.random() * 4) * Math.PI) / 2,
          scale: (0.92 + Math.random() * 0.24) * footprintScale,
          scaleY,
        });
      }
    }

    void loadVoxelInstanceSource(`${ASSET_ROOT}/SM-0-Ground`)
      .then(({ geometry, material, pivot }) => {
        if (this.disposed) return;
        const mesh = new THREE.InstancedMesh(geometry, material, tiles.length);
        mesh.name = 'graveyard-ground';
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
          const tile = tiles[i];
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
        this.reportAssetFailure('SM-0-Ground', error);
      });
    return fallback;
  }

  private buildRoads(): void {
    const nativeTileSize = 1.6;
    const laneHalfWidth = nativeTileSize / 2;
    const tileSpacing = nativeTileSize - 0.15;
    const roadTint = 0x4a5a4e;

    this.placeVoxel({
      asset: 'Road-Crossing-A',
      x: ROAD_X - laneHalfWidth,
      y: 0.02,
      z: SIDE_ROAD_Z,
      castShadow: false,
      tint: roadTint,
    });
    this.placeVoxel({
      asset: 'Road-Crossing-B',
      x: ROAD_X + laneHalfWidth,
      y: 0.02,
      z: SIDE_ROAD_Z,
      castShadow: false,
      tint: roadTint,
    });

    const arms = [
      { dirX: 0, dirZ: -1, length: SIDE_ROAD_Z + HALF_SIZE },
      { dirX: 0, dirZ: 1, length: HALF_SIZE - SIDE_ROAD_Z },
      { dirX: 1, dirZ: 0, length: HALF_SIZE - ROAD_X },
    ] as const;
    for (const arm of arms) {
      const tileCount = Math.max(
        0,
        Math.ceil((arm.length - laneHalfWidth) / tileSpacing),
      );
      for (let i = 0; i < tileCount; i++) {
        const offset = laneHalfWidth + tileSpacing / 2 + i * tileSpacing;
        const z = SIDE_ROAD_Z + arm.dirZ * offset;
        const gateCrosswalk =
          arm.dirZ === -1 && Math.abs(z + 29) < tileSpacing / 2;
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
          this.placeVoxel({
            asset: assetA,
            x: ROAD_X - laneHalfWidth,
            y,
            z,
            castShadow: false,
            tint: roadTint,
          });
          this.placeVoxel({
            asset: assetB,
            x: ROAD_X + laneHalfWidth,
            y,
            z,
            castShadow: false,
            tint: roadTint,
          });
        } else {
          const x = ROAD_X + arm.dirX * offset;
          this.placeVoxel({
            asset: assetA,
            x,
            y,
            z: SIDE_ROAD_Z + laneHalfWidth,
            rotation: Math.PI / 2,
            castShadow: false,
            tint: roadTint,
          });
          this.placeVoxel({
            asset: assetB,
            x,
            y,
            z: SIDE_ROAD_Z - laneHalfWidth,
            rotation: Math.PI / 2,
            castShadow: false,
            tint: roadTint,
          });
        }
      }
    }
  }

  private buildPerimeter(): void {
    const thickness = 1;
    const height = 4;
    this.addStaticBoxCollider(
      [HALF_SIZE * 2 + thickness * 2, height, thickness],
      [0, height / 2, -HALF_SIZE],
    );
    this.addStaticBoxCollider(
      [HALF_SIZE * 2 + thickness * 2, height, thickness],
      [0, height / 2, HALF_SIZE],
    );
    this.addStaticBoxCollider(
      [thickness, height, HALF_SIZE * 2 + thickness * 2],
      [-HALF_SIZE, height / 2, 0],
    );
    this.addStaticBoxCollider(
      [thickness, height, HALF_SIZE * 2 + thickness * 2],
      [HALF_SIZE, height / 2, 0],
    );

    for (let p = -33.5; p <= 33.5; p += 2) {
      this.placeVoxel({ asset: 'SM-7-Fence', x: p, z: -34.45, scale: 0.92 });
      this.placeVoxel({
        asset: 'SM-7-Fence',
        x: p,
        z: 34.45,
        scale: 0.92,
        rotation: Math.PI,
      });
      this.placeVoxel({
        asset: 'SM-7-Fence',
        x: -34.45,
        z: p,
        scale: 0.92,
        rotation: Math.PI / 2,
      });
      this.placeVoxel({
        asset: 'SM-7-Fence',
        x: 34.45,
        z: p,
        scale: 0.92,
        rotation: -Math.PI / 2,
      });
    }
  }

  private buildGate(): void {
    const left = ROAD_X - 4.2;
    const right = ROAD_X + 4.2;
    this.placeVoxel({
      asset: 'SM-8-Pillar',
      x: left,
      z: -30.5,
      rotation: Math.PI / 2,
      scale: 1.3,
    });
    this.placeVoxel({
      asset: 'SM-8-Pillar',
      x: right,
      z: -30.5,
      rotation: -Math.PI / 2,
      scale: 1.3,
    });
    this.addStaticBoxCollider([1.3, 3.2, 1.3], [left, 1.6, -30.5]);
    this.addStaticBoxCollider([1.3, 3.2, 1.3], [right, 1.6, -30.5]);
  }

  private buildBurialPlot(): void {
    this.placeFenceRun(-27.6, -28, 1.8, 0, 9, 0);
    this.placeFenceRun(-28.5, -26.2, 0, 1.8, 7, Math.PI / 2);
    this.placeFenceRun(-11.5, -26.2, 0, 1.8, 4, -Math.PI / 2);
    this.placeFenceRun(-27.6, -14.2, 1.8, 0, 3, Math.PI);
    this.placeFenceRun(-17.4, -14.2, 1.8, 0, 3, Math.PI);
    this.placeVoxel({ asset: 'SM-8-Pillar', x: -23.1, z: -14.3, scale: 1.1 });
    this.placeVoxel({
      asset: 'SM-8-Pillar',
      x: -18.3,
      z: -14.3,
      scale: 1.1,
      rotation: Math.PI,
    });
    const graves: readonly VoxelPlacement[] = [
      { asset: 'SM-3-Tomb1', x: -26.3, z: -25.6, rotation: 0.08 },
      { asset: 'SM-4-Tomb2', x: -23.8, z: -25.1, rotation: -0.1, scale: 0.9 },
      { asset: 'SM-5-Tomb3', x: -21.2, z: -25.7, rotation: 0.15, scale: 0.95 },
      { asset: 'SM-3-Tomb1', x: -18.4, z: -25.2, rotation: -0.06, scale: 0.88 },
      { asset: 'SM-4-Tomb2', x: -15.9, z: -25.8, rotation: 0.2 },
      { asset: 'SM-3-Tomb1', x: -13.6, z: -25.3, rotation: -0.14, scale: 0.94 },
      { asset: 'SM-5-Tomb3', x: -25.4, z: -21.9, rotation: -0.12, scale: 1.05 },
      { asset: 'SM-3-Tomb1', x: -22.6, z: -21.4, rotation: 0.1, scale: 0.92 },
      { asset: 'SM-4-Tomb2', x: -19.8, z: -22, rotation: 0.05, scale: 0.85 },
      { asset: 'SM-3-Tomb1', x: -16.8, z: -21.5, rotation: -0.18 },
      { asset: 'SM-5-Tomb3', x: -14.2, z: -22.1, rotation: 0.12, scale: 0.9 },
      { asset: 'SM-4-Tomb2', x: -26.6, z: -18.1, rotation: 0.16, scale: 0.95 },
      { asset: 'SM-3-Tomb1', x: -23.4, z: -17.6, rotation: -0.08, scale: 1.02 },
      { asset: 'SM-5-Tomb3', x: -20.4, z: -18.3, rotation: 0.06, scale: 0.88 },
      { asset: 'SM-4-Tomb2', x: -17.2, z: -17.7, rotation: -0.2, scale: 0.92 },
      { asset: 'SM-3-Tomb1', x: -14.6, z: -18.2, rotation: 0.1, scale: 0.9 },
    ];
    for (const grave of graves) this.placeVoxel(grave);
    this.placeVoxel({
      asset: 'SM-6-Raven',
      x: -26.3,
      y: 1.95,
      z: -25.6,
      rotation: 0.6,
      scale: 0.72,
    });
  }

  private buildCaretakerCorner(): void {
    this.placeVoxel({
      asset: 'SM-11-Igor_wSpade',
      x: 17,
      z: -19.5,
      rotation: 2.4,
      scale: 0.95,
    });
    this.placeVoxel({
      asset: 'SM-10-Spade',
      x: 15.6,
      z: -17.8,
      rotation: 0.6,
      scale: 0.9,
    });
    for (const grave of [
      { asset: 'SM-4-Tomb2', x: 14.8, z: -21.6, rotation: 0.35 },
      { asset: 'SM-4-Tomb2', x: 17.2, z: -22.8, rotation: -0.2, scale: 0.95 },
      { asset: 'SM-4-Tomb2', x: 19.6, z: -21.9, rotation: 0.15, scale: 1.05 },
    ] as const) {
      this.placeVoxel(grave);
    }
    this.placeVoxel({
      asset: 'props/Bonefire.fbx',
      x: 19.8,
      z: -16.4,
      rotation: 0.9,
    });
    this.addFireLight(19.8, -16.4);
    this.placeVoxel({
      asset: 'props/Trash.fbx',
      x: 22.4,
      z: -17.8,
      rotation: 0.7,
      scale: 0.9,
    });
    this.placeVoxel({
      asset: 'props/AttachedBoxes.fbx',
      x: 23.6,
      z: -15.6,
      rotation: -0.4,
      scale: 0.9,
    });
    this.placeVoxel({
      asset: 'props/AmmoBox_5.fbx',
      x: 22.2,
      z: -14.4,
      rotation: 1.2,
      scale: 0.8,
    });
    this.placeVoxel({
      asset: 'SM-5-Tomb3',
      x: 27,
      z: -24,
      rotation: 0.1,
      scale: 1.15,
    });
    this.placeVoxel({
      asset: 'SM-3-Tomb1',
      x: 24,
      z: -27.5,
      rotation: -0.12,
      scale: 0.95,
    });
    this.placeVoxel({
      asset: 'SM-6-Raven',
      x: 24,
      y: 1.85,
      z: -27.5,
      rotation: -2.1,
      scale: 0.72,
    });
  }

  private buildAncientTree(): void {
    const x = -21;
    const z = 20;
    const scale = 1.55;
    this.placeVoxel({ asset: 'SM-1-Tree', x, z, scale, rotation: 0.9 });
    this.addStaticCylinderCollider(0.58 * scale, 2.1 * scale, [
      x,
      1.05 * scale,
      z,
    ]);
    this.placeVoxel({
      asset: 'SM-2-Ghost',
      x: -15.5,
      y: 1.7,
      z: 16.5,
      rotation: 0.5,
      scale: 1.3,
      emissive: 0x2f8f84,
      castShadow: false,
    });
    const ghostLight = new THREE.PointLight(0x66ffe0, 22, 11, 2);
    ghostLight.position.set(-15.5, 3, 16.5);
    this.root.add(ghostLight);
    for (const grave of [
      { asset: 'SM-4-Tomb2', x: -27.5, z: 15, rotation: 0.4, scale: 0.95 },
      { asset: 'SM-5-Tomb3', x: -27, z: 23, rotation: 0.15 },
      { asset: 'SM-3-Tomb1', x: -25.5, z: 27, rotation: -0.3, scale: 1.05 },
      { asset: 'SM-5-Tomb3', x: -18, z: 27.5, rotation: 0.25, scale: 0.9 },
      { asset: 'SM-3-Tomb1', x: -13.5, z: 23.5, rotation: 2.9, scale: 0.85 },
      { asset: 'SM-4-Tomb2', x: -14, z: 13.5, rotation: -0.5, scale: 0.9 },
    ] as const) {
      this.placeVoxel(grave);
    }
    this.placeVoxel({
      asset: 'SM-6-Raven',
      x: -19.8,
      y: 4.6,
      z: 21.2,
      rotation: -1.2,
      scale: 0.72,
    });
  }

  private buildCheckpointAndMonument(): void {
    const camp: readonly VoxelPlacement[] = [
      { asset: 'props/Barricade_03.fbx', x: 4.6, z: 6.8, rotation: 0.35 },
      {
        asset: 'props/Barricade_03.fbx',
        x: 7.4,
        z: 4.4,
        rotation: 1.75,
        scale: 0.92,
      },
      { asset: 'props/BarbedWires.fbx', x: 5.2, z: 10.2, rotation: 0.2 },
      {
        asset: 'props/BarbedWires.fbx',
        x: 9.6,
        z: 5,
        rotation: 1.35,
        scale: 0.9,
      },
      { asset: 'props/Bonefire.fbx', x: 6.6, z: 7.8, rotation: -0.4 },
      {
        asset: 'props/AmmoBox_5.fbx',
        x: 7.8,
        z: 9,
        rotation: 2.2,
        scale: 0.75,
      },
      { asset: 'props/Trash.fbx', x: 10.4, z: 7.6, rotation: -0.8, scale: 0.9 },
    ];
    for (const placement of camp) this.placeVoxel(placement);
    this.addFireLight(6.6, 7.8);

    const monumentX = 25;
    const monumentZ = 23;
    for (const angle of [0.3, 1.55, 2.8, 4.05]) {
      this.placeVoxel({
        asset: 'SM-8-Pillar',
        x: monumentX + Math.cos(angle) * 3.4,
        z: monumentZ + Math.sin(angle) * 3.4,
        rotation: angle + Math.PI,
        scale: 1.45,
      });
    }
    this.placeVoxel({
      asset: 'SM-5-Tomb3',
      x: monumentX,
      z: monumentZ,
      rotation: 0.65,
      scale: 1.4,
    });
    this.placeVoxel({
      asset: 'SM-3-Tomb1',
      x: 15.5,
      z: 27,
      rotation: 0.2,
      scale: 0.9,
    });
    this.placeVoxel({
      asset: 'SM-4-Tomb2',
      x: 18.5,
      z: 14.5,
      rotation: -0.35,
      scale: 0.95,
    });
    this.placeVoxel({
      asset: 'SM-5-Tomb3',
      x: 29.5,
      z: 13.5,
      rotation: 0.1,
      scale: 0.85,
    });
  }

  private buildScatter(): void {
    const strays: readonly VoxelPlacement[] = [
      { asset: 'SM-4-Tomb2', x: -2.9, z: -26.5, rotation: 1.3, scale: 0.8 },
      { asset: 'SM-3-Tomb1', x: -3.2, z: -22, rotation: -0.4, scale: 0.9 },
      { asset: 'props/Trash.fbx', x: -9.9, z: -12, rotation: 2.6, scale: 0.7 },
      { asset: 'SM-5-Tomb3', x: -3.6, z: -8.5, rotation: 0.9, scale: 0.75 },
      { asset: 'SM-4-Tomb2', x: -2.6, z: 20.8, rotation: -1.1 },
      {
        asset: 'props/BarbedWires.fbx',
        x: -2.5,
        z: 29.3,
        rotation: 1.5,
        scale: 0.8,
      },
      {
        asset: 'props/AmmoBox_5.fbx',
        x: -9.5,
        z: -2.7,
        rotation: 0.9,
        scale: 0.7,
      },
      { asset: 'props/Trash.fbx', x: 21.5, z: 5.1, rotation: -1.9, scale: 0.8 },
      { asset: 'SM-3-Tomb1', x: 27.5, z: 11.1, rotation: 1.1, scale: 0.95 },
      { asset: 'SM-4-Tomb2', x: -9.8, z: 4.9, rotation: 1.7, scale: 0.7 },
      { asset: 'SM-3-Tomb1', x: -3.4, z: 11.9, rotation: -1.3, scale: 0.7 },
      { asset: 'SM-3-Tomb1', x: -26, z: -3, rotation: 1.8, scale: 0.8 },
      { asset: 'SM-4-Tomb2', x: -19.5, z: 2.7, rotation: 0.3, scale: 0.9 },
      { asset: 'SM-5-Tomb3', x: 12.5, z: 2.9, rotation: -0.7, scale: 0.9 },
      { asset: 'SM-3-Tomb1', x: 3, z: 19.5, rotation: 0.5, scale: 0.85 },
      { asset: 'SM-3-Tomb1', x: 5, z: -5.2, rotation: -1.3, scale: 0.7 },
      { asset: 'SM-4-Tomb2', x: -9.6, z: -17, rotation: 0.7, scale: 0.85 },
      { asset: 'SM-3-Tomb1', x: -10.2, z: -26.5, y: -0.2, rotation: -0.25 },
      { asset: 'SM-5-Tomb3', x: 9, z: -27, rotation: 0.4, scale: 0.8 },
      { asset: 'SM-4-Tomb2', x: 10.5, z: -13, rotation: -0.6, scale: 0.9 },
      {
        asset: 'SM-3-Tomb1',
        x: 12,
        z: 21.5,
        y: -0.3,
        rotation: 2.2,
        scale: 0.8,
      },
      { asset: 'SM-4-Tomb2', x: 26, z: 29, rotation: 0.9, scale: 0.85 },
      { asset: 'SM-5-Tomb3', x: -8.5, z: 20, rotation: -1.4, scale: 0.95 },
      { asset: 'SM-3-Tomb1', x: -10, z: 29, rotation: 0.15, scale: 0.9 },
      { asset: 'props/Trash.fbx', x: 28.5, z: -8, rotation: 0.5, scale: 0.85 },
      {
        asset: 'props/AttachedBoxes.fbx',
        x: -30.5,
        z: 6.5,
        rotation: 1.9,
        scale: 0.7,
      },
      { asset: 'SM-5-Tomb3', x: -31, z: -8, rotation: 2, scale: 0.9 },
      { asset: 'SM-4-Tomb2', x: 30, z: -19, rotation: -0.9, scale: 0.8 },
    ];
    for (const stray of strays) this.placeVoxel(stray);
    this.placeVoxel({
      asset: 'SM-6-Raven',
      x: 27.5,
      y: 1.85,
      z: 11.1,
      rotation: 2.6,
      scale: 0.72,
    });
  }

  private buildRoadSigns(): void {
    const signs = [
      [-2.8, 5.4, Math.PI / 2],
      [-3.4, -27.6, 0],
      [-8.6, 30.2, 0],
      [31, 10.6, Math.PI / 2],
    ] as const;
    for (const [x, z, rotation] of signs) {
      this.placeVoxel({ asset: 'RoadSign-66', x, z, rotation, scale: 1.8 });
    }
  }

  private buildLanterns(): void {
    const shoulderOffset = ROAD_HALF_WIDTH + 1;
    const positions: Array<readonly [number, number]> = [[-20.7, -12.6]];
    let side = 1;
    for (let z = -24; z <= 24; z += 12) {
      positions.push([ROAD_X + side * shoulderOffset, z]);
      side = -side;
    }
    side = -1;
    for (let x = 2; x <= 30; x += 12) {
      positions.push([x, SIDE_ROAD_Z + side * shoulderOffset]);
      side = -side;
    }

    for (const [x, z] of positions) {
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      const post = new THREE.Mesh(
        this.fallbackGeometry,
        this.lanternPostMaterial,
      );
      post.position.y = 1.25;
      post.scale.set(0.16, 2.5, 0.16);
      post.castShadow = true;
      group.add(post);
      const cap = new THREE.Mesh(
        this.fallbackGeometry,
        this.lanternPostMaterial,
      );
      cap.position.y = 2.55;
      cap.scale.set(0.56, 0.16, 0.56);
      cap.castShadow = true;
      group.add(cap);
      const glow = new THREE.Mesh(
        this.fallbackGeometry,
        this.lanternGlowMaterial,
      );
      glow.position.y = 2.28;
      glow.scale.set(0.34, 0.42, 0.34);
      group.add(glow);
      const light = new THREE.PointLight(0xff9d45, 36, 11, 2);
      light.position.y = 2.3;
      group.add(light);
      this.root.add(group);
    }
  }

  private placeFenceRun(
    x: number,
    z: number,
    dx: number,
    dz: number,
    count: number,
    rotation: number,
  ): void {
    for (let i = 0; i < count; i++) {
      this.placeVoxel({
        asset: 'SM-7-Fence',
        x: x + dx * i,
        z: z + dz * i,
        rotation,
        scale: 0.85,
      });
    }
  }

  private addFireLight(x: number, z: number): void {
    const light = new THREE.PointLight(0xff6a2b, 30, 10, 2);
    light.position.set(x, 0.9, z);
    this.root.add(light);
  }

  private placeVoxel(placement: VoxelPlacement): void {
    if (isBatchableAsset(placement.asset)) {
      const placements = this.voxelBatches.get(placement.asset);
      if (placements) placements.push(placement);
      else this.voxelBatches.set(placement.asset, [placement]);
      return;
    }
    void instantiateVoxelAsset(`${ASSET_ROOT}/${placement.asset}`)
      .then((object) => {
        if (this.disposed) return;
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
          for (const material of materials) {
            const colored = material as THREE.Material & {
              color?: THREE.Color;
              emissive?: THREE.Color;
            };
            if (placement.tint !== undefined) {
              colored.color?.set(placement.tint);
            }
            if (placement.emissive !== undefined) {
              colored.emissive?.set(placement.emissive);
            }
          }
        });
        this.root.add(object);
      })
      .catch((error: unknown) => {
        if (this.disposed) return;
        this.placeFallback(placement);
        this.reportAssetFailure(placement.asset, error);
      });
  }

  private flushVoxelBatches(): void {
    for (const [asset, placements] of this.voxelBatches) {
      void loadVoxelInstanceSource(`${ASSET_ROOT}/${asset}`)
        .then(({ geometry, material, pivot }) => {
          if (this.disposed) return;
          const batchMaterial = material.clone();
          const style = placements[0];
          const colored = batchMaterial as THREE.Material & {
            color?: THREE.Color;
            emissive?: THREE.Color;
          };
          if (style.tint !== undefined) colored.color?.set(style.tint);
          if (style.emissive !== undefined)
            colored.emissive?.set(style.emissive);

          const mesh = new THREE.InstancedMesh(
            geometry,
            batchMaterial,
            placements.length,
          );
          mesh.name = `graveyard-batch:${asset}`;
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
            const placement = placements[i];
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
          if (this.disposed) return;
          for (const placement of placements) this.placeFallback(placement);
          this.reportAssetFailure(asset, error);
        });
    }
    this.voxelBatches.clear();
  }

  private placeFallback(placement: VoxelPlacement): void {
    const dimensions = this.fallbackDimensions(placement.asset);
    const scale = placement.scale ?? 1;
    const scaleY = placement.scaleY ?? scale;
    const height = dimensions[1] * scaleY;
    const material = placement.asset.startsWith('Road-')
      ? this.fallbackRoadMaterial
      : placement.asset === 'SM-2-Ghost'
        ? this.fallbackSpectralMaterial
        : this.fallbackMaterial;
    const mesh = new THREE.Mesh(this.fallbackGeometry, material);
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
    if (asset.startsWith('Road-Street') || asset.startsWith('Road-Crossing')) {
      return FALLBACK_ROAD;
    }
    if (asset === 'RoadSign-66') return FALLBACK_SIGN;
    if (asset === 'SM-7-Fence') return FALLBACK_FENCE;
    if (asset === 'SM-8-Pillar') return FALLBACK_PILLAR;
    if (asset === 'SM-1-Tree') return FALLBACK_TREE;
    if (asset.includes('Tomb')) return FALLBACK_TOMB;
    if (asset === 'SM-2-Ghost' || asset === 'SM-11-Igor_wSpade') {
      return FALLBACK_PERSON;
    }
    if (asset.includes('Barricade') || asset.includes('BarbedWires')) {
      return FALLBACK_BARRICADE;
    }
    return FALLBACK_DEFAULT;
  }

  private reportAssetFailure(asset: string, error: unknown): void {
    if (this.disposed || this.failedAssets.has(asset)) return;
    this.failedAssets.add(asset);
    console.warn(`Using fallback for graveyard asset "${asset}"`, error);
  }

  private addStaticBoxCollider(
    size: Size3,
    position: readonly [number, number, number],
  ): void {
    if (!this.collidersEnabled) return;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(...position),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
        .setFriction(0.2)
        .setCollisionGroups(TERRAIN_GROUPS),
      body,
    );
    this.staticBodies.push(body);
  }

  private addStaticCylinderCollider(
    radius: number,
    height: number,
    position: readonly [number, number, number],
  ): void {
    if (!this.collidersEnabled) return;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(...position),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(height / 2, radius)
        .setFriction(0.15)
        .setCollisionGroups(TERRAIN_GROUPS),
      body,
    );
    this.staticBodies.push(body);
  }

  private computeSpawnPoints(): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < SPAWN_POINT_COUNT; i++) {
      const angle = (i / SPAWN_POINT_COUNT) * Math.PI * 2;
      points.push(
        new THREE.Vector3(
          Math.cos(angle) * SPAWN_RADIUS,
          0,
          Math.sin(angle) * SPAWN_RADIUS,
        ),
      );
    }
    return points;
  }
}
