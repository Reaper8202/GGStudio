import * as THREE from "three";
import type { GameContext, GameSystem, VehicleApi, WorldApi } from "../types";
import { CollisionGroups } from "../types/collision";
import { GameConfig } from "../config/gameConfig";
import { instantiateVoxelAsset } from "./VoxelAssetLoader";

const ASSET_ROOT = "/assets/graveyard";

interface VoxelPlacement {
  readonly asset: string;
  readonly x: number;
  readonly z: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly scale?: number;
}

const treePositions: ReadonlyArray<readonly [number, number, number]> = [
  [-28, -26, 0.82],
  [27, -25, 0.9],
  [-29, 17, 0.78],
  [28, 23, 0.86],
  [-7, -29, 0.76],
  [9, 29, 0.82],
  [31, -2, 0.72],
  [-31, -5, 0.74],
];

export class Graveyard implements WorldApi, GameSystem {
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  readonly spawnPoints: readonly THREE.Vector3[];

  private readonly ctx: GameContext;
  private readonly focusLight: THREE.SpotLight;
  private readonly focusLightTarget: THREE.Object3D;
  private focusTarget: VehicleApi | null = null;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    const half = GameConfig.world.halfSize;
    this.bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };

    const focus = this.buildLighting();
    this.focusLight = focus.light;
    this.focusLightTarget = focus.target;

    this.buildGround();
    this.buildPerimeter();
    this.buildGraveRows();
    this.buildTrees();
    this.buildLandmarks();
    this.buildLanterns();

    this.spawnPoints = this.computeSpawnPoints();
  }

  follow(target: VehicleApi): void {
    this.focusTarget = target;
    this.updateFocusLight();
  }

  update(): void {
    this.updateFocusLight();
  }

  private buildLighting(): { light: THREE.SpotLight; target: THREE.Object3D } {
    this.ctx.scene.background = new THREE.Color(0x080b14);
    this.ctx.scene.fog = new THREE.FogExp2(0x080b14, 0.012);

    // Cool moonlight at a 48-degree altitude gives the voxel edges long,
    // readable shadows while the hemisphere light keeps silhouettes legible.
    const ambientFill = new THREE.HemisphereLight(0x6c84b5, 0x2d243e, 1.08);
    this.ctx.scene.add(ambientFill);

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
    this.ctx.scene.add(moon, moon.target);

    // A warm, feathered pool follows the player. It is intentionally not a
    // hard headlight cone: from the top-down camera it reads as a focus radius.
    const target = new THREE.Object3D();
    const light = new THREE.SpotLight(0xffd6a0, 58, 26, Math.PI / 5.2, 0.82, 1.45);
    light.position.set(0, 14, 5);
    light.target = target;
    this.ctx.scene.add(light, target);

    return { light, target };
  }

  private buildGround(): void {
    const half = GameConfig.world.halfSize;

    // Collider only, no matching visible mesh: the real voxel ground tiles
    // below fully cover the field visually, and their underside geometry
    // reaches down well past y=-0.1 — a painted slab mesh at that depth
    // z-fights/clips against it instead of just backing the physics.
    const body = this.ctx.physics.createRigidBody(
      this.ctx.rapier.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0)
    );
    this.ctx.physics.createCollider(
      this.ctx.rapier.ColliderDesc.cuboid(half, 0.1, half).setCollisionGroups(
        CollisionGroups.static
      ),
      body
    );

    const pathMaterial = new THREE.MeshStandardMaterial({ color: 0x51463b, roughness: 1 });
    const northSouthPath = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.025, 67), pathMaterial);
    northSouthPath.position.set(0, 0.014, 0);
    northSouthPath.receiveShadow = true;
    this.ctx.scene.add(northSouthPath);

    const eastWestPath = new THREE.Mesh(new THREE.BoxGeometry(67, 0.026, 5.5), pathMaterial);
    eastWestPath.position.set(0, 0.015, 0);
    eastWestPath.receiveShadow = true;
    this.ctx.scene.add(eastWestPath);

    // Real voxel ground-tile asset (SM-0-Ground, 8x8 footprint) tiled across
    // the whole field gives the open ground its actual voxel relief/texture
    // instead of a flat painted slab. The flat slab + collider above is the
    // drivable surface underneath; these tiles are purely visual.
    //
    // The source asset isn't a thin flat tile: MagicaVoxel exports get
    // bottom-anchored at y=0 by the loader, but this tile's actual walkable
    // surface sits ~2.4 units above its own base (the rest is a solid
    // underside block). Left at the default y=0 it floats over the whole
    // map, burying the vehicle/zombies/tombstones under it — push it down
    // so the real surface lines up with world ground level (y=0).
    const groundTileSurfaceOffset = -2.4;
    const tileSize = 8;
    // Per-tile rotation alone wasn't enough — the SEAMS between tiles still
    // formed one continuous straight grid line every `tileSpacing` units,
    // and that grid is what reads as "uniform," regardless of what's
    // rotated inside each cell. Staggering each row horizontally (brick/
    // running-bond coursing, cycling through 4 offsets so the stagger
    // itself doesn't repeat every other row) breaks the seams into an
    // offset pattern instead of a grid. Rows still overlap safely — the
    // stagger only shifts tiles sideways along their own row, it never
    // opens a gap to the row above/below. A couple of extra columns are
    // added so the sideways shift never leaves the shifted edge uncovered.
    // Overlap is pushed a lot deeper (was 0.3 — barely a graze) so each
    // tile's edge is buried well inside its neighbor instead of just
    // touching it, and a small per-tile scale wobble means that overlap
    // depth isn't identical at every seam either — a uniform overlap is
    // still a uniform (if softer) cut line, varying its depth is what
    // keeps any one boundary from reading as a repeating groove.
    const tileSpacing = tileSize - 1.8;
    const tileSpan = Math.ceil((half * 2) / tileSpacing) + 2;
    const tileStart = -((tileSpan - 1) * tileSpacing) / 2 - tileSpacing / 2;
    for (let iz = 0; iz < tileSpan; iz++) {
      const rowStagger = (iz % 4) * (tileSpacing / 4);
      for (let ix = 0; ix < tileSpan; ix++) {
        this.placeVoxel({
          asset: "SM-0-Ground",
          x: tileStart + ix * tileSpacing + rowStagger,
          y: groundTileSurfaceOffset,
          z: tileStart + iz * tileSpacing,
          rotation: (Math.floor(Math.random() * 4) * Math.PI) / 2,
          scale: 0.92 + Math.random() * 0.24,
        });
      }
    }
  }

  private buildPerimeter(): void {
    const half = GameConfig.world.halfSize;
    const thickness = 0.8;
    const height = 2.1;

    // The boundary stays sealed for gameplay, but the collider is invisible;
    // the voxel iron fence supplies the actual graveyard silhouette.
    this.addStaticBoxCollider([half * 2 + 1.6, height, thickness], [0, height / 2, -half]);
    this.addStaticBoxCollider([half * 2 + 1.6, height, thickness], [0, height / 2, half]);
    this.addStaticBoxCollider([thickness, height, half * 2 + 1.6], [-half, height / 2, 0]);
    this.addStaticBoxCollider([thickness, height, half * 2 + 1.6], [half, height / 2, 0]);

    const fenceScale = 0.92;
    for (let p = -33.5; p <= 33.5; p += 2) {
      this.placeVoxel({ asset: "SM-7-Fence", x: p, z: -34.45, scale: fenceScale });
      this.placeVoxel({
        asset: "SM-7-Fence",
        x: p,
        z: 34.45,
        scale: fenceScale,
        rotation: Math.PI,
      });
      this.placeVoxel({
        asset: "SM-7-Fence",
        x: -34.45,
        z: p,
        scale: fenceScale,
        rotation: Math.PI / 2,
      });
      this.placeVoxel({
        asset: "SM-7-Fence",
        x: 34.45,
        z: p,
        scale: fenceScale,
        rotation: -Math.PI / 2,
      });
    }
  }

  private buildGraveRows(): void {
    const quadrants: ReadonlyArray<readonly [readonly number[], readonly number[]]> = [
      [[-25, -20, -15], [-24, -19, -14]],
      [[15, 20, 25], [-24, -19, -14]],
      [[-25, -20, -15], [14, 19, 24]],
      [[15, 20, 25], [14, 19, 24]],
    ];
    const tombs = ["SM-3-Tomb1", "SM-4-Tomb2", "SM-5-Tomb3"] as const;

    let index = 0;
    for (const [xs, zs] of quadrants) {
      for (const z of zs) {
        for (const x of xs) {
          this.placeVoxel({
            asset: tombs[index % tombs.length],
            x,
            z,
            rotation: z < 0 ? 0 : Math.PI,
            scale: 0.9 + (index % 4) * 0.06,
          });
          index++;
        }
      }
    }

    // A lighter inner ring makes the graveyard readable from the spawn
    // camera while preserving the two broad crossing drive lanes.
    const innerGraves: ReadonlyArray<readonly [number, number]> = [
      [-11, -9],
      [-11, -3],
      [-11, 3],
      [-11, 9],
      [11, -9],
      [11, -3],
      [11, 3],
      [11, 9],
      [-5, -11],
      [5, -11],
      [-5, 11],
      [5, 11],
    ];
    for (const [x, z] of innerGraves) {
      this.placeVoxel({
        asset: tombs[index % tombs.length],
        x,
        z,
        rotation: z < 0 ? 0 : Math.PI,
        scale: 0.94,
      });
      index++;
    }

    // A few ravens perched just above the taller stones.
    for (const [x, y, z, rotation] of [
      [-20, 1.72, -19, 0.3],
      [20, 1.45, 19, -0.8],
      [25, 1.62, -14, 1.9],
    ] as const) {
      this.placeVoxel({ asset: "SM-6-Raven", x, y, z, rotation, scale: 0.72 });
    }
  }

  private buildTrees(): void {
    for (const [x, z, scale] of treePositions) {
      this.placeVoxel({
        asset: "SM-1-Tree",
        x,
        z,
        scale,
        rotation: (x * 0.17 + z * 0.31) % (Math.PI * 2),
      });

      // Only the narrow trunk is solid; branches and foliage never create
      // invisible snag points around the vehicle.
      this.addStaticCylinderCollider(0.58 * scale, 2.1 * scale, [x, 1.05 * scale, z]);
    }
  }

  private buildLandmarks(): void {
    // Voxel gate pillars frame the northern path, while the gap remains wide.
    this.placeVoxel({ asset: "SM-8-Pillar", x: -4.2, z: -30.5, rotation: Math.PI / 2 });
    this.placeVoxel({ asset: "SM-8-Pillar", x: 4.2, z: -30.5, rotation: -Math.PI / 2 });

    this.placeVoxel({ asset: "SM-11-Igor_wSpade", x: -10.5, z: 9, rotation: 2.3, scale: 0.74 });
    this.placeVoxel({ asset: "SM-10-Spade", x: -12, z: 8, rotation: 0.5, scale: 0.9 });

    const ghosts: readonly VoxelPlacement[] = [
      { asset: "SM-2-Ghost", x: -26, y: 1.4, z: -7, rotation: 0.3, scale: 0.9 },
      { asset: "SM-2-Ghost", x: 25, y: 1.9, z: 8, rotation: -0.5, scale: 0.82 },
      { asset: "SM-2-Ghost", x: -7, y: 1.6, z: 27, rotation: 2.1, scale: 0.76 },
    ];
    for (const ghost of ghosts) this.placeVoxel(ghost);
  }

  private buildLanterns(): void {
    const lanternPositions: ReadonlyArray<readonly [number, number]> = [
      [-7, -7],
      [7, -7],
      [-7, 7],
      [7, 7],
      [0, -24],
      [0, 24],
      [-24, 0],
      [24, 0],
    ];
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x211b1b, roughness: 0.8 });
    const glowMaterial = new THREE.MeshStandardMaterial({
      color: 0xffb34f,
      emissive: 0xff7a21,
      emissiveIntensity: 5,
      roughness: 0.25,
    });

    for (const [x, z] of lanternPositions) {
      const group = new THREE.Group();
      group.position.set(x, 0, z);

      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.5, 0.16), postMaterial);
      post.position.y = 1.25;
      post.castShadow = true;
      group.add(post);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.56), postMaterial);
      cap.position.y = 2.55;
      cap.castShadow = true;
      group.add(cap);

      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.34), glowMaterial);
      glow.position.y = 2.28;
      group.add(glow);

      const light = new THREE.PointLight(0xff9d45, 36, 11, 2);
      light.position.y = 2.3;
      group.add(light);
      this.ctx.scene.add(group);
    }
  }

  private updateFocusLight(): void {
    if (!this.focusTarget) return;
    const { x, y, z } = this.focusTarget.position;
    this.focusLight.position.set(x, y + 13, z + 5);
    this.focusLightTarget.position.set(x, Math.max(y, 0), z);
  }

  private placeVoxel(placement: VoxelPlacement): void {
    const { asset, x, z, y = 0, rotation = 0, scale = 1 } = placement;
    void instantiateVoxelAsset(`${ASSET_ROOT}/${asset}`)
      .then((object) => {
        object.position.set(x, y, z);
        object.rotation.y = rotation;
        object.scale.setScalar(scale);
        this.ctx.scene.add(object);
      })
      .catch((error: unknown) => {
        console.error(`Failed to load graveyard asset ${asset}`, error);
      });
  }

  private addStaticBoxCollider(
    size: readonly [number, number, number],
    position: readonly [number, number, number]
  ): void {
    const body = this.ctx.physics.createRigidBody(
      this.ctx.rapier.RigidBodyDesc.fixed().setTranslation(...position)
    );
    this.ctx.physics.createCollider(
      this.ctx.rapier.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
        .setFriction(0.2)
        .setCollisionGroups(CollisionGroups.static),
      body
    );
  }

  private addStaticCylinderCollider(
    radius: number,
    height: number,
    position: readonly [number, number, number]
  ): void {
    const body = this.ctx.physics.createRigidBody(
      this.ctx.rapier.RigidBodyDesc.fixed().setTranslation(...position)
    );
    this.ctx.physics.createCollider(
      this.ctx.rapier.ColliderDesc.cylinder(height / 2, radius)
        .setFriction(0.15)
        .setCollisionGroups(CollisionGroups.static),
      body
    );
  }

  private computeSpawnPoints(): THREE.Vector3[] {
    const { spawnPointCount, spawnRadius } = GameConfig.world;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < spawnPointCount; i++) {
      const angle = (i / spawnPointCount) * Math.PI * 2;
      points.push(
        new THREE.Vector3(Math.cos(angle) * spawnRadius, 0, Math.sin(angle) * spawnRadius)
      );
    }
    return points;
  }
}
