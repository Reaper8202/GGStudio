import Phaser from 'phaser';
import { Depths, TextureKeys } from '../config/constants';

/** Pooled coin sprite. `elevated` marks arc coins drawn over a jump. */
export class Coin extends Phaser.GameObjects.Sprite {
  elevated = false;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, TextureKeys.Coin);
    this.setOrigin(0.5, 0.5).setDepth(Depths.Entities + 1);
    scene.add.existing(this);
    this.deactivate();
  }

  activate(x: number, y: number, elevated: boolean): void {
    this.elevated = elevated;
    this.setPosition(x, y);
    this.setScale(elevated ? 1.15 : 1);
    this.setActive(true).setVisible(true);
  }

  deactivate(): void {
    this.setActive(false).setVisible(false);
  }
}
