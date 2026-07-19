import Phaser from 'phaser';
import { Depths, TextureKeys } from '../config/constants';
import type { ObstacleKind } from '../systems/Spawner';

const KIND_TEXTURE: Record<ObstacleKind, string> = {
  low: TextureKeys.ObstacleLow,
  high: TextureKeys.ObstacleHigh,
  block: TextureKeys.ObstacleBlock,
};

/** Pooled obstacle sprite. `y` is the ground-contact (bottom) edge. */
export class Obstacle extends Phaser.GameObjects.Sprite {
  kind: ObstacleKind = 'low';
  lane = 0;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, TextureKeys.ObstacleLow);
    this.setOrigin(0.5, 1).setDepth(Depths.Entities);
    scene.add.existing(this);
    this.deactivate();
  }

  activate(lane: number, kind: ObstacleKind, x: number, y: number): void {
    this.kind = kind;
    this.lane = lane;
    this.setTexture(KIND_TEXTURE[kind]);
    this.setPosition(x, y);
    this.setActive(true).setVisible(true);
  }

  deactivate(): void {
    this.setActive(false).setVisible(false);
  }
}
