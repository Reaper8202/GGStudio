/**
 * The game's effects authority: every emitter the runtime can fire, on top of
 * two pooled voxel-cube layers (`lit` for matter, `glow` for light).
 *
 * Callers describe *what happened* — a sawblade shredded something here, a
 * turret fired there — and this module owns how it looks. Three rules keep it
 * cheap enough to run inside a horde:
 *
 * 1. Two draw calls total, regardless of how much is on screen.
 * 2. No allocation after construction: emitters fill a shared scratch spec.
 * 3. A per-frame spawn budget plus camera-distance LOD, so a grinder drum
 *    parked in a crowd degrades gracefully instead of stalling the frame.
 */

import * as THREE from 'three';
import {
  FRAME_SPAWN_BUDGET,
  GLOW_PARTICLE_CAPACITY,
  LIT_PARTICLE_CAPACITY,
  LOD_CULL_DISTANCE_M,
  LOD_FULL_DISTANCE_M,
  LOD_HALF_DISTANCE_M,
  VFX_GROUND_Y,
  VFX_PALETTE,
} from './vfxConfig.ts';
import {
  defaultParticleSpec,
  VoxelParticles,
  type ParticleSpec,
} from './VoxelParticles.ts';

/**
 * Which contact effect to play. The three melee kinds mirror
 * `MeleeDefinition.visual`; `ram` is a bare high-speed collision with a part
 * that carries no melee weapon.
 */
export type MeleeVfxKind = 'blade' | 'spikes' | 'drum' | 'ram';

/** Barrel character, chosen from the firing weapon's shape and damage type. */
export type MuzzleVfxStyle = 'standard' | 'heavy' | 'sniper' | 'flame' | 'ice';

/** What a projectile or ray terminated against. */
export type ImpactVfxKind = 'flesh' | 'shield' | 'hard' | 'ice' | 'burn';

interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class VfxSystem {
  private readonly lit: VoxelParticles;
  private readonly glow: VoxelParticles;
  private readonly spec: ParticleSpec = defaultParticleSpec();
  private readonly viewpoint = new THREE.Vector3(0, 0, 0);
  private frameBudget = FRAME_SPAWN_BUDGET;
  private quality = 1;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    groundY: number = VFX_GROUND_Y,
  ) {
    this.lit = new VoxelParticles('lit', LIT_PARTICLE_CAPACITY, groundY);
    this.glow = new VoxelParticles('glow', GLOW_PARTICLE_CAPACITY, groundY);
    this.scene.add(this.lit.mesh);
    this.scene.add(this.glow.mesh);
  }

  /** Live particle counts, for the debug seam and tests. */
  get particleCount(): number {
    return this.lit.activeCount + this.glow.activeCount;
  }

  /**
   * Where the player is looking from. Emitters scale their particle counts by
   * distance to this point and skip anything far outside the action.
   */
  setViewpoint(position: Vector3Like): void {
    this.viewpoint.set(position.x, position.y, position.z);
  }

  /** Global multiplier on every emitter's particle count (1 = authored). */
  setQuality(scale: number): void {
    this.quality = Math.max(0, Math.min(1, scale));
  }

  /** Advance every live particle. Call once per rendered frame. */
  update(frameDt: number): void {
    if (this.disposed) return;
    this.frameBudget = FRAME_SPAWN_BUDGET;
    const dt = Math.min(Math.max(frameDt, 0), 0.1);
    this.lit.update(dt);
    this.glow.update(dt);
  }

  /** Clear everything on screen, e.g. when a wave resets. */
  reset(): void {
    this.lit.reset();
    this.glow.reset();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lit.dispose();
    this.glow.dispose();
  }

  // ---------------------------------------------------------------- melee ---

  /**
   * A vehicle weapon bit into a zombie.
   *
   * `x/y/z` is the contact point, `dirX/dirZ` the normalised horizontal
   * direction from the part out toward the zombie, and `power` a 0..1 measure
   * of how hard the hit landed (melee damage and closing speed).
   */
  meleeShred(
    kind: MeleeVfxKind,
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    power = 1,
  ): void {
    if (this.disposed) return;
    const detail = this.detailAt(x, y, z);
    if (detail <= 0) return;
    const force = Math.max(0.25, Math.min(1.5, power));

    switch (kind) {
      case 'blade':
        this.sawShred(x, y, z, dirX, dirZ, detail, force);
        break;
      case 'spikes':
        this.spikeImpale(x, y, z, dirX, dirZ, detail, force);
        break;
      case 'drum':
        this.drumGrind(x, y, z, dirX, dirZ, detail, force);
        break;
      case 'ram':
        this.ramImpact(x, y, z, dirX, dirZ, detail, force);
        break;
    }
  }

  /**
   * Sawblade: the disc sweeps horizontally, so the spray is a flat fan thrown
   * along the blade's tangent — a wide arc of sparks with a fine mist of gore
   * riding it, and a single bright flash where the teeth bit.
   */
  private sawShred(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    detail: number,
    force: number,
  ): void {
    // Tangent to the disc at the contact point: the direction teeth travel.
    const tanX = -dirZ;
    const tanZ = dirX;

    this.flash(x, y, z, 0.34 * force, 0.07, VFX_PALETTE.sparkHot);

    const sparks = this.count(11 * force, detail);
    for (let i = 0; i < sparks; i++) {
      const along = this.rand(5, 13) * (Math.random() < 0.5 ? 1 : -1);
      this.reset0();
      this.spec.x = x + this.randSigned(0.12);
      this.spec.y = y + this.randSigned(0.12);
      this.spec.z = z + this.randSigned(0.12);
      this.spec.vx = tanX * along + dirX * this.rand(0.5, 2.5);
      this.spec.vy = this.rand(0.4, 3.2);
      this.spec.vz = tanZ * along + dirZ * this.rand(0.5, 2.5);
      this.spec.size = this.rand(0.035, 0.06);
      this.spec.endSize = 0.01;
      this.spec.lifeSeconds = this.rand(0.16, 0.34);
      this.spec.colorStart = VFX_PALETTE.sparkHot;
      this.spec.colorEnd = VFX_PALETTE.ember;
      this.spec.gravity = -13;
      this.spec.drag = 1.2;
      this.spec.spin = 12;
      this.spec.bounce = 0.35;
      this.glow.spawn(this.take());
    }

    const mist = this.count(9 * force, detail);
    for (let i = 0; i < mist; i++) {
      const along = this.rand(2, 8) * (Math.random() < 0.5 ? 1 : -1);
      this.reset0();
      this.spec.x = x + this.randSigned(0.14);
      this.spec.y = y + this.randSigned(0.14);
      this.spec.z = z + this.randSigned(0.14);
      this.spec.vx = tanX * along + dirX * this.rand(1.5, 4.5);
      this.spec.vy = this.rand(1, 4.5);
      this.spec.vz = tanZ * along + dirZ * this.rand(1.5, 4.5);
      this.spec.size = this.rand(0.055, 0.1);
      this.spec.endSize = this.spec.size * 0.6;
      this.spec.lifeSeconds = this.rand(0.5, 0.95);
      this.spec.colorStart = VFX_PALETTE.gore;
      this.spec.colorEnd = VFX_PALETTE.goreDark;
      this.spec.gravity = -17;
      this.spec.drag = 0.5;
      this.spec.spin = 9;
      this.spec.bounce = 0.15;
      this.spec.stick = true;
      this.lit.spawn(this.take());
    }
  }

  /**
   * Long Spikes: a puncture, not a sweep. One hot pop at the tip, a tight jet
   * of gore squeezed back along the pike, and a couple of heavy chunks that
   * tumble off and land.
   */
  private spikeImpale(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    detail: number,
    force: number,
  ): void {
    this.flash(
      x + dirX * 0.1,
      y,
      z + dirZ * 0.1,
      0.26 * force,
      0.1,
      VFX_PALETTE.steel,
    );

    const jet = this.count(12 * force, detail);
    for (let i = 0; i < jet; i++) {
      const speed = this.rand(4.5, 11);
      this.reset0();
      this.spec.x = x + this.randSigned(0.08);
      this.spec.y = y + this.randSigned(0.1);
      this.spec.z = z + this.randSigned(0.08);
      // Tight cone hugging the pike axis: the wound sprays where it entered.
      this.spec.vx = dirX * speed + this.randSigned(1.6);
      this.spec.vy = this.rand(0.5, 3.5);
      this.spec.vz = dirZ * speed + this.randSigned(1.6);
      this.spec.size = this.rand(0.06, 0.12);
      this.spec.endSize = this.spec.size * 0.7;
      this.spec.lifeSeconds = this.rand(0.6, 1.05);
      this.spec.colorStart = VFX_PALETTE.gore;
      this.spec.colorEnd = VFX_PALETTE.goreDark;
      this.spec.gravity = -18;
      this.spec.drag = 0.35;
      this.spec.spin = 7;
      this.spec.bounce = 0.1;
      this.spec.stick = true;
      this.lit.spawn(this.take());
    }

    const chunks = this.count(4 * force, detail);
    for (let i = 0; i < chunks; i++) {
      this.reset0();
      this.spec.x = x + this.randSigned(0.12);
      this.spec.y = y + this.rand(0, 0.2);
      this.spec.z = z + this.randSigned(0.12);
      this.spec.vx = dirX * this.rand(1.5, 4) + this.randSigned(2.2);
      this.spec.vy = this.rand(2.5, 5.5);
      this.spec.vz = dirZ * this.rand(1.5, 4) + this.randSigned(2.2);
      this.spec.size = this.rand(0.14, 0.22);
      this.spec.endSize = this.spec.size * 0.85;
      this.spec.lifeSeconds = this.rand(1, 1.5);
      this.spec.colorStart = VFX_PALETTE.flesh;
      this.spec.colorEnd = VFX_PALETTE.goreDark;
      this.spec.gravity = -19;
      this.spec.spin = 11;
      this.spec.bounce = 0.28;
      this.spec.stick = true;
      this.lit.spawn(this.take());
    }

    const sparks = this.count(4 * force, detail);
    for (let i = 0; i < sparks; i++) {
      const speed = this.rand(4, 9);
      this.reset0();
      this.spec.x = x;
      this.spec.y = y;
      this.spec.z = z;
      this.spec.vx = dirX * speed + this.randSigned(2.5);
      this.spec.vy = this.rand(0.5, 3);
      this.spec.vz = dirZ * speed + this.randSigned(2.5);
      this.spec.size = 0.045;
      this.spec.endSize = 0.01;
      this.spec.lifeSeconds = this.rand(0.14, 0.26);
      this.spec.colorStart = VFX_PALETTE.sparkHot;
      this.spec.colorEnd = VFX_PALETTE.emberDark;
      this.spec.gravity = -12;
      this.spec.spin = 10;
      this.glow.spawn(this.take());
    }
  }

  /**
   * Barrel Drum: the shredder. A wide fountain thrown up and back over the
   * rolling log, grinding sparks off its teeth, and a hanging red haze — this
   * is the loudest of the three because contact is continuous.
   */
  private drumGrind(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    detail: number,
    force: number,
  ): void {
    const tanX = -dirZ;
    const tanZ = dirX;

    const fountain = this.count(13 * force, detail);
    for (let i = 0; i < fountain; i++) {
      const lateral = this.randSigned(4.5);
      this.reset0();
      this.spec.x = x + tanX * this.randSigned(0.35) + this.randSigned(0.1);
      this.spec.y = y + this.randSigned(0.18);
      this.spec.z = z + tanZ * this.randSigned(0.35) + this.randSigned(0.1);
      this.spec.vx = dirX * this.rand(2, 6) + tanX * lateral;
      this.spec.vy = this.rand(4, 9.5);
      this.spec.vz = dirZ * this.rand(2, 6) + tanZ * lateral;
      this.spec.size = this.rand(0.06, 0.13);
      this.spec.endSize = this.spec.size * 0.65;
      this.spec.lifeSeconds = this.rand(0.65, 1.2);
      this.spec.colorStart = VFX_PALETTE.gore;
      this.spec.colorEnd = VFX_PALETTE.goreDark;
      this.spec.gravity = -18;
      this.spec.drag = 0.3;
      this.spec.spin = 13;
      this.spec.bounce = 0.12;
      this.spec.stick = true;
      this.lit.spawn(this.take());
    }

    const chunks = this.count(3 * force, detail);
    for (let i = 0; i < chunks; i++) {
      this.reset0();
      this.spec.x = x + this.randSigned(0.18);
      this.spec.y = y + this.rand(0, 0.2);
      this.spec.z = z + this.randSigned(0.18);
      this.spec.vx = dirX * this.rand(1, 3.5) + tanX * this.randSigned(3);
      this.spec.vy = this.rand(3, 7);
      this.spec.vz = dirZ * this.rand(1, 3.5) + tanZ * this.randSigned(3);
      this.spec.size = this.rand(0.16, 0.26);
      this.spec.endSize = this.spec.size * 0.9;
      this.spec.lifeSeconds = this.rand(1.1, 1.7);
      this.spec.colorStart = VFX_PALETTE.flesh;
      this.spec.colorEnd = VFX_PALETTE.goreDark;
      this.spec.gravity = -20;
      this.spec.spin = 16;
      this.spec.bounce = 0.3;
      this.spec.stick = true;
      this.lit.spawn(this.take());
    }

    const sparks = this.count(8 * force, detail);
    for (let i = 0; i < sparks; i++) {
      const along = this.rand(3, 9) * (Math.random() < 0.5 ? 1 : -1);
      this.reset0();
      this.spec.x = x + this.randSigned(0.3);
      this.spec.y = y + this.randSigned(0.15);
      this.spec.z = z + this.randSigned(0.3);
      this.spec.vx = tanX * along + dirX * this.rand(1, 4);
      this.spec.vy = this.rand(1.5, 5.5);
      this.spec.vz = tanZ * along + dirZ * this.rand(1, 4);
      this.spec.size = this.rand(0.03, 0.055);
      this.spec.endSize = 0.008;
      this.spec.lifeSeconds = this.rand(0.2, 0.42);
      this.spec.colorStart = VFX_PALETTE.spark;
      this.spec.colorEnd = VFX_PALETTE.emberDark;
      this.spec.gravity = -14;
      this.spec.drag = 0.8;
      this.spec.spin = 14;
      this.spec.bounce = 0.4;
      this.glow.spawn(this.take());
    }

    // Hanging haze: slow, heavily damped cubes that hold the red for a beat.
    const haze = this.count(4 * force, detail);
    for (let i = 0; i < haze; i++) {
      this.reset0();
      this.spec.x = x + this.randSigned(0.35);
      this.spec.y = y + this.rand(0, 0.35);
      this.spec.z = z + this.randSigned(0.35);
      this.spec.vx = this.randSigned(0.8);
      this.spec.vy = this.rand(0.3, 1.1);
      this.spec.vz = this.randSigned(0.8);
      this.spec.size = this.rand(0.1, 0.18);
      this.spec.endSize = this.spec.size * 1.7;
      this.spec.lifeSeconds = this.rand(0.5, 0.85);
      this.spec.colorStart = VFX_PALETTE.goreDark;
      this.spec.colorEnd = 0x000000;
      this.spec.gravity = 0.6;
      this.spec.drag = 2.4;
      this.spec.spin = 2;
      this.glow.spawn(this.take());
    }
  }

  /** Bare ram: blunt force. Dust off the plating, a short gore spit, no sparks. */
  private ramImpact(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    detail: number,
    force: number,
  ): void {
    this.flash(x, y, z, 0.22 * force, 0.06, VFX_PALETTE.dust);

    const dust = this.count(7 * force, detail);
    for (let i = 0; i < dust; i++) {
      this.reset0();
      this.spec.x = x + this.randSigned(0.22);
      this.spec.y = y + this.randSigned(0.22);
      this.spec.z = z + this.randSigned(0.22);
      this.spec.vx = dirX * this.rand(0.8, 3) + this.randSigned(1.4);
      this.spec.vy = this.rand(0.6, 2.4);
      this.spec.vz = dirZ * this.rand(0.8, 3) + this.randSigned(1.4);
      this.spec.size = this.rand(0.1, 0.2);
      this.spec.endSize = this.spec.size * 2;
      this.spec.lifeSeconds = this.rand(0.35, 0.6);
      this.spec.colorStart = VFX_PALETTE.dust;
      this.spec.colorEnd = VFX_PALETTE.smokeDark;
      this.spec.gravity = 0.8;
      this.spec.drag = 3.2;
      this.spec.spin = 3;
      this.lit.spawn(this.take());
    }

    const gore = this.count(6 * force, detail);
    for (let i = 0; i < gore; i++) {
      const speed = this.rand(2.5, 7);
      this.reset0();
      this.spec.x = x + this.randSigned(0.12);
      this.spec.y = y + this.randSigned(0.12);
      this.spec.z = z + this.randSigned(0.12);
      this.spec.vx = dirX * speed + this.randSigned(2);
      this.spec.vy = this.rand(1.5, 5);
      this.spec.vz = dirZ * speed + this.randSigned(2);
      this.spec.size = this.rand(0.06, 0.12);
      this.spec.endSize = this.spec.size * 0.7;
      this.spec.lifeSeconds = this.rand(0.6, 1);
      this.spec.colorStart = VFX_PALETTE.gore;
      this.spec.colorEnd = VFX_PALETTE.goreDark;
      this.spec.gravity = -18;
      this.spec.spin = 8;
      this.spec.bounce = 0.15;
      this.spec.stick = true;
      this.lit.spawn(this.take());
    }
  }

  /**
   * A zombie died: burst it into its own body voxels. `tintHex` should be the
   * dead zombie's body tint so the gibs read as that specific corpse.
   */
  zombieGib(
    x: number,
    y: number,
    z: number,
    tintHex: number,
    scale = 1,
  ): void {
    if (this.disposed) return;
    const detail = this.detailAt(x, y, z);
    if (detail <= 0) return;

    const body = this.count(13 * scale, detail);
    for (let i = 0; i < body; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = this.rand(1.5, 5.5) * scale;
      this.reset0();
      this.spec.x = x + this.randSigned(0.25);
      this.spec.y = y + this.rand(-0.4, 0.5);
      this.spec.z = z + this.randSigned(0.25);
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = this.rand(2, 6.5) * scale;
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.1, 0.2) * scale;
      this.spec.endSize = this.spec.size * 0.9;
      this.spec.lifeSeconds = this.rand(1, 1.7);
      this.spec.colorStart = tintHex;
      this.spec.colorEnd = VFX_PALETTE.goreDark;
      this.spec.gravity = -18;
      this.spec.spin = 12;
      this.spec.bounce = 0.32;
      this.spec.stick = true;
      this.lit.spawn(this.take());
    }

    const blood = this.count(8 * scale, detail);
    for (let i = 0; i < blood; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = this.rand(2, 6.5);
      this.reset0();
      this.spec.x = x;
      this.spec.y = y + this.rand(-0.2, 0.4);
      this.spec.z = z;
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = this.rand(1.5, 5);
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.05, 0.1);
      this.spec.endSize = this.spec.size * 0.7;
      this.spec.lifeSeconds = this.rand(0.8, 1.4);
      this.spec.colorStart = VFX_PALETTE.gore;
      this.spec.colorEnd = VFX_PALETTE.goreDark;
      this.spec.gravity = -19;
      this.spec.spin = 9;
      this.spec.bounce = 0.12;
      this.spec.stick = true;
      this.lit.spawn(this.take());
    }

    this.flash(x, y + 0.2, z, 0.4, 0.1, VFX_PALETTE.gore);
  }

  // ----------------------------------------------------------------- guns ---

  /**
   * A weapon fired. `from` is the muzzle and `to` the ray's end; only the
   * direction between them is used, so a hitscan and a projectile look alike
   * at the barrel.
   */
  muzzleFlash(
    from: Vector3Like,
    to: Vector3Like,
    style: MuzzleVfxStyle = 'standard',
  ): void {
    if (this.disposed) return;
    const detail = this.detailAt(from.x, from.y, from.z);
    if (detail <= 0) return;

    let dirX = to.x - from.x;
    let dirY = to.y - from.y;
    let dirZ = to.z - from.z;
    const length = Math.hypot(dirX, dirY, dirZ);
    if (length < 1e-5) return;
    dirX /= length;
    dirY /= length;
    dirZ /= length;

    if (style === 'flame') {
      this.flameMuzzle(from, dirX, dirY, dirZ, detail);
      return;
    }

    const ice = style === 'ice';
    const heavy = style === 'heavy';
    const sniper = style === 'sniper';
    const hot = ice ? VFX_PALETTE.ice : VFX_PALETTE.sparkHot;
    const cool = ice ? VFX_PALETTE.iceDeep : VFX_PALETTE.emberDark;
    const scale = heavy ? 1.6 : sniper ? 1.25 : 1;

    this.flash(
      from.x + dirX * 0.18,
      from.y + dirY * 0.18,
      from.z + dirZ * 0.18,
      0.3 * scale,
      heavy ? 0.09 : 0.06,
      hot,
    );

    // The cannon adds a second, slower blast bloom and side-vent puffs off the
    // breech, so the barrel itself sells the weight before the shell lands.
    if (heavy) {
      this.flash(
        from.x + dirX * 0.55,
        from.y + dirY * 0.55,
        from.z + dirZ * 0.55,
        0.62,
        0.16,
        VFX_PALETTE.ember,
      );
      const ventX = -dirZ;
      const ventZ = dirX;
      const ventLength = Math.hypot(ventX, ventZ) || 1;
      const vents = this.count(6, detail);
      for (let i = 0; i < vents; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const speed = this.rand(3, 7);
        this.reset0();
        this.spec.x = from.x + dirX * 0.3;
        this.spec.y = from.y + dirY * 0.3;
        this.spec.z = from.z + dirZ * 0.3;
        this.spec.vx = (ventX / ventLength) * side * speed + dirX * 2;
        this.spec.vy = this.rand(0.5, 2);
        this.spec.vz = (ventZ / ventLength) * side * speed + dirZ * 2;
        this.spec.size = this.rand(0.1, 0.18);
        this.spec.endSize = this.spec.size * 3;
        this.spec.lifeSeconds = this.rand(0.25, 0.45);
        this.spec.colorStart = VFX_PALETTE.ember;
        this.spec.colorEnd = 0x000000;
        this.spec.gravity = 1.4;
        this.spec.drag = 3;
        this.spec.spin = 3;
        this.glow.spawn(this.take());
      }
    }

    const sparks = this.count(7 * scale, detail);
    for (let i = 0; i < sparks; i++) {
      const speed = this.rand(9, 26) * scale;
      this.reset0();
      this.spec.x = from.x + dirX * 0.2;
      this.spec.y = from.y + dirY * 0.2;
      this.spec.z = from.z + dirZ * 0.2;
      this.spec.vx = dirX * speed + this.randSigned(2.5);
      this.spec.vy = dirY * speed + this.randSigned(2.5);
      this.spec.vz = dirZ * speed + this.randSigned(2.5);
      this.spec.size = this.rand(0.04, 0.075) * scale;
      this.spec.endSize = 0.008;
      this.spec.lifeSeconds = this.rand(0.05, 0.14);
      this.spec.colorStart = hot;
      this.spec.colorEnd = cool;
      this.spec.gravity = -5;
      this.spec.spin = 14;
      this.glow.spawn(this.take());
    }

    // Smoke curls out of the barrel and rises; skipped on the ice cannon,
    // which vents a cold mist instead of burnt powder.
    const smokePuffs = this.count(4 * scale, detail);
    for (let i = 0; i < smokePuffs; i++) {
      this.reset0();
      this.spec.x = from.x + dirX * this.rand(0.15, 0.5);
      this.spec.y = from.y + dirY * this.rand(0.15, 0.5);
      this.spec.z = from.z + dirZ * this.rand(0.15, 0.5);
      this.spec.vx = dirX * this.rand(1, 3.5) + this.randSigned(0.6);
      this.spec.vy = dirY * this.rand(1, 3.5) + this.rand(0.4, 1.2);
      this.spec.vz = dirZ * this.rand(1, 3.5) + this.randSigned(0.6);
      this.spec.size = this.rand(0.07, 0.13) * scale;
      this.spec.endSize = this.spec.size * this.rand(2.2, 3.4);
      this.spec.lifeSeconds = this.rand(0.3, 0.65);
      this.spec.colorStart = ice ? VFX_PALETTE.ice : VFX_PALETTE.smoke;
      this.spec.colorEnd = ice ? VFX_PALETTE.iceDeep : VFX_PALETTE.smokeDark;
      this.spec.gravity = 1.1;
      this.spec.drag = 2.6;
      this.spec.spin = 2;
      (ice ? this.glow : this.lit).spawn(this.take());
    }

    if (ice) return;

    // Brass out of the ejection port: one casing per shot, tumbling to rest.
    if (this.count(1, detail) < 1) return;
    const rightX = -dirZ;
    const rightZ = dirX;
    const rightLength = Math.hypot(rightX, rightZ) || 1;
    this.reset0();
    this.spec.x = from.x;
    this.spec.y = from.y;
    this.spec.z = from.z;
    this.spec.vx = (rightX / rightLength) * this.rand(1.8, 3.4);
    this.spec.vy = this.rand(2, 3.4);
    this.spec.vz = (rightZ / rightLength) * this.rand(1.8, 3.4);
    this.spec.size = 0.045;
    this.spec.endSize = 0.045;
    this.spec.lifeSeconds = this.rand(1.2, 1.8);
    this.spec.colorStart = VFX_PALETTE.brass;
    this.spec.colorEnd = VFX_PALETTE.smokeDark;
    this.spec.gravity = -19;
    this.spec.spin = 22;
    this.spec.bounce = 0.35;
    this.lit.spawn(this.take());
  }

  /**
   * A shot terminated. `dirX/dirY/dirZ` is the travel direction, so flesh
   * sprays through and hard surfaces spit sparks back at the shooter.
   */
  bulletImpact(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    kind: ImpactVfxKind,
  ): void {
    if (this.disposed) return;
    const detail = this.detailAt(x, y, z);
    if (detail <= 0) return;

    if (kind === 'burn') {
      this.burnImpact(x, y, z, detail);
      return;
    }

    if (kind === 'flesh') {
      const spray = this.count(7, detail);
      for (let i = 0; i < spray; i++) {
        const speed = this.rand(2.5, 7);
        this.reset0();
        this.spec.x = x;
        this.spec.y = y;
        this.spec.z = z;
        this.spec.vx = dirX * speed + this.randSigned(2.2);
        this.spec.vy = dirY * speed + this.rand(0.5, 3);
        this.spec.vz = dirZ * speed + this.randSigned(2.2);
        this.spec.size = this.rand(0.045, 0.09);
        this.spec.endSize = this.spec.size * 0.6;
        this.spec.lifeSeconds = this.rand(0.45, 0.85);
        this.spec.colorStart = VFX_PALETTE.gore;
        this.spec.colorEnd = VFX_PALETTE.goreDark;
        this.spec.gravity = -18;
        this.spec.spin = 9;
        this.spec.bounce = 0.12;
        this.spec.stick = true;
        this.lit.spawn(this.take());
      }
      this.flash(x, y, z, 0.16, 0.06, VFX_PALETTE.gore);
      return;
    }

    if (kind === 'shield') {
      // Bounced off the phone addict's bubble: cyan shards straight back.
      const shards = this.count(8, detail);
      for (let i = 0; i < shards; i++) {
        const speed = this.rand(3, 9);
        this.reset0();
        this.spec.x = x;
        this.spec.y = y;
        this.spec.z = z;
        this.spec.vx = -dirX * speed + this.randSigned(3);
        this.spec.vy = -dirY * speed + this.rand(0.5, 3.5);
        this.spec.vz = -dirZ * speed + this.randSigned(3);
        this.spec.size = this.rand(0.03, 0.06);
        this.spec.endSize = 0.008;
        this.spec.lifeSeconds = this.rand(0.18, 0.36);
        this.spec.colorStart = VFX_PALETTE.shield;
        this.spec.colorEnd = VFX_PALETTE.iceDeep;
        this.spec.gravity = -8;
        this.spec.spin = 12;
        this.glow.spawn(this.take());
      }
      this.flash(x, y, z, 0.3, 0.09, VFX_PALETTE.shield);
      return;
    }

    if (kind === 'ice') {
      const shards = this.count(7, detail);
      for (let i = 0; i < shards; i++) {
        const speed = this.rand(2, 6);
        this.reset0();
        this.spec.x = x;
        this.spec.y = y;
        this.spec.z = z;
        this.spec.vx = -dirX * speed + this.randSigned(2.5);
        this.spec.vy = this.rand(0.5, 3.5);
        this.spec.vz = -dirZ * speed + this.randSigned(2.5);
        this.spec.size = this.rand(0.04, 0.08);
        this.spec.endSize = 0.01;
        this.spec.lifeSeconds = this.rand(0.3, 0.6);
        this.spec.colorStart = VFX_PALETTE.ice;
        this.spec.colorEnd = VFX_PALETTE.iceDeep;
        this.spec.gravity = -11;
        this.spec.drag = 0.6;
        this.spec.spin = 10;
        this.spec.bounce = 0.3;
        this.glow.spawn(this.take());
      }
      this.flash(x, y, z, 0.22, 0.1, VFX_PALETTE.ice);
      return;
    }

    // Hard surface: sparks skittering back plus a small dust kick.
    const sparks = this.count(6, detail);
    for (let i = 0; i < sparks; i++) {
      const speed = this.rand(3, 10);
      this.reset0();
      this.spec.x = x;
      this.spec.y = y;
      this.spec.z = z;
      this.spec.vx = -dirX * speed + this.randSigned(3.5);
      this.spec.vy = -dirY * speed + this.rand(0.5, 4);
      this.spec.vz = -dirZ * speed + this.randSigned(3.5);
      this.spec.size = this.rand(0.03, 0.055);
      this.spec.endSize = 0.008;
      this.spec.lifeSeconds = this.rand(0.15, 0.34);
      this.spec.colorStart = VFX_PALETTE.sparkHot;
      this.spec.colorEnd = VFX_PALETTE.emberDark;
      this.spec.gravity = -13;
      this.spec.spin = 13;
      this.spec.bounce = 0.4;
      this.glow.spawn(this.take());
    }

    const dust = this.count(4, detail);
    for (let i = 0; i < dust; i++) {
      this.reset0();
      this.spec.x = x;
      this.spec.y = y;
      this.spec.z = z;
      this.spec.vx = -dirX * this.rand(0.5, 2) + this.randSigned(1.2);
      this.spec.vy = this.rand(0.5, 2);
      this.spec.vz = -dirZ * this.rand(0.5, 2) + this.randSigned(1.2);
      this.spec.size = this.rand(0.06, 0.12);
      this.spec.endSize = this.spec.size * 2.4;
      this.spec.lifeSeconds = this.rand(0.3, 0.55);
      this.spec.colorStart = VFX_PALETTE.dust;
      this.spec.colorEnd = VFX_PALETTE.smokeDark;
      this.spec.gravity = 0.6;
      this.spec.drag = 3;
      this.spec.spin = 2;
      this.lit.spawn(this.take());
    }
  }

  /**
   * Flamethrower body: the fire itself, built along one ray of the cone.
   *
   * Four ingredients sell a voxel flame — fast white licks at the nozzle, fat
   * rolling puffs that expand and cool as they travel, embers that separate
   * and float up, and greasy smoke off the far end. Each ray of the cone plays
   * a thinner version of the same recipe, so the six rays composite into one
   * body of fire rather than six visible lines.
   */
  flameJet(from: Vector3Like, to: Vector3Like): void {
    if (this.disposed) return;
    const detail = this.detailAt(to.x, to.y, to.z);
    if (detail <= 0) return;

    let dirX = to.x - from.x;
    let dirY = to.y - from.y;
    let dirZ = to.z - from.z;
    const range = Math.hypot(dirX, dirY, dirZ);
    if (range < 1e-5) return;
    dirX /= range;
    dirY /= range;
    dirZ /= range;

    // Rolling body of the flame. Spawned along the near two-thirds of the ray
    // and heavily damped, so each puff blooms outward instead of streaking.
    const puffs = this.count(4, detail);
    for (let i = 0; i < puffs; i++) {
      const along = Math.random() * 0.65 * range;
      const speed = this.rand(4, 11);
      this.reset0();
      this.spec.x = from.x + dirX * along + this.randSigned(0.18);
      this.spec.y = from.y + dirY * along + this.randSigned(0.18);
      this.spec.z = from.z + dirZ * along + this.randSigned(0.18);
      this.spec.vx = dirX * speed + this.randSigned(1.6);
      this.spec.vy = dirY * speed + this.rand(0.4, 1.8);
      this.spec.vz = dirZ * speed + this.randSigned(1.6);
      this.spec.size = this.rand(0.12, 0.2);
      this.spec.endSize = this.rand(0.36, 0.55);
      this.spec.lifeSeconds = this.rand(0.18, 0.36);
      this.spec.colorStart = VFX_PALETTE.sparkHot;
      this.spec.colorEnd = VFX_PALETTE.emberDark;
      this.spec.gravity = 2.2;
      this.spec.drag = 3.2;
      this.spec.spin = 3;
      this.glow.spawn(this.take());
    }

    // Licks: the hot white core, only near the nozzle and gone almost at once.
    const licks = this.count(2, detail);
    for (let i = 0; i < licks; i++) {
      const speed = this.rand(12, 22);
      this.reset0();
      this.spec.x = from.x + dirX * this.rand(0.1, 0.8);
      this.spec.y = from.y + dirY * this.rand(0.1, 0.8);
      this.spec.z = from.z + dirZ * this.rand(0.1, 0.8);
      this.spec.vx = dirX * speed + this.randSigned(1);
      this.spec.vy = dirY * speed + this.randSigned(1);
      this.spec.vz = dirZ * speed + this.randSigned(1);
      this.spec.size = this.rand(0.08, 0.14);
      this.spec.endSize = 0.22;
      this.spec.lifeSeconds = this.rand(0.08, 0.16);
      this.spec.colorStart = 0xffffff;
      this.spec.colorEnd = VFX_PALETTE.ember;
      this.spec.gravity = 1;
      this.spec.drag = 2;
      this.spec.spin = 4;
      this.glow.spawn(this.take());
    }

    // Embers break off the cone and drift upward well after the fire has gone.
    const embers = this.count(2, detail);
    for (let i = 0; i < embers; i++) {
      const along = Math.random() * range;
      this.reset0();
      this.spec.x = from.x + dirX * along + this.randSigned(0.25);
      this.spec.y = from.y + dirY * along + this.randSigned(0.25);
      this.spec.z = from.z + dirZ * along + this.randSigned(0.25);
      this.spec.vx = dirX * this.rand(0.5, 2.5) + this.randSigned(1.2);
      this.spec.vy = this.rand(1, 3);
      this.spec.vz = dirZ * this.rand(0.5, 2.5) + this.randSigned(1.2);
      this.spec.size = this.rand(0.045, 0.085);
      this.spec.endSize = 0.015;
      this.spec.lifeSeconds = this.rand(0.4, 0.85);
      this.spec.colorStart = VFX_PALETTE.spark;
      this.spec.colorEnd = VFX_PALETTE.emberDark;
      this.spec.gravity = 1.8;
      this.spec.drag = 1.2;
      this.spec.spin = 8;
      this.glow.spawn(this.take());
    }

    // Greasy smoke off the head of the cone, on the lit layer so it reads as
    // matter blocking the moonlight rather than as more light.
    const smoke = this.count(1.5, detail);
    for (let i = 0; i < smoke; i++) {
      this.reset0();
      this.spec.x = to.x + this.randSigned(0.3);
      this.spec.y = to.y + this.rand(0, 0.35);
      this.spec.z = to.z + this.randSigned(0.3);
      this.spec.vx = dirX * this.rand(0.5, 2) + this.randSigned(0.8);
      this.spec.vy = this.rand(1.2, 2.8);
      this.spec.vz = dirZ * this.rand(0.5, 2) + this.randSigned(0.8);
      this.spec.size = this.rand(0.14, 0.24);
      this.spec.endSize = this.spec.size * this.rand(2.4, 3.6);
      this.spec.lifeSeconds = this.rand(0.6, 1.1);
      this.spec.colorStart = VFX_PALETTE.smoke;
      this.spec.colorEnd = VFX_PALETTE.smokeDark;
      this.spec.gravity = 1.5;
      this.spec.drag = 2.2;
      this.spec.spin = 1.5;
      this.lit.spawn(this.take());
    }
  }

  /**
   * The nozzle itself: a fat ball of ignition rather than a powder flash, with
   * a pilot glow that sits on the barrel for a beat after the burst.
   */
  private flameMuzzle(
    from: Vector3Like,
    dirX: number,
    dirY: number,
    dirZ: number,
    detail: number,
  ): void {
    this.flash(
      from.x + dirX * 0.25,
      from.y + dirY * 0.25,
      from.z + dirZ * 0.25,
      0.44,
      0.09,
      0xffffff,
    );

    const ignition = this.count(6, detail);
    for (let i = 0; i < ignition; i++) {
      const speed = this.rand(5, 14);
      this.reset0();
      this.spec.x = from.x + dirX * 0.2 + this.randSigned(0.1);
      this.spec.y = from.y + dirY * 0.2 + this.randSigned(0.1);
      this.spec.z = from.z + dirZ * 0.2 + this.randSigned(0.1);
      this.spec.vx = dirX * speed + this.randSigned(2);
      this.spec.vy = dirY * speed + this.rand(0.2, 1.6);
      this.spec.vz = dirZ * speed + this.randSigned(2);
      this.spec.size = this.rand(0.1, 0.18);
      this.spec.endSize = this.rand(0.3, 0.46);
      this.spec.lifeSeconds = this.rand(0.12, 0.26);
      this.spec.colorStart = 0xffffff;
      this.spec.colorEnd = VFX_PALETTE.emberDark;
      this.spec.gravity = 2;
      this.spec.drag = 3.4;
      this.spec.spin = 4;
      this.glow.spawn(this.take());
    }
  }

  /**
   * Something caught fire: flames climbing off it, a couple of burning scraps
   * that drop and smoulder where they land, and a wisp of smoke.
   */
  private burnImpact(x: number, y: number, z: number, detail: number): void {
    const flames = this.count(5, detail);
    for (let i = 0; i < flames; i++) {
      this.reset0();
      this.spec.x = x + this.randSigned(0.22);
      this.spec.y = y + this.rand(-0.2, 0.3);
      this.spec.z = z + this.randSigned(0.22);
      this.spec.vx = this.randSigned(0.9);
      this.spec.vy = this.rand(1.6, 3.6);
      this.spec.vz = this.randSigned(0.9);
      this.spec.size = this.rand(0.1, 0.18);
      this.spec.endSize = this.rand(0.02, 0.06);
      this.spec.lifeSeconds = this.rand(0.3, 0.6);
      this.spec.colorStart = VFX_PALETTE.sparkHot;
      this.spec.colorEnd = VFX_PALETTE.emberDark;
      this.spec.gravity = 2.4;
      this.spec.drag = 1.8;
      this.spec.spin = 5;
      this.glow.spawn(this.take());
    }

    // Burning scraps: they fall, land, and keep glowing where they settle.
    const scraps = this.count(3, detail);
    for (let i = 0; i < scraps; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = this.rand(1, 3.5);
      this.reset0();
      this.spec.x = x;
      this.spec.y = y;
      this.spec.z = z;
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = this.rand(1, 3);
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.05, 0.09);
      this.spec.endSize = this.spec.size * 0.6;
      this.spec.lifeSeconds = this.rand(0.7, 1.3);
      this.spec.colorStart = VFX_PALETTE.ember;
      this.spec.colorEnd = VFX_PALETTE.emberDark;
      this.spec.gravity = -12;
      this.spec.spin = 9;
      this.spec.bounce = 0.2;
      this.spec.stick = true;
      this.glow.spawn(this.take());
    }

    this.flash(x, y + 0.15, z, 0.28, 0.08, VFX_PALETTE.ember);
  }

  /**
   * Heavy Cannon shell detonation. Deliberately louder than a landmine and
   * built to read as *area*: a white-hot core, a flat shockwave ring of low
   * cubes racing out along the ground to the actual blast radius, a fireball
   * that lifts and cools, then debris and smoke. The ring is the important
   * part — it is what tells the player how far the damage reached.
   */
  shellBurst(x: number, y: number, z: number, radius: number): void {
    if (this.disposed) return;
    const detail = this.detailAt(x, y, z);
    if (detail <= 0) return;

    // Two-stage core: a hard white flash inside a slower orange fireball.
    this.flash(x, y + 0.3, z, radius * 0.75, 0.09, 0xffffff);
    this.flash(x, y + 0.4, z, radius * 1.15, 0.22, VFX_PALETTE.ember);

    // Shockwave: low, flat cubes travelling out to exactly the blast radius.
    const ring = this.count(18, detail);
    for (let i = 0; i < ring; i++) {
      const angle = (i / Math.max(1, ring)) * Math.PI * 2 + this.randSigned(0.2);
      // Reach the rim inside the particle's life, so the ring stops where the
      // damage does rather than sailing past it.
      const life = this.rand(0.26, 0.36);
      const speed = (radius / life) * this.rand(0.75, 1);
      this.reset0();
      this.spec.x = x + Math.cos(angle) * 0.2;
      this.spec.y = y + 0.12;
      this.spec.z = z + Math.sin(angle) * 0.2;
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = this.rand(0.2, 1.2);
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.16, 0.26);
      this.spec.endSize = 0.02;
      this.spec.lifeSeconds = life;
      this.spec.colorStart = VFX_PALETTE.sparkHot;
      this.spec.colorEnd = VFX_PALETTE.emberDark;
      this.spec.gravity = 0;
      this.spec.drag = 1.4;
      this.spec.spin = 2;
      this.glow.spawn(this.take());
    }

    // Fireball: fat puffs that climb out of the crater and cool as they go.
    const fireball = this.count(10, detail);
    for (let i = 0; i < fireball; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = this.rand(1.5, 6);
      this.reset0();
      this.spec.x = x + this.randSigned(0.25);
      this.spec.y = y + this.rand(0.1, 0.5);
      this.spec.z = z + this.randSigned(0.25);
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = this.rand(3, 8);
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.22, 0.4);
      this.spec.endSize = this.rand(0.5, 0.8);
      this.spec.lifeSeconds = this.rand(0.3, 0.55);
      this.spec.colorStart = 0xffffff;
      this.spec.colorEnd = VFX_PALETTE.emberDark;
      this.spec.gravity = 2.5;
      this.spec.drag = 2.8;
      this.spec.spin = 3;
      this.glow.spawn(this.take());
    }

    const sparks = this.count(14, detail);
    for (let i = 0; i < sparks; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = this.rand(8, 22);
      this.reset0();
      this.spec.x = x;
      this.spec.y = y + 0.2;
      this.spec.z = z;
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = this.rand(3, 13);
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.05, 0.09);
      this.spec.endSize = 0.01;
      this.spec.lifeSeconds = this.rand(0.3, 0.7);
      this.spec.colorStart = VFX_PALETTE.sparkHot;
      this.spec.colorEnd = VFX_PALETTE.emberDark;
      this.spec.gravity = -15;
      this.spec.drag = 0.4;
      this.spec.spin = 16;
      this.spec.bounce = 0.45;
      this.glow.spawn(this.take());
    }

    const debris = this.count(11, detail);
    for (let i = 0; i < debris; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = this.rand(3, 9);
      this.reset0();
      this.spec.x = x;
      this.spec.y = y + 0.15;
      this.spec.z = z;
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = this.rand(4, 11);
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.09, 0.2);
      this.spec.endSize = this.spec.size * 0.8;
      this.spec.lifeSeconds = this.rand(1, 1.7);
      this.spec.colorStart = VFX_PALETTE.dust;
      this.spec.colorEnd = VFX_PALETTE.smokeDark;
      this.spec.gravity = -21;
      this.spec.spin = 14;
      this.spec.bounce = 0.3;
      this.spec.stick = true;
      this.lit.spawn(this.take());
    }

    const smoke = this.count(8, detail);
    for (let i = 0; i < smoke; i++) {
      this.reset0();
      this.spec.x = x + this.randSigned(0.5);
      this.spec.y = y + this.rand(0.2, 0.9);
      this.spec.z = z + this.randSigned(0.5);
      this.spec.vx = this.randSigned(1.8);
      this.spec.vy = this.rand(1.4, 3.4);
      this.spec.vz = this.randSigned(1.8);
      this.spec.size = this.rand(0.24, 0.42);
      this.spec.endSize = this.spec.size * this.rand(2.4, 3.4);
      this.spec.lifeSeconds = this.rand(1, 1.7);
      this.spec.colorStart = VFX_PALETTE.smoke;
      this.spec.colorEnd = VFX_PALETTE.smokeDark;
      this.spec.gravity = 1.6;
      this.spec.drag = 2;
      this.spec.spin = 1.2;
      this.lit.spawn(this.take());
    }
  }

  /** Landmine or other blast: fireball core, radial sparks, dirt, and smoke. */
  explosion(x: number, y: number, z: number, radius: number): void {
    if (this.disposed) return;
    const detail = this.detailAt(x, y, z);
    if (detail <= 0) return;

    this.flash(x, y + 0.2, z, radius * 0.9, 0.16, VFX_PALETTE.sparkHot);

    const sparks = this.count(16, detail);
    for (let i = 0; i < sparks; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = this.rand(5, 16);
      this.reset0();
      this.spec.x = x;
      this.spec.y = y + 0.1;
      this.spec.z = z;
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = this.rand(2, 10);
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.05, 0.1);
      this.spec.endSize = 0.01;
      this.spec.lifeSeconds = this.rand(0.25, 0.6);
      this.spec.colorStart = VFX_PALETTE.sparkHot;
      this.spec.colorEnd = VFX_PALETTE.emberDark;
      this.spec.gravity = -14;
      this.spec.drag = 0.5;
      this.spec.spin = 14;
      this.spec.bounce = 0.4;
      this.glow.spawn(this.take());
    }

    const dirt = this.count(10, detail);
    for (let i = 0; i < dirt; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = this.rand(2, 7);
      this.reset0();
      this.spec.x = x;
      this.spec.y = y + 0.1;
      this.spec.z = z;
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = this.rand(3, 9);
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.08, 0.18);
      this.spec.endSize = this.spec.size * 0.8;
      this.spec.lifeSeconds = this.rand(0.9, 1.5);
      this.spec.colorStart = VFX_PALETTE.dust;
      this.spec.colorEnd = VFX_PALETTE.smokeDark;
      this.spec.gravity = -20;
      this.spec.spin = 12;
      this.spec.bounce = 0.3;
      this.spec.stick = true;
      this.lit.spawn(this.take());
    }

    const smoke = this.count(7, detail);
    for (let i = 0; i < smoke; i++) {
      this.reset0();
      this.spec.x = x + this.randSigned(0.4);
      this.spec.y = y + this.rand(0.1, 0.6);
      this.spec.z = z + this.randSigned(0.4);
      this.spec.vx = this.randSigned(1.4);
      this.spec.vy = this.rand(1, 2.8);
      this.spec.vz = this.randSigned(1.4);
      this.spec.size = this.rand(0.16, 0.3);
      this.spec.endSize = this.spec.size * 2.6;
      this.spec.lifeSeconds = this.rand(0.7, 1.3);
      this.spec.colorStart = VFX_PALETTE.smoke;
      this.spec.colorEnd = VFX_PALETTE.smokeDark;
      this.spec.gravity = 1.4;
      this.spec.drag = 2.2;
      this.spec.spin = 1.5;
      this.lit.spawn(this.take());
    }
  }

  // -------------------------------------------------------------- helpers ---

  /**
   * One short-lived additive cube that blooms and collapses at a hit point.
   * Deliberately exempt from LOD thinning — the flash is what makes a distant
   * hit legible — but it still stops when effects are turned off outright.
   */
  private flash(
    x: number,
    y: number,
    z: number,
    size: number,
    lifeSeconds: number,
    colorHex: number,
  ): void {
    if (this.quality <= 0) return;
    this.reset0();
    this.spec.x = x;
    this.spec.y = y;
    this.spec.z = z;
    this.spec.size = size;
    this.spec.endSize = 0;
    this.spec.lifeSeconds = lifeSeconds;
    this.spec.colorStart = colorHex;
    this.spec.colorEnd = 0x000000;
    this.spec.gravity = 0;
    this.spec.spin = 5;
    this.glow.spawn(this.take());
  }

  /** Restore the shared scratch spec to its defaults before an emitter fills it. */
  private reset0(): void {
    this.spec.x = 0;
    this.spec.y = 0;
    this.spec.z = 0;
    this.spec.vx = 0;
    this.spec.vy = 0;
    this.spec.vz = 0;
    this.spec.size = 0.1;
    this.spec.endSize = 0;
    this.spec.lifeSeconds = 0.5;
    this.spec.colorStart = 0xffffff;
    this.spec.colorEnd = 0x000000;
    this.spec.gravity = -18;
    this.spec.drag = 0;
    this.spec.spin = 0;
    this.spec.bounce = -1;
    this.spec.stick = false;
  }

  /**
   * Hand the filled spec to a pool, charging it against this frame's budget.
   * Returns a spec whose life is zeroed when the budget is spent, which the
   * pool treats as a no-op — so an over-subscribed frame thins out evenly
   * instead of dropping whole effects.
   */
  private take(): ParticleSpec {
    if (this.frameBudget <= 0) {
      this.spec.lifeSeconds = 0;
      return this.spec;
    }
    this.frameBudget--;
    return this.spec;
  }

  /**
   * Detail factor for a world position: 1 up close, 0.5 mid-range, 0.25 far,
   * and 0 past the cull distance. Squared distances only.
   */
  private detailAt(x: number, y: number, z: number): number {
    const dx = x - this.viewpoint.x;
    const dy = y - this.viewpoint.y;
    const dz = z - this.viewpoint.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq > LOD_CULL_DISTANCE_M * LOD_CULL_DISTANCE_M) return 0;
    if (distanceSq <= LOD_FULL_DISTANCE_M * LOD_FULL_DISTANCE_M) return 1;
    if (distanceSq <= LOD_HALF_DISTANCE_M * LOD_HALF_DISTANCE_M) return 0.5;
    return 0.25;
  }

  /**
   * Authored count scaled by LOD and quality. Fractional results round
   * probabilistically so a one-particle effect at quarter detail still fires
   * a quarter of the time rather than never.
   */
  private count(base: number, detail: number): number {
    const scaled = base * detail * this.quality;
    const whole = Math.floor(scaled);
    return whole + (Math.random() < scaled - whole ? 1 : 0);
  }

  private rand(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  private randSigned(magnitude: number): number {
    return (Math.random() * 2 - 1) * magnitude;
  }
}
