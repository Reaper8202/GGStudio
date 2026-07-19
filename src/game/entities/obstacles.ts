import * as THREE from 'three';
import { Palette } from '../../config/constants';
import type { ObstacleKind } from '../../systems/Spawner';
import { makeBean, makeBlobShadow } from './bean';

/**
 * Pooled 3D obstacles. One class per spawner kind:
 *   'block' → ImposterObstacle — a menacing impostor standing in the lane;
 *             can't be jumped or slid past, change lanes
 *   'low'   → VentObstacle — floor vent, jump over it
 *   'high'  → GateObstacle — overhead energy gate, slide under it
 */
export interface Obstacle3D {
  readonly kind: ObstacleKind;
  readonly group: THREE.Group;
  lane: number;
  activate(lane: number, x: number, z: number): void;
  deactivate(): void;
  update(dt: number, now: number): void;
}

abstract class BaseObstacle implements Obstacle3D {
  abstract readonly kind: ObstacleKind;
  readonly group = new THREE.Group();
  lane = 0;
  active = false;

  constructor(scene: THREE.Scene) {
    this.group.visible = false;
    scene.add(this.group);
  }

  activate(lane: number, x: number, z: number): void {
    this.lane = lane;
    this.group.position.set(x, 0, z);
    this.group.visible = true;
    this.active = true;
  }

  deactivate(): void {
    this.group.visible = false;
    this.active = false;
  }

  update(_dt: number, _now: number): void {}
}

// ---------------------------------------------------------------------------

const ventBaseGeo = new THREE.BoxGeometry(1.7, 0.5, 0.95);
const ventSlatGeo = new THREE.BoxGeometry(1.45, 0.06, 0.16);
const ventGlowGeo = new THREE.BoxGeometry(1.5, 0.05, 0.02);
const ventMat = new THREE.MeshLambertMaterial({ color: Palette.vent });
const ventDarkMat = new THREE.MeshLambertMaterial({ color: Palette.ventDark });
const ventGlowMat = new THREE.MeshBasicMaterial({
  color: Palette.laneGlow,
  transparent: true,
  opacity: 0.55,
});

/** Floor vent — jump over. */
export class VentObstacle extends BaseObstacle {
  readonly kind = 'low' as const;

  constructor(scene: THREE.Scene) {
    super(scene);
    const base = new THREE.Mesh(ventBaseGeo, ventMat);
    base.position.y = 0.25;
    this.group.add(base);
    for (let i = 0; i < 4; i++) {
      const slat = new THREE.Mesh(ventSlatGeo, ventDarkMat);
      slat.position.set(0, 0.53, -0.36 + i * 0.24);
      this.group.add(slat);
    }
    // Low-key emissive strip along the front face so the vent pops under bloom.
    const glow = new THREE.Mesh(ventGlowGeo, ventGlowMat);
    glow.position.set(0, 0.12, 0.485);
    this.group.add(glow);
  }
}

// ---------------------------------------------------------------------------

const postGeo = new THREE.BoxGeometry(0.18, 2.1, 0.18);
const beamGeo = new THREE.BoxGeometry(1.95, 0.45, 0.28);
const beamGlowGeo = new THREE.BoxGeometry(1.95, 0.07, 0.3);
const postMat = new THREE.MeshLambertMaterial({ color: Palette.ventDark });
const beamMat = new THREE.MeshLambertMaterial({ color: Palette.gate });
const beamGlowMat = new THREE.MeshBasicMaterial({ color: Palette.gateBeam });

// Hover-drone variant geometry — same clearance as the beam gate (underside
// ~y1.36, overall top ~y2.0), just no posts to slide "under a beam" past.
const droneBodyGeo = new THREE.BoxGeometry(1.3, 0.4, 0.75);
const droneStemGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.2, 8);
const droneRotorGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.035, 20);
const droneGlowGeo = new THREE.BoxGeometry(1.1, 0.04, 0.5);
const droneBodyMat = new THREE.MeshLambertMaterial({ color: Palette.vent });
const droneDarkMat = new THREE.MeshLambertMaterial({ color: Palette.ventDark });
const droneGlowMat = new THREE.MeshBasicMaterial({ color: Palette.gateBeam });

/** Overhead energy gate — slide under (clearance below ~1.3u). */
export class GateObstacle extends BaseObstacle {
  readonly kind = 'high' as const;
  private readonly glow: THREE.Mesh;

  // Two interchangeable visual variants, same footprint/clearance:
  //   0 = classic post-and-beam gate, 1 = hovering drone.
  private static variantCounter = 0;
  private variant = 0;
  private readonly beamVariant: THREE.Group;
  private readonly droneVariant: THREE.Group;
  private readonly droneRotor: THREE.Mesh;
  private readonly droneGlow: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    super(scene);

    this.beamVariant = new THREE.Group();
    const postL = new THREE.Mesh(postGeo, postMat);
    postL.position.set(-0.9, 1.05, 0);
    const postR = new THREE.Mesh(postGeo, postMat);
    postR.position.set(0.9, 1.05, 0);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 1.62;
    this.glow = new THREE.Mesh(beamGlowGeo, beamGlowMat);
    this.glow.position.y = 1.36;
    this.beamVariant.add(postL, postR, beam, this.glow);

    this.droneVariant = new THREE.Group();
    const body = new THREE.Mesh(droneBodyGeo, droneBodyMat);
    body.position.y = 1.56; // bottom 1.36, top 1.76
    const stem = new THREE.Mesh(droneStemGeo, droneDarkMat);
    stem.position.y = 1.86; // sits atop the body, up to the rotor
    this.droneRotor = new THREE.Mesh(droneRotorGeo, droneDarkMat);
    this.droneRotor.position.y = 1.98; // overall top ~2.0
    this.droneGlow = new THREE.Mesh(droneGlowGeo, droneGlowMat);
    this.droneGlow.position.y = 1.34; // emissive strip flush under the body
    this.droneVariant.add(body, stem, this.droneRotor, this.droneGlow);

    this.group.add(this.beamVariant, this.droneVariant);
  }

  override activate(lane: number, x: number, z: number): void {
    super.activate(lane, x, z);
    this.variant = GateObstacle.variantCounter++ % 2;
    this.beamVariant.visible = this.variant === 0;
    this.droneVariant.visible = this.variant === 1;
    this.droneVariant.position.y = 0;
  }

  override update(dt: number, now: number): void {
    if (this.variant === 0) {
      // Hazard flicker on the lower edge of the beam.
      (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.3 * Math.sin(now / 90);
      (this.glow.material as THREE.MeshBasicMaterial).transparent = true;
    } else {
      // Spinning rotor, a subtle hover bob (does not affect the collision
      // profile — only shifts the whole assembly by up to ±0.04), and the
      // same flicker treatment on the underside glow strip.
      this.droneRotor.rotation.y += dt * 0.015;
      this.droneVariant.position.y = 0.04 * Math.sin(now / 260);
      (this.droneGlow.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.3 * Math.sin(now / 90);
      (this.droneGlow.material as THREE.MeshBasicMaterial).transparent = true;
    }
  }
}

// ---------------------------------------------------------------------------

/** An impostor standing in the lane — the 'block' kind: change lanes or die. */
export class ImposterObstacle extends BaseObstacle {
  readonly kind = 'block' as const;
  private readonly bean: THREE.Group;

  constructor(scene: THREE.Scene) {
    super(scene);
    const parts = makeBean({
      color: Palette.imposter,
      darkColor: Palette.imposterDark,
      visorColor: Palette.imposterEye,
      visorEmissive: Palette.imposterEye,
      menacing: true,
    });
    this.bean = parts.group;
    this.bean.scale.setScalar(1.25);
    this.bean.rotation.y = Math.PI; // faces the approaching player
    this.group.add(this.bean);
    this.group.add(makeBlobShadow());
  }

  override update(_dt: number, now: number): void {
    // Menacing idle: slow bob + sway.
    this.bean.position.y = 0.05 * Math.sin(now / 300 + this.group.position.x);
    this.bean.rotation.z = 0.06 * Math.sin(now / 420 + this.lane);
  }
}

// ---------------------------------------------------------------------------

const coinGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 18);
const coinMat = new THREE.MeshLambertMaterial({
  color: Palette.coin,
  emissive: Palette.coin,
  emissiveIntensity: 0.35,
});

/** Spinning pickup. `elevated` marks arc coins floating over a vent jump. */
export class CoinPickup {
  readonly group = new THREE.Group();
  elevated = false;
  active = false;
  private readonly disc: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.disc = new THREE.Mesh(coinGeo, coinMat);
    this.disc.rotation.z = Math.PI / 2; // upright coin facing the player
    this.disc.position.y = 0.6;
    this.group.add(this.disc);
    this.group.visible = false;
    scene.add(this.group);
  }

  activate(x: number, z: number, elevated: boolean): void {
    this.elevated = elevated;
    this.group.position.set(x, 0, z);
    this.disc.position.y = elevated ? 1.35 : 0.6;
    this.group.visible = true;
    this.active = true;
  }

  deactivate(): void {
    this.group.visible = false;
    this.active = false;
  }

  update(dt: number): void {
    this.disc.rotation.y += dt * 0.004;
  }
}
