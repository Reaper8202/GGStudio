import * as THREE from 'three';
import { Palette, ThemePalettes, type ThemeName } from '../config/constants';
import { Rng } from '../systems/Rng';
import type { LaneManager } from './LaneManager';

const SEGMENT_UNITS = 10; // one texture repeat = 10 world units of track
const TRACK_LENGTH = 150;
const FLOOR_CANVAS_SIZE = 256;
const WALL_CANVAS_SIZE = { w: 256, h: 96 };

/** One theme's color set, as defined in `ThemePalettes`. */
type ThemePalette = (typeof ThemePalettes)[ThemeName];

/**
 * The space-station corridor: a scrolling floor (canvas texture, offset
 * animated), windowed side walls scrolled in sync, and a static starfield.
 * All visuals are generated in code — zero asset files.
 *
 * The corridor's look can be swapped between distance-based `ThemeName`s via
 * `setTheme`; the floor/wall canvases are repainted in place and the scene's
 * fog + background color ease toward the new theme over `update(dt)`.
 */
export class Track {
  private readonly scene: THREE.Scene;
  private readonly floorCanvas: HTMLCanvasElement;
  private readonly wallCanvas: HTMLCanvasElement;
  private readonly floorTex: THREE.CanvasTexture;
  private readonly wallTex: THREE.CanvasTexture;
  private readonly wallMat: THREE.MeshStandardMaterial;

  private currentTheme: ThemeName = 'station';
  /** Lerp target for fog/background color, preallocated to avoid per-frame GC. */
  private readonly fogTarget = new THREE.Color(ThemePalettes.station.fog);

  constructor(scene: THREE.Scene, lanes: LaneManager) {
    this.scene = scene;
    const width = lanes.floorHalfWidth * 2;

    // -- floor ---------------------------------------------------------------
    this.floorCanvas = createCanvas(FLOOR_CANVAS_SIZE, FLOOR_CANVAS_SIZE);
    paintFloorCanvas(this.floorCanvas, this.currentTheme, ThemePalettes[this.currentTheme]);
    this.floorTex = new THREE.CanvasTexture(this.floorCanvas);
    this.floorTex.wrapS = THREE.RepeatWrapping;
    this.floorTex.wrapT = THREE.RepeatWrapping;
    this.floorTex.repeat.set(1, TRACK_LENGTH / SEGMENT_UNITS);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, TRACK_LENGTH),
      new THREE.MeshStandardMaterial({ map: this.floorTex, roughness: 0.85, metalness: 0.25 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -TRACK_LENGTH / 2 + 12);
    scene.add(floor);

    // -- side walls (inner faces with lit windows) --------------------------
    this.wallCanvas = createCanvas(WALL_CANVAS_SIZE.w, WALL_CANVAS_SIZE.h);
    paintWallCanvas(this.wallCanvas, this.currentTheme, ThemePalettes[this.currentTheme]);
    this.wallTex = new THREE.CanvasTexture(this.wallCanvas);
    this.wallTex.wrapS = THREE.RepeatWrapping;
    this.wallTex.repeat.set(TRACK_LENGTH / SEGMENT_UNITS, 1);
    const wallGeo = new THREE.PlaneGeometry(TRACK_LENGTH, 3.2);
    this.wallMat = new THREE.MeshStandardMaterial({ map: this.wallTex, roughness: 0.8, metalness: 0.2 });
    const wallX = lanes.floorHalfWidth + 0.4;

    const left = new THREE.Mesh(wallGeo, this.wallMat);
    left.position.set(-wallX, 1.6, -TRACK_LENGTH / 2 + 12);
    left.rotation.y = Math.PI / 2;
    scene.add(left);

    const right = new THREE.Mesh(wallGeo, this.wallMat);
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

  /**
   * Switch the corridor's environment theme. Repaints the floor/wall canvases
   * in place (same CanvasTexture objects — just `needsUpdate`) and sets the
   * new fog/background lerp target. No-op if `theme` is already current.
   */
  setTheme(theme: ThemeName): void {
    if (theme === this.currentTheme) return;
    this.currentTheme = theme;
    const palette = ThemePalettes[theme];

    paintFloorCanvas(this.floorCanvas, theme, palette);
    this.floorTex.needsUpdate = true;

    paintWallCanvas(this.wallCanvas, theme, palette);
    this.wallTex.needsUpdate = true;
    if (palette.wallOpenness > 0) {
      // Open-hull themes need alpha blending; once enabled it stays enabled —
      // fully opaque pixels render identically whether the flag is set or not.
      this.wallMat.transparent = true;
    }

    this.fogTarget.setHex(palette.fog);
  }

  /**
   * Ease the scene's fog and background color toward the current theme's
   * target color. Frame-rate independent; a full transition takes ~1.5s.
   */
  update(dt: number): void {
    const t = Math.min(1, (dt / 1500) * 3);
    if (this.scene.fog) {
      this.scene.fog.color.lerp(this.fogTarget, t);
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(this.fogTarget, t);
    }
  }
}

// -- canvas texture painters (one 10-unit segment each) -----------------------

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/** Diagonal hazard stripes clipped to a band, used by the reactor floor theme. */
function paintHazardStripes(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = css(color);
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 4;
  for (let sx = -h; sx < w + h; sx += 12) {
    ctx.beginPath();
    ctx.moveTo(x + sx, y + h);
    ctx.lineTo(x + sx + h, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Repaint the floor canvas in place for `theme`. */
function paintFloorCanvas(canvas: HTMLCanvasElement, theme: ThemeName, palette: ThemePalette): void {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = css(palette.floor);
  ctx.fillRect(0, 0, width, height);

  // plate seam(s) across the segment — reactor gets a second band with
  // diagonal hazard stripes for a denser, more dangerous-looking floor.
  ctx.fillStyle = css(palette.seam);
  ctx.fillRect(0, 0, width, 6);
  if (theme === 'reactor') {
    ctx.fillRect(0, height / 2, width, 6);
    paintHazardStripes(ctx, 0, 0, width, 6, palette.wallGlow);
    paintHazardStripes(ctx, 0, height / 2, width, 6, palette.wallGlow);
  }

  // lane divider dashes at 1/3 and 2/3 — hull skips the lower dash for a
  // sparser, more open-hull look.
  ctx.fillStyle = css(palette.floorLine);
  for (const x of [width / 3, (2 * width) / 3]) {
    ctx.fillRect(x - 2, 24, 4, 64);
    if (theme !== 'hull') {
      ctx.fillRect(x - 2, height - 104, 4, 64);
    }
  }

  // glowing edge rails
  ctx.fillStyle = css(palette.laneGlow);
  ctx.globalAlpha = 0.7;
  ctx.fillRect(0, 0, 5, height);
  ctx.fillRect(width - 5, 0, 5, height);
  ctx.globalAlpha = 1;
}

/** Repaint the wall canvas in place for `theme`. */
function paintWallCanvas(canvas: HTMLCanvasElement, theme: ThemeName, palette: ThemePalette): void {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);

  if (palette.wallOpenness > 0) {
    // Open-hull look: everything above the guard rail is left transparent
    // (canvas alpha 0) so the starfield shows through. Only a low band of
    // wall at the bottom, with a glowing rail along its top edge.
    const bandY = height * palette.wallOpenness;
    const bandH = height - bandY;
    ctx.fillStyle = css(palette.wall);
    ctx.fillRect(0, bandY, width, bandH);

    ctx.fillStyle = css(palette.wallGlow);
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, bandY, width, 3);
    ctx.globalAlpha = 1;
    return;
  }

  ctx.fillStyle = css(palette.wall);
  ctx.fillRect(0, 0, width, height);

  // panel seam (reuses the floor color, matching the original station look)
  ctx.fillStyle = css(palette.floor);
  ctx.fillRect(0, 0, 4, height);

  // lit porthole windows
  ctx.fillStyle = css(palette.wallGlow);
  ctx.globalAlpha = 0.85;
  for (const x of [64, 176]) {
    ctx.beginPath();
    ctx.roundRect(x - 22, 24, 44, 26, 8);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (theme === 'reactor') {
    // extra thin glow strip mid-height, warm reactor glow bleeding through
    ctx.fillStyle = css(palette.wallGlow);
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, height / 2 - 1, width, 3);
    ctx.globalAlpha = 1;
  }

  // accent strip along the bottom
  ctx.fillStyle = css(palette.laneGlow);
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, height - 8, width, 4);
  ctx.globalAlpha = 1;
}
