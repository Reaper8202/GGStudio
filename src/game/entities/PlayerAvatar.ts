import * as THREE from 'three';
import { GameConfig } from '../../config/GameConfig';
import { Palette } from '../../config/constants';
import type { LaneManager } from '../LaneManager';
import type { Sfx } from '../../audio/Sfx';
import { makeBean, makeBlobShadow, type BeanParts } from './bean';

export type Pose = 'run' | 'jump' | 'slide' | 'dead';

/**
 * The runner. Same state machine as the 2D version: run / jump / slide /
 * dead (+ revive invulnerability). Lane changes are 120 ms eased tweens on
 * x; jump/slide are timed poses that gate collisions (jump clears vents,
 * slide clears gates). The player stands at z = 0; the world moves past.
 */
export class PlayerAvatar {
  readonly group = new THREE.Group();
  pose: Pose = 'run';
  lane = 1;
  invulnUntil = 0;

  private readonly bean: BeanParts;
  private readonly shadow: THREE.Mesh;
  private poseStart = 0;
  private poseUntil = 0;
  private laneFrom = 0;
  private laneTo = 0;
  private laneMoveStart = -1; // -1 → not tweening

  constructor(
    scene: THREE.Scene,
    private readonly lanes: LaneManager,
    private readonly sfx: Sfx,
  ) {
    this.bean = makeBean({
      color: Palette.crew,
      darkColor: Palette.crewDark,
      visorColor: Palette.visor,
      visorEmissive: Palette.visor,
    });
    this.group.add(this.bean.group);
    this.shadow = makeBlobShadow();
    this.group.add(this.shadow);
    this.group.position.set(this.lanes.laneX(1), 0, 0);
    scene.add(this.group);
  }

  /** Recolors the crewmate body; legs/backpack get the same hue darkened. Does not touch the visor. */
  setColor(hex: number): void {
    this.bean.bodyMat.color.set(hex);
    this.bean.darkMat.color.copy(new THREE.Color(hex).multiplyScalar(0.55));
  }

  get x(): number {
    return this.group.position.x;
  }

  get airborne(): boolean {
    return this.pose === 'jump';
  }

  get sliding(): boolean {
    return this.pose === 'slide';
  }

  invulnerable(now: number): boolean {
    return now < this.invulnUntil;
  }

  moveLane(dir: -1 | 1, now: number): void {
    if (this.pose === 'dead') return;
    const target = this.lanes.clampLane(this.lane + dir);
    if (target === this.lane) return;
    this.lane = target;
    this.laneFrom = this.group.position.x;
    this.laneTo = this.lanes.laneX(target);
    this.laneMoveStart = now;
  }

  jump(now: number): void {
    if (this.pose === 'dead' || this.pose === 'jump') return;
    this.enterPose('jump', GameConfig.jumpMs, now);
    this.sfx.jump();
  }

  slide(now: number): void {
    if (this.pose === 'dead' || this.pose === 'slide') return;
    this.enterPose('slide', GameConfig.slideMs, now);
    this.sfx.slide();
  }

  private enterPose(pose: Pose, durMs: number, now: number): void {
    this.pose = pose;
    this.poseStart = now;
    this.poseUntil = now + durMs;
    if (pose === 'slide') {
      // A slide can cancel a jump mid-air — snap back to the ground.
      this.bean.group.position.y = 0;
    }
  }

  die(): void {
    this.pose = 'dead';
    this.laneMoveStart = -1;
  }

  revive(now: number): void {
    this.pose = 'run';
    this.bean.group.rotation.set(0, 0, 0);
    this.bean.group.scale.set(1, 1, 1);
    this.bean.group.position.y = 0;
    this.invulnUntil = now + GameConfig.reviveInvulnMs;
  }

  resetRun(): void {
    this.pose = 'run';
    this.invulnUntil = 0;
    this.lane = 1;
    this.laneMoveStart = -1;
    this.group.position.set(this.lanes.laneX(1), 0, 0);
    this.bean.group.rotation.set(0, 0, 0);
    this.bean.group.scale.set(1, 1, 1);
    this.bean.group.position.y = 0;
    this.group.visible = true;
  }

  update(now: number): void {
    const b = this.bean.group;

    // Lane tween (sine-out ease).
    if (this.laneMoveStart >= 0) {
      const t = Math.min(1, (now - this.laneMoveStart) / GameConfig.laneSwitchMs);
      const e = Math.sin((t * Math.PI) / 2);
      this.group.position.x = this.laneFrom + (this.laneTo - this.laneFrom) * e;
      b.rotation.z = -(this.laneTo - this.laneFrom) * 0.12 * Math.sin(t * Math.PI);
      if (t >= 1) this.laneMoveStart = -1;
    }

    if (this.pose === 'jump') {
      const t = Math.min(1, (now - this.poseStart) / GameConfig.jumpMs);
      b.position.y = GameConfig.jumpHeight * Math.sin(Math.PI * t);
      this.bean.legL.rotation.x = 1.1 * Math.sin(Math.PI * t);
      this.bean.legR.rotation.x = 1.1 * Math.sin(Math.PI * t);
      const s = 1 - 0.45 * Math.sin(Math.PI * t);
      this.shadow.scale.set(s, s, s);
      if (now >= this.poseUntil) this.land();
    } else if (this.pose === 'slide') {
      const t = Math.min(1, (now - this.poseStart) / GameConfig.slideMs);
      const depth = Math.sin(Math.PI * Math.min(1, t * 1.15));
      b.scale.y = 1 - 0.45 * depth;
      b.rotation.x = -0.55 * depth; // lean back, feet-first
      if (now >= this.poseUntil) this.land();
    } else if (this.pose === 'run') {
      // Run cycle: bob + leg swing.
      const phase = now / 90;
      b.position.y = Math.abs(Math.sin(phase)) * 0.07;
      this.bean.legL.rotation.x = Math.sin(phase) * 0.7;
      this.bean.legR.rotation.x = -Math.sin(phase) * 0.7;
    } else {
      // dead: keel over toward the camera
      b.rotation.x = Math.min(Math.PI / 2, b.rotation.x + 0.12);
      b.position.y = Math.max(0, b.position.y - 0.05);
    }

    // Revive grace blink.
    if (this.pose !== 'dead') {
      this.group.visible = this.invulnerable(now) ? Math.floor(now / 90) % 2 === 0 : true;
    }

    this.shadow.position.x = 0; // shadow is a child; stays under the group
  }

  private land(): void {
    this.pose = 'run';
    const b = this.bean.group;
    b.position.y = 0;
    b.scale.y = 1;
    b.rotation.x = 0;
    this.bean.legL.rotation.x = 0;
    this.bean.legR.rotation.x = 0;
    this.shadow.scale.set(1, 1, 1);
  }
}
