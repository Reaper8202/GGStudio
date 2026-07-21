import * as THREE from 'three';
import type { MinimapFeature } from './Graveyard.ts';

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

export const MINIMAP_REDRAW_HZ = 15;

const DEFAULT_SIZE_PX = 188;
const MAX_DEVICE_PIXEL_RATIO = 2;
const ZOMBIE_RADIUS_PX = 2.6;
const PLAYER_LENGTH_PX = 14;
const PLAYER_TIP_DISTANCE_PX = (PLAYER_LENGTH_PX * 2) / 3;
const PLAYER_REAR_DISTANCE_PX = PLAYER_LENGTH_PX / 3;
const PLAYER_HALF_WIDTH_PX = 6;
const PLAYER_EDGE_MARGIN_PX = PLAYER_TIP_DISTANCE_PX + 2;
const REDRAW_INTERVAL_MS = 1000 / MINIMAP_REDRAW_HZ;

/** Maps the full arena to a north-up minimap without hiding out-of-bounds points. */
export function worldToMinimap(
  worldX: number,
  worldZ: number,
  bounds: MinimapBounds,
  sizePx: number,
): { x: number; y: number } {
  return {
    x: ((worldX - bounds.minX) / (bounds.maxX - bounds.minX)) * sizePx,
    y: ((bounds.maxZ - worldZ) / (bounds.maxZ - bounds.minZ)) * sizePx,
  };
}

/** A fixed, full-arena overview intended for the survival UI layer. */
export class Minimap {
  private root: HTMLDivElement | null;
  private canvas: HTMLCanvasElement | null;
  private context: CanvasRenderingContext2D | null;
  private backgroundCanvas: HTMLCanvasElement | null;
  private backgroundContext: CanvasRenderingContext2D | null;
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
  }

  update(
    vehicleX: number,
    vehicleZ: number,
    yaw: number,
    zombies: readonly MinimapZombie[],
  ): void {
    const context = this.context;
    if (context === null) return;

    const now = performance.now();
    if (now - this.lastDrawAt < REDRAW_INTERVAL_MS) return;
    this.lastDrawAt = now;

    this.resizeBackingStore();
    const sizePx = this.sizePx;

    context.clearRect(0, 0, sizePx, sizePx);
    if (this.backgroundCanvas !== null) {
      context.drawImage(this.backgroundCanvas, 0, 0, sizePx, sizePx);
    }

    context.fillStyle = '#ff3b30';
    context.strokeStyle = 'rgba(72, 13, 11, 0.9)';
    context.lineWidth = 0.9;
    context.beginPath();
    for (let index = 0; index < zombies.length; index += 1) {
      const position = zombies[index].position;
      if (
        position.x < this.minX ||
        position.x > this.maxX ||
        position.z < this.minZ ||
        position.z > this.maxZ
      ) {
        continue;
      }

      const x = (position.x - this.minX) * this.scaleX;
      const y = (this.maxZ - position.z) * this.scaleZ;
      context.moveTo(x + ZOMBIE_RADIUS_PX, y);
      context.arc(x, y, ZOMBIE_RADIUS_PX, 0, Math.PI * 2);
    }
    context.fill();
    context.stroke();

    const projectedPlayerX = (vehicleX - this.minX) * this.scaleX;
    const projectedPlayerY = (this.maxZ - vehicleZ) * this.scaleZ;
    const playerX = Math.min(
      sizePx - PLAYER_EDGE_MARGIN_PX,
      Math.max(PLAYER_EDGE_MARGIN_PX, projectedPlayerX),
    );
    const playerY = Math.min(
      sizePx - PLAYER_EDGE_MARGIN_PX,
      Math.max(PLAYER_EDGE_MARGIN_PX, projectedPlayerY),
    );
    const forwardX = Math.sin(yaw);
    const forwardY = -Math.cos(yaw);
    const sideX = -forwardY;
    const sideY = forwardX;
    const rearX = playerX - forwardX * PLAYER_REAR_DISTANCE_PX;
    const rearY = playerY - forwardY * PLAYER_REAR_DISTANCE_PX;

    context.fillStyle = 'rgba(61, 220, 91, 0.42)';
    context.shadowColor = 'rgba(61, 220, 91, 0.9)';
    context.shadowBlur = 8;
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(
      playerX + forwardX * PLAYER_TIP_DISTANCE_PX,
      playerY + forwardY * PLAYER_TIP_DISTANCE_PX,
    );
    context.lineTo(
      rearX + sideX * PLAYER_HALF_WIDTH_PX,
      rearY + sideY * PLAYER_HALF_WIDTH_PX,
    );
    context.lineTo(
      rearX - sideX * PLAYER_HALF_WIDTH_PX,
      rearY - sideY * PLAYER_HALF_WIDTH_PX,
    );
    context.closePath();
    context.fill();
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.fillStyle = '#3ddc5b';
    context.strokeStyle = '#101410';
    context.lineWidth = 1.25;
    context.fill();
    context.stroke();
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.canvas = null;
    this.context = null;
    this.backgroundCanvas = null;
    this.backgroundContext = null;
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

    context.fillStyle = 'rgba(67, 78, 70, 0.88)';
    for (let index = 0; index < this.features.length; index += 1) {
      const feature = this.features[index];
      if (feature.kind !== 'road') continue;
      this.fillFeature(context, feature);
    }

    context.fillStyle = 'rgba(125, 130, 126, 0.55)';
    for (let index = 0; index < this.features.length; index += 1) {
      const feature = this.features[index];
      if (feature.kind !== 'obstacle') continue;
      this.fillFeature(context, feature);
    }

    context.strokeStyle = 'rgba(166, 177, 160, 0.46)';
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, sizePx - 1, sizePx - 1);
  }

  private fillFeature(
    context: CanvasRenderingContext2D,
    feature: MinimapFeature,
  ): void {
    const x = (feature.minX - this.minX) * this.scaleX;
    const y = (this.maxZ - feature.maxZ) * this.scaleZ;
    const width = (feature.maxX - feature.minX) * this.scaleX;
    const height = (feature.maxZ - feature.minZ) * this.scaleZ;
    context.fillRect(x, y, width, height);
  }
}
