import Phaser from 'phaser';
import { GameConfig } from '../config/GameConfig';
import { Depths, TextureKeys } from '../config/constants';
import type { LaneManager } from '../systems/LaneManager';
import type { Sfx } from '../audio/Sfx';

export type Pose = 'run' | 'jump' | 'slide' | 'dead';

export interface Aabb {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The runner. State machine: run / jump / slide / dead (+ invulnerability
 * window after a revive). Lane changes are 120 ms tweens; jump/slide are
 * timed poses that gate collisions (jump clears `low`, slide clears `high`).
 */
export class Player extends Phaser.GameObjects.Sprite {
  pose: Pose = 'run';
  lane: number;
  invulnUntil = 0;

  private poseUntil = 0;
  private poseStart = 0;
  private readonly groundY: number;
  private readonly shadow: Phaser.GameObjects.Image;
  private laneTween: Phaser.Tweens.Tween | null = null;
  private readonly aabbOut: Aabb = { x: 0, y: 0, w: 0, h: 0 };

  constructor(
    scene: Phaser.Scene,
    private readonly lanes: LaneManager,
    private readonly sfx: Sfx,
    groundY: number,
  ) {
    super(scene, lanes.laneX(1), groundY, TextureKeys.PlayerRun);
    this.lane = 1;
    this.groundY = groundY;
    this.setOrigin(0.5, 1).setDepth(Depths.Player);

    this.shadow = scene.add
      .image(this.x, groundY + 8, TextureKeys.Shadow)
      .setDepth(Depths.Shadow)
      .setAlpha(0.35);

    scene.add.existing(this);
  }

  get airborne(): boolean {
    return this.pose === 'jump';
  }

  get sliding(): boolean {
    return this.pose === 'slide';
  }

  get invulnerable(): boolean {
    return this.scene.time.now < this.invulnUntil;
  }

  moveLane(dir: -1 | 1): void {
    if (this.pose === 'dead') return;
    const target = this.lanes.clampLane(this.lane + dir);
    if (target === this.lane) return;
    this.lane = target;
    this.laneTween?.remove();
    this.laneTween = this.scene.tweens.add({
      targets: this,
      x: this.lanes.laneX(target),
      duration: GameConfig.laneSwitchMs,
      ease: 'Sine.easeOut',
    });
  }

  jump(): void {
    if (this.pose === 'dead' || this.pose === 'jump') return;
    this.enterPose('jump', GameConfig.jumpMs, TextureKeys.PlayerJump);
    this.sfx.jump();
  }

  slide(): void {
    if (this.pose === 'dead' || this.pose === 'slide') return;
    this.enterPose('slide', GameConfig.slideMs, TextureKeys.PlayerSlide);
    this.sfx.slide();
  }

  private enterPose(pose: Pose, durMs: number, texture: string): void {
    this.pose = pose;
    this.poseStart = this.scene.time.now;
    this.poseUntil = this.poseStart + durMs;
    this.setTexture(texture);
    if (pose === 'slide') {
      // A slide can cancel a jump mid-air — snap back to the ground.
      this.y = this.groundY;
      this.setScale(1);
      this.shadow.setScale(1);
    }
  }

  die(): void {
    this.pose = 'dead';
    this.laneTween?.remove();
    this.setTexture(TextureKeys.PlayerRun);
    this.setTint(0xff6677);
    this.y = this.groundY;
  }

  revive(): void {
    this.clearTint();
    this.pose = 'run';
    this.setTexture(TextureKeys.PlayerRun);
    this.invulnUntil = this.scene.time.now + GameConfig.reviveInvulnMs;
  }

  /** Full reset for a new run. */
  resetRun(): void {
    this.clearTint();
    this.pose = 'run';
    this.invulnUntil = 0;
    this.lane = 1;
    this.laneTween?.remove();
    this.laneTween = null;
    this.setTexture(TextureKeys.PlayerRun);
    this.setPosition(this.lanes.laneX(1), this.groundY);
    this.setAlpha(1);
  }

  override update(): void {
    const now = this.scene.time.now;

    if (this.pose === 'jump') {
      const t = Phaser.Math.Clamp(
        (now - this.poseStart) / GameConfig.jumpMs,
        0,
        1,
      );
      this.y = this.groundY - GameConfig.jumpHeightPx * Math.sin(Math.PI * t);
      const s = 1 + 0.12 * Math.sin(Math.PI * t);
      this.setScale(s);
      this.shadow.setScale(1 - 0.35 * Math.sin(Math.PI * t));
      if (now >= this.poseUntil) this.land();
    } else if (this.pose === 'slide') {
      if (now >= this.poseUntil) this.land();
    }

    // Invulnerability blink (revive grace period).
    if (this.pose !== 'dead') {
      this.setAlpha(this.invulnerable ? (Math.floor(now / 90) % 2 ? 0.35 : 0.9) : 1);
    }

    this.shadow.setPosition(this.x, this.groundY + 8);
  }

  private land(): void {
    this.pose = 'run';
    this.setTexture(TextureKeys.PlayerRun);
    this.setScale(1);
    this.shadow.setScale(1);
    this.y = this.groundY;
  }

  /** Ground-plane footprint used for obstacle/coin overlap tests. */
  aabb(): Aabb {
    const w = 56;
    const h = 46;
    this.aabbOut.x = this.x - w / 2;
    this.aabbOut.y = this.groundY - h;
    this.aabbOut.w = w;
    this.aabbOut.h = h;
    return this.aabbOut;
  }

  override destroy(fromScene?: boolean): void {
    this.shadow.destroy();
    super.destroy(fromScene);
  }
}
