import Phaser from 'phaser';
import { Colors, SceneKeys, TextureKeys } from '../config/constants';

/**
 * Generates every texture procedurally — the game ships zero binary art
 * assets, which keeps the initial load to the code bundle alone (≪ 8 MB).
 * Also registers global key captures so the host page never scrolls.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Boot);
  }

  create(): void {
    // Prevent page scroll on arrows/space when embedded in a portal iframe.
    this.input.keyboard?.addCapture([
      Phaser.Input.Keyboard.KeyCodes.LEFT,
      Phaser.Input.Keyboard.KeyCodes.RIGHT,
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.SPACE,
    ]);

    this.makeTextures();
    this.scene.start(SceneKeys.Preload);
  }

  private makeTextures(): void {
    this.makePlayerRun();
    this.makePlayerJump();
    this.makePlayerSlide();
    this.makeShadow();
    this.makeObstacleLow();
    this.makeObstacleHigh();
    this.makeObstacleBlock();
    this.makeCoin();
    this.makeRoad();
    this.makePixel();
  }

  private gfx(): Phaser.GameObjects.Graphics {
    return this.add.graphics().setVisible(false);
  }

  private bake(g: Phaser.GameObjects.Graphics, key: string, w: number, h: number): void {
    g.generateTexture(key, w, h);
    g.destroy();
  }

  private makePlayerRun(): void {
    const g = this.gfx();
    g.fillStyle(Colors.playerDark, 1);
    g.fillRoundedRect(14, 58, 15, 26, 6); // legs
    g.fillRoundedRect(35, 58, 15, 26, 6);
    g.fillStyle(Colors.player, 1);
    g.fillRoundedRect(8, 0, 48, 66, 18); // body
    g.fillStyle(0x0b0e1a, 1);
    g.fillRoundedRect(20, 16, 28, 11, 5); // visor
    this.bake(g, TextureKeys.PlayerRun, 64, 84);
  }

  private makePlayerJump(): void {
    const g = this.gfx();
    g.fillStyle(Colors.playerDark, 1);
    g.fillRoundedRect(12, 56, 16, 16, 6); // tucked legs
    g.fillRoundedRect(36, 56, 16, 16, 6);
    g.fillStyle(Colors.player, 1);
    g.fillRoundedRect(8, 0, 48, 62, 18);
    g.fillStyle(0x0b0e1a, 1);
    g.fillRoundedRect(20, 14, 28, 11, 5);
    this.bake(g, TextureKeys.PlayerJump, 64, 84);
  }

  private makePlayerSlide(): void {
    const g = this.gfx();
    g.fillStyle(Colors.player, 1);
    g.fillRoundedRect(2, 12, 80, 32, 15); // low horizontal body
    g.fillStyle(Colors.playerDark, 1);
    g.fillRoundedRect(6, 34, 26, 12, 5);
    g.fillStyle(0x0b0e1a, 1);
    g.fillRoundedRect(56, 20, 20, 9, 4); // visor toward travel direction
    this.bake(g, TextureKeys.PlayerSlide, 84, 48);
  }

  private makeShadow(): void {
    const g = this.gfx();
    g.fillStyle(Colors.shadow, 1);
    g.fillEllipse(36, 13, 68, 22);
    this.bake(g, TextureKeys.Shadow, 72, 26);
  }

  /** Hurdle — jump over it. */
  private makeObstacleLow(): void {
    const g = this.gfx();
    g.fillStyle(0xb23e55, 1);
    g.fillRoundedRect(8, 12, 12, 34, 3); // legs
    g.fillRoundedRect(120, 12, 12, 34, 3);
    g.fillStyle(Colors.obstacleLow, 1);
    g.fillRoundedRect(0, 0, 140, 20, 7); // bar
    g.fillStyle(0xffffff, 0.35);
    g.fillRoundedRect(8, 4, 124, 5, 2); // highlight
    this.bake(g, TextureKeys.ObstacleLow, 140, 46);
  }

  /** Overhead gate — slide under it. */
  private makeObstacleHigh(): void {
    const g = this.gfx();
    g.fillStyle(0xc27d16, 1);
    g.fillRect(0, 0, 13, 124); // posts
    g.fillRect(127, 0, 13, 124);
    g.fillStyle(Colors.obstacleHigh, 1);
    g.fillRoundedRect(0, 0, 140, 46, 6); // top banner (clearance underneath)
    g.fillStyle(0x0b0e1a, 0.5);
    for (let x = 8; x < 132; x += 28) g.fillRect(x, 8, 14, 30); // stripes
    this.bake(g, TextureKeys.ObstacleHigh, 140, 124);
  }

  /** Full block — must change lane. */
  private makeObstacleBlock(): void {
    const g = this.gfx();
    g.fillStyle(Colors.obstacleBlock, 1);
    g.fillRoundedRect(0, 0, 140, 112, 10);
    g.fillStyle(0xffffff, 0.25);
    g.fillRoundedRect(0, 0, 140, 20, 10); // top face
    g.fillStyle(0x0b0e1a, 0.35);
    for (let x = -20; x < 140; x += 36) {
      g.beginPath();
      g.moveTo(x, 112);
      g.lineTo(x + 22, 26);
      g.lineTo(x + 36, 26);
      g.lineTo(x + 14, 112);
      g.closePath();
      g.fillPath(); // hazard stripes
    }
    this.bake(g, TextureKeys.ObstacleBlock, 140, 112);
  }

  private makeCoin(): void {
    const g = this.gfx();
    g.fillStyle(Colors.coinDark, 1);
    g.fillCircle(16, 16, 15);
    g.fillStyle(Colors.coin, 1);
    g.fillCircle(16, 16, 12);
    g.fillStyle(0xffffff, 0.55);
    g.fillEllipse(12, 11, 8, 5);
    this.bake(g, TextureKeys.Coin, 32, 32);
  }

  /** 600×240 road tile: edges + dashed lane dividers; scrolled as a TileSprite. */
  private makeRoad(): void {
    const g = this.gfx();
    g.fillStyle(Colors.road, 1);
    g.fillRect(0, 0, 600, 240);
    g.fillStyle(Colors.roadEdge, 1);
    g.fillRect(0, 0, 8, 240);
    g.fillRect(592, 0, 8, 240);
    g.fillStyle(Colors.laneLine, 1);
    for (const x of [197, 397]) {
      g.fillRect(x, 0, 6, 62);
      g.fillRect(x, 122, 6, 62);
    }
    this.bake(g, TextureKeys.Road, 600, 240);
  }

  private makePixel(): void {
    const g = this.gfx();
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 2, 2);
    this.bake(g, TextureKeys.Pixel, 2, 2);
  }
}
