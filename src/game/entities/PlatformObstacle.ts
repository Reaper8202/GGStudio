import * as THREE from 'three';
import { GameConfig } from '../../config/GameConfig';
import { Palette } from '../../config/constants';
import type { Obstacle3D } from './obstacles';

const WIDTH = 1.9;
const HEIGHT = GameConfig.platform.height;
const LENGTH = GameConfig.platform.length;
const RAIL_INSET = 0.06;

const bodyGeo = new THREE.BoxGeometry(WIDTH, HEIGHT, LENGTH);
const topGeo = new THREE.BoxGeometry(WIDTH, 0.06, LENGTH);
const railGeo = new THREE.BoxGeometry(0.1, 0.05, LENGTH);

const bodyMat = new THREE.MeshLambertMaterial({ color: Palette.ventDark });
const topMat = new THREE.MeshLambertMaterial({ color: Palette.vent });
const railMat = new THREE.MeshBasicMaterial({ color: Palette.laneGlow });

/**
 * Rideable platform — a long box the player can jump onto and run along the
 * top of, then run off the far end back to floor level. Colliding with the
 * front face while grounded kills (see CollisionSystem.checkPlatforms); it
 * can never be slid under (it has no gap beneath it).
 *
 * `group.position.z` is the CENTER of the box (footprint spans
 * ±LENGTH/2), and the box itself sits on the floor: y runs from 0 (floor)
 * to HEIGHT (walkable top surface).
 *
 * Mirrors the BaseObstacle pattern in obstacles.ts (pooled
 * activate/deactivate, visibility toggling, no-op update) but implemented
 * locally rather than sharing that abstract class, per the file boundary
 * for this change.
 */
export class PlatformObstacle implements Obstacle3D {
  readonly kind = 'platform' as const;
  readonly group = new THREE.Group();
  lane = 0;
  active = false;

  constructor(scene: THREE.Scene) {
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = HEIGHT / 2;
    this.group.add(body);

    // Lighter top face, flush with the walkable surface.
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = HEIGHT + 0.03;
    this.group.add(top);

    // Thin emissive edge rails along both top edges, full length — glow
    // under bloom to read clearly as "step up here".
    const railL = new THREE.Mesh(railGeo, railMat);
    railL.position.set(-WIDTH / 2 + RAIL_INSET, HEIGHT + 0.04, 0);
    this.group.add(railL);
    const railR = new THREE.Mesh(railGeo, railMat);
    railR.position.set(WIDTH / 2 - RAIL_INSET, HEIGHT + 0.04, 0);
    this.group.add(railR);

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
