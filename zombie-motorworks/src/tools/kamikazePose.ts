// Procedural pose for the rigid-chunk Kamikaze rig produced by
// `glb-rigger/kamikaze.rig.json`. Pure math only — no Three.js — so the
// curves stay unit testable and the same values can drive a preview page or
// the game.
//
// Shares the bone vocabulary and rotation convention with every other
// character rig — see `rigPose.ts`. The model faces +Z, so a NEGATIVE
// rotation about a bone's local X swings it forward and a positive one
// swings it back. The character's right hand is on -X. Angles are radians.
//
// The arms are the one place this rig departs from every other character's:
// the source T-pose holds them straight out to the sides, along the bone's
// own local X axis, so a local-X rotation (the usual forward/back swing) is
// a no-op — it rotates the bone about its own length. Legs, torso, and head
// keep the shared convention unchanged.
//
// The arms are instead built from a fixed local-Z "tuck", verified by
// rendering `verify/render_pose.py` rather than derived on paper (a 13-bone
// rigid-chunk rig has no forgiving skin to hide a wrong guess in). A 90°
// local-Z tuck on this rig does not swing the T-pose arm down to hang at the
// side as the necromancer/gunslinger analogy would suggest — it swings it
// forward, to point straight ahead. That reads as reaching for the target,
// which is exactly right for a zombie sprinting at the vehicle, so the pose
// below leans into it rather than fighting it: both arms tuck forward and
// stay there, with only a small local-Y wobble riding on top for life. Ry
// swings much past roughly +/-15 degrees at this tuck were tried and threw
// the forearm into a wild overhead swing — an artifact of composing two
// rotated joints, not a sign the rig is broken — so the dynamic amplitudes
// here are deliberately kept small.
//
// This model is small and unarmed — nothing hangs off the forearms — so
// unlike the Gunslinger it commits fully to a sprint: a wide stride and a
// heavy forward lean, since it is closing distance as fast as it can rather
// than stalking.
import { TAU, rot, type CharacterPose, type BonePose } from './rigPose.ts';

export interface RunOptions {
  /** Strides per second. */
  readonly cadence?: number;
  /** Peak thigh swing, radians. */
  readonly stride?: number;
  /** Peak shoulder swing, radians. */
  readonly armSwing?: number;
  /** Constant forward lean of the upper body, radians. */
  readonly lean?: number;
  /** Peak vertical bob, model units. */
  readonly bob?: number;
  /** Peak shoulder/hip roll, radians. */
  readonly sway?: number;
  /** Fixed elbow bend, radians — bent throughout, not just while trailing. */
  readonly elbowBend?: number;
}

// Fast and short-strided to read as small and frantic rather than a long
// athletic gait: quicker cadence than the Gunslinger's stalk, bigger lean.
const RUN_DEFAULTS: Required<RunOptions> = {
  cadence: 2.6,
  stride: 0.85,
  armSwing: 0.22,
  lean: 0.32,
  bob: 0.05,
  sway: 0.1,
  elbowBend: 0.35,
};

/** Fixed local-Z rotation that swings a T-pose arm forward out of the bind. */
const ARM_TUCK = Math.PI / 2;

/**
 * Upper arm: a fixed tuck (rz) pulls the bone out of its T-pose bind to point
 * forward, and a small running wobble rides on local Y on top of it — see the
 * file header for why rx does nothing here and why this amplitude stays
 * small. `side` is +1 for the right arm (bind direction -X) and -1 for the
 * left (bind direction +X); both the tuck and the wobble sign flip with it
 * so the two arms mirror.
 */
function upperArmPose(side: number, wobble: number): BonePose {
  return rot(0, side * wobble, side * ARM_TUCK);
}

/**
 * Forearm: same trick one joint down. In the forearm's own local frame —
 * nested inside the now-tucked upper arm — it still starts out pointing
 * along local X, so the reach-forward tuck and the bend are again Z
 * rotations, not X ones.
 */
function forearmPose(side: number, wobble: number, bend: number): BonePose {
  return rot(0, side * wobble * 0.3, side * bend);
}

/**
 * Full sprint cycle: legs drive the run, arms reach forward toward the
 * target with only a light wobble riding on top.
 *
 * Legs swing in counter-phase with the knee clamped to the backward half, the
 * same rule as every other rig's walk.
 */
export function runPose(time: number, options: RunOptions = {}): CharacterPose {
  const { cadence, stride, armSwing, lean, bob, sway, elbowBend } = {
    ...RUN_DEFAULTS,
    ...options,
  };
  const phase = time * cadence * TAU;
  const swing = Math.sin(phase);

  // Negative X is forward, so the leg leading the stride gets -stride.
  const thighR = -stride * swing;
  const thighL = stride * swing;

  // A knee bends one way only. Each shin lags a quarter cycle behind its
  // thigh and is clamped to the backward half, so the leg straightens as it
  // plants and folds hard on the recovery.
  const kneeR = Math.max(0, Math.sin(phase - Math.PI / 2)) * stride * 1.3;
  const kneeL = Math.max(0, Math.sin(phase + Math.PI / 2)) * stride * 1.3;

  // A small opposite-phase wobble on the reaching arms, just enough to read
  // as alive rather than rigidly locked forward.
  const armWobbleR = armSwing * swing;
  const armWobbleL = -armSwing * swing;

  return {
    rootLift: -Math.abs(Math.sin(phase)) * bob,
    bones: {
      hips: rot(0, 0, -sway * swing * 0.5),
      torso: rot(-lean, sway * swing * 0.3, sway * swing),
      head: rot(lean * 0.5, -sway * swing * 0.4, sway * swing * -0.5),
      legR_thigh: rot(thighR),
      legL_thigh: rot(thighL),
      legR_shin: rot(kneeR),
      legL_shin: rot(kneeL),
      // Ankles counter the thigh a little so the feet stay nearer flat.
      footR: rot(-thighR * 0.3),
      footL: rot(-thighL * 0.3),
      armR_upper: upperArmPose(1, armWobbleR),
      armL_upper: upperArmPose(-1, armWobbleL),
      armR_fore: forearmPose(1, armWobbleR, elbowBend),
      armL_fore: forearmPose(-1, armWobbleL, elbowBend),
    },
  };
}
