import * as THREE from 'three';
import { Palette } from '../config/constants';
import { Rng } from '../systems/Rng';
import type { LaneManager } from './LaneManager';

const SEGMENT_UNITS = 10; // one texture repeat = 10 world units of track
const TRACK_LENGTH = 150;

/**
 * The space-station corridor: a scrolling floor (canvas texture, offset
 * animated), windowed side walls scrolled in sync, and a static starfield.
 * All visuals are generated in code — zero asset files.
 */
export class Track {
  private readonly floorTex: THREE.CanvasTexture;
  private readonly wallTex: THREE.CanvasTexture;

  constructor(scene: THREE.Scene, lanes: LaneManager) {
    const width = lanes.floorHalfWidth * 2;

    // -- floor ---------------------------------------------------------------
    this.floorTex = new THREE.CanvasTexture(makeFloorCanvas());
    this.floorTex.wrapS = THREE.RepeatWrapping;
    this.floorTex.wrapT = THREE.RepeatWrapping;
    this.floorTex.repeat.set(1, TRACK_LENGTH / SEGMENT_UNITS);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, TRACK_LENGTH),
      new THREE.MeshLambertMaterial({ map: this.floorTex }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -TRACK_LENGTH / 2 + 12);
    scene.add(floor);

    // -- side walls (inner faces with lit windows) --------------------------
    this.wallTex = new THREE.CanvasTexture(makeWallCanvas());
    this.wallTex.wrapS = THREE.RepeatWrapping;
    this.wallTex.repeat.set(TRACK_LENGTH / SEGMENT_UNITS, 1);
    const wallGeo = new THREE.PlaneGeometry(TRACK_LENGTH, 3.2);
    const wallMat = new THREE.MeshLambertMaterial({ map: this.wallTex });
    const wallX = lanes.floorHalfWidth + 0.4;

    const left = new THREE.Mesh(wallGeo, wallMat);
    left.position.set(-wallX, 1.6, -TRACK_LENGTH / 2 + 12);
    left.rotation.y = Math.PI / 2;
    scene.add(left);

    const right = new THREE.Mesh(wallGeo, wallMat);
    right.position.set(wallX, 1.6, -TRACK_LENGTH / 2 + 12);
    right.rotation.y = -Math.PI / 2;
    scene.add(right);

    // -- starfield above the corridor ---------------------------------------
    const rng = new Rng(7); // fixed seed — purely cosmetic, stable every boot
    const starCount = 350;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = rng.next() * Math.PI * 2;
      const phi = rng.next() * Math.PI * 0.45; // upper hemisphere only
      const r = 80 + rng.next() * 40;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = 8 + r * Math.cos(phi) * 0.55;
      positions[i * 3 + 2] = -r * Math.sin(phi) * Math.sin(theta) - 10;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: Palette.star, size: 0.35, fog: false }),
    );
    scene.add(stars);
  }

  /** Advance the corridor by `dy` world units (world moves toward camera). */
  scroll(dy: number): void {
    this.floorTex.offset.y -= dy / SEGMENT_UNITS;
    this.wallTex.offset.x -= dy / SEGMENT_UNITS;
  }
}

// -- canvas texture painters (one 10-unit segment each) -----------------------

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function makeFloorCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = css(Palette.floor);
  ctx.fillRect(0, 0, 256, 256);

  // plate seam across the segment
  ctx.fillStyle = css(Palette.wall);
  ctx.fillRect(0, 0, 256, 6);

  // lane divider dashes at 1/3 and 2/3
  ctx.fillStyle = css(Palette.floorLine);
  for (const x of [256 / 3, (2 * 256) / 3]) {
    ctx.fillRect(x - 2, 24, 4, 64);
    ctx.fillRect(x - 2, 152, 4, 64);
  }

  // glowing edge rails
  ctx.fillStyle = css(Palette.laneGlow);
  ctx.globalAlpha = 0.7;
  ctx.fillRect(0, 0, 5, 256);
  ctx.fillRect(251, 0, 5, 256);
  ctx.globalAlpha = 1;
  return c;
}

function makeWallCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = css(Palette.wall);
  ctx.fillRect(0, 0, 256, 96);

  // panel seam
  ctx.fillStyle = css(Palette.floor);
  ctx.fillRect(0, 0, 4, 96);

  // lit porthole windows
  ctx.fillStyle = css(Palette.wallGlow);
  ctx.globalAlpha = 0.85;
  for (const x of [64, 176]) {
    ctx.beginPath();
    ctx.roundRect(x - 22, 24, 44, 26, 8);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // accent strip along the bottom
  ctx.fillStyle = css(Palette.laneGlow);
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, 88, 256, 4);
  ctx.globalAlpha = 1;
  return c;
}
