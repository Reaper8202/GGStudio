/**
 * The Reinforce ward: a yellow hex shell that breaks apart as it soaks damage.
 *
 * The ability is a pool of hit points in front of the hull rather than a switch
 * (see `RuntimeVehicle.grantReinforce`), and the player has to be able to read
 * how much of that pool is left without looking anywhere but the rig. So the
 * shell is built out of discrete hexagonal panels: every panel is a slice of
 * the pool, and as the pool drains, panels shatter — each into a spray of
 * smaller hexagons that tumble outward and fade. A ward at half strength is a
 * shell with half its panels missing, which reads at a glance and from any
 * angle, unlike a bar or a fading tint.
 *
 * Presentation only: nothing here decides whether damage got through. It is
 * driven entirely by the ward fraction the vehicle reports, so a ward that
 * shatters, times out, or is re-raised needs no notification beyond that
 * number.
 */

import * as THREE from 'three';

/** Panels in the shell. Also how finely the pool reads as it drains. */
const PANEL_COUNT = 55;
/** Smaller hexagons one shattering panel breaks into. */
const SHARDS_PER_PANEL = 5;
/** Circumradius of an intact panel, metres. */
const PANEL_RADIUS_M = 0.92;
/** Circumradius of a shard, as a fraction of the panel it came from. */
const SHARD_SCALE = 0.34;
/** Seconds a shard spends tumbling away before it is gone. */
const SHARD_LIFE_SECONDS = 0.7;
/** Metres per second a shard drifts outward, before its own jitter. */
const SHARD_DRIFT_MPS = 2.4;

/** Plating yellow: the ward at full strength. */
const WARD_COLOR = 0xffd23f;
/** The white-hot flash a panel takes when the ward soaks a hit. */
const WARD_HIT_COLOR = 0xfff6c9;
/** What a shard cools to on its way out. */
const SHARD_COLOR = 0xb8781a;

/** Opacity of an intact panel at rest, before the hit flash is added. */
const PANEL_OPACITY = 0.5;
/** Opacity of the soft inner bubble at full pool. */
const BUBBLE_OPACITY = 0.13;
/** Seconds a hit flash takes to fall back to rest. */
const FLASH_DECAY_SECONDS = 0.28;

interface WardPanel {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly shards: THREE.Mesh[];
  /** Outward normal at this panel's seat on the shell. */
  readonly normal: THREE.Vector3;
  /**
   * Ward fraction at or below which this panel gives way. Panels are seated in
   * a scattered order rather than pole-to-pole, so the shell erodes all over
   * instead of unzipping from one side (see `constructor`).
   */
  readonly breakAt: number;
  broken: boolean;
  /** Seconds of shard flight left; 0 once the debris is gone. */
  shardLife: number;
}

export class ReinforceWard {
  readonly root = new THREE.Group();
  private readonly panels: WardPanel[] = [];
  private readonly bubble: THREE.Mesh;
  private readonly bubbleMaterial: THREE.MeshBasicMaterial;
  private readonly panelGeometry: THREE.CircleGeometry;
  private readonly shardGeometry: THREE.CircleGeometry;
  /** Ward fraction last frame, so a drop can be read as a hit. */
  private lastFraction = 0;
  /** 0..1 flash left over from the most recent hit. */
  private flash = 0;
  private disposed = false;

  constructor(radiusM: number) {
    this.root.name = 'reinforce-ward';
    this.root.visible = false;

    // Flat six-sided discs: a hexagon is `CircleGeometry` with six segments,
    // which costs two triangles less than a panel mesh of its own would.
    this.panelGeometry = new THREE.CircleGeometry(PANEL_RADIUS_M, 6);
    this.shardGeometry = new THREE.CircleGeometry(
      PANEL_RADIUS_M * SHARD_SCALE,
      6,
    );

    this.bubbleMaterial = new THREE.MeshBasicMaterial({
      color: WARD_COLOR,
      transparent: true,
      opacity: BUBBLE_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.bubble = new THREE.Mesh(
      new THREE.SphereGeometry(radiusM * 0.97, 20, 14),
      this.bubbleMaterial,
    );
    this.root.add(this.bubble);

    for (let i = 0; i < PANEL_COUNT; i++) {
      this.panels.push(this.createPanel(i, radiusM));
    }
  }

  /**
   * Seat one panel on the shell. Positions come off a Fibonacci sphere, which
   * spaces them evenly without the crowding a latitude/longitude grid gets at
   * the poles; each panel is then turned to lie flat against the shell.
   */
  private createPanel(index: number, radiusM: number): WardPanel {
    const golden = Math.PI * (3 - Math.sqrt(5));
    const y = 1 - (2 * index + 1) / PANEL_COUNT;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * index;
    const normal = new THREE.Vector3(
      Math.cos(theta) * ring,
      y,
      Math.sin(theta) * ring,
    ).normalize();

    const material = new THREE.MeshBasicMaterial({
      color: WARD_COLOR,
      transparent: true,
      opacity: PANEL_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.panelGeometry, material);
    mesh.position.copy(normal).multiplyScalar(radiusM);
    // A disc faces +Z by default; point that at the normal so the panel lies
    // tangent to the shell rather than edge-on to the camera.
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this.root.add(mesh);

    const shards: THREE.Mesh[] = [];
    for (let i = 0; i < SHARDS_PER_PANEL; i++) {
      const shard = new THREE.Mesh(this.shardGeometry, material);
      shard.visible = false;
      shards.push(shard);
      this.root.add(shard);
    }

    // The break order is the Fibonacci index scrambled by an odd stride: a
    // panel's seat on the shell and its place in the queue are then unrelated,
    // so the ward erodes in scattered holes instead of peeling off one face.
    const order = ((index * 17) % PANEL_COUNT) / PANEL_COUNT;
    return {
      mesh,
      material,
      shards,
      normal,
      breakAt: order,
      broken: false,
      shardLife: 0,
    };
  }

  /**
   * Advance the shell for a frame. `fraction` is the ward pool left, 0..1;
   * pass 0 (or `active: false`) once the ward is down and the shell resets,
   * ready to be raised whole again.
   */
  update(dt: number, active: boolean, fraction: number): void {
    if (this.disposed) return;
    if (!active) {
      // A ward that shattered leaves its last shards in flight for a beat
      // rather than blinking out mid-break.
      if (this.root.visible && this.hasShardsInFlight()) {
        this.stepShards(dt);
        this.bubbleMaterial.opacity = 0;
        this.setPanelsHidden();
        return;
      }
      if (this.root.visible) this.reset();
      return;
    }

    if (!this.root.visible) {
      this.reset();
      this.root.visible = true;
      this.lastFraction = fraction;
    }

    if (fraction < this.lastFraction - 1e-4) this.flash = 1;
    this.lastFraction = fraction;
    this.flash = Math.max(0, this.flash - dt / FLASH_DECAY_SECONDS);

    this.bubbleMaterial.opacity = BUBBLE_OPACITY * (0.35 + 0.65 * fraction);

    for (const panel of this.panels) {
      if (!panel.broken && fraction <= panel.breakAt) this.shatter(panel);
      if (panel.broken) continue;
      panel.material.opacity = PANEL_OPACITY * (0.55 + 0.45 * fraction);
      panel.material.color.setHex(this.flash > 0 ? WARD_HIT_COLOR : WARD_COLOR);
    }
    this.stepShards(dt);
  }

  /**
   * Break every panel still standing. Called when the pool is emptied outright
   * rather than drained past a threshold, so the last hit takes the whole shell
   * apart instead of leaving it to vanish on the next frame.
   */
  shatterAll(): void {
    if (this.disposed || !this.root.visible) return;
    for (const panel of this.panels) {
      if (!panel.broken) this.shatter(panel);
    }
  }

  /** Break one panel: hide the plate, scatter its shards from where it sat. */
  private shatter(panel: WardPanel): void {
    panel.broken = true;
    panel.shardLife = SHARD_LIFE_SECONDS;
    panel.mesh.visible = false;
    // The panel's own plane, in the shell's frame: the shards start spread
    // across the face it occupied, so a break reads as the panel coming apart
    // rather than as pieces appearing beside it.
    const tangentX = new THREE.Vector3(1, 0, 0).applyQuaternion(
      panel.mesh.quaternion,
    );
    const tangentY = new THREE.Vector3(0, 1, 0).applyQuaternion(
      panel.mesh.quaternion,
    );
    for (let i = 0; i < panel.shards.length; i++) {
      const shard = panel.shards[i];
      const angle = (i / panel.shards.length) * Math.PI * 2;
      const spread = PANEL_RADIUS_M * 0.45;
      shard.position
        .copy(panel.mesh.position)
        .addScaledVector(tangentX, Math.cos(angle) * spread)
        .addScaledVector(tangentY, Math.sin(angle) * spread);
      shard.quaternion.copy(panel.mesh.quaternion);
      shard.scale.setScalar(1);
      shard.visible = true;
    }
  }

  /** Drift, spin and fade every panel's debris; hide it once it has burned out. */
  private stepShards(dt: number): void {
    for (const panel of this.panels) {
      if (!panel.broken || panel.shardLife <= 0) continue;
      panel.shardLife = Math.max(0, panel.shardLife - dt);
      const progress = 1 - panel.shardLife / SHARD_LIFE_SECONDS;
      for (const shard of panel.shards) {
        shard.position.addScaledVector(panel.normal, SHARD_DRIFT_MPS * dt);
        shard.rotateZ(dt * 5);
        shard.rotateX(dt * 3);
        shard.scale.setScalar(Math.max(0.05, 1 - progress * 0.7));
        if (panel.shardLife === 0) shard.visible = false;
      }
      // The debris carries its panel's material, so this is what fades it —
      // the plate itself is already hidden and takes no part in the colour.
      panel.material.color.setHex(SHARD_COLOR);
      panel.material.opacity = PANEL_OPACITY * (1 - progress);
    }
  }

  private hasShardsInFlight(): boolean {
    return this.panels.some((panel) => panel.broken && panel.shardLife > 0);
  }

  private setPanelsHidden(): void {
    for (const panel of this.panels) {
      if (!panel.broken) panel.mesh.visible = false;
    }
  }

  /** Put the shell back together, whole and unlit, for the next activation. */
  private reset(): void {
    this.root.visible = false;
    this.flash = 0;
    this.lastFraction = 0;
    for (const panel of this.panels) {
      panel.broken = false;
      panel.shardLife = 0;
      panel.mesh.visible = true;
      panel.material.color.setHex(WARD_COLOR);
      panel.material.opacity = PANEL_OPACITY;
      for (const shard of panel.shards) shard.visible = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.panelGeometry.dispose();
    this.shardGeometry.dispose();
    this.bubble.geometry.dispose();
    this.bubbleMaterial.dispose();
    for (const panel of this.panels) panel.material.dispose();
  }
}
