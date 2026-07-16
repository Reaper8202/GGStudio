/**
 * The ranch keeper — built entirely from Three primitives (no downloaded model).
 * WASD/arrows + virtual joystick movement, circle collision via the spatial hash,
 * subtle walk bob. Speed and interact radius come from balance.json.
 */
import * as THREE from 'three';
import type { JoystickState } from '../core/EventBus';
import type { SpatialHash } from '../core/SpatialHash';
import { makeBlobShadow } from './Fx';

const CREAM = 0xf6eedd;
const BARK = 0x8a6b4d;
const STRAW = 0xf2c14e;
const SKIN = 0xf0c9a0;

export class Player {
  readonly group = new THREE.Group();
  readonly radius = 0.4;
  x = 0;
  z = 0;
  facing = 0;
  moving = false;

  private body: THREE.Group;
  private keys = new Set<string>();
  private bobT = 0;
  private tmpDir = new THREE.Vector2();

  constructor(private speed: number) {
    this.body = new THREE.Group();
    this.group.add(makeBlobShadow(0.55));
    this.group.add(this.body);

    // overalls / lower body
    const legs = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.35, 4, 8),
      new THREE.MeshStandardMaterial({ color: BARK, flatShading: true }),
    );
    legs.position.y = 0.45;
    this.body.add(legs);

    // cream shirt torso
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.26, 0.22, 4, 8),
      new THREE.MeshStandardMaterial({ color: CREAM, flatShading: true }),
    );
    torso.position.y = 0.85;
    this.body.add(torso);

    // head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 12, 10),
      new THREE.MeshStandardMaterial({ color: SKIN, flatShading: true }),
    );
    head.position.y = 1.18;
    this.body.add(head);

    // straw hat: brim + cone
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 0.04, 12),
      new THREE.MeshStandardMaterial({ color: STRAW, flatShading: true }),
    );
    brim.position.y = 1.3;
    this.body.add(brim);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.28, 12),
      new THREE.MeshStandardMaterial({ color: STRAW, flatShading: true }),
    );
    cone.position.y = 1.45;
    this.body.add(cone);

    // tiny feet
    for (const sx of [-0.14, 0.14]) {
      const foot = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x5c4632, flatShading: true }),
      );
      foot.scale.set(1, 0.6, 1.4);
      foot.position.set(sx, 0.12, 0.05);
      this.body.add(foot);
    }

    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (
      ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)
    ) {
      if (e.type === 'keydown') this.keys.add(k);
      else this.keys.delete(k);
    }
  };

  setPosition(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.group.position.set(x, 0, z);
  }

  get position2(): { x: number; z: number } {
    return { x: this.x, z: this.z };
  }

  worldPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.x, 0, this.z);
  }

  update(dt: number, joystick: JoystickState, hash: SpatialHash): void {
    let dx = 0;
    let dz = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dz -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dz += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (joystick.active) {
      dx += joystick.x;
      dz += joystick.y;
    }
    this.tmpDir.set(dx, dz);
    const len = this.tmpDir.length();
    this.moving = len > 0.05;
    if (this.moving) {
      this.tmpDir.multiplyScalar(1 / Math.max(len, 1));
      const nx = this.x + this.tmpDir.x * this.speed * dt;
      const nz = this.z + this.tmpDir.y * this.speed * dt;
      const resolved = hash.resolveCircle(nx, nz, this.radius);
      this.x = resolved.x;
      this.z = resolved.z;
      this.facing = Math.atan2(this.tmpDir.x, this.tmpDir.y);
      this.bobT += dt * 10;
    } else {
      this.bobT = 0;
    }
    this.group.position.set(this.x, 0, this.z);
    this.body.rotation.y = this.facing;
    this.body.position.y = this.moving ? Math.abs(Math.sin(this.bobT)) * 0.08 : 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
  }
}
