import * as THREE from 'three';
import type { MinimapFeature } from './arena/Arena.ts';

export interface MinimapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MinimapZombie {
  /** World position; only x and z are read. */
  readonly position: THREE.Vector3;
}

export interface MinimapMine {
  readonly x: number;
  readonly z: number;
  readonly revealed: boolean;
}

export interface MinimapCrate {
  readonly x: number;
  readonly z: number;
}

export interface MinimapSnapshotSource {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** Objects to hide for the capture (vehicle, zombies) — restored afterwards. */
  hide: readonly THREE.Object3D[];
  ready: Promise<void>;
}

export const MINIMAP_REDRAW_HZ = 15;

const DEFAULT_SIZE_PX = 188;
const MAX_DEVICE_PIXEL_RATIO = 2;
const MAX_SNAPSHOT_SIZE_PX = 512;
const SNAPSHOT_CAMERA_HEIGHT = 96;
const SNAPSHOT_BRIGHTNESS_GAIN = 1.9;
const SNAPSHOT_BRIGHTNESS_FLOOR = 12;
const SNAPSHOT_DESATURATION = 0.22;
/**
 * The arena's night lighting is blue, which fights the warm olive HUD once the
 * capture is brightened. Bias the lift per channel so the map sits in the same
 * palette as the panels around it.
 */
const SNAPSHOT_TINT = [1.06, 1.02, 0.82] as const;
const ZOMBIE_RADIUS_PX = 2.6;
const MINE_MARKER_RADIUS_PX = 4;
const FUEL_MARKER_RADIUS_PX = 4.5;
const FUEL_MARKER_COLOR = '#54e07a';
const PLAYER_LENGTH_PX = 16;
const PLAYER_TIP_DISTANCE_PX = (PLAYER_LENGTH_PX * 2) / 3;
const PLAYER_REAR_DISTANCE_PX = PLAYER_LENGTH_PX / 3;
const PLAYER_HALF_WIDTH_PX = 7;
const REDRAW_INTERVAL_MS = 1000 / MINIMAP_REDRAW_HZ;

/**
 * Metres from the vehicle to the edge of the round minimap. The viewport is
 * zoomed to this radius and re-centred on the player each frame, so the map
 * scrolls to reveal new sections of the arena as you drive.
 */
export const MINIMAP_VIEW_RADIUS_M = 32;

/** Maps the full arena to a north-up minimap without hiding out-of-bounds points. */
export function worldToMinimap(
  worldX: number,
  worldZ: number,
  bounds: MinimapBounds,
  sizePx: number,
): { x: number; y: number } {
  return {
    // FollowCamera's (0, 20, -12) offset looks along world +Z, making
    // screen-right world -X. Keep the minimap aligned with that fixed view.
    x: ((bounds.maxX - worldX) / (bounds.maxX - bounds.minX)) * sizePx,
    y: ((bounds.maxZ - worldZ) / (bounds.maxZ - bounds.minZ)) * sizePx,
  };
}

/**
 * Projects a world point into the fixed, player-centred viewport. The player
 * sits at the canvas centre and the map is north-up (screen-right is world -X,
 * screen-down is world -Z) — it never rotates with the vehicle's heading; only
 * the player arrow turns to show which way you are pointing.
 */
export function worldToViewport(
  worldX: number,
  worldZ: number,
  playerX: number,
  playerZ: number,
  sizePx: number,
): { x: number; y: number } {
  const pxPerMetre = sizePx / 2 / MINIMAP_VIEW_RADIUS_M;
  const half = sizePx / 2;
  // North-up map space: screen-right is world -X, screen-down is world -Z.
  return {
    x: half - (worldX - playerX) * pxPerMetre,
    y: half - (worldZ - playerZ) * pxPerMetre,
  };
}

/** A fixed north-up, zoomed, player-centred radar for the survival UI layer. */
export class Minimap {
  private root: HTMLDivElement | null;
  private canvas: HTMLCanvasElement | null;
  private context: CanvasRenderingContext2D | null;
  private backgroundCanvas: HTMLCanvasElement | null;
  private backgroundContext: CanvasRenderingContext2D | null;
  private snapshotCanvas: HTMLCanvasElement | null = null;
  private readonly features: readonly MinimapFeature[];
  private readonly minX: number;
  private readonly maxX: number;
  private readonly minZ: number;
  private readonly maxZ: number;
  private sizePx = DEFAULT_SIZE_PX;
  private devicePixelRatio = 0;
  private scaleX = 0;
  private scaleZ = 0;
  private lastDrawAt = -Infinity;

  /** Appends its own root element to `parent`. */
  constructor(
    parent: HTMLElement,
    bounds: MinimapBounds,
    features: readonly MinimapFeature[] = [],
    snapshot?: MinimapSnapshotSource,
  ) {
    this.minX = bounds.minX;
    this.maxX = bounds.maxX;
    this.minZ = bounds.minZ;
    this.maxZ = bounds.maxZ;
    this.features = features;

    const root = document.createElement('div');
    root.className = 'minimap';
    const canvas = document.createElement('canvas');
    canvas.className = 'minimap__canvas';
    const backgroundCanvas = document.createElement('canvas');
    root.append(canvas);
    parent.append(root);

    const context = canvas.getContext('2d');
    const backgroundContext = backgroundCanvas.getContext('2d');
    if (context === null || backgroundContext === null) {
      root.remove();
      throw new Error('Minimap requires a 2D canvas context.');
    }

    this.root = root;
    this.canvas = canvas;
    this.context = context;
    this.backgroundCanvas = backgroundCanvas;
    this.backgroundContext = backgroundContext;
    this.resizeBackingStore();
    if (snapshot !== undefined) {
      void this.captureSnapshotWhenReady(snapshot);
    }
  }

  update(
    vehicleX: number,
    vehicleZ: number,
    yaw: number,
    zombies: readonly MinimapZombie[],
    mines?: readonly MinimapMine[],
    crates?: readonly MinimapCrate[],
  ): void {
    const context = this.context;
    if (context === null) return;

    const now = performance.now();
    if (now - this.lastDrawAt < REDRAW_INTERVAL_MS) return;
    this.lastDrawAt = now;

    this.resizeBackingStore();
    const sizePx = this.sizePx;
    const half = sizePx / 2;
    // Anything past the round edge (plus a marker's reach) is off-viewport.
    const cullRadiusPx = half + FUEL_MARKER_RADIUS_PX;

    context.save();
    context.clearRect(0, 0, sizePx, sizePx);
    // Round radar mask so the rotating background has no square corners.
    context.beginPath();
    context.arc(half, half, half, 0, Math.PI * 2);
    context.clip();

    this.drawBackground(context, vehicleX, vehicleZ, sizePx);

    context.fillStyle = '#ff3b30';
    context.strokeStyle = 'rgba(72, 13, 11, 0.9)';
    context.lineWidth = 0.9;
    context.beginPath();
    for (let index = 0; index < zombies.length; index += 1) {
      const position = zombies[index].position;
      const point = worldToViewport(
        position.x,
        position.z,
        vehicleX,
        vehicleZ,
        sizePx,
      );
      if (Math.hypot(point.x - half, point.y - half) > cullRadiusPx) continue;
      context.moveTo(point.x + ZOMBIE_RADIUS_PX, point.y);
      context.arc(point.x, point.y, ZOMBIE_RADIUS_PX, 0, Math.PI * 2);
    }
    context.fill();
    context.stroke();

    if (crates !== undefined && crates.length > 0) {
      context.fillStyle = FUEL_MARKER_COLOR;
      context.strokeStyle = 'rgba(12, 46, 26, 0.95)';
      context.lineWidth = 1;
      context.beginPath();
      for (let index = 0; index < crates.length; index += 1) {
        const crate = crates[index];
        const point = worldToViewport(
          crate.x,
          crate.z,
          vehicleX,
          vehicleZ,
          sizePx,
        );
        if (Math.hypot(point.x - half, point.y - half) > cullRadiusPx) continue;
        const r = FUEL_MARKER_RADIUS_PX;
        context.moveTo(point.x - r, point.y - r);
        context.lineTo(point.x + r, point.y - r);
        context.lineTo(point.x + r, point.y + r);
        context.lineTo(point.x - r, point.y + r);
        context.closePath();
      }
      context.fill();
      context.stroke();
    }

    if (mines !== undefined) {
      context.fillStyle = '#ffae3d';
      context.strokeStyle = 'rgba(77, 39, 7, 0.95)';
      context.lineWidth = 1;
      context.beginPath();
      for (let index = 0; index < mines.length; index += 1) {
        const mine = mines[index];
        if (!mine.revealed) continue;
        const point = worldToViewport(
          mine.x,
          mine.z,
          vehicleX,
          vehicleZ,
          sizePx,
        );
        if (Math.hypot(point.x - half, point.y - half) > cullRadiusPx) continue;
        const r = MINE_MARKER_RADIUS_PX;
        context.moveTo(point.x, point.y - r);
        context.lineTo(point.x + r, point.y);
        context.lineTo(point.x, point.y + r);
        context.lineTo(point.x - r, point.y);
        context.closePath();
      }
      context.fill();
      context.stroke();
    }

    // The map is north-up, so the player arrow rotates to show heading. Local
    // up (0, -1) rotated by canvas `-yaw` points along the vehicle's forward
    // direction in map space (-sin yaw, -cos yaw), so at yaw 0 it points up.
    context.save();
    context.translate(half, half);
    context.rotate(-yaw);
    const tipY = -PLAYER_TIP_DISTANCE_PX;
    const rearY = PLAYER_REAR_DISTANCE_PX;
    context.fillStyle = 'rgba(61, 220, 91, 0.42)';
    context.shadowColor = 'rgba(61, 220, 91, 0.9)';
    context.shadowBlur = 8;
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(0, tipY);
    context.lineTo(PLAYER_HALF_WIDTH_PX, rearY);
    context.lineTo(-PLAYER_HALF_WIDTH_PX, rearY);
    context.closePath();
    context.fill();
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.fillStyle = '#3ddc5b';
    context.strokeStyle = '#101410';
    context.lineWidth = 1.25;
    context.fill();
    context.stroke();
    context.restore();

    context.restore();
  }

  /** Draws the fixed north-up, zoomed arena snapshot centred on the player. */
  private drawBackground(
    context: CanvasRenderingContext2D,
    vehicleX: number,
    vehicleZ: number,
    sizePx: number,
  ): void {
    const half = sizePx / 2;
    if (this.backgroundCanvas === null) {
      context.fillStyle = 'rgba(12, 15, 13, 0.82)';
      context.fillRect(0, 0, sizePx, sizePx);
      return;
    }
    // The background canvas holds the full arena in map space (scaleX px per
    // world unit). Zoom so MINIMAP_VIEW_RADIUS_M metres fills the radius, and
    // translate so the player's map-space point sits at the centre. The map is
    // north-up, so there is no rotation — the arena keeps a fixed orientation.
    const pxPerMetre = half / MINIMAP_VIEW_RADIUS_M;
    const zoom = this.scaleX > 0 ? pxPerMetre / this.scaleX : 1;
    const playerBgX = (this.maxX - vehicleX) * this.scaleX;
    const playerBgY = (this.maxZ - vehicleZ) * this.scaleZ;
    context.save();
    context.translate(half, half);
    context.scale(zoom, zoom);
    context.translate(-playerBgX, -playerBgY);
    context.drawImage(this.backgroundCanvas, 0, 0, sizePx, sizePx);
    context.restore();
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.canvas = null;
    this.context = null;
    this.backgroundCanvas = null;
    this.backgroundContext = null;
    this.snapshotCanvas = null;
  }

  private resizeBackingStore(): void {
    const canvas = this.canvas;
    const context = this.context;
    const backgroundCanvas = this.backgroundCanvas;
    const backgroundContext = this.backgroundContext;
    if (
      canvas === null ||
      context === null ||
      backgroundCanvas === null ||
      backgroundContext === null
    ) {
      return;
    }

    const cssSizePx = canvas.clientWidth || DEFAULT_SIZE_PX;
    const browserDevicePixelRatio = window.devicePixelRatio;
    const nextDevicePixelRatio = Math.min(
      browserDevicePixelRatio > 0 ? browserDevicePixelRatio : 1,
      MAX_DEVICE_PIXEL_RATIO,
    );
    if (
      cssSizePx === this.sizePx &&
      nextDevicePixelRatio === this.devicePixelRatio
    ) {
      return;
    }

    this.sizePx = cssSizePx;
    this.devicePixelRatio = nextDevicePixelRatio;
    canvas.width = Math.round(cssSizePx * nextDevicePixelRatio);
    canvas.height = Math.round(cssSizePx * nextDevicePixelRatio);
    backgroundCanvas.width = canvas.width;
    backgroundCanvas.height = canvas.height;
    context.setTransform(
      nextDevicePixelRatio,
      0,
      0,
      nextDevicePixelRatio,
      0,
      0,
    );
    this.scaleX = cssSizePx / (this.maxX - this.minX);
    this.scaleZ = cssSizePx / (this.maxZ - this.minZ);
    this.rebuildBackgroundLayer();
  }

  private rebuildBackgroundLayer(): void {
    const context = this.backgroundContext;
    if (context === null) return;

    const sizePx = this.sizePx;
    context.setTransform(
      this.devicePixelRatio,
      0,
      0,
      this.devicePixelRatio,
      0,
      0,
    );
    context.clearRect(0, 0, sizePx, sizePx);
    context.fillStyle = 'rgba(12, 15, 13, 0.82)';
    context.fillRect(0, 0, sizePx, sizePx);

    if (this.snapshotCanvas !== null) {
      context.drawImage(this.snapshotCanvas, 0, 0, sizePx, sizePx);
      context.fillStyle = 'rgba(67, 78, 70, 0.22)';
    } else {
      context.fillStyle = 'rgba(67, 78, 70, 0.88)';
    }
    for (let index = 0; index < this.features.length; index += 1) {
      const feature = this.features[index];
      if (feature.kind !== 'road') continue;
      this.fillFeature(context, feature);
    }

    if (this.snapshotCanvas === null) {
      context.fillStyle = 'rgba(125, 130, 126, 0.55)';
      for (let index = 0; index < this.features.length; index += 1) {
        const feature = this.features[index];
        if (feature.kind !== 'obstacle') continue;
        this.fillFeature(context, feature);
      }
    }

    context.strokeStyle = 'rgba(166, 177, 160, 0.46)';
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, sizePx - 1, sizePx - 1);
  }

  private fillFeature(
    context: CanvasRenderingContext2D,
    feature: MinimapFeature,
  ): void {
    const x = (this.maxX - feature.maxX) * this.scaleX;
    const y = (this.maxZ - feature.maxZ) * this.scaleZ;
    const width = (feature.maxX - feature.minX) * this.scaleX;
    const height = (feature.maxZ - feature.minZ) * this.scaleZ;
    context.fillRect(x, y, width, height);
  }

  private async captureSnapshotWhenReady(
    snapshot: MinimapSnapshotSource,
  ): Promise<void> {
    try {
      await snapshot.ready;
      if (this.root === null) return;
      this.captureSnapshot(snapshot);
    } catch {
      // The vector layer is deliberately retained when readiness or capture fails.
    }
  }

  private captureSnapshot(snapshot: MinimapSnapshotSource): void {
    const backgroundCanvas = this.backgroundCanvas;
    if (backgroundCanvas === null) return;

    const width = Math.min(backgroundCanvas.width, MAX_SNAPSHOT_SIZE_PX);
    const height = Math.min(backgroundCanvas.height, MAX_SNAPSHOT_SIZE_PX);
    if (width <= 0 || height <= 0) return;

    const worldWidth = this.maxX - this.minX;
    const worldHeight = this.maxZ - this.minZ;
    const centreX = (this.minX + this.maxX) / 2;
    const centreZ = (this.minZ + this.maxZ) / 2;
    const camera = new THREE.OrthographicCamera(
      -worldWidth / 2,
      worldWidth / 2,
      worldHeight / 2,
      -worldHeight / 2,
      0.1,
      SNAPSHOT_CAMERA_HEIGHT * 2,
    );
    camera.position.set(centreX, SNAPSHOT_CAMERA_HEIGHT, centreZ);
    // Looking down with up +Z makes image-right -X and image-up +Z. Thus the
    // road junction (-6, 8) lands at the exact pixel worldToMinimap returns.
    camera.up.set(0, 0, 1);
    camera.lookAt(centreX, 0, centreZ);
    camera.updateMatrixWorld(true);

    const renderTarget = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    renderTarget.texture.colorSpace = snapshot.renderer.outputColorSpace;

    const renderer = snapshot.renderer;
    const previousRenderTarget = renderer.getRenderTarget();
    const previousCubeFace = renderer.getActiveCubeFace();
    const previousMipmapLevel = renderer.getActiveMipmapLevel();
    const previousClearColor = renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = renderer.getClearAlpha();
    const previousViewport = renderer.getViewport(new THREE.Vector4());
    const previousScissor = renderer.getScissor(new THREE.Vector4());
    const previousScissorTest = renderer.getScissorTest();
    const previousVisibility = snapshot.hide.map((object) => object.visible);
    const pixels = new Uint8Array(width * height * 4);

    try {
      for (const object of snapshot.hide) object.visible = false;
      renderer.setRenderTarget(renderTarget);
      renderer.setViewport(0, 0, width, height);
      renderer.setScissor(0, 0, width, height);
      renderer.setScissorTest(false);
      renderer.setClearColor(0x080b14, 1);
      renderer.clear(true, true, true);
      renderer.render(snapshot.scene, camera);
      renderer.readRenderTargetPixels(
        renderTarget,
        0,
        0,
        width,
        height,
        pixels,
      );
    } finally {
      for (let index = 0; index < snapshot.hide.length; index += 1) {
        snapshot.hide[index].visible = previousVisibility[index];
      }
      renderer.setRenderTarget(
        previousRenderTarget,
        previousCubeFace,
        previousMipmapLevel,
      );
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      renderer.setViewport(previousViewport);
      renderer.setScissor(previousScissor);
      renderer.setScissorTest(previousScissorTest);
      renderTarget.dispose();
      // Three.js cameras own no disposable GPU resources; clear any children.
      camera.clear();
    }

    const liftedPixels = new Uint8ClampedArray(pixels.length);
    for (let sourceY = 0; sourceY < height; sourceY += 1) {
      const destinationY = height - sourceY - 1;
      for (let x = 0; x < width; x += 1) {
        const sourceOffset = (sourceY * width + x) * 4;
        const destinationOffset = (destinationY * width + x) * 4;
        const red = pixels[sourceOffset];
        const green = pixels[sourceOffset + 1];
        const blue = pixels[sourceOffset + 2];
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        liftedPixels[destinationOffset] = liftSnapshotChannel(
          red,
          luminance,
          SNAPSHOT_TINT[0],
        );
        liftedPixels[destinationOffset + 1] = liftSnapshotChannel(
          green,
          luminance,
          SNAPSHOT_TINT[1],
        );
        liftedPixels[destinationOffset + 2] = liftSnapshotChannel(
          blue,
          luminance,
          SNAPSHOT_TINT[2],
        );
        liftedPixels[destinationOffset + 3] = pixels[sourceOffset + 3];
      }
    }

    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = width;
    snapshotCanvas.height = height;
    const snapshotContext = snapshotCanvas.getContext('2d');
    if (snapshotContext === null) return;
    snapshotContext.putImageData(
      new ImageData(liftedPixels, width, height),
      0,
      0,
    );
    this.snapshotCanvas = snapshotCanvas;
    this.rebuildBackgroundLayer();
  }
}

function liftSnapshotChannel(
  channel: number,
  luminance: number,
  tint: number,
): number {
  const desaturated = channel + (luminance - channel) * SNAPSHOT_DESATURATION;
  return Math.min(
    255,
    Math.round(
      SNAPSHOT_BRIGHTNESS_FLOOR * tint +
        desaturated * SNAPSHOT_BRIGHTNESS_GAIN * tint,
    ),
  );
}
