import { describe, expect, it } from 'vitest';

import {
  ARM_DROP,
  mergePoses,
  restPose,
  THROW_COCK,
  THROW_RELEASE,
  throwPose,
  throwRecoverPose,
  walkPose,
} from '../src/tools/alchemistPose';
import { BONE_NAMES, TAU, type BoneName } from '../src/tools/rigPose';

const CADENCE = 0.95;
const STRIDE_PERIOD = 1 / CADENCE;

type Pose = ReturnType<typeof walkPose>;

function everyAngle(pose: Pose): number[] {
  return Object.values(pose.bones).flatMap((bone) => [bone.rx, bone.ry, bone.rz]);
}

/**
 * Compare two poses bone by bone over the union of their names, treating a
 * bone a pose does not mention as sitting at bind. Two poses can be identical
 * on screen while listing different bones — a clip that explicitly writes 0 to
 * a leg and one that stays silent about it produce the same skeleton — so a
 * flat angle-array comparison would report a difference that is not there.
 */
function expectSamePose(actual: Pose, expected: Pose, label: string): void {
  const names = new Set([
    ...(Object.keys(actual.bones) as BoneName[]),
    ...(Object.keys(expected.bones) as BoneName[]),
  ]);
  for (const name of names) {
    for (const axis of ['rx', 'ry', 'rz'] as const) {
      expect(actual.bones[name]?.[axis] ?? 0, `${label}: ${name}.${axis}`).toBeCloseTo(
        expected.bones[name]?.[axis] ?? 0,
        10,
      );
    }
  }
  expect(actual.rootLift, `${label}: rootLift`).toBeCloseTo(expected.rootLift, 10);
}

/**
 * The one invariant that matters most on this rig: the source model is a
 * T-pose, so a pose that fails to drive `rz` on an upper arm leaves that arm
 * sticking straight out sideways. Nothing else here would catch that, because
 * every angle would still be perfectly "in range".
 */
function expectArmsDropped(pose: Pose, label: string): void {
  expect(pose.bones.armR_upper, `${label}: right arm undriven`).toBeDefined();
  expect(pose.bones.armL_upper, `${label}: left arm undriven`).toBeDefined();
  // Mirrored signs: the right arm points down -X and the left down +X, so the
  // same rotation direction sends one up and the other down.
  expect(pose.bones.armR_upper!.rz).toBeGreaterThan(1);
  expect(pose.bones.armL_upper!.rz).toBeLessThan(-1);
}

describe('restPose', () => {
  it('only emits known bone names', () => {
    for (const name of Object.keys(restPose().bones)) {
      expect(BONE_NAMES).toContain(name as BoneName);
    }
  });

  it('brings both arms down out of the T-pose bind', () => {
    expectArmsDropped(restPose(), 'rest');
    expect(restPose().bones.armR_upper!.rz).toBeCloseTo(ARM_DROP, 10);
    expect(restPose().bones.armL_upper!.rz).toBeCloseTo(-ARM_DROP, 10);
  });

  it('leaves the arms splayed clear of the robe rather than dead vertical', () => {
    // A full 90 degrees would bury the hands in the apron, which is as wide as
    // the arm is long. See ARM_DROP.
    expect(ARM_DROP).toBeLessThan(Math.PI / 2);
    expect(ARM_DROP).toBeGreaterThan(1.2);
  });

  it('stands still: no root lift and no leg bend', () => {
    expect(restPose().rootLift).toBe(0);
    expect(restPose().bones.legR_thigh).toBeUndefined();
    expect(restPose().bones.legL_thigh).toBeUndefined();
  });
});

describe('walkPose', () => {
  it('only emits known bone names', () => {
    for (const name of Object.keys(walkPose(0.3).bones)) {
      expect(BONE_NAMES).toContain(name as BoneName);
    }
  });

  it('keeps the arms down through the entire cycle', () => {
    for (let i = 0; i <= 200; i += 1) {
      expectArmsDropped(walkPose((i / 200) * STRIDE_PERIOD), `walk ${i}`);
    }
  });

  it('swings the legs in counter-phase', () => {
    const pose = walkPose(0.21);
    expect(pose.bones.legR_thigh!.rx).toBeCloseTo(-pose.bones.legL_thigh!.rx, 10);
  });

  it('swings each arm opposite its own side leg', () => {
    const pose = walkPose(0.21);
    expect(Math.sign(pose.bones.armR_upper!.rx)).toBe(
      -Math.sign(pose.bones.legR_thigh!.rx),
    );
    expect(Math.sign(pose.bones.armL_upper!.rx)).toBe(
      -Math.sign(pose.bones.legL_thigh!.rx),
    );
  });

  it('never bends a knee forwards', () => {
    for (let i = 0; i <= 200; i += 1) {
      const pose = walkPose((i / 200) * STRIDE_PERIOD);
      expect(pose.bones.legR_shin!.rx).toBeGreaterThanOrEqual(0);
      expect(pose.bones.legL_shin!.rx).toBeGreaterThanOrEqual(0);
    }
  });

  it('repeats exactly once per stride', () => {
    for (const t of [0, 0.13, 0.42, 0.77]) {
      const a = walkPose(t, { cadence: CADENCE });
      const b = walkPose(t + STRIDE_PERIOD, { cadence: CADENCE });
      expect(everyAngle(b)).toEqual(everyAngle(a).map((v) => expect.closeTo(v, 10)));
      expect(b.rootLift).toBeCloseTo(a.rootLift, 10);
    }
  });

  it('mirrors the legs half a stride apart', () => {
    const a = walkPose(0.1, { cadence: CADENCE });
    const b = walkPose(0.1 + STRIDE_PERIOD / 2, { cadence: CADENCE });
    expect(b.bones.legR_thigh!.rx).toBeCloseTo(a.bones.legL_thigh!.rx, 10);
  });

  it('never lifts the root above the ground line', () => {
    for (let i = 0; i <= 100; i += 1) {
      const { rootLift } = walkPose((i / 100) * STRIDE_PERIOD);
      expect(rootLift).toBeLessThanOrEqual(0);
      expect(rootLift).toBeGreaterThan(-0.1);
    }
  });

  it('leans the body forward, and the head back against it', () => {
    // Positive rx tips an upright bone toward +Z, which is the way the model
    // faces. The head counter-nods so the mask keeps pointing at the vehicle.
    const pose = walkPose(0);
    expect(pose.bones.torso!.rx).toBeGreaterThan(0);
    expect(pose.bones.head!.rx).toBeLessThan(0);
  });

  it('scales with the stride option', () => {
    const small = walkPose(0.21, { stride: 0.1 });
    const large = walkPose(0.21, { stride: 0.8 });
    expect(Math.abs(large.bones.legR_thigh!.rx)).toBeGreaterThan(
      Math.abs(small.bones.legR_thigh!.rx),
    );
  });
});

describe('throwPose', () => {
  it('only emits known bone names', () => {
    for (const name of Object.keys(throwPose(0.5).bones)) {
      expect(BONE_NAMES).toContain(name as BoneName);
    }
  });

  it('keeps the arms down through the entire clip', () => {
    for (let i = 0; i <= 200; i += 1) {
      expectArmsDropped(throwPose(i / 200), `throw ${i}`);
    }
  });

  it('starts from exactly the rest pose', () => {
    // The boss stands in restPose while its cooldown runs, so any mismatch
    // here is a visible jerk on the frame the wind-up begins.
    expectSamePose(throwPose(0), restPose(), 'throw start');
  });

  it('clamps progress outside 0..1', () => {
    expect(everyAngle(throwPose(-2))).toEqual(everyAngle(throwPose(0)));
    expect(everyAngle(throwPose(4))).toEqual(everyAngle(throwPose(1)));
  });

  it('sweeps the throwing arm one way only, never reversing', () => {
    // The whole clip is a single windmill rotation. A non-monotonic sweep
    // would read as the arm hesitating or double-pumping mid-throw.
    let previous = throwPose(0).bones.armR_upper!.rx;
    for (let i = 1; i <= 1000; i += 1) {
      const swing = throwPose(i / 1000).bones.armR_upper!.rx;
      expect(swing).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = swing;
    }
  });

  it('cocks behind the shoulder and releases out front', () => {
    expect(throwPose(0).bones.armR_upper!.rx).toBeCloseTo(0, 10);
    // At the hand-over point the arm is up and behind; by the end it has come
    // over the top and punched forward.
    expect(throwPose(0.62).bones.armR_upper!.rx).toBeCloseTo(THROW_COCK, 6);
    expect(throwPose(1).bones.armR_upper!.rx).toBeCloseTo(THROW_RELEASE, 10);
  });

  it('places the cock and release where a windmill actually puts them', () => {
    // Rotating a hanging arm (0,-1,0) by Rx(s) lands it at (0,-cos s,-sin s).
    // The cock must read up-and-back, the release forward-and-level.
    expect(-Math.cos(THROW_COCK)).toBeGreaterThan(0.8); // up
    expect(-Math.sin(THROW_COCK)).toBeLessThan(0); // behind
    expect(-Math.sin(THROW_RELEASE)).toBeGreaterThan(0.9); // out front
    expect(THROW_COCK).toBeLessThan(THROW_RELEASE);
    expect(THROW_RELEASE).toBeLessThan(TAU);
  });

  it('folds the elbow through the cock and straightens it for the release', () => {
    expect(throwPose(0.62).bones.armR_fore!.rx).toBeLessThan(-1);
    expect(throwPose(1).bones.armR_fore!.rx).toBeCloseTo(0, 10);
  });

  it('turns the throwing shoulder away to load, then whips back through', () => {
    // Negative ry turns the right shoulder (-X) backwards.
    expect(throwPose(0.62).bones.torso!.ry).toBeLessThan(0);
    expect(throwPose(1).bones.torso!.ry).toBeGreaterThan(
      throwPose(0.62).bones.torso!.ry,
    );
  });

  it('keeps the head counter-rotating so the mask tracks the target', () => {
    for (const t of [0.3, 0.62, 0.9]) {
      const pose = throwPose(t);
      expect(Math.sign(pose.bones.head!.ry)).toBe(-Math.sign(pose.bones.torso!.ry));
    }
  });

  it('never bends a knee backwards', () => {
    for (let i = 0; i <= 200; i += 1) {
      const pose = throwPose(i / 200);
      expect(pose.bones.legR_shin!.rx).toBeGreaterThanOrEqual(0);
      expect(pose.bones.legL_shin!.rx).toBeGreaterThanOrEqual(0);
    }
  });

  it('never lifts the root above the ground line', () => {
    for (let i = 0; i <= 200; i += 1) {
      const { rootLift } = throwPose(i / 200);
      expect(rootLift).toBeLessThanOrEqual(1e-12);
      expect(rootLift).toBeGreaterThan(-0.2);
    }
  });

  it('is continuous everywhere, including the cock-to-drive hand-over', () => {
    let previous = throwPose(0);
    for (let i = 1; i <= 1000; i += 1) {
      const pose = throwPose(i / 1000);
      const a = everyAngle(previous);
      const b = everyAngle(pose);
      for (let k = 0; k < a.length; k += 1) {
        expect(Math.abs(b[k] - a[k])).toBeLessThan(0.1);
      }
      previous = pose;
    }
  });

  it('scales with the twist option', () => {
    const slight = throwPose(0.62, { twist: 0.1 });
    const deep = throwPose(0.62, { twist: 0.7 });
    expect(deep.bones.torso!.ry).toBeLessThan(slight.bones.torso!.ry);
  });
});

describe('throwRecoverPose', () => {
  it('only emits known bone names', () => {
    for (const name of Object.keys(throwRecoverPose(0.5).bones)) {
      expect(BONE_NAMES).toContain(name as BoneName);
    }
  });

  it('picks up exactly where the throw left off', () => {
    // Derived from throwPose(1) rather than hand-copied, so this guards the
    // derivation staying wired rather than a pair of numbers agreeing.
    const released = throwPose(1);
    const recovered = throwRecoverPose(0);
    for (const name of ['torso', 'head', 'armR_upper', 'armR_fore', 'armL_upper', 'armL_fore'] as const) {
      expect(recovered.bones[name]!.rx, name).toBeCloseTo(released.bones[name]!.rx, 10);
      expect(recovered.bones[name]!.ry, name).toBeCloseTo(released.bones[name]!.ry, 10);
      expect(recovered.bones[name]!.rz, name).toBeCloseTo(released.bones[name]!.rz, 10);
    }
  });

  it('finishes at the rest pose, so the walk takes over without a jump', () => {
    const settled = throwRecoverPose(1);
    const rest = restPose();
    for (const name of ['torso', 'head', 'armR_fore', 'armL_upper', 'armL_fore'] as const) {
      expect(settled.bones[name]!.rx, name).toBeCloseTo(rest.bones[name]?.rx ?? 0, 10);
      expect(settled.bones[name]!.ry, name).toBeCloseTo(rest.bones[name]?.ry ?? 0, 10);
      expect(settled.bones[name]!.rz, name).toBeCloseTo(rest.bones[name]?.rz ?? 0, 10);
    }
    // The throwing arm completes the windmill instead of rewinding: TAU is the
    // same pose as rest's 0, reached the long way round.
    expect(settled.bones.armR_upper!.rx).toBeCloseTo(TAU, 10);
    expect(settled.bones.armR_upper!.rz).toBeCloseTo(ARM_DROP, 10);
  });

  it('keeps the throwing arm moving forwards, never rewinding', () => {
    let previous = throwRecoverPose(0).bones.armR_upper!.rx;
    for (let i = 1; i <= 500; i += 1) {
      const swing = throwRecoverPose(i / 500).bones.armR_upper!.rx;
      expect(swing).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = swing;
    }
  });

  it('leaves the legs alone for the walk to drive', () => {
    const pose = throwRecoverPose(0.5);
    expect(pose.bones.legR_thigh).toBeUndefined();
    expect(pose.bones.legL_thigh).toBeUndefined();
    expect(pose.bones.legR_shin).toBeUndefined();
    expect(pose.bones.footR).toBeUndefined();
  });
});

describe('mergePoses', () => {
  it('takes the legs from the base and the arms from the overlay', () => {
    const walk = walkPose(0.3);
    const merged = mergePoses(walk, throwRecoverPose(0.2));
    expect(merged.bones.legR_thigh).toEqual(walk.bones.legR_thigh);
    expect(merged.bones.footR).toEqual(walk.bones.footR);
    expect(merged.bones.armR_upper!.rx).toBeGreaterThan(1);
  });

  it('still lands the arms down, whichever clip supplied them', () => {
    for (let i = 0; i <= 100; i += 1) {
      expectArmsDropped(
        mergePoses(walkPose(i / 100), throwRecoverPose(i / 100)),
        `merged ${i}`,
      );
    }
  });
});
