// Procedural poses for the rigid-chunk Behemoth rig produced by
// `glb-rigger/behemoth.rig.json`. Pure math only — no Three.js — so the
// curves stay unit testable and the same values can drive a preview page or
// the game.
//
// Shares the bone vocabulary and rotation convention with every other
// character rig — see `rigPose.ts`. The model faces +Z, so a NEGATIVE
// rotation about a bone's local X swings it forward and a positive one
// swings it back. The character's right hand is on -X. Angles are radians.
//
// This is the heaviest, bulkiest rig in the horde: the walk is a slow,
// lumbering shamble with a big vertical bob, and the smash is a two-handed
// overhead slam — both arms rise and fall together — rather than the
// Gunslinger's one-armed draw or the Necromancer's single-hand cast.
// The .ts extension is explicit here so bare Node can run this module
// directly from `glb-rigger/verify/emit_pose.ts`, which has no bundler to
// resolve for it.
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

export interface SmashOptions {
  /** Peak overhead arm lift at the top of the wind-up, radians. */
  readonly reach?: number;
  /** How deep the coil/stomp bends the torso and knees, radians. */
  readonly crouch?: number;
}

// Slower and heavier than every other rig here: a bigger stride and a
// noticeably bigger vertical bob, because this is dead weight shambling
// rather than a purposeful stalk.
const WALK_DEFAULTS: Required<WalkOptions> = {
  cadence: 0.9,
  stride: 0.6,
  armSwing: 0.22,
  lean: 0.14,
  bob: 0.05,
};

const SMASH_DEFAULTS: Required<SmashOptions> = {
  reach: 1.55,
  crouch: 0.32,
};

/** Fraction of the clip spent winding up before the arms start dropping. */
const WINDUP_FRACTION = 0.42;
/** Fraction of the clip the downswing itself takes, right after wind-up. */
const RELEASE_DURATION = 0.16;

/**
 * Progress at which the slam actually lands — both arms are at the bottom of
 * the swing and the knees have driven into the stomp. Exported so gameplay
 * code can land the AOE hit and its VFX on the same frame the pose actually
 * strikes, instead of guessing at a second copy of this number.
 */
export const SMASH_IMPACT = WINDUP_FRACTION + RELEASE_DURATION;

/**
 * Lumbering shamble. Bigger stride and bob than every other rig in the
 * horde, and the arms swing as dead weight rather than a purposeful
 * counter-stride.
 */
export function walkPose(time: number, options: WalkOptions = {}): CharacterPose {
  const { cadence, stride, armSwing, lean, bob } = { ...WALK_DEFAULTS, ...options };
  const phase = time * cadence * TAU;
  const swing = Math.sin(phase);

  // Negative X is forward, so the leg leading the stride gets -stride.
  const thighR = -stride * swing;
  const thighL = stride * swing;

  // A knee bends one way only. Each shin lags a quarter cycle behind its
  // thigh and is clamped to the backward half, so the leg straightens as it
  // plants.
  const kneeR = Math.max(0, Math.sin(phase - Math.PI / 2)) * stride * 0.85;
  const kneeL = Math.max(0, Math.sin(phase + Math.PI / 2)) * stride * 0.85;

  return {
    rootLift: -Math.abs(Math.sin(phase)) * bob,
    bones: {
      torso: rot(-lean, 0, Math.sin(phase) * 0.06),
      head: rot(lean * 0.5, 0, Math.sin(phase) * -0.04),
      legR_thigh: rot(thighR),
      legL_thigh: rot(thighL),
      legR_shin: rot(kneeR),
      legL_shin: rot(kneeL),
      // Ankles counter the thigh a little so the feet stay nearer flat.
      footR: rot(-thighR * 0.3),
      footL: rot(-thighL * 0.3),
      armR_upper: rot(armSwing * swing),
      armL_upper: rot(-armSwing * swing),
      armR_fore: rot(armSwing * swing * 0.4),
      armL_fore: rot(-armSwing * swing * 0.4),
    },
  };
}

/**
 * One smash: coil back with both arms rising overhead together, drive them
 * down past straight through the strike, then ease back up to rest.
 *
 * `progress` runs 0..1 across the whole action, and `SMASH_IMPACT` above
 * marks the frame the downswing actually lands. Both ends return to the bind
 * pose so the clip can be entered and left without a visible snap.
 */
export function smashPose(progress: number, options: SmashOptions = {}): CharacterPose {
  const { reach, crouch } = { ...SMASH_DEFAULTS, ...options };
  const t = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;

  const windUp = smoothStep(t / WINDUP_FRACTION);
  const release =
    t <= WINDUP_FRACTION ? 0 : smoothStep((t - WINDUP_FRACTION) / RELEASE_DURATION);
  const settle =
    t <= SMASH_IMPACT ? 0 : smoothStep((t - SMASH_IMPACT) / (1 - SMASH_IMPACT));

  // Both arms lift high together through the wind-up, then punch down past
  // straight through the release before settling back to rest.
  const lift = (windUp - release * 1.3 + settle * 0.3) * reach;
  // Torso rocks back through the coil, then slams forward hard on release.
  const rock = (windUp * 0.5 - release * 1.4 + settle * 0.9) * crouch;
  // Knees bend into a crouch through the coil, drive deeper into the stomp
  // right as the strike lands, then straighten back out. Never goes
  // negative, since a knee only bends the one way.
  const kneeDip = (windUp - settle * 1.4 + release * 0.4) * crouch;

  return {
    rootLift: -kneeDip * 0.32,
    bones: {
      torso: rot(rock),
      head: rot(-rock * 0.6),
      armR_upper: rot(-lift),
      armR_fore: rot(-lift * 0.5),
      armL_upper: rot(-lift),
      armL_fore: rot(-lift * 0.5),
      legR_shin: rot(kneeDip),
      legL_shin: rot(kneeDip),
    },
  };
}
