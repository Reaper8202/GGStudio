// Shared vocabulary for the rigid-chunk character rigs produced by
// `glb-rigger`. Pure math only — no Three.js — so the curves stay unit testable
// and the same values can drive a preview page or the game.
//
// Every rig config in `glb-rigger/` uses these same thirteen bone names, which
// is what lets one set of pose curves drive any of the characters.
//
// Convention, verified against the exported hierarchies: the models face +Z, so
// a NEGATIVE rotation about a bone's local X swings it forward and a positive
// one swings it back. Angles are radians.

/** Bone names emitted by every rig config in `glb-rigger/`. */
export type BoneName =
  | 'hips'
  | 'torso'
  | 'head'
  | 'armR_upper'
  | 'armR_fore'
  | 'armL_upper'
  | 'armL_fore'
  | 'legR_thigh'
  | 'legR_shin'
  | 'footR'
  | 'legL_thigh'
  | 'legL_shin'
  | 'footL';

export const BONE_NAMES: readonly BoneName[] = [
  'hips',
  'torso',
  'head',
  'armR_upper',
  'armR_fore',
  'armL_upper',
  'armL_fore',
  'legR_thigh',
  'legR_shin',
  'footR',
  'legL_thigh',
  'legL_shin',
  'footL',
];

/** Local Euler rotation for one bone, in radians. */
export interface BonePose {
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
}

export interface CharacterPose {
  /** Bones absent from the map stay at their bind rotation. */
  readonly bones: Partial<Record<BoneName, BonePose>>;
  /** Vertical offset for the root, in model units (models are 2.0 tall). */
  readonly rootLift: number;
}

export const TAU = Math.PI * 2;

export function rot(rx: number, ry = 0, rz = 0): BonePose {
  return { rx, ry, rz };
}

/** Smooth 0..1 ramp with zero slope at both ends. */
export function smoothStep(t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return clamped * clamped * (3 - 2 * clamped);
}

/** `smoothStep` remapped onto an arbitrary span; flat outside it. */
export function ramp(t: number, from: number, to: number): number {
  return smoothStep((t - from) / (to - from));
}

/**
 * A one-shot spike: rises 0..1 over `rise`, falls back to 0 over `fall`, and is
 * flat zero everywhere else. Used for recoil, where the kick has to arrive far
 * faster than it decays.
 */
export function pulse(t: number, at: number, rise: number, fall: number): number {
  if (t <= at || t >= at + rise + fall) return 0;
  return t < at + rise ? smoothStep((t - at) / rise) : 1 - smoothStep((t - at - rise) / fall);
}
