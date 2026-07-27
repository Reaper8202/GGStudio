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

/** Barrel character, keyed by weapon id; the old names remain adapter aliases. */
export type MuzzleVfxStyle =
  | 'turret'
  | 'cannon-heavy'
  | 'ice-cannon'
  | 'sniper-light'
  | 'flamethrower'
  | 'standard'
  | 'heavy'
  | 'sniper'
  | 'flame'
  | 'hellfire'
  | 'ice';

/** What a projectile or ray terminated against. */
export type ImpactVfxKind =
  | 'turret-zombie'
  | 'turret-terrain'
  | 'turret-shield'
  | 'cannon-heavy-zombie'
  | 'cannon-heavy-terrain'
  | 'cannon-heavy-shield'
  | 'ice-cannon-zombie'
  | 'ice-cannon-terrain'
  | 'ice-cannon-shield'
  | 'sniper-light-zombie'
  | 'sniper-light-terrain'
  | 'sniper-light-shield'
  | 'flamethrower-zombie'
  | 'flamethrower-terrain'
  | 'flamethrower-shield'
  | 'flesh'
  | 'shield'
  | 'hard'
  | 'ice'
  | 'burn'
  | 'hellburn';

interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

type WeaponMuzzleStyle =
  'turret' | 'cannon-heavy' | 'ice-cannon' | 'sniper-light' | 'flamethrower';

function canonicalMuzzleStyle(style: MuzzleVfxStyle): WeaponMuzzleStyle {
  switch (style) {
    case 'standard':
    case 'turret':
      return 'turret';
    case 'heavy':
    case 'cannon-heavy':
      return 'cannon-heavy';
    case 'ice':
    case 'ice-cannon':
      return 'ice-cannon';
    case 'sniper':
    case 'sniper-light':
      return 'sniper-light';
    // An overcharged nozzle is still a nozzle; the hotter look is carried by
    // the hellfire flag passed on to the emitter, not by a separate barrel.
    case 'flame':
    case 'flamethrower':
    case 'hellfire':
      return 'flamethrower';
  }
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
  zombieGib(x: number, y: number, z: number, tintHex: number, scale = 1): void {
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

    const weaponStyle = canonicalMuzzleStyle(style);
    if (weaponStyle === 'flamethrower') {
      this.flameMuzzle(from, dirX, dirY, dirZ, detail, style === 'hellfire');
      return;
    }
    if (weaponStyle === 'turret') {
      this.turretMuzzle(from, dirX, dirY, dirZ, detail);
      return;
    }

    const ice = weaponStyle === 'ice-cannon';
    const heavy = weaponStyle === 'cannon-heavy';
    const sniper = weaponStyle === 'sniper-light';
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

    if (heavy) this.cannonTrail(from, dirX, dirY, dirZ, length, detail);
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
   * The rapid turret fires often enough that its muzzle has to register as a
   * blink, not a persistent fountain of particles competing with its tracers.
   */
  private turretMuzzle(
    from: Vector3Like,
    dirX: number,
    dirY: number,
    dirZ: number,
    detail: number,
  ): void {
    this.flash(
      from.x + dirX * 0.16,
      from.y + dirY * 0.16,
      from.z + dirZ * 0.16,
      0.12,
      0.035,
      VFX_PALETTE.sparkHot,
    );
    const sparks = this.count(2, detail);
    for (let i = 0; i < sparks; i++) {
      const speed = this.rand(5, 10);
      this.reset0();
      this.spec.x = from.x + dirX * 0.14;
      this.spec.y = from.y + dirY * 0.14;
      this.spec.z = from.z + dirZ * 0.14;
      this.spec.vx = dirX * speed + this.randSigned(0.8);
      this.spec.vy = dirY * speed + this.randSigned(0.8);
      this.spec.vz = dirZ * speed + this.randSigned(0.8);
      this.spec.size = this.rand(0.02, 0.035);
      this.spec.endSize = 0.005;
      this.spec.lifeSeconds = this.rand(0.035, 0.07);
      this.spec.colorStart = VFX_PALETTE.sparkHot;
      this.spec.colorEnd = VFX_PALETTE.ember;
      this.spec.gravity = -4;
      this.spec.spin = 10;
      this.glow.spawn(this.take());
    }
  }

  /**
   * The ribbon supplies the hot shell core; a few pooled smoke puffs along
   * its early path give the Heavy Cannon the slow, dirty tail its impact earns.
   */
  private cannonTrail(
    from: Vector3Like,
    dirX: number,
    dirY: number,
    dirZ: number,
    range: number,
    detail: number,
  ): void {
    const puffs = this.count(3, detail);
    const tailLength = Math.min(range * 0.38, 4.5);
    for (let i = 0; i < puffs; i++) {
      const along = tailLength * ((i + this.rand(0.15, 0.85)) / puffs);
      this.reset0();
      this.spec.x = from.x + dirX * along + this.randSigned(0.08);
      this.spec.y = from.y + dirY * along + this.randSigned(0.08);
      this.spec.z = from.z + dirZ * along + this.randSigned(0.08);
      this.spec.vx = dirX * this.rand(0.5, 1.5) + this.randSigned(0.35);
      this.spec.vy = dirY * this.rand(0.5, 1.5) + this.rand(0.4, 1.1);
      this.spec.vz = dirZ * this.rand(0.5, 1.5) + this.randSigned(0.35);
      this.spec.size = this.rand(0.07, 0.13);
      this.spec.endSize = this.spec.size * this.rand(2.2, 3.1);
      this.spec.lifeSeconds = this.rand(0.35, 0.62);
      this.spec.colorStart = VFX_PALETTE.smoke;
      this.spec.colorEnd = VFX_PALETTE.smokeDark;
      this.spec.gravity = 0.9;
      this.spec.drag = 2.8;
      this.spec.spin = 1.5;
      this.lit.spawn(this.take());
    }
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

    switch (kind) {
      case 'turret-zombie':
        this.turretImpact(x, y, z, dirX, dirY, dirZ, false, detail);
        return;
      case 'turret-terrain':
        this.turretImpact(x, y, z, dirX, dirY, dirZ, true, detail);
        return;
      case 'cannon-heavy-zombie':
        this.cannonImpact(x, y, z, dirX, dirY, dirZ, false, detail);
        return;
      case 'cannon-heavy-terrain':
        this.cannonImpact(x, y, z, dirX, dirY, dirZ, true, detail);
        return;
      case 'ice-cannon-zombie':
        this.iceCannonImpact(x, y, z, dirX, dirY, dirZ, false, detail);
        return;
      case 'ice-cannon-terrain':
        this.iceCannonImpact(x, y, z, dirX, dirY, dirZ, true, detail);
        return;
      case 'sniper-light-zombie':
        this.sniperImpact(x, y, z, dirX, dirY, dirZ, false, detail);
        return;
      case 'sniper-light-terrain':
        this.sniperImpact(x, y, z, dirX, dirY, dirZ, true, detail);
        return;
      case 'flamethrower-zombie':
      case 'flamethrower-terrain':
        this.flameImpact(x, y, z, dirX, dirY, dirZ, detail);
        return;
      case 'turret-shield':
        this.weaponShieldImpact(
          x,
          y,
          z,
          dirX,
          dirY,
          dirZ,
          detail,
          VFX_PALETTE.spark,
        );
        return;
      case 'cannon-heavy-shield':
        this.weaponShieldImpact(
          x,
          y,
          z,
          dirX,
          dirY,
          dirZ,
          detail,
          VFX_PALETTE.ember,
        );
        return;
      case 'ice-cannon-shield':
        this.weaponShieldImpact(
          x,
          y,
          z,
          dirX,
          dirY,
          dirZ,
          detail,
          VFX_PALETTE.ice,
        );
        return;
      case 'sniper-light-shield':
        this.weaponShieldImpact(
          x,
          y,
          z,
          dirX,
          dirY,
          dirZ,
          detail,
          VFX_PALETTE.frost,
        );
        return;
      case 'flamethrower-shield':
        this.weaponShieldImpact(
          x,
          y,
          z,
          dirX,
          dirY,
          dirZ,
          detail,
          VFX_PALETTE.ember,
        );
        return;
    }

    if (kind === 'burn' || kind === 'hellburn') {
      this.burnImpact(x, y, z, detail, kind === 'hellburn');
      return;
    }

    if (kind === 'flesh') {
      const spray = this.count(7, detail);
      for (let i = 0; i < spray; i++) {
        const speed = this.rand(3.5, 8.5);
        this.reset0();
        this.spec.x = x;
        this.spec.y = y;
        this.spec.z = z;
        this.spec.vx = dirX * speed + this.randSigned(2.2);
        this.spec.vy = dirY * speed + this.rand(0.8, 3.8);
        this.spec.vz = dirZ * speed + this.randSigned(2.2);
        this.spec.size = this.rand(0.045, 0.09);
        this.spec.endSize = this.spec.size * 0.6;
        this.spec.lifeSeconds = this.rand(0.35, 0.65);
        this.spec.colorStart = VFX_PALETTE.gore;
        this.spec.colorEnd = VFX_PALETTE.goreDark;
        this.spec.gravity = -18;
        this.spec.spin = 9;
        this.spec.bounce = 0.12;
        this.spec.stick = true;
        this.lit.spawn(this.take());
      }
      // A bright arcade spark sells a solid connection without increasing gore.
      const sparks = this.count(3, detail);
      for (let i = 0; i < sparks; i++) {
        const speed = this.rand(4, 10);
        this.reset0();
        this.spec.x = x;
        this.spec.y = y;
        this.spec.z = z;
        this.spec.vx = dirX * speed + this.randSigned(2.4);
        this.spec.vy = dirY * speed + this.rand(1, 4);
        this.spec.vz = dirZ * speed + this.randSigned(2.4);
        this.spec.size = this.rand(0.025, 0.05);
        this.spec.endSize = 0.008;
        this.spec.lifeSeconds = this.rand(0.14, 0.28);
        this.spec.colorStart = VFX_PALETTE.sparkHot;
        this.spec.colorEnd = VFX_PALETTE.ember;
        this.spec.gravity = -13;
        this.spec.spin = 14;
        this.spec.bounce = 0.32;
        this.glow.spawn(this.take());
      }
      this.flash(x, y, z, 0.28, 0.09, VFX_PALETTE.sparkHot);
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

  /** Small rapid-fire contact: a clean spark puff, with a dust tick on dirt. */
  private turretImpact(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    terrain: boolean,
    detail: number,
  ): void {
    this.flash(x, y, z, 0.14, 0.045, VFX_PALETTE.sparkHot);
    const sparks = this.count(terrain ? 3 : 2, detail);
    for (let i = 0; i < sparks; i++) {
      const speed = this.rand(2.5, 6);
      this.reset0();
      this.spec.x = x;
      this.spec.y = y;
      this.spec.z = z;
      this.spec.vx = -dirX * speed + this.randSigned(1.2);
      this.spec.vy = -dirY * speed + this.rand(0.2, 1.8);
      this.spec.vz = -dirZ * speed + this.randSigned(1.2);
      this.spec.size = this.rand(0.018, 0.035);
      this.spec.endSize = 0.004;
      this.spec.lifeSeconds = this.rand(0.06, 0.12);
      this.spec.colorStart = VFX_PALETTE.sparkHot;
      this.spec.colorEnd = VFX_PALETTE.ember;
      this.spec.gravity = -9;
      this.spec.spin = 11;
      this.glow.spawn(this.take());
    }
    if (!terrain) return;
    this.reset0();
    this.spec.x = x;
    this.spec.y = y;
    this.spec.z = z;
    this.spec.vx = -dirX * 0.5 + this.randSigned(0.5);
    this.spec.vy = this.rand(0.3, 0.8);
    this.spec.vz = -dirZ * 0.5 + this.randSigned(0.5);
    this.spec.size = 0.045;
    this.spec.endSize = 0.11;
    this.spec.lifeSeconds = 0.16;
    this.spec.colorStart = VFX_PALETTE.dust;
    this.spec.colorEnd = VFX_PALETTE.smokeDark;
    this.spec.gravity = 0.4;
    this.spec.drag = 3;
    this.lit.spawn(this.take());
  }

  /** Heavy shell contact reinforces the splash with a direct flash and chunks. */
  private cannonImpact(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    terrain: boolean,
    detail: number,
  ): void {
    this.flash(x, y + 0.08, z, 0.62, 0.13, VFX_PALETTE.sparkHot);
    const debris = this.count(terrain ? 7 : 5, detail);
    for (let i = 0; i < debris; i++) {
      const speed = this.rand(3, 9);
      this.reset0();
      this.spec.x = x + this.randSigned(0.12);
      this.spec.y = y + this.rand(0, 0.2);
      this.spec.z = z + this.randSigned(0.12);
      this.spec.vx = -dirX * speed + this.randSigned(3.5);
      this.spec.vy = -dirY * speed + this.rand(3, 8);
      this.spec.vz = -dirZ * speed + this.randSigned(3.5);
      this.spec.size = this.rand(0.075, 0.16);
      this.spec.endSize = this.spec.size * 0.72;
      this.spec.lifeSeconds = this.rand(0.45, 0.9);
      this.spec.colorStart = terrain ? VFX_PALETTE.dust : VFX_PALETTE.ember;
      this.spec.colorEnd = VFX_PALETTE.smokeDark;
      this.spec.gravity = -18;
      this.spec.spin = 12;
      this.spec.bounce = 0.28;
      this.lit.spawn(this.take());
    }
  }

  /** Frost shards burst once, then pale motes drift slowly where the round hit. */
  private iceCannonImpact(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    terrain: boolean,
    detail: number,
  ): void {
    this.flash(x, y, z, terrain ? 0.26 : 0.22, 0.1, VFX_PALETTE.frost);
    const motes = this.count(terrain ? 9 : 7, detail);
    for (let i = 0; i < motes; i++) {
      const speed = this.rand(0.8, 3.5);
      this.reset0();
      this.spec.x = x + this.randSigned(0.08);
      this.spec.y = y + this.randSigned(0.08);
      this.spec.z = z + this.randSigned(0.08);
      this.spec.vx = -dirX * speed + this.randSigned(1.1);
      this.spec.vy = -dirY * speed + this.rand(0.15, 1.4);
      this.spec.vz = -dirZ * speed + this.randSigned(1.1);
      this.spec.size = this.rand(0.035, 0.075);
      this.spec.endSize = 0.012;
      this.spec.lifeSeconds = this.rand(0.75, 1.35);
      this.spec.colorStart = VFX_PALETTE.sparkHot;
      this.spec.colorEnd = VFX_PALETTE.iceDeep;
      this.spec.gravity = terrain ? -0.5 : 0.25;
      this.spec.drag = 2.8;
      this.spec.spin = 4;
      this.glow.spawn(this.take());
    }
  }

  /** A sniper hit is a narrow, high-contrast crack rather than a broad burst. */
  private sniperImpact(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    terrain: boolean,
    detail: number,
  ): void {
    this.flash(x, y, z, terrain ? 0.26 : 0.22, 0.055, VFX_PALETTE.frost);
    const cracks = this.count(terrain ? 5 : 4, detail);
    for (let i = 0; i < cracks; i++) {
      const speed = this.rand(12, 22);
      this.reset0();
      this.spec.x = x;
      this.spec.y = y;
      this.spec.z = z;
      this.spec.vx = dirX * speed + this.randSigned(0.35);
      this.spec.vy = dirY * speed + this.randSigned(0.35);
      this.spec.vz = dirZ * speed + this.randSigned(0.35);
      this.spec.size = this.rand(0.012, 0.025);
      this.spec.endSize = 0.002;
      this.spec.lifeSeconds = this.rand(0.05, 0.11);
      this.spec.colorStart = VFX_PALETTE.frost;
      this.spec.colorEnd = VFX_PALETTE.sparkHot;
      this.spec.gravity = 0;
      this.spec.drag = 5;
      this.spec.spin = 0;
      this.glow.spawn(this.take());
    }
  }

  /** Flame ends in soft, short-lived light with no hard projectile particles. */
  private flameImpact(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    detail: number,
  ): void {
    const licks = this.count(3, detail);
    for (let i = 0; i < licks; i++) {
      this.reset0();
      this.spec.x = x + this.randSigned(0.1);
      this.spec.y = y + this.randSigned(0.08);
      this.spec.z = z + this.randSigned(0.1);
      this.spec.vx = dirX * this.rand(1, 3) + this.randSigned(0.8);
      this.spec.vy = dirY * this.rand(1, 3) + this.rand(0.6, 1.8);
      this.spec.vz = dirZ * this.rand(1, 3) + this.randSigned(0.8);
      this.spec.size = this.rand(0.1, 0.17);
      this.spec.endSize = this.rand(0.2, 0.3);
      this.spec.lifeSeconds = this.rand(0.08, 0.16);
      this.spec.colorStart = VFX_PALETTE.frost;
      this.spec.colorEnd = VFX_PALETTE.emberDark;
      this.spec.gravity = 1.8;
      this.spec.drag = 4;
      this.spec.spin = 3;
      this.glow.spawn(this.take());
    }
  }

  /** Shield bounces retain a small colour accent from the round that hit it. */
  private weaponShieldImpact(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    detail: number,
    accent: number,
  ): void {
    const shards = this.count(5, detail);
    for (let i = 0; i < shards; i++) {
      const speed = this.rand(3, 8);
      this.reset0();
      this.spec.x = x;
      this.spec.y = y;
      this.spec.z = z;
      this.spec.vx = -dirX * speed + this.randSigned(1.6);
      this.spec.vy = -dirY * speed + this.rand(0.3, 2.2);
      this.spec.vz = -dirZ * speed + this.randSigned(1.6);
      this.spec.size = this.rand(0.025, 0.055);
      this.spec.endSize = 0.008;
      this.spec.lifeSeconds = this.rand(0.12, 0.26);
      this.spec.colorStart = accent;
      this.spec.colorEnd = VFX_PALETTE.shield;
      this.spec.gravity = -4;
      this.spec.spin = 10;
      this.glow.spawn(this.take());
    }
    this.flash(x, y, z, 0.24, 0.06, VFX_PALETTE.shield);
  }

  /**
   * Flamethrower body: the fire itself, built along one ray of the cone.
   *
   * Four ingredients sell a voxel flame — fast white licks at the nozzle, fat
   * rolling puffs that expand and cool as they travel, embers that separate
   * and float up, and greasy smoke off the far end. Each ray of the cone plays
   * a thinner version of the same recipe, so the six rays composite into one
   * body of fire rather than six visible lines.
   *
   * `hellfire` is the overcharged spray (the flamethrower's ability): the same
   * recipe run hotter and heavier, in yellow and red rather than the stock
   * white-to-orange, plus a rolling red underbody and a spray of yellow sparks
   * the normal nozzle never throws.
   */
  flameJet(from: Vector3Like, to: Vector3Like, hellfire = false): void {
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
    const puffs = this.count(hellfire ? 7 : 4, detail);
    for (let i = 0; i < puffs; i++) {
      const along = Math.random() * 0.65 * range;
      const speed = this.rand(4, 11);
      this.reset0();
      this.spec.x = from.x + dirX * along + this.randSigned(hellfire ? 0.3 : 0.18);
      this.spec.y = from.y + dirY * along + this.randSigned(hellfire ? 0.3 : 0.18);
      this.spec.z = from.z + dirZ * along + this.randSigned(hellfire ? 0.3 : 0.18);
      this.spec.vx = dirX * speed + this.randSigned(1.6);
      this.spec.vy = dirY * speed + this.rand(0.4, 1.8);
      this.spec.vz = dirZ * speed + this.randSigned(1.6);
      this.spec.size = this.rand(0.12, 0.2);
      this.spec.endSize = hellfire ? this.rand(0.5, 0.8) : this.rand(0.36, 0.55);
      this.spec.lifeSeconds = hellfire
        ? this.rand(0.26, 0.5)
        : this.rand(0.18, 0.36);
      // Hellfire's puffs start yellow instead of near-white and die red rather
      // than brown, which is what turns the whole cone from orange to fire.
      this.spec.colorStart = hellfire
        ? VFX_PALETTE.hellYellow
        : VFX_PALETTE.sparkHot;
      this.spec.colorEnd = hellfire
        ? VFX_PALETTE.hellRed
        : VFX_PALETTE.emberDark;
      this.spec.gravity = 2.2;
      this.spec.drag = 3.2;
      this.spec.spin = 3;
      this.glow.spawn(this.take());
    }

    // Licks: the hot white core, only near the nozzle and gone almost at once.
    const licks = this.count(hellfire ? 4 : 2, detail);
    for (let i = 0; i < licks; i++) {
      const speed = this.rand(12, 22);
      this.reset0();
      this.spec.x = from.x + dirX * this.rand(0.1, 0.8);
      this.spec.y = from.y + dirY * this.rand(0.1, 0.8);
      this.spec.z = from.z + dirZ * this.rand(0.1, 0.8);
      this.spec.vx = dirX * speed + this.randSigned(1);
      this.spec.vy = dirY * speed + this.randSigned(1);
      this.spec.vz = dirZ * speed + this.randSigned(1);
      this.spec.size = hellfire ? this.rand(0.11, 0.19) : this.rand(0.08, 0.14);
      this.spec.endSize = hellfire ? 0.32 : 0.22;
      this.spec.lifeSeconds = this.rand(0.08, 0.16);
      this.spec.colorStart = 0xffffff;
      this.spec.colorEnd = hellfire ? VFX_PALETTE.hellAmber : VFX_PALETTE.ember;
      this.spec.gravity = 1;
      this.spec.drag = 2;
      this.spec.spin = 4;
      this.glow.spawn(this.take());
    }

    // Hellfire only: a slow red underbody rolling beneath the yellow core, and
    // yellow sparks shed sideways off the cone. Together they give the
    // overcharge the two colours the stock jet never separates out.
    if (hellfire) {
      const underbody = this.count(4, detail);
      for (let i = 0; i < underbody; i++) {
        const along = Math.random() * 0.85 * range;
        const speed = this.rand(2.5, 6);
        this.reset0();
        this.spec.x = from.x + dirX * along + this.randSigned(0.34);
        this.spec.y = from.y + dirY * along + this.rand(-0.32, 0.05);
        this.spec.z = from.z + dirZ * along + this.randSigned(0.34);
        this.spec.vx = dirX * speed + this.randSigned(1.2);
        this.spec.vy = this.rand(-0.2, 0.9);
        this.spec.vz = dirZ * speed + this.randSigned(1.2);
        this.spec.size = this.rand(0.2, 0.34);
        this.spec.endSize = this.rand(0.6, 0.95);
        this.spec.lifeSeconds = this.rand(0.35, 0.62);
        this.spec.colorStart = VFX_PALETTE.hellRed;
        this.spec.colorEnd = VFX_PALETTE.hellRedDark;
        this.spec.gravity = 1.2;
        this.spec.drag = 2.6;
        this.spec.spin = 2;
        this.glow.spawn(this.take());
      }

      const sparks = this.count(3, detail);
      for (let i = 0; i < sparks; i++) {
        const along = Math.random() * range;
        const speed = this.rand(3, 9);
        this.reset0();
        this.spec.x = from.x + dirX * along;
        this.spec.y = from.y + dirY * along + this.randSigned(0.2);
        this.spec.z = from.z + dirZ * along;
        this.spec.vx = -dirZ * this.randSigned(speed) + this.randSigned(1.5);
        this.spec.vy = this.rand(1.5, 4.5);
        this.spec.vz = dirX * this.randSigned(speed) + this.randSigned(1.5);
        this.spec.size = this.rand(0.05, 0.09);
        this.spec.endSize = 0.02;
        this.spec.lifeSeconds = this.rand(0.3, 0.7);
        this.spec.colorStart = VFX_PALETTE.hellYellow;
        this.spec.colorEnd = VFX_PALETTE.hellRed;
        this.spec.gravity = 3.2;
        this.spec.drag = 1;
        this.spec.spin = 9;
        this.glow.spawn(this.take());
      }
    }

    // Embers break off the cone and drift upward well after the fire has gone.
    const embers = this.count(hellfire ? 4 : 2, detail);
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
      this.spec.colorStart = hellfire
        ? VFX_PALETTE.hellYellow
        : VFX_PALETTE.spark;
      this.spec.colorEnd = hellfire
        ? VFX_PALETTE.hellRedDark
        : VFX_PALETTE.emberDark;
      this.spec.gravity = 1.8;
      this.spec.drag = 1.2;
      this.spec.spin = 8;
      this.glow.spawn(this.take());
    }

    // Greasy smoke off the head of the cone, on the lit layer so it reads as
    // matter blocking the moonlight rather than as more light.
    const smoke = this.count(hellfire ? 2.5 : 1.5, detail);
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
      // Overcharged smoke leaves the head of the cone still glowing red before
      // it cools, so the far end of the spray never looks clean.
      this.spec.colorStart = hellfire
        ? VFX_PALETTE.hellRedDark
        : VFX_PALETTE.smoke;
      this.spec.colorEnd = VFX_PALETTE.smokeDark;
      this.spec.gravity = 1.5;
      this.spec.drag = 2.2;
      this.spec.spin = 1.5;
      this.lit.spawn(this.take());
    }
  }

  /**
   * The nozzle itself: a fat ball of ignition rather than a powder flash, with
   * a pilot glow that sits on the barrel for a beat after the burst. An
   * overcharged nozzle adds a wide yellow bloom over the top of it and burns
   * its ignition down through red instead of brown.
   */
  private flameMuzzle(
    from: Vector3Like,
    dirX: number,
    dirY: number,
    dirZ: number,
    detail: number,
    hellfire = false,
  ): void {
    this.flash(
      from.x + dirX * 0.25,
      from.y + dirY * 0.25,
      from.z + dirZ * 0.25,
      hellfire ? 0.62 : 0.44,
      hellfire ? 0.13 : 0.09,
      0xffffff,
    );
    if (hellfire) {
      this.flash(
        from.x + dirX * 0.5,
        from.y + dirY * 0.5,
        from.z + dirZ * 0.5,
        0.9,
        0.18,
        VFX_PALETTE.hellYellow,
      );
    }

    const ignition = this.count(hellfire ? 10 : 6, detail);
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
      this.spec.endSize = hellfire ? this.rand(0.42, 0.62) : this.rand(0.3, 0.46);
      this.spec.lifeSeconds = this.rand(0.12, 0.26);
      this.spec.colorStart = 0xffffff;
      this.spec.colorEnd = hellfire
        ? VFX_PALETTE.hellRed
        : VFX_PALETTE.emberDark;
      this.spec.gravity = 2;
      this.spec.drag = 3.4;
      this.spec.spin = 4;
      this.glow.spawn(this.take());
    }
  }

  /**
   * Something caught fire: flames climbing off it, a couple of burning scraps
   * that drop and smoulder where they land, and a wisp of smoke. Hellfire
   * doubles the flames and burns them yellow-to-red, so a zombie caught in the
   * overcharge is visibly cooking rather than merely singed.
   */
  private burnImpact(
    x: number,
    y: number,
    z: number,
    detail: number,
    hellfire = false,
  ): void {
    const flames = this.count(hellfire ? 10 : 5, detail);
    for (let i = 0; i < flames; i++) {
      this.reset0();
      this.spec.x = x + this.randSigned(hellfire ? 0.32 : 0.22);
      this.spec.y = y + this.rand(-0.2, 0.3);
      this.spec.z = z + this.randSigned(hellfire ? 0.32 : 0.22);
      this.spec.vx = this.randSigned(0.9);
      this.spec.vy = this.rand(1.6, hellfire ? 5 : 3.6);
      this.spec.vz = this.randSigned(0.9);
      this.spec.size = hellfire ? this.rand(0.14, 0.26) : this.rand(0.1, 0.18);
      this.spec.endSize = this.rand(0.02, 0.06);
      this.spec.lifeSeconds = hellfire
        ? this.rand(0.4, 0.8)
        : this.rand(0.3, 0.6);
      this.spec.colorStart = hellfire
        ? VFX_PALETTE.hellYellow
        : VFX_PALETTE.sparkHot;
      this.spec.colorEnd = hellfire
        ? VFX_PALETTE.hellRed
        : VFX_PALETTE.emberDark;
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

    this.flash(
      x,
      y + 0.15,
      z,
      hellfire ? 0.46 : 0.28,
      hellfire ? 0.12 : 0.08,
      hellfire ? VFX_PALETTE.hellYellow : VFX_PALETTE.ember,
    );
    if (hellfire) this.flash(x, y + 0.1, z, 0.7, 0.2, VFX_PALETTE.hellRed);
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
      const angle =
        (i / Math.max(1, ring)) * Math.PI * 2 + this.randSigned(0.2);
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

  // --------------------------------------------------------------- freeze ---

  /**
   * Ice Cannon Q ability: a cold front rolling off the vehicle. The blast
   * counterpart with nothing hot in it — a rime ring that stops exactly on the
   * freeze radius so one activation teaches the player the ability's reach,
   * mist that sinks instead of rising, and crystals that fall back as frost.
   */
  freezeBurst(x: number, y: number, z: number, radiusM: number): void {
    if (this.disposed || radiusM <= 0) return;
    const detail = this.detailAt(x, y, z);
    if (detail <= 0) return;

    this.flash(x, y + 0.4, z, radiusM * 0.3, 0.12, VFX_PALETTE.frost);
    this.flash(x, y + 0.5, z, radiusM * 0.55, 0.3, VFX_PALETTE.ice);

    const ring = this.count(24, detail);
    for (let i = 0; i < ring; i++) {
      const angle =
        (i / Math.max(1, ring)) * Math.PI * 2 + this.randSigned(0.15);
      // Reach the rim inside the particle's life, so the ring stops where the
      // freeze does rather than sailing past it.
      const life = this.rand(0.4, 0.6);
      const speed = (radiusM / life) * this.rand(0.8, 1);
      this.reset0();
      this.spec.x = x + Math.cos(angle) * 0.3;
      this.spec.y = y + 0.12;
      this.spec.z = z + Math.sin(angle) * 0.3;
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = this.rand(0.3, 1.4);
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.13, 0.24);
      this.spec.endSize = 0.03;
      this.spec.lifeSeconds = life;
      this.spec.colorStart = VFX_PALETTE.frost;
      this.spec.colorEnd = VFX_PALETTE.iceDeep;
      this.spec.gravity = 0;
      this.spec.drag = 0.7;
      this.spec.spin = 7;
      this.glow.spawn(this.take());
    }

    const mist = this.count(11, detail);
    for (let i = 0; i < mist; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = this.rand(2, 6);
      this.reset0();
      this.spec.x = x + this.randSigned(0.4);
      this.spec.y = y + this.rand(0.4, 1.1);
      this.spec.z = z + this.randSigned(0.4);
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = this.rand(-0.6, 0.4);
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.22, 0.4);
      this.spec.endSize = this.spec.size * this.rand(2, 3);
      this.spec.lifeSeconds = this.rand(0.6, 1.1);
      this.spec.colorStart = VFX_PALETTE.frost;
      this.spec.colorEnd = VFX_PALETTE.iceDeep;
      this.spec.gravity = -1.2;
      this.spec.drag = 2.4;
      this.spec.spin = 1;
      this.glow.spawn(this.take());
    }

    const crystals = this.count(10, detail);
    for (let i = 0; i < crystals; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = this.rand(2, 7);
      this.reset0();
      this.spec.x = x;
      this.spec.y = y + 0.2;
      this.spec.z = z;
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = this.rand(2.5, 6);
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.07, 0.14);
      this.spec.endSize = this.spec.size * 0.7;
      this.spec.lifeSeconds = this.rand(0.8, 1.4);
      this.spec.colorStart = VFX_PALETTE.ice;
      this.spec.colorEnd = VFX_PALETTE.iceDeep;
      this.spec.gravity = -14;
      this.spec.spin = 9;
      this.spec.bounce = 0.25;
      this.spec.stick = true;
      this.lit.spawn(this.take());
    }
  }

  /**
   * One zombie caught by a freeze: shards rush inward and lock around it. The
   * converging direction is what separates this from every other burst in the
   * game — everything else throws matter away from the point.
   */
  freezeEncase(x: number, y: number, z: number): void {
    if (this.disposed) return;
    const detail = this.detailAt(x, y, z);
    if (detail <= 0) return;

    const shards = this.count(12, detail);
    for (let i = 0; i < shards; i++) {
      const angle = (i / Math.max(1, shards)) * Math.PI * 2 + this.rand(0, 0.4);
      const radius = this.rand(1.1, 1.9);
      const life = this.rand(0.16, 0.26);
      const height = this.randSigned(0.7);
      this.reset0();
      this.spec.x = x + Math.cos(angle) * radius;
      this.spec.y = y + height;
      this.spec.z = z + Math.sin(angle) * radius;
      this.spec.vx = (-Math.cos(angle) * radius) / life;
      this.spec.vy = -height / life;
      this.spec.vz = (-Math.sin(angle) * radius) / life;
      this.spec.size = this.rand(0.09, 0.17);
      this.spec.endSize = 0.02;
      this.spec.lifeSeconds = life;
      this.spec.colorStart = VFX_PALETTE.frost;
      this.spec.colorEnd = VFX_PALETTE.ice;
      this.spec.gravity = 0;
      this.spec.spin = 10;
      this.glow.spawn(this.take());
    }
    this.flash(x, y, z, 0.7, 0.14, VFX_PALETTE.ice);
  }

  /** A freeze ended, or its host died inside the ice: the shell bursts. */
  frostShatter(x: number, y: number, z: number): void {
    if (this.disposed) return;
    const detail = this.detailAt(x, y, z);
    if (detail <= 0) return;

    const shards = this.count(14, detail);
    for (let i = 0; i < shards; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = this.rand(2.5, 7);
      this.reset0();
      this.spec.x = x + this.randSigned(0.3);
      this.spec.y = y + this.randSigned(0.6);
      this.spec.z = z + this.randSigned(0.3);
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = this.rand(1, 4.5);
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.06, 0.13);
      this.spec.endSize = this.spec.size * 0.5;
      this.spec.lifeSeconds = this.rand(0.4, 0.8);
      this.spec.colorStart = VFX_PALETTE.frost;
      this.spec.colorEnd = VFX_PALETTE.iceDeep;
      this.spec.gravity = -16;
      this.spec.spin = 13;
      this.spec.bounce = 0.35;
      this.glow.spawn(this.take());
    }
    this.flash(x, y, z, 0.45, 0.1, VFX_PALETTE.frost);
  }

  // ------------------------------------------------------------ abilities ---

  /**
   * Shield ability coming up: the bubble snaps into being. Cubes rush *outward*
   * to the bubble's skin and stop there, so the effect reads as a surface being
   * drawn rather than as an explosion — nothing here is thrown loose.
   */
  shieldRaise(x: number, y: number, z: number, radiusM: number): void {
    if (this.disposed || radiusM <= 0) return;
    const detail = this.detailAt(x, y, z);
    if (detail <= 0) return;

    this.flash(x, y + 0.5, z, radiusM * 0.7, 0.12, 0xffffff);
    this.flash(x, y + 0.5, z, radiusM * 1.25, 0.26, VFX_PALETTE.shield);

    // Skin: a band of cubes that arrive on the bubble's radius as it inflates.
    const skin = this.count(26, detail);
    for (let i = 0; i < skin; i++) {
      const angle = (i / Math.max(1, skin)) * Math.PI * 2 + this.randSigned(0.2);
      const lift = this.rand(-0.5, 1.4);
      const life = this.rand(0.3, 0.45);
      const speed = (radiusM / life) * this.rand(0.85, 1);
      this.reset0();
      this.spec.x = x;
      this.spec.y = y + 0.5 + lift * 0.3;
      this.spec.z = z;
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = lift;
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.14, 0.26);
      this.spec.endSize = 0.04;
      this.spec.lifeSeconds = life;
      this.spec.colorStart = 0xffffff;
      this.spec.colorEnd = VFX_PALETTE.shield;
      this.spec.gravity = 0;
      this.spec.drag = 2.6;
      this.spec.spin = 3;
      this.glow.spawn(this.take());
    }

    // Charge motes climbing the emitter, to sell where the bubble came from.
    const motes = this.count(9, detail);
    for (let i = 0; i < motes; i++) {
      const angle = Math.random() * Math.PI * 2;
      this.reset0();
      this.spec.x = x + Math.cos(angle) * this.rand(0.2, 0.9);
      this.spec.y = y - 0.2;
      this.spec.z = z + Math.sin(angle) * this.rand(0.2, 0.9);
      this.spec.vy = this.rand(3, 6.5);
      this.spec.size = this.rand(0.06, 0.12);
      this.spec.endSize = 0.02;
      this.spec.lifeSeconds = this.rand(0.35, 0.6);
      this.spec.colorStart = VFX_PALETTE.shield;
      this.spec.colorEnd = 0x0b3f66;
      this.spec.gravity = 0;
      this.spec.drag = 1.6;
      this.spec.spin = 5;
      this.glow.spawn(this.take());
    }
  }

  /** Shield ability running out: the skin lets go and falls apart. */
  shieldCollapse(x: number, y: number, z: number, radiusM: number): void {
    if (this.disposed || radiusM <= 0) return;
    const detail = this.detailAt(x, y, z);
    if (detail <= 0) return;

    const shards = this.count(16, detail);
    for (let i = 0; i < shards; i++) {
      const angle = (i / Math.max(1, shards)) * Math.PI * 2;
      const height = this.rand(0.1, 1.6);
      this.reset0();
      this.spec.x = x + Math.cos(angle) * radiusM * 0.9;
      this.spec.y = y + height;
      this.spec.z = z + Math.sin(angle) * radiusM * 0.9;
      this.spec.vx = Math.cos(angle) * this.rand(0.4, 1.6);
      this.spec.vy = this.rand(-0.5, 0.8);
      this.spec.vz = Math.sin(angle) * this.rand(0.4, 1.6);
      this.spec.size = this.rand(0.1, 0.2);
      this.spec.endSize = 0.02;
      this.spec.lifeSeconds = this.rand(0.3, 0.55);
      this.spec.colorStart = VFX_PALETTE.shield;
      this.spec.colorEnd = 0x0b3f66;
      this.spec.gravity = -3.5;
      this.spec.drag = 1.2;
      this.spec.spin = 6;
      this.glow.spawn(this.take());
    }
  }

  /**
   * Pulse ability: a ring of force, not of fire. Everything travels flat and
   * outward and dies on the damage radius — the one blast in the game with no
   * ember in it, so the player never confuses it with an explosion.
   */
  pulseRing(x: number, y: number, z: number, radiusM: number): void {
    if (this.disposed || radiusM <= 0) return;
    const detail = this.detailAt(x, y, z);
    if (detail <= 0) return;

    this.flash(x, y + 0.3, z, radiusM * 0.5, 0.1, 0xffffff);
    this.flash(x, y + 0.35, z, radiusM * 0.95, 0.2, VFX_PALETTE.steel);

    const ring = this.count(30, detail);
    for (let i = 0; i < ring; i++) {
      const angle =
        (i / Math.max(1, ring)) * Math.PI * 2 + this.randSigned(0.12);
      // Stop on the rim inside one life, so the ring draws the exact reach.
      const life = this.rand(0.24, 0.34);
      const speed = (radiusM / life) * this.rand(0.85, 1);
      this.reset0();
      this.spec.x = x + Math.cos(angle) * 0.25;
      this.spec.y = y + 0.14;
      this.spec.z = z + Math.sin(angle) * 0.25;
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = this.rand(0.1, 0.7);
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.18, 0.3);
      this.spec.endSize = 0.03;
      this.spec.lifeSeconds = life;
      this.spec.colorStart = 0xffffff;
      this.spec.colorEnd = VFX_PALETTE.steel;
      this.spec.gravity = 0;
      this.spec.drag = 1.1;
      this.spec.spin = 4;
      this.glow.spawn(this.take());
    }

    // Dirt kicked up under the ring, so the ground registers the slam.
    const dust = this.count(12, detail);
    for (let i = 0; i < dust; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = this.rand(3, 9);
      this.reset0();
      this.spec.x = x + Math.cos(angle) * this.rand(0.3, 1.2);
      this.spec.y = y + 0.1;
      this.spec.z = z + Math.sin(angle) * this.rand(0.3, 1.2);
      this.spec.vx = Math.cos(angle) * speed;
      this.spec.vy = this.rand(1.2, 3.6);
      this.spec.vz = Math.sin(angle) * speed;
      this.spec.size = this.rand(0.2, 0.36);
      this.spec.endSize = this.spec.size * this.rand(1.8, 2.6);
      this.spec.lifeSeconds = this.rand(0.5, 0.95);
      this.spec.colorStart = VFX_PALETTE.dust;
      this.spec.colorEnd = VFX_PALETTE.smokeDark;
      this.spec.gravity = -2.4;
      this.spec.drag = 2.2;
      this.spec.spin = 2;
      this.lit.spawn(this.take());
    }
  }

  /**
   * Overdrive kicking in: a hard shove of exhaust out the back of the rig.
   * `dirX/dirZ` is the vehicle's normalised forward heading — the flare fires
   * against it, so the boost reads as thrust.
   */
  overdriveBurst(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
  ): void {
    if (this.disposed) return;
    const detail = this.detailAt(x, y, z);
    if (detail <= 0) return;

    this.flash(x - dirX, y + 0.3, z - dirZ, 1.4, 0.1, 0xffffff);
    this.flash(x - dirX * 1.4, y + 0.35, z - dirZ * 1.4, 2.6, 0.2, VFX_PALETTE.sparkHot);

    const jet = this.count(26, detail);
    for (let i = 0; i < jet; i++) {
      const spread = this.randSigned(0.5);
      const speed = this.rand(11, 24);
      this.reset0();
      this.spec.x = x - dirX * this.rand(0.6, 1.4);
      this.spec.y = y + this.rand(0.1, 0.6);
      this.spec.z = z - dirZ * this.rand(0.6, 1.4);
      this.spec.vx = -dirX * speed + dirZ * spread * speed * 0.3;
      this.spec.vy = this.rand(0.5, 2.5);
      this.spec.vz = -dirZ * speed - dirX * spread * speed * 0.3;
      this.spec.size = this.rand(0.12, 0.24);
      this.spec.endSize = 0.03;
      this.spec.lifeSeconds = this.rand(0.25, 0.45);
      this.spec.colorStart = 0xffffff;
      this.spec.colorEnd = VFX_PALETTE.ember;
      this.spec.gravity = 1.2;
      this.spec.drag = 2.6;
      this.spec.spin = 6;
      this.glow.spawn(this.take());
    }
  }

  /**
   * Overdrive still running: a thin trail behind the rig. Deliberately a few
   * particles per call — this is ticked every frame for the whole surge, so it
   * has to cost about as little as a muzzle flash does once.
   */
  overdriveTrail(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
  ): void {
    if (this.disposed) return;
    const detail = this.detailAt(x, y, z);
    if (detail <= 0) return;

    const puffs = this.count(3, detail);
    for (let i = 0; i < puffs; i++) {
      const speed = this.rand(3, 7);
      this.reset0();
      this.spec.x = x - dirX * this.rand(0.7, 1.5) + this.randSigned(0.25);
      this.spec.y = y + this.rand(0.05, 0.5);
      this.spec.z = z - dirZ * this.rand(0.7, 1.5) + this.randSigned(0.25);
      this.spec.vx = -dirX * speed;
      this.spec.vy = this.rand(0.4, 1.6);
      this.spec.vz = -dirZ * speed;
      this.spec.size = this.rand(0.1, 0.2);
      this.spec.endSize = this.spec.size * this.rand(1.4, 2.2);
      this.spec.lifeSeconds = this.rand(0.2, 0.4);
      this.spec.colorStart = VFX_PALETTE.spark;
      this.spec.colorEnd = VFX_PALETTE.emberDark;
      this.spec.gravity = 1.4;
      this.spec.drag = 2.4;
      this.spec.spin = 4;
      this.glow.spawn(this.take());
    }
  }

  /**
   * One end of a phase blink: a flat ring of displaced air that reads as the
   * rig being pulled out of (or shoved back into) the world. `dirX/dirZ` is the
   * vehicle's normalised heading — particles run along it, so the departure and
   * the arrival both point the way the blink went.
   *
   * Deliberately cold and colourless next to nitro's exhaust: the two abilities
   * both move the rig forward, and they must never be confused on screen.
   */
  phaseBurst(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
  ): void {
    if (this.disposed) return;
    const detail = this.detailAt(x, y, z);
    if (detail <= 0) return;

    this.flash(x, y + 0.4, z, 1.2, 0.08, VFX_PALETTE.frost);
    this.flash(x, y + 0.45, z, 2.4, 0.16, VFX_PALETTE.shield);

    const shards = this.count(20, detail);
    for (let i = 0; i < shards; i++) {
      // Sideways off the heading: the rig's own volume folding outward as it
      // leaves, rather than a jet coming off a nozzle.
      const lateral = this.randSigned(1);
      const speed = this.rand(4, 11);
      this.reset0();
      this.spec.x = x + dirZ * lateral * 0.9 + dirX * this.randSigned(1.2);
      this.spec.y = y + this.rand(0.05, 0.9);
      this.spec.z = z - dirX * lateral * 0.9 + dirZ * this.randSigned(1.2);
      this.spec.vx = dirZ * lateral * speed + dirX * this.rand(0.5, 3);
      this.spec.vy = this.rand(0.4, 2.2);
      this.spec.vz = -dirX * lateral * speed + dirZ * this.rand(0.5, 3);
      this.spec.size = this.rand(0.1, 0.22);
      this.spec.endSize = 0.02;
      this.spec.lifeSeconds = this.rand(0.18, 0.36);
      this.spec.colorStart = VFX_PALETTE.frost;
      this.spec.colorEnd = VFX_PALETTE.shield;
      this.spec.gravity = 0;
      this.spec.drag = 3.2;
      this.spec.spin = 7;
      this.glow.spawn(this.take());
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
