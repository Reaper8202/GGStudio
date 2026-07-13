/**
 * Lightweight pooled particle effects + a tiny procedural audio hook.
 * Owned by Agent C (Combat).
 *
 * - A fixed pool of small cube "particle" meshes is reused for every burst
 *   (zombie death, projectile/ram impact, vehicle damage flash) — no
 *   per-frame allocations once the pool is built.
 * - Sounds are short generated WebAudio oscillator blips (no external
 *   assets). The `AudioContext` is created lazily on the first user gesture
 *   (pointerdown/keydown) per browser autoplay policy, and every play is
 *   gated on `state.muted`.
 */
import * as THREE from "three";
import type { GameContext, GameEvents, GameSystem, VehicleApi } from "../types";

const PARTICLE_POOL_SIZE = 48;
const PARTICLE_GEOMETRY = new THREE.BoxGeometry(0.14, 0.14, 0.14);
/** Simple downward acceleration so bursts arc and settle, purely cosmetic. */
const PARTICLE_GRAVITY = -9.8;

const DEATH_PARTICLE_COUNT = 9;
const DEATH_PARTICLE_COLOR = new THREE.Color(0x5c3a34);
const DEATH_PARTICLE_SPEED = 3.2;
const DEATH_PARTICLE_LIFE = 0.5;

const IMPACT_PARTICLE_COUNT = 4;
const IMPACT_PARTICLE_COLOR = new THREE.Color(0xd8d8c8);
const IMPACT_PARTICLE_SPEED = 2.2;
const IMPACT_PARTICLE_LIFE = 0.3;

const DAMAGE_PARTICLE_COUNT = 6;
const DAMAGE_PARTICLE_COLOR = new THREE.Color(0xff5533);
const DAMAGE_PARTICLE_SPEED = 2.6;
const DAMAGE_PARTICLE_LIFE = 0.35;

/** Tire dust: small ground-level puffs kicked up behind a fast-moving
 *  vehicle. Throttled by `TIRE_DUST_INTERVAL` (a few puffs/second max) and
 *  gated on `TIRE_DUST_MIN_SPEED` so idling/slow driving stays clean. */
const TIRE_DUST_MIN_SPEED = 6;
const TIRE_DUST_INTERVAL = 0.22;
const TIRE_DUST_PARTICLE_COUNT = 2;
const TIRE_DUST_COLOR = new THREE.Color(0xb9a888);
const TIRE_DUST_LIFE = 0.45;
/** How far behind the vehicle center the puff appears. */
const TIRE_DUST_BEHIND_OFFSET = 1.5;
const TIRE_DUST_SIDE_JITTER = 0.7;
const TIRE_DUST_UP_SPEED = 1.6;
const TIRE_DUST_DRIFT_SPEED = 0.8;

interface Particle {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  active: boolean;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export class EffectsSystem implements GameSystem {
  private readonly ctx: GameContext;
  private readonly vehicle: VehicleApi;

  private readonly pool: Particle[] = [];
  private nextFree = 0;

  private dustTimer = 0;
  private readonly scratchDust = new THREE.Vector3();

  private audioCtx: AudioContext | null = null;

  constructor(ctx: GameContext, vehicle: VehicleApi) {
    this.ctx = ctx;
    this.vehicle = vehicle;

    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
      const mesh = new THREE.Mesh(PARTICLE_GEOMETRY, material);
      mesh.visible = false;
      ctx.scene.add(mesh);
      this.pool.push({
        mesh,
        material,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        active: false,
      });
    }

    ctx.events.on("audio:play", this.handleAudioPlay);
    ctx.events.on("vehicle:damaged", this.handleVehicleDamaged);

    this.bindFirstGesture();
  }

  // ---------------------------------------------------------------------
  // Public particle hooks (called directly by Zombie/ZombieSystem/TurretSystem)
  // ---------------------------------------------------------------------

  spawnDeathPuff(position: THREE.Vector3): void {
    this.burst(position, DEATH_PARTICLE_COUNT, DEATH_PARTICLE_COLOR, DEATH_PARTICLE_SPEED, DEATH_PARTICLE_LIFE);
  }

  spawnImpactPuff(position: THREE.Vector3): void {
    this.burst(position, IMPACT_PARTICLE_COUNT, IMPACT_PARTICLE_COLOR, IMPACT_PARTICLE_SPEED, IMPACT_PARTICLE_LIFE);
  }

  // ---------------------------------------------------------------------
  // GameSystem (render-rate only — cosmetic, no gameplay determinism needed)
  // ---------------------------------------------------------------------

  update(dt: number): void {
    this.updateTireDust(dt);

    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.velocity.y += PARTICLE_GRAVITY * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      const t = clamp01(p.life / p.maxLife);
      p.material.opacity = t;
      p.mesh.scale.setScalar(0.4 + t * 0.6);
    }
  }

  reset(): void {
    for (const p of this.pool) {
      p.active = false;
      p.mesh.visible = false;
    }
    this.dustTimer = 0;
  }

  // ---------------------------------------------------------------------
  // Internals — particles
  // ---------------------------------------------------------------------

  /** Ground-level dust puffs behind a fast-moving vehicle, throttled to
   *  `1 / TIRE_DUST_INTERVAL` puffs per second. Reads speed/position/forward
   *  straight off the held `VehicleApi` reference — no new events, no
   *  allocations (scratch Vector3 + the shared particle pool). */
  private updateTireDust(dt: number): void {
    this.dustTimer = Math.max(0, this.dustTimer - dt);
    if (this.dustTimer > 0) return;
    if (this.vehicle.speed < TIRE_DUST_MIN_SPEED) return;

    this.dustTimer = TIRE_DUST_INTERVAL;

    // Spawn point: behind the vehicle along its facing, near the ground.
    const forward = this.vehicle.forward;
    const origin = this.scratchDust
      .copy(this.vehicle.position)
      .addScaledVector(forward, -TIRE_DUST_BEHIND_OFFSET);
    origin.y = 0.12;

    for (let i = 0; i < TIRE_DUST_PARTICLE_COUNT; i++) {
      const p = this.acquire();
      if (!p) return;

      p.active = true;
      p.life = TIRE_DUST_LIFE;
      p.maxLife = TIRE_DUST_LIFE;
      p.material.color.copy(TIRE_DUST_COLOR);
      p.material.opacity = 0.8;
      p.mesh.visible = true;
      p.mesh.scale.setScalar(1);
      // Small lateral jitter (right vector = (forward.z, 0, -forward.x)).
      const side = (Math.random() - 0.5) * 2 * TIRE_DUST_SIDE_JITTER;
      p.mesh.position.set(
        origin.x + forward.z * side,
        origin.y,
        origin.z - forward.x * side
      );
      // Gentle rise + a slight trail-back drift; PARTICLE_GRAVITY settles it.
      p.velocity.set(
        -forward.x * TIRE_DUST_DRIFT_SPEED + (Math.random() - 0.5) * 0.6,
        TIRE_DUST_UP_SPEED * (0.7 + Math.random() * 0.6),
        -forward.z * TIRE_DUST_DRIFT_SPEED + (Math.random() - 0.5) * 0.6
      );
    }
  }

  private burst(
    position: THREE.Vector3,
    count: number,
    color: THREE.Color,
    speed: number,
    life: number
  ): void {
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      if (!p) return; // pool exhausted; drop the remainder of this burst

      p.active = true;
      p.life = life;
      p.maxLife = life;
      p.material.color.copy(color);
      p.material.opacity = 1;
      p.mesh.visible = true;
      p.mesh.position.copy(position);
      p.mesh.scale.setScalar(1);

      const angle = Math.random() * Math.PI * 2;
      const outSpeed = speed * (0.5 + Math.random() * 0.5);
      const upSpeed = 1.5 + Math.random() * speed * 0.6;
      p.velocity.set(Math.cos(angle) * outSpeed, upSpeed, Math.sin(angle) * outSpeed);
    }
  }

  private acquire(): Particle | null {
    for (let i = 0; i < this.pool.length; i++) {
      const idx = (this.nextFree + i) % this.pool.length;
      if (!this.pool[idx].active) {
        this.nextFree = (idx + 1) % this.pool.length;
        return this.pool[idx];
      }
    }
    return null;
  }

  private readonly handleVehicleDamaged = (payload: GameEvents["vehicle:damaged"]): void => {
    // Only zombie-attack damage gets a hit-flash burst here; collision
    // damage already has its own camera shake (impact:major) + chassis
    // emissive flash owned by the vehicle system.
    if (payload.source !== "zombie") return;
    this.burst(
      this.vehicle.position,
      DAMAGE_PARTICLE_COUNT,
      DAMAGE_PARTICLE_COLOR,
      DAMAGE_PARTICLE_SPEED,
      DAMAGE_PARTICLE_LIFE
    );
  };

  // ---------------------------------------------------------------------
  // Internals — audio (procedural, no external assets, gesture-gated)
  // ---------------------------------------------------------------------

  private bindFirstGesture(): void {
    const unlock = (): void => {
      if (this.audioCtx) return;
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.audioCtx = new Ctor();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
  }

  private readonly handleAudioPlay = (payload: GameEvents["audio:play"]): void => {
    if (this.ctx.state.muted) return;
    if (!this.audioCtx) return;
    this.playTone(payload.sound);
  };

  private playTone(sound: string): void {
    const ac = this.audioCtx;
    if (!ac) return;

    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);

    let freq = 440;
    let type: OscillatorType = "square";
    let duration = 0.08;
    let peak = 0.05;

    switch (sound) {
      case "shot":
        freq = 880;
        type = "square";
        duration = 0.05;
        peak = 0.045;
        break;
      case "kill":
        freq = 220;
        type = "sawtooth";
        duration = 0.15;
        peak = 0.07;
        break;
      case "impact":
        freq = 110;
        type = "triangle";
        duration = 0.1;
        peak = 0.09;
        break;
      case "purchase":
        freq = 660;
        type = "sine";
        duration = 0.18;
        peak = 0.06;
        break;
      default:
        break;
    }

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (sound === "kill") {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), now + duration);
    } else if (sound === "purchase") {
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + duration);
    }

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }
}
