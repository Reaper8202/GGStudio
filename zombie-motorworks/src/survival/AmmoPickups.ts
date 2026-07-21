/**
 * Ammo-box pickups scattered across the graveyard. A small, fixed number of
 * boxes exist at once and each spot only comes back a good while after it is
 * collected, so resupply is deliberately scarce — the player cannot simply
 * park on a box for effectively infinite ammo. Driving over an active box tops
 * every mounted weapon up by a fixed chunk of its magazine.
 */

import * as THREE from 'three';
import type { RuntimeVehicle } from '../runtime/vehicle.ts';
import { instantiateVoxelAsset } from './VoxelAssetLoader.ts';

interface MapBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const ASSET_URL = `${import.meta.env.BASE_URL}assets/graveyard/props/AmmoBox_5.fbx`;

// Rarity knobs. Few boxes, slow to return: a resupply is something to go out
// of your way for, not a given.
const SLOT_COUNT = 3;
const RESPAWN_SECONDS = 34;
const INITIAL_DELAY_MIN = 5;
const INITIAL_DELAY_MAX = 28;

const PICKUP_RADIUS = 2.8; // horizontal metres to collect
const PICKUP_RADIUS_SQ = PICKUP_RADIUS * PICKUP_RADIUS;
const REFILL_FRACTION = 0.5; // fixed chunk added to each weapon's magazine
const EDGE_MARGIN = 8; // keep boxes clear of the perimeter walls
const MIN_VEHICLE_DISTANCE = 12; // never drop one on top of the player
const MIN_VEHICLE_DISTANCE_SQ = MIN_VEHICLE_DISTANCE * MIN_VEHICLE_DISTANCE;

const BASE_Y = 0.7; // hover height of the box centre
const BOB_AMPLITUDE = 0.22;
const BOB_RATE = 2.1; // rad/s
const SPIN_RATE = 1.1; // rad/s
const BOX_SCALE = 1.15;
const GLOW_COLOR = 0xffd166;

interface Slot {
  readonly group: THREE.Group;
  box: THREE.Object3D | null;
  active: boolean;
  cooldown: number; // seconds until this spot spawns again
  x: number;
  z: number;
  phase: number; // bob/spin animation offset
}

export class AmmoPickups {
  private readonly root = new THREE.Group();
  private readonly slots: Slot[] = [];
  private disposed = false;

  // Owned, shared beacon visuals (disposed here; the box mesh itself shares the
  // cached voxel template and is disposed with the asset cache).
  private readonly haloGeometry = new THREE.TorusGeometry(1.1, 0.08, 8, 24);
  private readonly haloMaterial = new THREE.MeshBasicMaterial({
    color: GLOW_COLOR,
    transparent: true,
    opacity: 1,
  });
  private readonly beamGeometry = new THREE.CylinderGeometry(0.32, 0.32, 6, 12, 1, true);
  private readonly beamMaterial = new THREE.MeshBasicMaterial({
    color: GLOW_COLOR,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  constructor(
    private readonly scene: THREE.Scene,
    private readonly vehicle: RuntimeVehicle,
    private readonly bounds: MapBounds,
  ) {
    this.root.name = 'ammo-pickups';
    this.scene.add(this.root);
    for (let i = 0; i < SLOT_COUNT; i++) this.slots.push(this.createSlot());
  }

  private createSlot(): Slot {
    const group = new THREE.Group();
    group.visible = false;

    const halo = new THREE.Mesh(this.haloGeometry, this.haloMaterial);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.12;
    group.add(halo);

    const beam = new THREE.Mesh(this.beamGeometry, this.beamMaterial);
    beam.position.y = 3;
    group.add(beam);

    // No real light source here on purpose: toggling a light's visibility
    // changes the scene's active-light count, which makes three.js recompile
    // every material in the scene (a hard frame spike on spawn/collect). The
    // unlit glow meshes above read as a beacon without touching lighting.

    this.root.add(group);

    const slot: Slot = {
      group,
      box: null,
      active: false,
      cooldown:
        INITIAL_DELAY_MIN +
        Math.random() * (INITIAL_DELAY_MAX - INITIAL_DELAY_MIN),
      x: 0,
      z: 0,
      phase: Math.random() * Math.PI * 2,
    };

    // Load the box model once per slot; it shares geometry with any decorative
    // ammo boxes already placed in the graveyard.
    void instantiateVoxelAsset(ASSET_URL)
      .then((object) => {
        if (this.disposed) return;
        object.scale.setScalar(BOX_SCALE);
        object.position.y = -0.3; // model origin sits at its base; centre it
        slot.box = object;
        group.add(object);
      })
      .catch(() => undefined);

    return slot;
  }

  /** Advance respawn timers and collect any box the vehicle is sitting on. */
  step(dt: number): void {
    if (this.disposed) return;
    const pos = this.vehicle.body.translation();
    for (const slot of this.slots) {
      if (!slot.active) {
        slot.cooldown -= dt;
        if (slot.cooldown <= 0) this.spawn(slot, pos);
        continue;
      }
      const dx = pos.x - slot.x;
      const dz = pos.z - slot.z;
      if (dx * dx + dz * dz > PICKUP_RADIUS_SQ) continue;
      // Only spend the box if it actually restores something; a full loadout
      // drives straight over it and leaves it for later.
      if (this.vehicle.refillWeapons(REFILL_FRACTION) > 0) this.collect(slot);
    }
  }

  private spawn(slot: Slot, vehiclePos: { x: number; z: number }): void {
    const point = this.pickLocation(vehiclePos);
    slot.x = point.x;
    slot.z = point.z;
    slot.active = true;
    slot.group.position.set(point.x, 0, point.z);
    slot.group.visible = true;
  }

  private collect(slot: Slot): void {
    slot.active = false;
    slot.cooldown = RESPAWN_SECONDS;
    slot.group.visible = false;
  }

  private pickLocation(vehiclePos: { x: number; z: number }): {
    x: number;
    z: number;
  } {
    const minX = this.bounds.minX + EDGE_MARGIN;
    const maxX = this.bounds.maxX - EDGE_MARGIN;
    const minZ = this.bounds.minZ + EDGE_MARGIN;
    const maxZ = this.bounds.maxZ - EDGE_MARGIN;
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      x = minX + Math.random() * (maxX - minX);
      z = minZ + Math.random() * (maxZ - minZ);
      const dx = x - vehiclePos.x;
      const dz = z - vehiclePos.z;
      if (dx * dx + dz * dz >= MIN_VEHICLE_DISTANCE_SQ) break;
    }
    return { x, z };
  }

  /** Bob and spin active boxes so they read as collectible beacons. */
  updateVisuals(frameDt: number): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.phase += frameDt;
      slot.group.position.y = BASE_Y + Math.sin(slot.phase * BOB_RATE) * BOB_AMPLITUDE;
      if (slot.box) slot.box.rotation.y += SPIN_RATE * frameDt;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.root);
    this.root.clear();
    this.haloGeometry.dispose();
    this.haloMaterial.dispose();
    this.beamGeometry.dispose();
    this.beamMaterial.dispose();
    this.slots.length = 0;
  }
}
