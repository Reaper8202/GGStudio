import * as THREE from "three";
import type { GameContext, GameSystem, VehicleApi, WorldApi } from "../types";
import { CollisionGroups } from "../types/collision";
import { GameConfig } from "../config/gameConfig";
import {
  instantiateVoxelAsset,
  loadVoxelInstanceSource,
} from "./VoxelAssetLoader";

const ASSET_ROOT = "/assets/graveyard";

/** Half-width of a road — two native 1.6-unit-wide tiles placed
 *  side by side, ±0.1 margin. Shared by `buildGround`'s ground-flattening
 *  (the ground layer has real 3D relief now, so it has to be kept low along
 *  the road corridor rather than just trusting a thin road slab to sit
 *  above it everywhere) and `buildRoads`' actual road geometry. */
const ROAD_HALF_WIDTH = 1.7;

/** The road layout is deliberately not a centered cross: the main road runs
 *  north-south the full map at x = ROAD_X (off-center, through the north
 *  gate), and a side road branches east-only from a T-junction at
 *  (ROAD_X, SIDE_ROAD_Z). Both constants are shared by the ground
 *  flattening, the road tiles, the gate, and the lamp/scatter layout. */
const ROAD_X = -6;
const SIDE_ROAD_Z = 8;

interface VoxelPlacement {
  readonly asset: string;
  readonly x: number;
  readonly z: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly scale?: number;
  /** Independent Y-axis scale, defaults to `scale`. Lets a placement's
   *  height (relief) be squashed/stretched without affecting its footprint. */
  readonly scaleY?: number;
  /** The loader defaults every voxel mesh to `castShadow = true`; pass
   *  `false` to opt a placement out (e.g. a large tiled layer where the
   *  doubled shadow-pass draw calls cost far more than the effect is worth). */
  readonly castShadow?: boolean;
  /** Sets `material.color`, which the shader then multiplies against the
   *  asset's own texture at render time — a uniform tint that pulls a
   *  bright/saturated source texture toward another palette without
   *  losing its internal light/dark detail (every pixel scales by the same
   *  factor, so the relative contrast between e.g. a road's base color and
   *  its painted lines survives). An absolute set, not a running multiply,
   *  so re-applying it to a material shared by many placements of the same
   *  asset is safe/idempotent. */
  readonly tint?: THREE.ColorRepresentation;
  /** Sets `material.emissive` — a flat self-glow added on top of whatever
   *  light reaches the mesh, for things that should read as light sources
   *  themselves (the ghost). Same absolute-set/idempotent semantics as
   *  `tint`. */
  readonly emissive?: THREE.ColorRepresentation;
}


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
    this.buildRoads();
    this.buildPerimeter();
    this.buildGate();
    // One distinct landmark cluster per quadrant instead of mirrored grids —
    // the four reads are deliberately different in shape, density, and
    // content so any screen edge instantly tells you where you are.
    this.buildBurialPlot(); // NW: fenced old cemetery block
    this.buildCaretakerCorner(); // NE: Igor's dig site + supply clutter
    this.buildAncientTree(); // SW: the one giant tree + the one ghost
    this.buildCheckpointAndMonument(); // SE: survivor barricades + pillar ruin
    this.buildScatter(); // stray graves/clutter that ignore the quadrants
    this.buildRoadSigns();
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
    const light = new THREE.SpotLight(
      0xffd6a0,
      58,
      26,
      Math.PI / 5.2,
      0.82,
      1.45,
    );
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
      this.ctx.rapier.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0),
    );
    this.ctx.physics.createCollider(
      this.ctx.rapier.ColliderDesc.cuboid(half, 0.1, half).setCollisionGroups(
        CollisionGroups.static,
      ),
      body,
    );

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
    // so the real surface lines up with world ground level (y=0). Squashing
    // a tile's Y-scale (see the plaza clearing below) shrinks that offset
    // proportionally too, so the surface stays flush at y=0 regardless of
    // how flat/noisy any individual tile is.
    const groundTileBaseOffset = -2.4;
    // Collapsing every tile into one InstancedMesh draw call (below) fixed
    // draw-call count, but not triangle count: SM-0-Ground is a raw,
    // unmerged MagicaVoxel export — ~34k triangles PER INSTANCE regardless
    // of draw-call batching. At the tile's native 8-unit footprint, fully
    // covering the map took ~140-200 instances, i.e. 5-7 MILLION triangles
    // every frame (measured: this was ~93% of the entire scene's triangle
    // budget — the actual cause of the lag, not colliders or draw calls).
    // `footprintScale` stretches each instance's footprint so far fewer,
    // bigger copies cover the same area — the only lever that reduces total
    // triangle count for a fixed-density source asset like this one without
    // decimating its geometry. It only scales X/Z (via `scale` below); the
    // independent `scaleY` relief/flatten logic is untouched.
    const footprintScale = 2.4;
    const tileSize = 8 * footprintScale;
    // Multiple flattened "clearings" scattered around the map (not just one
    // centered plaza) — each blends smoothly into the surrounding noisy
    // relief over its own blend radius, and where two clearings' blend
    // radii overlap, whichever pulls flattest wins. The start/combat plaza
    // at the origin is always included since that flatten read well; the
    // rest are randomized in position, size, and depth every load for
    // organic variety instead of one uniform ring.
    interface SmoothZone {
      readonly x: number;
      readonly z: number;
      readonly flatRadius: number;
      readonly blendRadius: number;
      readonly squash: number;
    }
    const smoothZones: SmoothZone[] = [
      { x: 0, z: 0, flatRadius: 9, blendRadius: 24, squash: 0.22 },
    ];
    const extraZoneCount = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < extraZoneCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 10 + Math.random() * (half - 14);
      const flatRadius = 3 + Math.random() * 6;
      smoothZones.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        flatRadius,
        blendRadius: flatRadius + 8 + Math.random() * 14,
        squash: 0.16 + Math.random() * 0.3,
      });
    }
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
    // Overlap buries each tile's edge inside its neighbor instead of just
    // touching it, and a small per-tile scale wobble means that overlap
    // depth isn't identical at every seam either — a uniform overlap is
    // still a uniform (if softer) cut line, varying its depth is what
    // keeps any one boundary from reading as a repeating groove. Scales
    // with `footprintScale` so the overlap-to-tile-size ratio (and thus how
    // well seams hide) stays the same as when this was tuned at the smaller
    // footprint.
    const tileSpacing = tileSize - 1.0 * footprintScale;
    const tileSpan = Math.ceil((half * 2) / tileSpacing) + 2;
    const tileStart = -((tileSpan - 1) * tileSpacing) / 2 - tileSpacing / 2;

    interface TileTransform {
      readonly x: number;
      readonly z: number;
      readonly y: number;
      readonly rotation: number;
      readonly scale: number;
      readonly scaleY: number;
    }
    const tiles: TileTransform[] = [];
    for (let iz = 0; iz < tileSpan; iz++) {
      const rowStagger = (iz % 4) * (tileSpacing / 4);
      for (let ix = 0; ix < tileSpan; ix++) {
        const x = tileStart + ix * tileSpacing + rowStagger;
        const z = tileStart + iz * tileSpacing;

        // Wider spread than before (was 0.92-1.16) so terrain outside every
        // clearing reads noticeably rougher, sharpening the contrast against
        // the flattened zones. Each zone pulls scaleY down toward its own
        // squash within its blend radius; the strongest (lowest) pull wins
        // where zones overlap, and tiles outside every zone's influence keep
        // their full-noise value untouched.
        let scaleY = 0.82 + Math.random() * 0.55;
        for (const zone of smoothZones) {
          const dist = Math.hypot(x - zone.x, z - zone.z);
          const t = THREE.MathUtils.smoothstep(
            dist,
            zone.flatRadius,
            zone.blendRadius,
          );
          scaleY = Math.min(
            scaleY,
            THREE.MathUtils.lerp(zone.squash, scaleY, t),
          );
        }

        // The road (built right after this in `buildRoads`) is a real but
        // thin asphalt/marking surface — ground relief has to be forced
        // near-zero along its whole length, not just near the origin, or
        // tufts further out (outside every plaza/clearing zone, at up to
        // full noise height) poke up through it. `roadDist` is distance to
        // the nearest road center-line: the full-length main road at
        // x = ROAD_X, plus the east-only side arm at z = SIDE_ROAD_Z (which
        // simply doesn't exist west of the junction — a T, not a cross).
        const mainRoadDist = Math.abs(x - ROAD_X);
        const sideRoadDist =
          x > ROAD_X ? Math.abs(z - SIDE_ROAD_Z) : Infinity;
        const roadDist = Math.min(mainRoadDist, sideRoadDist);
        const roadT = THREE.MathUtils.smoothstep(
          roadDist,
          ROAD_HALF_WIDTH,
          ROAD_HALF_WIDTH + 5,
        );
        scaleY = Math.min(scaleY, THREE.MathUtils.lerp(0.04, scaleY, roadT));

        tiles.push({
          x,
          z,
          y: groundTileBaseOffset * scaleY,
          rotation: (Math.floor(Math.random() * 4) * Math.PI) / 2,
          scale: (0.92 + Math.random() * 0.24) * footprintScale,
          scaleY,
        });
      }
    }

    // All tiles share one geometry/material, so they're drawn as a
    // single `InstancedMesh` — one draw call for the whole ground layer
    // instead of one per tile (this was the single biggest frame-cost item
    // on the map). Shadow-casting stays off for the same reason it was
    // before: not worth doubling the cost for self-shadowing ground relief.
    // The pivot offset the loader bakes into the template (bottom-anchored
    // at local y=0) has to be folded into each instance's matrix by hand
    // here, since InstancedMesh has no parent/child transform to inherit it
    // from the way a placed clone would.
    void loadVoxelInstanceSource(`${ASSET_ROOT}/SM-0-Ground`)
      .then(({ geometry, material, pivot }) => {
        const mesh = new THREE.InstancedMesh(geometry, material, tiles.length);
        const pivotMatrix = new THREE.Matrix4().makeTranslation(
          pivot.x,
          pivot.y,
          pivot.z,
        );
        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        const position = new THREE.Vector3();
        const scaleVec = new THREE.Vector3();
        for (let i = 0; i < tiles.length; i++) {
          const tile = tiles[i];
          position.set(tile.x, tile.y, tile.z);
          quaternion.setFromAxisAngle(up, tile.rotation);
          scaleVec.set(tile.scale, tile.scaleY, tile.scale);
          matrix.compose(position, quaternion, scaleVec).multiply(pivotMatrix);
          mesh.setMatrixAt(i, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        this.ctx.scene.add(mesh);
      })
      .catch((error: unknown) => {
        console.error("Failed to load ground tile asset SM-0-Ground", error);
      });
  }

  private buildRoads(): void {
    const half = GameConfig.world.halfSize;

    // The road assets are small (1.6x1.6-unit) modular tiles that come in
    // mirrored A/B pairs — confirmed by rendering them in isolation
    // (debug-road-viewer.html): "A" carries a lane-edge line near its own
    // -X edge, "B" the same line near its own +X edge. They're meant to sit
    // side by side (A + B = one 3.2-wide two-lane road with a marked edge
    // on each outside boundary), not to be scaled up individually — doing
    // that earlier stretched the tiny marking geometry and caused the
    // overlap seams to double up ("clipping"). Used at native scale here.
    //
    // Their native/unrotated orientation is already a north-south road
    // (edge lines and crosswalk stripes both run along Z) — the previous
    // version had this backwards, rotating the N-S arm instead of the E-W
    // one.
    const nativeTileSize = 1.6;
    const laneHalfWidth = nativeTileSize / 2;
    const tileSpacing = nativeTileSize - 0.15; // slight overlap, no seam gaps
    const crossingHalfExtent = laneHalfWidth;

    // These textures are tiny MagicaVoxel palette swatches sampled by the
    // geometry's own UVs — the tiles already have a full opaque base color
    // baked in (a bright grass green, since this pack's roads are meant to
    // run through grass/park-like ground), not a road-photo texture. That
    // green read as visually clashing against the graveyard's much darker,
    // desaturated ground palette (SM-0-Ground uses e.g. 0x21362e), so it's
    // tinted toward that same family here — `tint` multiplies the existing
    // texture rather than replacing it, so the yellow lane lines and grey
    // crosswalk stripes stay distinguishable from the base, just darker.
    const roadTint = 0x4a5a4e;

    // Crosswalk block at the T-junction: A (crosswalk only) + B
    // (crosswalk + edge line) side by side, oriented for the main N-S road.
    this.placeVoxel({
      asset: "Road-Crossing-A",
      x: ROAD_X - laneHalfWidth,
      y: 0.02,
      z: SIDE_ROAD_Z,
      castShadow: false,
      tint: roadTint,
    });
    this.placeVoxel({
      asset: "Road-Crossing-B",
      x: ROAD_X + laneHalfWidth,
      y: 0.02,
      z: SIDE_ROAD_Z,
      castShadow: false,
      tint: roadTint,
    });

    // A second crosswalk just inside the north gate — real roads repeat
    // their markings at features, not at mirror-symmetric offsets.
    const gateCrosswalkZ = -29;

    // Three arms radiate from the junction: the main road's long north run
    // (all the way to the gate) and shorter south run, plus the side road
    // heading east only. Their unequal lengths are the point.
    const arms: ReadonlyArray<{
      readonly dirX: number;
      readonly dirZ: number;
      readonly length: number;
    }> = [
      { dirX: 0, dirZ: -1, length: SIDE_ROAD_Z + half },
      { dirX: 0, dirZ: 1, length: half - SIDE_ROAD_Z },
      { dirX: 1, dirZ: 0, length: half - ROAD_X },
    ];

    for (const arm of arms) {
      const tileCount = Math.max(
        0,
        Math.ceil((arm.length - crossingHalfExtent) / tileSpacing),
      );
      for (let i = 0; i < tileCount; i++) {
        const offset = crossingHalfExtent + tileSpacing / 2 + i * tileSpacing;
        const cz = SIDE_ROAD_Z + arm.dirZ * offset;
        // Alternate the two street variants along each arm's length purely
        // for texture variety (their marking layout differs slightly) —
        // real lane-edge position/orientation is unaffected either way.
        // The gate crosswalk swaps in the crossing tiles at one grid slot
        // of the north run.
        const gateCrosswalk =
          arm.dirZ === -1 && Math.abs(cz - gateCrosswalkZ) < tileSpacing / 2;
        const streetAsset = gateCrosswalk
          ? "Road-Crossing-A"
          : i % 2 === 0
            ? "Road-Street6-A"
            : "Road-Street8-A";
        const streetAssetB = gateCrosswalk
          ? "Road-Crossing-B"
          : i % 2 === 0
            ? "Road-Street6-B"
            : "Road-Street8-B";

        if (arm.dirZ !== 0) {
          // Main road, native N-S orientation (rotation 0).
          this.placeVoxel({
            asset: streetAsset,
            x: ROAD_X - laneHalfWidth,
            y: 0.02,
            z: cz,
            castShadow: false,
            tint: roadTint,
          });
          this.placeVoxel({
            asset: streetAssetB,
            x: ROAD_X + laneHalfWidth,
            y: 0.02,
            z: cz,
            castShadow: false,
            tint: roadTint,
          });
        } else {
          // Side road east: rotated 90 deg. A local +X edge-line offset maps
          // to world -Z after this rotation (verified empirically), so the
          // A/B lane assignment swaps sides here relative to the main road —
          // that's expected and fine, it's still symmetric edge lines
          // outside, open lane in the middle.
          const cx = ROAD_X + arm.dirX * offset;
          this.placeVoxel({
            asset: streetAsset,
            x: cx,
            y: 0.02,
            z: SIDE_ROAD_Z + laneHalfWidth,
            rotation: Math.PI / 2,
            castShadow: false,
            tint: roadTint,
          });
          this.placeVoxel({
            asset: streetAssetB,
            x: cx,
            y: 0.02,
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
    const half = GameConfig.world.halfSize;
    const thickness = 0.8;
    const height = 2.1;

    // The boundary stays sealed for gameplay, but the collider is invisible;
    // the voxel iron fence supplies the actual graveyard silhouette.
    this.addStaticBoxCollider(
      [half * 2 + 1.6, height, thickness],
      [0, height / 2, -half],
    );
    this.addStaticBoxCollider(
      [half * 2 + 1.6, height, thickness],
      [0, height / 2, half],
    );
    this.addStaticBoxCollider(
      [thickness, height, half * 2 + 1.6],
      [-half, height / 2, 0],
    );
    this.addStaticBoxCollider(
      [thickness, height, half * 2 + 1.6],
      [half, height / 2, 0],
    );

    const fenceScale = 0.92;
    for (let p = -33.5; p <= 33.5; p += 2) {
      this.placeVoxel({
        asset: "SM-7-Fence",
        x: p,
        z: -34.45,
        scale: fenceScale,
      });
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

  private buildGate(): void {
    // Voxel gate pillars frame the main road's northern exit (which sits at
    // ROAD_X, not the map center); the gap stays wide.
    this.placeVoxel({
      asset: "SM-8-Pillar",
      x: ROAD_X - 4.2,
      z: -30.5,
      rotation: Math.PI / 2,
      scale: 1.3,
    });
    this.placeVoxel({
      asset: "SM-8-Pillar",
      x: ROAD_X + 4.2,
      z: -30.5,
      rotation: -Math.PI / 2,
      scale: 1.3,
    });
  }

  /** NW quadrant: the old fenced cemetery block. A rectangular plot with its
   *  own iron fence (broken open on the east side, gated on the south) and
   *  jittered rows of headstones inside — the densest grave read on the map,
   *  and clearly a *place* rather than scattered stones. */
  private buildBurialPlot(): void {
    // Plot rectangle roughly x [-28.5, -11.5], z [-28, -14.2].
    this.placeFenceRun(-27.6, -28, 1.8, 0, 9, 0); // north wall
    this.placeFenceRun(-28.5, -26.2, 0, 1.8, 7, Math.PI / 2); // west wall
    this.placeFenceRun(-11.5, -26.2, 0, 1.8, 4, -Math.PI / 2); // east wall, broken
    this.placeFenceRun(-27.6, -14.2, 1.8, 0, 3, Math.PI); // south wall, west run
    this.placeFenceRun(-17.4, -14.2, 1.8, 0, 3, Math.PI); // south wall, east run
    // Pillars flank the gap the south runs leave — the plot's own gate.
    this.placeVoxel({ asset: "SM-8-Pillar", x: -23.1, z: -14.3, scale: 1.1 });
    this.placeVoxel({
      asset: "SM-8-Pillar",
      x: -18.3,
      z: -14.3,
      scale: 1.1,
      rotation: Math.PI,
    });

    // Hand-jittered rows: consistent enough to read as a cemetery block,
    // irregular enough (offsets, rotations, mixed stones, varied scale)
    // that no two graves line up perfectly.
    const graves: readonly VoxelPlacement[] = [
      { asset: "SM-3-Tomb1", x: -26.3, z: -25.6, rotation: 0.08, scale: 1.0 },
      { asset: "SM-4-Tomb2", x: -23.8, z: -25.1, rotation: -0.1, scale: 0.9 },
      { asset: "SM-5-Tomb3", x: -21.2, z: -25.7, rotation: 0.15, scale: 0.95 },
      { asset: "SM-3-Tomb1", x: -18.4, z: -25.2, rotation: -0.06, scale: 0.88 },
      { asset: "SM-4-Tomb2", x: -15.9, z: -25.8, rotation: 0.2, scale: 1.0 },
      { asset: "SM-3-Tomb1", x: -13.6, z: -25.3, rotation: -0.14, scale: 0.94 },
      { asset: "SM-5-Tomb3", x: -25.4, z: -21.9, rotation: -0.12, scale: 1.05 },
      { asset: "SM-3-Tomb1", x: -22.6, z: -21.4, rotation: 0.1, scale: 0.92 },
      { asset: "SM-4-Tomb2", x: -19.8, z: -22.0, rotation: 0.05, scale: 0.85 },
      { asset: "SM-3-Tomb1", x: -16.8, z: -21.5, rotation: -0.18, scale: 1.0 },
      { asset: "SM-5-Tomb3", x: -14.2, z: -22.1, rotation: 0.12, scale: 0.9 },
      { asset: "SM-4-Tomb2", x: -26.6, z: -18.1, rotation: 0.16, scale: 0.95 },
      { asset: "SM-3-Tomb1", x: -23.4, z: -17.6, rotation: -0.08, scale: 1.02 },
      { asset: "SM-5-Tomb3", x: -20.4, z: -18.3, rotation: 0.06, scale: 0.88 },
      { asset: "SM-4-Tomb2", x: -17.2, z: -17.7, rotation: -0.2, scale: 0.92 },
      { asset: "SM-3-Tomb1", x: -14.6, z: -18.2, rotation: 0.1, scale: 0.9 },
    ];
    for (const grave of graves) this.placeVoxel(grave);

    // A raven on one of the taller headstones in the back row.
    this.placeVoxel({
      asset: "SM-6-Raven",
      x: -26.3,
      y: 1.95,
      z: -25.6,
      rotation: 0.6,
      scale: 0.72,
    });
  }

  /** NE quadrant: the caretaker's corner. Igor mid-dig beside a loose row of
   *  fresh grave mounds, with his supply clutter (trash, crates, ammo box)
   *  around a burning fire pit — the quadrant's light source. */
  private buildCaretakerCorner(): void {
    this.placeVoxel({
      asset: "SM-11-Igor_wSpade",
      x: 17,
      z: -19.5,
      rotation: 2.4,
      scale: 0.95,
    });
    this.placeVoxel({
      asset: "SM-10-Spade",
      x: 15.6,
      z: -17.8,
      rotation: 0.6,
      scale: 0.9,
    });

    // Fresh, low grave mounds — the row Igor is still working on.
    const freshGraves: readonly VoxelPlacement[] = [
      { asset: "SM-4-Tomb2", x: 14.8, z: -21.6, rotation: 0.35, scale: 1.0 },
      { asset: "SM-4-Tomb2", x: 17.2, z: -22.8, rotation: -0.2, scale: 0.95 },
      { asset: "SM-4-Tomb2", x: 19.6, z: -21.9, rotation: 0.15, scale: 1.05 },
    ];
    for (const grave of freshGraves) this.placeVoxel(grave);

    // Supply clutter around the fire pit.
    this.placeVoxel({
      asset: "props/Bonefire.fbx",
      x: 19.8,
      z: -16.4,
      rotation: 0.9,
    });
    this.addFireLight(19.8, -16.4);
    this.placeVoxel({
      asset: "props/Trash.fbx",
      x: 22.4,
      z: -17.8,
      rotation: 0.7,
      scale: 0.9,
    });
    this.placeVoxel({
      asset: "props/AttachedBoxes.fbx",
      x: 23.6,
      z: -15.6,
      rotation: -0.4,
      scale: 0.9,
    });
    this.placeVoxel({
      asset: "props/AmmoBox_5.fbx",
      x: 22.2,
      z: -14.4,
      rotation: 1.2,
      scale: 0.8,
    });

    // A couple of older stones deeper in the corner keep it a graveyard.
    this.placeVoxel({
      asset: "SM-5-Tomb3",
      x: 27,
      z: -24,
      rotation: 0.1,
      scale: 1.15,
    });
    this.placeVoxel({
      asset: "SM-3-Tomb1",
      x: 24,
      z: -27.5,
      rotation: -0.12,
      scale: 0.95,
    });
    this.placeVoxel({
      asset: "SM-6-Raven",
      x: 24,
      y: 1.85,
      z: -27.5,
      rotation: -2.1,
      scale: 0.72,
    });
  }

  /** SW quadrant: the ancient tree. The map's single tree, scaled up into a
   *  proper landmark, with the single ghost drifting beside it and a loose
   *  arc of leaning old graves scattered under the canopy. */
  private buildAncientTree(): void {
    const treeX = -21;
    const treeZ = 20;
    const treeScale = 1.55;
    this.placeVoxel({
      asset: "SM-1-Tree",
      x: treeX,
      z: treeZ,
      scale: treeScale,
      rotation: 0.9,
    });
    // Only the narrow trunk is solid; branches and foliage never create
    // invisible snag points around the vehicle.
    this.addStaticCylinderCollider(0.58 * treeScale, 2.1 * treeScale, [
      treeX,
      1.05 * treeScale,
      treeZ,
    ]);

    // The ghost self-glows and casts its own cold light pool on the graves
    // below — the spectral teal is deliberately the only non-warm light
    // source on the map, so the SW corner reads haunted from across it.
    this.placeVoxel({
      asset: "SM-2-Ghost",
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
    this.ctx.scene.add(ghostLight);

    // Old graves in a rough arc under the canopy, angles all over the place —
    // this corner predates the tidy plot across the road.
    const oldGraves: readonly VoxelPlacement[] = [
      { asset: "SM-4-Tomb2", x: -27.5, z: 15, rotation: 0.4, scale: 0.95 },
      { asset: "SM-5-Tomb3", x: -27, z: 23, rotation: 0.15, scale: 1.0 },
      { asset: "SM-3-Tomb1", x: -25.5, z: 27, rotation: -0.3, scale: 1.05 },
      { asset: "SM-5-Tomb3", x: -18, z: 27.5, rotation: 0.25, scale: 0.9 },
      { asset: "SM-3-Tomb1", x: -13.5, z: 23.5, rotation: 2.9, scale: 0.85 },
      { asset: "SM-4-Tomb2", x: -14, z: 13.5, rotation: -0.5, scale: 0.9 },
    ];
    for (const grave of oldGraves) this.placeVoxel(grave);

    // A raven up on a branch instead of a headstone here.
    this.placeVoxel({
      asset: "SM-6-Raven",
      x: -19.8,
      y: 4.6,
      z: 21.2,
      rotation: -1.2,
      scale: 0.72,
    });
  }

  /** Southeast: two sub-clusters. A survivor roadblock camp sitting ON the
   *  side road just east of the T-junction (barricades, barbed wire, fire —
   *  players drive right through it), and a ruined pillar monument deeper
   *  into the corner as the far landmark. */
  private buildCheckpointAndMonument(): void {
    // Roadblock straddling the side road near the junction.
    this.placeVoxel({
      asset: "props/Barricade_03.fbx",
      x: 4.6,
      z: 6.8,
      rotation: 0.35,
    });
    this.placeVoxel({
      asset: "props/Barricade_03.fbx",
      x: 7.4,
      z: 4.4,
      rotation: 1.75,
      scale: 0.92,
    });
    this.placeVoxel({
      asset: "props/BarbedWires.fbx",
      x: 5.2,
      z: 10.2,
      rotation: 0.2,
    });
    this.placeVoxel({
      asset: "props/BarbedWires.fbx",
      x: 9.6,
      z: 5,
      rotation: 1.35,
      scale: 0.9,
    });
    this.placeVoxel({
      asset: "props/Bonefire.fbx",
      x: 6.6,
      z: 7.8,
      rotation: -0.4,
    });
    this.addFireLight(6.6, 7.8);
    this.placeVoxel({
      asset: "props/AmmoBox_5.fbx",
      x: 7.8,
      z: 9,
      rotation: 2.2,
      scale: 0.75,
    });
    this.placeVoxel({
      asset: "props/Trash.fbx",
      x: 10.4,
      z: 7.6,
      rotation: -0.8,
      scale: 0.9,
    });

    // Ruined monument: a broken ring of pillars around one oversized fallen
    // tomb — the missing pillar keeps the ring readable as a ruin.
    const monumentX = 25;
    const monumentZ = 23;
    for (const angle of [0.3, 1.55, 2.8, 4.05] as const) {
      this.placeVoxel({
        asset: "SM-8-Pillar",
        x: monumentX + Math.cos(angle) * 3.4,
        z: monumentZ + Math.sin(angle) * 3.4,
        rotation: angle + Math.PI,
        scale: 1.45,
      });
    }
    this.placeVoxel({
      asset: "SM-5-Tomb3",
      x: monumentX,
      z: monumentZ,
      rotation: 0.65,
      scale: 1.4,
    });

    // Sparse stones bridging the two sub-clusters.
    this.placeVoxel({
      asset: "SM-3-Tomb1",
      x: 15.5,
      z: 27,
      rotation: 0.2,
      scale: 0.9,
    });
    this.placeVoxel({
      asset: "SM-4-Tomb2",
      x: 18.5,
      z: 14.5,
      rotation: -0.35,
      scale: 0.95,
    });
    this.placeVoxel({
      asset: "SM-5-Tomb3",
      x: 29.5,
      z: 13.5,
      rotation: 0.1,
      scale: 0.85,
    });
  }

  /** Strays that deliberately ignore the quadrant clusters: lone sunken
   *  graves, dumped supplies, and roadside clutter. Hand-placed rather than
   *  Math.random so nothing lands on the road or inside a cluster, but with
   *  no rhythm — uneven gaps, mixed sides of the road, odd rotations, and a
   *  few pieces half-sunk into the ground. This is what keeps the map from
   *  reading as four tidy islands. */
  private buildScatter(): void {
    const strays: readonly VoxelPlacement[] = [
      // Shoulders of the main road, both sides at uneven intervals.
      { asset: "SM-4-Tomb2", x: -2.9, z: -26.5, rotation: 1.3, scale: 0.8 },
      { asset: "SM-3-Tomb1", x: -3.2, z: -22, rotation: -0.4, scale: 0.9 },
      {
        asset: "props/Trash.fbx",
        x: -9.9,
        z: -12,
        rotation: 2.6,
        scale: 0.7,
      },
      { asset: "SM-5-Tomb3", x: -3.6, z: -8.5, rotation: 0.9, scale: 0.75 },
      { asset: "SM-4-Tomb2", x: -2.6, z: 20.8, rotation: -1.1, scale: 1.0 },
      {
        asset: "props/BarbedWires.fbx",
        x: -2.5,
        z: 29.3,
        rotation: 1.5,
        scale: 0.8,
      },
      {
        asset: "props/AmmoBox_5.fbx",
        x: -9.5,
        z: -2.7,
        rotation: 0.9,
        scale: 0.7,
      },
      // Shoulders of the east side road.
      { asset: "props/Trash.fbx", x: 21.5, z: 5.1, rotation: -1.9, scale: 0.8 },
      { asset: "SM-3-Tomb1", x: 27.5, z: 11.1, rotation: 1.1, scale: 0.95 },
      // Two of the T-junction's corners get a lone marker, the rest stay
      // bare.
      { asset: "SM-4-Tomb2", x: -9.8, z: 4.9, rotation: 1.7, scale: 0.7 },
      { asset: "SM-3-Tomb1", x: -3.4, z: 11.9, rotation: -1.3, scale: 0.7 },
      // Mid-field strays in the gaps between clusters, a few sunk into the
      // ground like the earth is reclaiming them.
      { asset: "SM-3-Tomb1", x: -26, z: -3.0, rotation: 1.8, scale: 0.8 },
      { asset: "SM-4-Tomb2", x: -19.5, z: 2.7, rotation: 0.3, scale: 0.9 },
      { asset: "SM-5-Tomb3", x: 12.5, z: 2.9, rotation: -0.7, scale: 0.9 },
      { asset: "SM-3-Tomb1", x: 3.0, z: 19.5, rotation: 0.5, scale: 0.85 },
      { asset: "SM-3-Tomb1", x: 5.0, z: -5.2, rotation: -1.3, scale: 0.7 },
      { asset: "SM-4-Tomb2", x: -9.6, z: -17, rotation: 0.7, scale: 0.85 },
      {
        asset: "SM-3-Tomb1",
        x: -10.2,
        z: -26.5,
        y: -0.2,
        rotation: -0.25,
        scale: 1.0,
      },
      { asset: "SM-5-Tomb3", x: 9, z: -27, rotation: 0.4, scale: 0.8 },
      { asset: "SM-4-Tomb2", x: 10.5, z: -13, rotation: -0.6, scale: 0.9 },
      {
        asset: "SM-3-Tomb1",
        x: 12,
        z: 21.5,
        y: -0.3,
        rotation: 2.2,
        scale: 0.8,
      },
      { asset: "SM-4-Tomb2", x: 26, z: 29, rotation: 0.9, scale: 0.85 },
      { asset: "SM-5-Tomb3", x: -8.5, z: 20, rotation: -1.4, scale: 0.95 },
      { asset: "SM-3-Tomb1", x: -10, z: 29, rotation: 0.15, scale: 0.9 },
      // Odd dumps along the perimeter fence, far from any cluster.
      { asset: "props/Trash.fbx", x: 28.5, z: -8, rotation: 0.5, scale: 0.85 },
      {
        asset: "props/AttachedBoxes.fbx",
        x: -30.5,
        z: 6.5,
        rotation: 1.9,
        scale: 0.7,
      },
      { asset: "SM-5-Tomb3", x: -31, z: -8, rotation: 2.0, scale: 0.9 },
      { asset: "SM-4-Tomb2", x: 30, z: -19, rotation: -0.9, scale: 0.8 },
    ];
    for (const stray of strays) this.placeVoxel(stray);

    // One more raven, perched on the lone headstone at the side road's far
    // east end.
    this.placeVoxel({
      asset: "SM-6-Raven",
      x: 27.5,
      y: 1.85,
      z: 11.1,
      rotation: 2.6,
      scale: 0.72,
    });
  }

  /** A straight run of fence pieces starting at (x, z), stepping by
   *  (dx, dz) per piece. Used for the burial plot's own enclosure. */
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
        asset: "SM-7-Fence",
        x: x + dx * i,
        z: z + dz * i,
        rotation,
        scale: 0.85,
      });
    }
  }

  /** Warm flickerless fire glow for the bonfire props. */
  private addFireLight(x: number, z: number): void {
    const light = new THREE.PointLight(0xff6a2b, 30, 10, 2);
    light.position.set(x, 0.9, z);
    this.ctx.scene.add(light);
  }

  /** Stop signs where a real road would post them: facing traffic arriving
   *  at the T-junction, before the gate crosswalk, and at each dead end.
   *  Upright and axis-aligned — street furniture, not debris. The panel's
   *  normal is Z at rotation 0, so main-road signs use rotation 0 and
   *  side-road signs use PI/2; native height is only ~1 unit, so they're
   *  scaled up to read next to the car. */
  private buildRoadSigns(): void {
    const signs: ReadonlyArray<readonly [number, number, number]> = [
      [-2.8, 5.4, Math.PI / 2], // junction, faces side-road traffic
      [-3.4, -27.6, 0], // before the gate crosswalk
      [-8.6, 30.2, 0], // main road's south dead end
      [31, 10.6, Math.PI / 2], // side road's east dead end
    ];
    for (const [x, z, rotation] of signs) {
      this.placeVoxel({ asset: "RoadSign-66", x, z, rotation, scale: 1.8 });
    }
  }

  private buildLanterns(): void {
    // Street lamps at a fixed 12-unit interval along both roads, alternating
    // shoulders the way real street lighting staggers, plus one at the
    // burial plot gate. The two bonfires light their own clusters.
    const shoulderOffset = ROAD_HALF_WIDTH + 1.0;
    const lanternPositions: Array<readonly [number, number]> = [
      [-20.7, -12.6], // burial plot gate
    ];
    const lampSpacing = 12;
    // Main road: z runs -24..24, starting clear of the gate pillars.
    let side = 1;
    for (let z = -24; z <= 24; z += lampSpacing) {
      lanternPositions.push([ROAD_X + side * shoulderOffset, z]);
      side = -side;
    }
    // Side road: x runs east from just past the junction to the fence.
    side = -1;
    for (let x = 2; x <= 30; x += lampSpacing) {
      lanternPositions.push([x, SIDE_ROAD_Z + side * shoulderOffset]);
      side = -side;
    }
    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0x211b1b,
      roughness: 0.8,
    });
    const glowMaterial = new THREE.MeshStandardMaterial({
      color: 0xffb34f,
      emissive: 0xff7a21,
      emissiveIntensity: 5,
      roughness: 0.25,
    });

    for (const [x, z] of lanternPositions) {
      const group = new THREE.Group();
      group.position.set(x, 0, z);

      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 2.5, 0.16),
        postMaterial,
      );
      post.position.y = 1.25;
      post.castShadow = true;
      group.add(post);

      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(0.56, 0.16, 0.56),
        postMaterial,
      );
      cap.position.y = 2.55;
      cap.castShadow = true;
      group.add(cap);

      const glow = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.42, 0.34),
        glowMaterial,
      );
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
    const {
      asset,
      x,
      z,
      y = 0,
      rotation = 0,
      scale = 1,
      scaleY = scale,
      castShadow = true,
      tint,
      emissive,
    } = placement;
    void instantiateVoxelAsset(`${ASSET_ROOT}/${asset}`)
      .then((object) => {
        object.position.set(x, y, z);
        object.rotation.y = rotation;
        object.scale.set(scale, scaleY, scale);
        if (!castShadow || tint !== undefined || emissive !== undefined) {
          object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            if (!castShadow) child.castShadow = false;
            if (tint === undefined && emissive === undefined) return;
            const materials = Array.isArray(child.material)
              ? child.material
              : [child.material];
            for (const material of materials) {
              const colored = material as THREE.Material & {
                color?: THREE.Color;
                emissive?: THREE.Color;
              };
              if (tint !== undefined) colored.color?.set(tint);
              if (emissive !== undefined) colored.emissive?.set(emissive);
            }
          });
        }
        this.ctx.scene.add(object);
      })
      .catch((error: unknown) => {
        console.error(`Failed to load graveyard asset ${asset}`, error);
      });
  }

  private addStaticBoxCollider(
    size: readonly [number, number, number],
    position: readonly [number, number, number],
  ): void {
    const body = this.ctx.physics.createRigidBody(
      this.ctx.rapier.RigidBodyDesc.fixed().setTranslation(...position),
    );
    this.ctx.physics.createCollider(
      this.ctx.rapier.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
        .setFriction(0.2)
        .setCollisionGroups(CollisionGroups.static),
      body,
    );
  }

  private addStaticCylinderCollider(
    radius: number,
    height: number,
    position: readonly [number, number, number],
  ): void {
    const body = this.ctx.physics.createRigidBody(
      this.ctx.rapier.RigidBodyDesc.fixed().setTranslation(...position),
    );
    this.ctx.physics.createCollider(
      this.ctx.rapier.ColliderDesc.cylinder(height / 2, radius)
        .setFriction(0.15)
        .setCollisionGroups(CollisionGroups.static),
      body,
    );
  }

  private computeSpawnPoints(): THREE.Vector3[] {
    const { spawnPointCount, spawnRadius } = GameConfig.world;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < spawnPointCount; i++) {
      const angle = (i / spawnPointCount) * Math.PI * 2;
      points.push(
        new THREE.Vector3(
          Math.cos(angle) * spawnRadius,
          0,
          Math.sin(angle) * spawnRadius,
        ),
      );
    }
    return points;
  }
}
