// Procedural poses for the rigid-chunk Necromancer rig produced by
// `glb-rigger`. Pure math only — no Three.js — so the curves stay unit
// testable and the same values can drive a preview page or the game.
//
// The bone vocabulary and the rotation convention are shared with every other
// character rig — see `rigPose.ts`. In short: the model faces +Z, so a NEGATIVE
// rotation about a bone's local X swings it forward. Angles are radians.
// The .ts extension is explicit here so bare Node can run this module directly
// from `glb-rigger/verify/emit_pose.ts`, which has no bundler to resolve for it.
import { TAU, rot, smoothStep, type CharacterPose } from './rigPose.ts';

export {
  BONE_NAMES,
  smoothStep,
  type BoneName,
  type BonePose,
  type CharacterPose,
} from './rigPose.ts';

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
}

export interface CastOptions {
  /** Peak shoulder lift at the top of the wind-up, radians. */
  readonly reach?: number;
  /** How far the torso rocks back then forward, radians. */
  readonly recoil?: number;
}

const WALK_DEFAULTS: Required<WalkOptions> = {
  cadence: 1.15,
  stride: 0.52,
  armSwing: 0.26,
  lean: 0.1,
  bob: 0.035,
};

const CAST_DEFAULTS: Required<CastOptions> = {
  reach: 0.85,
  recoil: 0.22,
};

/**
 * Shambling walk cycle.
 *
 * Legs swing in counter-phase; each knee only ever bends backward, which is the
 * one joint limit that reads as broken if violated. Arms swing opposite their
 * own side's leg, and the body bobs twice per stride (once per footfall).
 */
export function walkPose(time: number, options: WalkOptions = {}): CharacterPose {
  const { cadence, stride, armSwing, lean, bob } = { ...WALK_DEFAULTS, ...options };
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
      torso: rot(-lean, 0, Math.sin(phase) * 0.05),
      head: rot(lean * 0.6, 0, Math.sin(phase) * -0.04),
      legR_thigh: rot(thighR),
      legL_thigh: rot(thighL),
      legR_shin: rot(kneeR),
      legL_shin: rot(kneeL),
      // Ankles counter the thigh a little so the feet stay nearer flat.
      footR: rot(-thighR * 0.3),
      footL: rot(-thighL * 0.3),
      armR_upper: rot(armSwing * swing),
      armL_upper: rot(-armSwing * swing),
      // Segmentation puts nearly the whole sleeve on the forearm and leaves the
      // upper arm a sliver at the shoulder, so bending the elbow here would tear
      // the sleeve open mid-length. Swing each arm as one rigid piece instead;
      // the only seam is at the shoulder, buried in the coat.
      armR_fore: rot(0),
      armL_fore: rot(0),
    },
  };
}

/**
 * One cast: wind the arms up and back, then thrust forward and settle.
 *
 * `progress` runs 0..1 across the whole action. Both ends return to the bind
 * pose so the clip can be entered and left without a visible snap.
 */
export function castPose(progress: number, options: CastOptions = {}): CharacterPose {
  const { reach, recoil } = { ...CAST_DEFAULTS, ...options };
  const t = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;

  // Wind up over the first 45%, release sharply, then ease back to rest.
  const windUp = smoothStep(t / 0.45);
  const release = t <= 0.45 ? 0 : smoothStep((t - 0.45) / 0.2);
  const settle = t <= 0.65 ? 0 : smoothStep((t - 0.65) / 0.35);

  // Lift high on the wind-up, punch down through the release, then return.
  const lift = (windUp - release * 1.35 + settle * 0.35) * reach;
  // Torso rocks back as the arms rise, forward as they come down.
  const rock = (windUp - release * 1.6 + settle * 0.6) * recoil;

  return {
    rootLift: -Math.abs(windUp - release) * 0.02,
    bones: {
      torso: rot(rock),
      head: rot(-rock * 0.7),
      // Negative X raises the arms; the left hand carries the tome, so it leads.
      armL_upper: rot(-lift),
      armL_fore: rot(-lift * 0.45),
      armR_upper: rot(-lift * 0.7),
      armR_fore: rot(-lift * 0.35),
      // Braced stance: the knees dip through the release, then straighten again
      // so the clip finishes back at the bind pose.
      legR_shin: rot((release - settle) * 0.12),
      legL_shin: rot((release - settle) * 0.12),
    },
  };
}
