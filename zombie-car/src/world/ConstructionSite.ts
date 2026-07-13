/**
 * The construction-site map: a compact (~70x70) low-poly level built from
 * primitives. Implements `WorldApi` (bounds + spawn ring) and `GameSystem`
 * (syncs the handful of small dynamic props to their physics bodies each
 * frame, and restores their initial poses on `reset()`).
 *
 * Layout (world-space, x = east/west, z = north(-)/south(+)):
 *  - Center (~[-9,9] both axes): open plaza, kept clear for driving/turning.
 *  - NW (~x:[-27,-13], z:[-24,-12]): partial building — an L-shaped pair of
 *    gapped walls plus a 3x3 column grid (unfinished parking structure).
 *  - NE (~x:[9,29], z:[-25,-13]): two staggered shipping-container rows with
 *    a ~3.5-wide gap between them — CHOKE POINT 1 — plus a stacked pipe pile.
 *  - SE (~x:[14,29], z:[12,26]): raised concrete loading-dock platform with
 *    a drivable ramp leading up to it, flanked by concrete barriers.
 *  - SW (~x:[-24,-8], z:[8,28]): a ~4-wide lane between two concrete barrier
 *    walls — CHOKE POINT 2 — plus scattered debris/pallets/cones.
 *  - Perimeter: a fully sealed ring of static colliders (never gapped, even
 *    where fencing is drawn purely for visual dressing) so nothing escapes.
 */
import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { GameContext, GameSystem, WorldApi } from "../types";
import { CollisionGroups } from "../types/collision";
import { GameConfig } from "../config/gameConfig";
import { Materials } from "./materials";
import { createDebrisChunk, createPallet, createTrafficCone, type DynamicProp } from "./props";

interface TrackedProp extends DynamicProp {
  readonly initialPos: RAPIER.Vector;
  readonly initialRot: RAPIER.Rotation;
}

export class ConstructionSite implements WorldApi, GameSystem {
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  readonly spawnPoints: readonly THREE.Vector3[];

  private readonly ctx: GameContext;
  private readonly dynamicProps: TrackedProp[] = [];

  constructor(ctx: GameContext) {
    this.ctx = ctx;

    const half = GameConfig.world.halfSize;
    this.bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };

    this.buildLighting();
    this.buildGround();
    this.buildPerimeter();
    this.buildNorthWestBuilding();
    this.buildNorthEastContainerYard();
    this.buildSouthEastRamp();
    this.buildSouthWestChokepoint();
    this.buildScatteredProps();

    this.spawnPoints = this.computeSpawnPoints();
  }

  /** Syncs dynamic prop meshes to their physics bodies. */
  update(_dt: number): void {
    for (const prop of this.dynamicProps) {
      const t = prop.body.translation();
      const r = prop.body.rotation();
      prop.mesh.position.set(t.x, t.y, t.z);
      prop.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /** Restores every small prop to its original pose for a clean restart. */
  reset(): void {
    for (const prop of this.dynamicProps) {
      prop.body.setTranslation(prop.initialPos, true);
      prop.body.setRotation(prop.initialRot, true);
      prop.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      prop.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  // ---------------------------------------------------------------------
  // Lighting / ground
  // ---------------------------------------------------------------------

  private buildLighting(): void {
    const hemi = new THREE.HemisphereLight(0xbfd6e8, 0x4a3f33, 1.15);
    this.ctx.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d9, 1.0);
    sun.position.set(30, 45, 20);
    sun.castShadow = false;
    this.ctx.scene.add(sun);
    this.ctx.scene.add(sun.target);
  }

  private buildGround(): void {
    const half = GameConfig.world.halfSize;

    const groundMesh = new THREE.Mesh(
      new THREE.BoxGeometry(half * 2, 0.2, half * 2),
      Materials.dirt
    );
    groundMesh.position.set(0, -0.1, 0);
    this.ctx.scene.add(groundMesh);

    const body = this.ctx.physics.createRigidBody(
      this.ctx.rapier.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0)
    );
    this.ctx.physics.createCollider(
      this.ctx.rapier.ColliderDesc.cuboid(half, 0.1, half).setCollisionGroups(
        CollisionGroups.static
      ),
      body
    );

    // Concrete pad areas — visual dressing only (thin slabs resting on the
    // dirt, no separate collider needed).
    const pads: ReadonlyArray<readonly [number, number, number, number]> = [
      [0, 0, 20, 20], // central plaza
      [20, -20, 18, 14], // NE container yard
      [22, 20, 16, 16], // SE ramp/dock
      [-16, 18, 12, 22], // SW chokepoint lane
    ];
    for (const [x, z, sx, sz] of pads) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.06, sz), Materials.concrete);
      pad.position.set(x, 0.01, z);
      this.ctx.scene.add(pad);
    }
  }

  // ---------------------------------------------------------------------
  // Perimeter (fully sealed — must never have a collider gap)
  // ---------------------------------------------------------------------

  private buildPerimeter(): void {
    const half = GameConfig.world.halfSize;
    const h = GameConfig.world.wallHeight;
    const t = GameConfig.world.wallThickness;
    const outer = half + t;

    this.addStaticBox([outer * 2, h, t], [0, h / 2, -outer], Materials.concreteDark);
    this.addStaticBox([outer * 2, h, t], [0, h / 2, outer], Materials.concreteDark);
    this.addStaticBox([t, h, outer * 2], [outer, h / 2, 0], Materials.concreteDark);
    this.addStaticBox([t, h, outer * 2], [-outer, h / 2, 0], Materials.concreteDark);

    // Construction-fencing dressing along the south wall: thin posts, purely
    // decorative — the collider above already seals this edge completely.
    for (let x = -half + 3; x <= half - 3; x += 6) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, h * 0.85, 6),
        Materials.fence
      );
      post.position.set(x, (h * 0.85) / 2, outer - t / 2 - 0.08);
      this.ctx.scene.add(post);
    }
  }

  // ---------------------------------------------------------------------
  // NW — partial building (gapped L-corner walls) + column grid
  // ---------------------------------------------------------------------

  private buildNorthWestBuilding(): void {
    const h = 3.2;
    const t = 0.6;
    const mat = Materials.concrete;

    // North-facing wall, x:[-27,-13] with a 3-wide doorway gap at x=-20.
    this.addStaticBox([5.5, h, t], [-24.25, h / 2, -24], mat);
    this.addStaticBox([5.5, h, t], [-15.75, h / 2, -24], mat);

    // West-facing wall, z:[-24,-12] with a 3-wide doorway gap at z=-18.
    this.addStaticBox([t, h, 4.5], [-27, h / 2, -21.75], mat);
    this.addStaticBox([t, h, 4.5], [-27, h / 2, -14.25], mat);

    // 3x3 column grid — an unfinished parking-structure feel; wide enough
    // gaps to weave through, tight enough to slow a straight run-through.
    for (const cx of [-24, -20, -16]) {
      for (const cz of [-10, -6, -2]) {
        this.addStaticCylinder(0.35, 3.2, [cx, 1.6, cz], [0, 0, 0], Materials.concreteDark);
      }
    }
  }

  // ---------------------------------------------------------------------
  // NE — shipping-container yard with CHOKE POINT 1 between two rows
  // ---------------------------------------------------------------------

  private buildNorthEastContainerYard(): void {
    const containerSize: readonly [number, number, number] = [6, 2.5, 2.4];

    // Row A (z=-23) and Row B (z=-17): inner faces ~3.6 apart — narrow lane.
    const rowA: ReadonlyArray<readonly [number, number]> = [
      [10, -23],
      [17, -23],
      [24, -23],
    ];
    const rowB: ReadonlyArray<readonly [number, number]> = [
      [13, -17],
      [20, -17],
    ];
    for (const [x, z] of [...rowA, ...rowB]) {
      this.addStaticBox(containerSize, [x, containerSize[1] / 2, z], Materials.containerBlue);
    }
    // One rust-toned container capping the east end for visual variety.
    this.addStaticBox(containerSize, [27, containerSize[1] / 2, -17], Materials.containerRust);

    // Stacked pipe cluster just east of the yard.
    const pipeRadius = 0.3;
    const pipeLength = 4;
    this.addStaticCylinder(
      pipeRadius,
      pipeLength,
      [30, pipeRadius, -21],
      [0, 0, Math.PI / 2],
      Materials.rust
    );
    this.addStaticCylinder(
      pipeRadius,
      pipeLength,
      [30, pipeRadius, -19],
      [0, 0, Math.PI / 2],
      Materials.rust
    );
    this.addStaticCylinder(
      pipeRadius,
      pipeLength,
      [30, pipeRadius * 3, -20],
      [0, 0, Math.PI / 2],
      Materials.metal
    );
  }

  // ---------------------------------------------------------------------
  // SE — raised loading-dock platform + drivable ramp
  // ---------------------------------------------------------------------

  private buildSouthEastRamp(): void {
    const platformHeight = 2.2;
    // Platform: x:[19,29], z:[18,26].
    this.addStaticBox(
      [10, platformHeight, 8],
      [24, platformHeight / 2, 22],
      Materials.concreteLight
    );

    // Ramp: connects ground (z=12) up to the platform edge (z=18).
    const run = 6;
    const rise = platformHeight;
    const slopeLength = Math.sqrt(run * run + rise * rise);
    const pitch = Math.atan2(rise, run);
    this.addStaticRampBox([5, 0.5, slopeLength], [24, rise / 2, 15], pitch);

    // Barriers flanking the ramp base.
    this.addStaticBox([0.5, 0.8, 3], [20.8, 0.4, 13], Materials.concreteLight);
    this.addStaticBox([0.5, 0.8, 3], [27.2, 0.4, 13], Materials.concreteLight);
  }

  // ---------------------------------------------------------------------
  // SW — CHOKE POINT 2: narrow lane between two barrier walls
  // ---------------------------------------------------------------------

  private buildSouthWestChokepoint(): void {
    const mat = Materials.concrete;
    // West wall of the lane at x=-24, east wall at x=-19.5 -> ~4.1 gap.
    this.addStaticBox([0.4, 1.2, 16], [-24, 0.6, 16], mat);
    this.addStaticBox([0.4, 1.2, 16], [-19.5, 0.6, 16], mat);
  }

  // ---------------------------------------------------------------------
  // Scattered small dynamic props (cones, pallets, debris)
  // ---------------------------------------------------------------------

  private buildScatteredProps(): void {
    // Cones marking chokepoint/ramp entrances.
    const conePositions: ReadonlyArray<readonly [number, number]> = [
      [-22, -10.5],
      [-21, -9],
      [8, -20],
      [8, -18],
      [21, 12.5],
      [27, 12.5],
      [-24.5, 8.5],
      [-19, 8.5],
    ];
    for (const [x, z] of conePositions) {
      this.trackProp(createTrafficCone(this.ctx, x, z, Math.random() * Math.PI * 2));
    }

    // Pallets near the NW doorway and the ramp base.
    const palletPositions: ReadonlyArray<readonly [number, number, number]> = [
      [-19, -9.5, 0.2],
      [-21, -8.5, -0.3],
      [21, 11, 0.4],
    ];
    for (const [x, z, rot] of palletPositions) {
      this.trackProp(createPallet(this.ctx, x, z, rot));
    }

    // Debris piles near the SW corner and center-south edge.
    const debrisCenters: ReadonlyArray<readonly [number, number]> = [
      [-30, 30],
      [2, 26],
    ];
    for (const [cx, cz] of debrisCenters) {
      for (let i = 0; i < 5; i++) {
        const x = cx + (Math.random() - 0.5) * 3;
        const z = cz + (Math.random() - 0.5) * 3;
        this.trackProp(createDebrisChunk(this.ctx, x, z, 0.8 + Math.random() * 0.6));
      }
    }
  }

  // ---------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------

  private addStaticBox(
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    material: THREE.Material,
    rotationY = 0
  ): void {
    this.addStaticBoxRotated(size, position, [0, rotationY, 0], material);
  }

  private addStaticRampBox(
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    pitchRadians: number,
    rotationY = 0
  ): void {
    this.addStaticBoxRotated(size, position, [pitchRadians, rotationY, 0], Materials.concreteLight);
  }

  private addStaticBoxRotated(
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    euler: readonly [number, number, number],
    material: THREE.Material
  ): void {
    const [sx, sy, sz] = size;
    const [x, y, z] = position;

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(euler[0], euler[1], euler[2]);
    this.ctx.scene.add(mesh);

    const bodyDesc = this.ctx.rapier.RigidBodyDesc.fixed().setTranslation(x, y, z);
    if (euler[0] !== 0 || euler[1] !== 0 || euler[2] !== 0) {
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(euler[0], euler[1], euler[2])
      );
      bodyDesc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
    const body = this.ctx.physics.createRigidBody(bodyDesc);
    this.ctx.physics.createCollider(
      this.ctx.rapier.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setCollisionGroups(
        CollisionGroups.static
      ),
      body
    );
  }

  private addStaticCylinder(
    radius: number,
    length: number,
    position: readonly [number, number, number],
    euler: readonly [number, number, number],
    material: THREE.Material
  ): void {
    const [x, y, z] = position;

    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(euler[0], euler[1], euler[2]);
    this.ctx.scene.add(mesh);

    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(euler[0], euler[1], euler[2]));
    const body = this.ctx.physics.createRigidBody(
      this.ctx.rapier.RigidBodyDesc.fixed()
        .setTranslation(x, y, z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    );
    this.ctx.physics.createCollider(
      this.ctx.rapier.ColliderDesc.cylinder(length / 2, radius).setCollisionGroups(
        CollisionGroups.static
      ),
      body
    );
  }

  private trackProp(prop: DynamicProp): void {
    const t = prop.body.translation();
    const r = prop.body.rotation();
    this.dynamicProps.push({
      ...prop,
      initialPos: { x: t.x, y: t.y, z: t.z },
      initialRot: { x: r.x, y: r.y, z: r.z, w: r.w },
    });
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
