// Procedural poses for the rigid-chunk Zombie Gunslinger rig produced by
// `glb-rigger/gunslinger.rig.json`. Pure math only — no Three.js — so the
// curves stay unit testable and the same values can drive a preview page or the
// game.
//
// Shares the bone vocabulary and rotation convention with every other character
// rig — see `rigPose.ts`. The model faces +Z, so a NEGATIVE rotation about a
// bone's local X swings it forward and a positive one swings it back. The
// character's right hand is on -X. Angles are radians.
//
// Two things about this model shape the curves below. Its arms hang nearly
// straight down at rest, well out from the body (x +/-0.17 at the shoulder to
// +/-0.34 at the hands), so raising a gun to aim is close to a full quarter
// turn at the shoulder rather than the small lift the Necromancer's cast needs.
// And a revolver is rigged onto each forearm, which is what makes the muzzle
// flip on recoil worth animating at all.
// The .ts extension is explicit here so bare Node can run this module directly
// from `glb-rigger/verify/emit_pose.ts`, which has no bundler to resolve for it.
import { TAU, pulse, ramp, rot, type CharacterPose } from './rigPose.ts';

export interface WalkOptions {
  /** Steps per second. */
  readonly cadence?: number;
  /** Peak thigh swing, radians. */
  readonly stride?: number;
  /** Peak arm counter-swing, radians. */
  readonly armSwing?: number;
  /** Constant forward lean of the upper body, radians. */
  readonly lean?: number;
  /** Peak vertical bob, model units. */
  readonly bob?: number;
  /** Peak shoulder/hip roll, radians. */
  readonly sway?: number;
}

export interface ShootOptions {
  /** Shoulder lift that brings the guns up to aim, radians. */
  readonly reach?: number;
  /** How hard each shot kicks the shoulder back, radians. */
  readonly recoil?: number;
  /** How far the muzzle flips up on each shot, radians. */
  readonly muzzleRise?: number;
}

// Slower and shorter-strided than the Necromancer's shamble: this one stalks.
// The arms barely swing because the hands stay down by the holsters.
const WALK_DEFAULTS: Required<WalkOptions> = {
  cadence: 0.95,
  stride: 0.44,
  armSwing: 0.13,
  lean: 0.06,
  bob: 0.03,
  sway: 0.07,
};

// `reach` stops short of a right angle so the guns level out pointing slightly
// down — the model is 2.0 tall and shoots at things on the ground.
const SHOOT_DEFAULTS: Required<ShootOptions> = {
  reach: 1.32,
  recoil: 0.3,
  muzzleRise: 0.36,
};

/** Progress at which each hand fires. The right hand leads; the left answers. */
const SHOT_R = 0.4;
const SHOT_L = 0.6;
/** A shot arrives almost instantly and decays over roughly four times as long. */
const SHOT_RISE = 0.035;
const SHOT_FALL = 0.135;

/**
 * Stalking walk cycle.
 *
 * Legs swing in counter-phase; each knee only ever bends backward, which is the
 * one joint limit that reads as broken if violated. Arms swing opposite their
 * own side's leg — but only barely, because a gunslinger walks with their hands
 * hovering by the guns. The swagger comes from the shoulder roll instead.
 */
export function walkPose(time: number, options: WalkOptions = {}): CharacterPose {
  const { cadence, stride, armSwing, lean, bob, sway } = { ...WALK_DEFAULTS, ...options };
  const phase = time * cadence * TAU;
  const swing = Math.sin(phase);

  // Negative X is forward, so the leg leading the stride gets -stride.
  const thighR = -stride * swing;
  const thighL = stride * swing;

  // A knee bends one way only. Each shin lags a quarter cycle behind its thigh
  // and is clamped to the backward half, so the leg straightens as it plants.
  const kneeR = Math.max(0, Math.sin(phase - Math.PI / 2)) * stride * 0.9;
  const kneeL = Math.max(0, Math.sin(phase + Math.PI / 2)) * stride * 0.9;

  return {
    rootLift: -Math.abs(Math.sin(phase)) * bob,
    bones: {
      // Shoulders and hips counter-roll, which is the swagger.
      hips: rot(0, 0, -sway * swing * 0.5),
      torso: rot(-lean, sway * swing * 0.3, sway * swing),
      head: rot(lean * 0.7, -sway * swing * 0.4, sway * swing * -0.5),
      legR_thigh: rot(thighR),
      legL_thigh: rot(thighL),
      legR_shin: rot(kneeR),
      legL_shin: rot(kneeL),
      // Ankles counter the thigh a little so the feet stay nearer flat.
      footR: rot(-thighR * 0.3),
      footL: rot(-thighL * 0.3),
      armR_upper: rot(armSwing * swing),
      armL_upper: rot(-armSwing * swing),
      // The forearms carry the revolvers, so they trail the shoulder by a hair
      // rather than staying locked — just enough for the guns to feel weighted.
      armR_fore: rot(armSwing * swing * 0.35),
      armL_fore: rot(-armSwing * swing * 0.35),
    },
  };
}

/**
 * One two-shot exchange: draw both guns up to aim, fire right then left with a
 * kick on each, then lower them again.
 *
 * `progress` runs 0..1 across the whole action. Both ends return to the bind
 * pose so the clip can be entered and left without a visible snap.
 */
export function shootPose(progress: number, options: ShootOptions = {}): CharacterPose {
  const { reach, recoil, muzzleRise } = { ...SHOOT_DEFAULTS, ...options };
  const t = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;

  // Draw over the first 30%, hold the aim through both shots, holster from 85%.
  // Subtracting the holster ramp is what guarantees t=1 lands back at rest.
  const aim = ramp(t, 0, 0.3) - ramp(t, 0.85, 1);

  const kickR = pulse(t, SHOT_R, SHOT_RISE, SHOT_FALL);
  const kickL = pulse(t, SHOT_L, SHOT_RISE, SHOT_FALL);
  const kick = Math.max(kickR, kickL);

  // The whole body absorbs each shot: the shoulder is driven back (positive rx)
  // while the muzzle — and so the forearm — flips forward and up (negative).
  const shoulder = (side: number): number => -reach * aim + recoil * side;
  const forearm = (side: number): number => -reach * 0.12 * aim - muzzleRise * side;

  return {
    // Braced and settling, never rising above the ground line.
    rootLift: -0.018 * aim - 0.008 * kick,
    bones: {
      hips: rot(0.04 * aim),
      // Rocks back with each shot, on top of a slight forward set for the aim.
      torso: rot(-0.07 * aim + 0.14 * kick),
      // Head stays level over the sights rather than riding the torso.
      head: rot(0.05 * aim - 0.1 * kick),
      armR_upper: rot(shoulder(kickR)),
      armR_fore: rot(forearm(kickR)),
      armL_upper: rot(shoulder(kickL) * 0.92),
      armL_fore: rot(forearm(kickL) * 0.92),
      // Knees dip into a brace and take a little more on each shot. Positive is
      // the only direction a knee may bend.
      legR_shin: rot(0.13 * aim + 0.05 * kick),
      legL_shin: rot(0.13 * aim + 0.05 * kick),
      // Ankles hold the boots flat against the knee dip.
      footR: rot(-0.06 * aim),
      footL: rot(-0.06 * aim),
    },
  };
}
