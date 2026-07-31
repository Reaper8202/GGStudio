// Procedural poses for the rigid-chunk Green Alchemist rig produced by
// `glb-rigger/green-alchemist.rig.json`. Pure math only — no Three.js — so the
// curves stay unit testable and the same values can drive a preview page or
// the game.
//
// Shares the bone vocabulary and rotation convention with every other
// character rig — see `rigPose.ts`. The model faces +Z, so a NEGATIVE rotation
// about a bone's local X swings a hanging limb forward and a positive one
// swings it back. The character's right hand is on -X. Angles are radians.
//
// TWO THINGS ARE DIFFERENT ABOUT THIS RIG, and both shape everything below.
//
// 1. The source is a clean T-pose, so the bind pose has both arms straight out
//    along X rather than hanging at the sides. Every pose here — including the
//    idle — has to rotate the arms down itself, via `rz` on `armX_upper` (see
//    `ARM_DROP`). A pose that leaves an arm bone alone leaves it sticking
//    straight out sideways, which is why there is a `restPose()` here at all
//    and why the shared `REST_POSE` (all-bind) must never be used on this rig.
//
// 2. The legs pivot at the apron hem rather than at the pelvis, because the
//    robe is one rigid piece down to mid-thigh (see the rig config). The
//    visible leg is only the bottom fifth of the model, so the walk leans on
//    body bob and lean far more than on stride to read as movement.
//
// Rotations compose in Three.js Euler order 'XYZ', which means the matrix is
// Rx*Ry*Rz and **Rz is applied to the limb first**. That ordering is load
// bearing: `rz` drops the arm out of the T into a hanging position, and `rx`
// then sweeps that hanging arm through the sagittal plane. Swapping the order
// would sweep it through a different plane entirely.
//
// The .ts extension is explicit here so bare Node can run this module directly
// from `glb-rigger/verify/emit_pose.ts`, which has no bundler to resolve for it.
import { TAU, rot, smoothStep, type BoneName, type CharacterPose } from './rigPose.ts';

export {
  BONE_NAMES,
  smoothStep,
  type BoneName,
  type BonePose,
  type CharacterPose,
} from './rigPose.ts';

/**
 * How far `rz` rotates a T-pose arm down to hang at the side. Not quite the
 * 90 degrees that would point it straight down: the alchemist is widest at the
 * apron (half-width 0.235 in model units, against a 0.765-long arm), and a
 * fully vertical arm ends up buried in the robe. Ten degrees of splay clears it.
 *
 * The sign is mirrored per side — the right arm points down -X, so a POSITIVE
 * `rz` rotates it toward -Y, while the left arm needs a negative one.
 */
export const ARM_DROP = 1.4;

/**
 * Sweep angle of the throwing arm, as `rx` on `armR_upper`, measured from the
 * hanging rest position. The whole throw is one monotonic rotation in a single
 * direction — a windmill — which is what lets the clip start and finish at the
 * same pose without ever reversing:
 *
 *   0                 arm hanging at the side (rest)
 *   THROW_COCK 2.7    up and behind the shoulder, elbow folded
 *   THROW_RELEASE 4.8 punched forward, horizontal, elbow straight
 *   TAU               swept down the front, back to hanging
 *
 * Verified against the geometry rather than by eye: rotating a hanging arm
 * (0,-1,0) by `Rx(s)` puts it at `(0, -cos s, -sin s)`, so s=2.7 reads
 * up-and-back and s=4.8 reads forward-and-level.
 */
export const THROW_COCK = 2.7;
export const THROW_RELEASE = 4.8;

/**
 * Resting elbow bend on both forearms. Shared by every clip rather than
 * repeated per pose: it is the value a clip has to start from and return to, so
 * a copy that drifted would show up as the forearm snapping on the frame one
 * clip hands over to another.
 */
const ELBOW_REST = -0.18;
/** How far the throwing elbow folds the hand back behind the shoulder. */
const ELBOW_COCKED = -1.65;

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

export interface ThrowOptions {
  /** How far the torso twists away from the target through the cock, radians. */
  readonly twist?: number;
  /** How deep the knees drop as the throw is driven home, radians. */
  readonly crouch?: number;
}

// A stalking, top-heavy shamble. The stride is large for the leg length
// on purpose: the hem-pivoted legs are short, so a timid stride reads as
// gliding. The bob is what actually sells the weight of the still on its back.
const WALK_DEFAULTS: Required<WalkOptions> = {
  cadence: 1.05,
  stride: 0.62,
  armSwing: 0.3,
  lean: 0.11,
  bob: 0.035,
};

const THROW_DEFAULTS: Required<ThrowOptions> = {
  twist: 0.38,
  crouch: 0.3,
};

/** Fraction of the throw clip spent cocking before the arm drives forward. */
const COCK_FRACTION = 0.62;

/**
 * Both arms hanging, everything else at bind. This is the pose a rig with a
 * T-pose bind needs wherever other rigs would simply hold their bind pose —
 * standing, staggering, or waiting out an attack cooldown.
 */
export function restPose(): CharacterPose {
  return {
    rootLift: 0,
    bones: {
      armR_upper: rot(0, 0, ARM_DROP),
      armL_upper: rot(0, 0, -ARM_DROP),
      // A slight inward elbow on both sides, so the arms hang like a stooped
      // caster's rather than like a scarecrow's.
      armR_fore: rot(ELBOW_REST),
      armL_fore: rot(ELBOW_REST),
    },
  };
}

/**
 * Stalking shamble. The arms hang from the T-pose bind (see `ARM_DROP`) and
 * counter-swing against the legs; the torso leans forward into the walk and
 * rolls with each step under the weight of the apparatus on its back.
 */
export function walkPose(time: number, options: WalkOptions = {}): CharacterPose {
  const { cadence, stride, armSwing, lean, bob } = { ...WALK_DEFAULTS, ...options };
  const phase = time * cadence * TAU;
  const swing = Math.sin(phase);

  // Negative X is forward for a hanging limb, so the leading leg gets -stride.
  const thighR = -stride * swing;
  const thighL = stride * swing;

  // A knee bends one way only. Each shin lags a quarter cycle behind its thigh
  // and is clamped to the backward half, so the leg straightens as it plants.
  const kneeR = Math.max(0, Math.sin(phase - Math.PI / 2)) * stride * 0.8;
  const kneeL = Math.max(0, Math.sin(phase + Math.PI / 2)) * stride * 0.8;

  return {
    rootLift: -Math.abs(Math.sin(phase)) * bob,
    bones: {
      // Positive rx tips an upright bone forward (+Z), so the lean is positive.
      torso: rot(lean, 0, swing * 0.05),
      // The head counter-nods so the mask keeps pointing at the vehicle
      // instead of riding the torso's lean all the way down.
      head: rot(-lean * 0.55, 0, swing * -0.035),
      legR_thigh: rot(thighR),
      legL_thigh: rot(thighL),
      legR_shin: rot(kneeR),
      legL_shin: rot(kneeL),
      // Ankles counter the thigh a little so the feet stay nearer flat.
      footR: rot(-thighR * 0.3),
      footL: rot(-thighL * 0.3),
      // The counter-swing rides on top of the drop, which stays on `rz`.
      armR_upper: rot(armSwing * swing, 0, ARM_DROP),
      armL_upper: rot(-armSwing * swing, 0, -ARM_DROP),
      armR_fore: rot(ELBOW_REST + armSwing * swing * 0.35),
      armL_fore: rot(ELBOW_REST - armSwing * swing * 0.35),
    },
  };
}

/**
 * One vial throw, `progress` running 0..1 across the boss's wind-up. The vial
 * leaves the hand at `progress === 1`, which is the frame the arm reaches full
 * forward extension — `Zombie.stepWindingUp` fires `onBossVials` on exactly
 * that boundary, so the projectile and the pose release together rather than
 * being kept in sync by two hand-copied timings.
 *
 * Both ends are deliberately NOT the same pose: this clip stops at the release,
 * with the arm still thrown out front. `throwRecoverPose` carries it from there
 * back to rest, and is what the boss plays for a moment after the vial is away.
 */
export function throwPose(progress: number, options: ThrowOptions = {}): CharacterPose {
  const { twist, crouch } = { ...THROW_DEFAULTS, ...options };
  const t = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;

  const cock = smoothStep(t / COCK_FRACTION);
  const drive = t <= COCK_FRACTION ? 0 : smoothStep((t - COCK_FRACTION) / (1 - COCK_FRACTION));

  // One continuous sweep: rest -> cocked behind the shoulder -> punched out
  // front. Never reverses, so there is no hitch at the hand-over.
  const swing = cock * THROW_COCK + drive * (THROW_RELEASE - THROW_COCK);
  // The elbow folds the hand back behind the shoulder through the cock and
  // snaps straight as the arm comes over. Negative, because that is the
  // direction that folds the forearm back rather than flicking it forward.
  // It starts from ELBOW_REST rather than from 0, so the first frame of the
  // wind-up continues the pose the boss was standing in instead of jumping.
  const elbow =
    (ELBOW_REST * (1 - cock) + ELBOW_COCKED * cock) * (1 - drive);
  // The body turns its right shoulder away from the target to load the throw,
  // then whips back through it. Negative ry turns the right shoulder (-X) back.
  const turn = -twist * cock + twist * 0.7 * drive;

  return {
    rootLift: -crouch * 0.18 * drive,
    bones: {
      torso: rot(-0.16 * cock + 0.3 * drive, turn),
      // The mask stays locked on the vehicle while the torso rotates under it.
      head: rot(0.1 * cock - 0.12 * drive, -turn * 0.65),
      armR_upper: rot(swing, 0, ARM_DROP),
      armR_fore: rot(elbow),
      // The off arm rises toward the target as a counterweight through the
      // cock, then drops away as the throwing arm comes through.
      armL_upper: rot(-1.15 * cock + 0.85 * drive, 0, -ARM_DROP + 0.25 * cock),
      armL_fore: rot(ELBOW_REST - 0.5 * cock),
      // A braced stance: the front knee takes the drive.
      legR_thigh: rot(0.16 * cock - 0.1 * drive),
      legL_thigh: rot(-0.2 * cock - 0.14 * drive),
      legR_shin: rot(0.24 * cock + crouch * drive),
      legL_shin: rot(0.1 * cock + crouch * 0.55 * drive),
    },
  };
}

/**
 * Blend two poses, `t` 0..1. A bone named by only one side is blended against
 * that bone's bind rotation, which is what makes a pose that stops setting a
 * bone ease it back to bind instead of dropping it there on one frame.
 */
function blendPoses(from: CharacterPose, to: CharacterPose, t: number): CharacterPose {
  const bones: CharacterPose['bones'] = {};
  const names = new Set([
    ...(Object.keys(from.bones) as BoneName[]),
    ...(Object.keys(to.bones) as BoneName[]),
  ]);
  for (const name of names) {
    const a = from.bones[name];
    const b = to.bones[name];
    bones[name] = rot(
      (a?.rx ?? 0) + ((b?.rx ?? 0) - (a?.rx ?? 0)) * t,
      (a?.ry ?? 0) + ((b?.ry ?? 0) - (a?.ry ?? 0)) * t,
      (a?.rz ?? 0) + ((b?.rz ?? 0) - (a?.rz ?? 0)) * t,
    );
  }
  return { rootLift: from.rootLift + (to.rootLift - from.rootLift) * t, bones };
}

/**
 * The follow-through, `progress` 0..1. It starts from exactly the pose
 * `throwPose(1)` ends on — derived from that call rather than hand-copied, so
 * the two clips cannot drift apart when the throw is retuned — and settles to
 * `restPose()`.
 *
 * The one thing that is not a plain blend is the throwing arm: it keeps
 * travelling in the direction it was already going, down the front and round
 * to its side, completing the windmill at `TAU`. Blending its `rx` back to 0
 * instead would rewind the arm up over the shoulder backwards, which reads as
 * the throw playing in reverse. `TAU` and 0 are the same pose, so this only
 * changes the route, not the destination.
 */
export function throwRecoverPose(
  progress: number,
  options: ThrowOptions = {},
): CharacterPose {
  const settle = smoothStep(progress);
  const blended = blendPoses(throwPose(1, options), restPose(), settle);
  // Upper body only. The boss is walking again by the time this plays, so the
  // legs belong to the walk clip; `mergePoses` is what puts the two together.
  const bones: CharacterPose['bones'] = {
    armR_upper: rot(THROW_RELEASE + settle * (TAU - THROW_RELEASE), 0, ARM_DROP),
  };
  for (const name of ['torso', 'head', 'armR_fore', 'armL_upper', 'armL_fore'] as const) {
    bones[name] = blended.bones[name];
  }
  return { rootLift: blended.rootLift, bones };
}

/**
 * Overlay `over`'s bones onto `base`, for playing a partial clip on top of a
 * full-body one — the follow-through's upper body over the walk's legs. A bone
 * `over` does not name keeps whatever `base` gave it.
 */
export function mergePoses(base: CharacterPose, over: CharacterPose): CharacterPose {
  return {
    rootLift: base.rootLift + over.rootLift,
    bones: { ...base.bones, ...over.bones },
  };
}
