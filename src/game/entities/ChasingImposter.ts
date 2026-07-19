import * as THREE from 'three';
import { Palette } from '../../config/constants';
import { makeBean, makeBlobShadow, type BeanParts } from './bean';

/**
 * Lurk position: directly behind the player, low in the frame. The camera
 * (at z 6.8, pitched ~10° down) clips anything past z ≈ 3 below the frame
 * bottom, so the chase band lives at z ≈ 1.7–2.8 — close on the player's
 * heels and rising into the bottom edge of the screen.
 */
const LURK_X = 0;
const LURK_Z = 2.4;

/** Slow "closing in" z-drift band while chasing normally. */
const DRIFT_Z_NEAR = 1.7;
const DRIFT_Z_FAR = 2.8;
const DRIFT_PERIOD_MS = 4000;

/** Exponential lag time constant for the x-chase (ms). */
const CHASE_TAU_MS = 450;
/** Exponential ease time constant for z settling back to lurk depth (ms). */
const SETTLE_TAU_MS = 600;

/** Base forward hunch — "sprinting after you" — held at all times outside a lunge. */
const HUNCH_X = 0.25;
/** Extra forward pitch piled on top of the hunch mid-lunge. */
const LUNGE_PITCH_X = 0.65;
/** Pitch held once the lunge has landed — crouched over the kill spot. */
const LANDED_PITCH_X = 0.5;

const LUNGE_MS = 380;
const LUNGE_LAND_Z = 0.4;
const LUNGE_PEAK_Y = 1.2;

/**
 * The impostor chasing the player from behind (between the player and the
 * camera, low in the frame). Fully self-contained: owns its own bean mesh,
 * shadow, and animation state, and is driven purely by the `now`/`dt`
 * passed into `update` — no internal clock, no per-frame allocations.
 *
 * Normal chase: x tracks the player's lane with a soft exponential lag (so
 * it trails a beat behind lane switches) while z idles on a slow sine
 * between ~3.1 and ~4.3 units behind the player, selling a "closing in"
 * menace. `lunge()` fires a ~380 ms pounce — a parabolic hop from the
 * current depth down to just behind the player (z ≈ 0.4) — after which it
 * holds a crouched pose until `reset()` sends it back to the lurk spot.
 */
export class ChasingImposter {
  readonly group = new THREE.Group();

  private readonly bean: BeanParts;
  private readonly shadow: THREE.Mesh;

  private lungeActive = false;
  private lungeStart = 0;
  private lungeFromZ = LURK_Z;

  constructor(scene: THREE.Scene) {
    this.bean = makeBean({
      color: Palette.imposter,
      darkColor: Palette.imposterDark,
      visorColor: Palette.imposterEye,
      visorEmissive: Palette.imposterEye,
      menacing: true,
    });
    this.bean.group.rotation.x = HUNCH_X;
    this.group.add(this.bean.group);

    this.shadow = makeBlobShadow();
    this.group.add(this.shadow);

    this.group.position.set(LURK_X, 0, LURK_Z);
    scene.add(this.group);
  }

  get isLunging(): boolean {
    return this.lungeActive;
  }

  /** Starts the pounce. Animates from the current depth, wherever that is. */
  lunge(now: number): void {
    this.lungeActive = true;
    this.lungeStart = now;
    this.lungeFromZ = this.group.position.z;
  }

  reset(): void {
    this.lungeActive = false;
    this.lungeStart = 0;
    this.lungeFromZ = LURK_Z;

    this.group.position.set(LURK_X, 0, LURK_Z);
    this.bean.group.position.set(0, 0, 0);
    this.bean.group.rotation.set(HUNCH_X, 0, 0);
    this.bean.legL.rotation.x = 0;
    this.bean.legR.rotation.x = 0;
    this.shadow.scale.set(1, 1, 1);
  }

  update(dt: number, now: number, playerX: number, running: boolean): void {
    // x always chases the player's lane, lunging or not — exponential lag.
    const x = this.group.position.x;
    this.group.position.x = x + (playerX - x) * Math.min(1, dt / CHASE_TAU_MS);

    if (this.lungeActive) {
      this.updateLunge(now);
      return;
    }

    if (running) {
      // Frantic run cycle: faster bob + leg swing than the player's.
      const phase = now / 70;
      this.bean.group.position.y = Math.abs(Math.sin(phase)) * 0.09;
      this.bean.legL.rotation.x = Math.sin(phase) * 0.85;
      this.bean.legR.rotation.x = -Math.sin(phase) * 0.85;
      this.bean.group.rotation.x = HUNCH_X;

      // Slow "closing in" depth drift.
      const drift = (Math.sin((2 * Math.PI * now) / DRIFT_PERIOD_MS) + 1) / 2;
      this.group.position.z = DRIFT_Z_NEAR + (DRIFT_Z_FAR - DRIFT_Z_NEAR) * drift;
    } else {
      // Idle bob only; ease depth back toward the lurk spot.
      this.bean.group.position.y = 0.05 * Math.sin(now / 300);
      this.bean.legL.rotation.x = 0;
      this.bean.legR.rotation.x = 0;
      this.bean.group.rotation.x = HUNCH_X;

      const z = this.group.position.z;
      this.group.position.z = z + (LURK_Z - z) * Math.min(1, dt / SETTLE_TAU_MS);
    }
  }

  private updateLunge(now: number): void {
    const t = Math.min(1, (now - this.lungeStart) / LUNGE_MS);
    const arc = Math.sin(Math.PI * t);

    this.group.position.z = this.lungeFromZ + (LUNGE_LAND_Z - this.lungeFromZ) * t;
    this.bean.group.position.y = LUNGE_PEAK_Y * arc;
    this.bean.group.rotation.x = HUNCH_X + (LUNGE_PITCH_X - HUNCH_X) * arc;
    this.shadow.scale.setScalar(1 - 0.45 * arc);

    if (t >= 1) {
      // Landed — hold a crouched pose over the kill spot until reset().
      this.bean.group.position.y = 0;
      this.bean.group.rotation.x = LANDED_PITCH_X;
      this.shadow.scale.set(1, 1, 1);
    }
  }
}
