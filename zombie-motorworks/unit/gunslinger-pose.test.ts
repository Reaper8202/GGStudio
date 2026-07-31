import { describe, expect, it } from 'vitest';

import { shootPose, walkPose } from '../src/tools/gunslingerPose';
import { BONE_NAMES, pulse, ramp, type BoneName } from '../src/tools/rigPose';

const CADENCE = 0.95;
const STRIDE_PERIOD = 1 / CADENCE;

/** Peak of each shot's recoil — the shot time plus the pulse's rise. */
const SHOT_R_PEAK = 0.4 + 0.035;
const SHOT_L_PEAK = 0.6 + 0.035;

function everyAngle(pose: ReturnType<typeof walkPose>): number[] {
  return Object.values(pose.bones).flatMap((bone) => [bone.rx, bone.ry, bone.rz]);
}

describe('ramp', () => {
  it('is flat outside the span and smooth across it', () => {
    expect(ramp(0.1, 0.2, 0.6)).toBe(0);
    expect(ramp(0.2, 0.2, 0.6)).toBe(0);
    expect(ramp(0.4, 0.2, 0.6)).toBeCloseTo(0.5, 10);
    expect(ramp(0.6, 0.2, 0.6)).toBe(1);
    expect(ramp(0.9, 0.2, 0.6)).toBe(1);
  });
});

describe('pulse', () => {
  it('is zero outside the spike and peaks where the rise ends', () => {
    expect(pulse(0.1, 0.4, 0.04, 0.16)).toBe(0);
    expect(pulse(0.4, 0.4, 0.04, 0.16)).toBe(0);
    expect(pulse(0.44, 0.4, 0.04, 0.16)).toBeCloseTo(1, 10);
    expect(pulse(0.6, 0.4, 0.04, 0.16)).toBe(0);
    expect(pulse(0.95, 0.4, 0.04, 0.16)).toBe(0);
  });

  it('decays monotonically after the peak', () => {
    let previous = 1;
    for (let i = 0; i <= 20; i += 1) {
      const value = pulse(0.44 + (i / 20) * 0.16, 0.4, 0.04, 0.16);
      expect(value).toBeLessThanOrEqual(previous + 1e-12);
      previous = value;
    }
  });
});

describe('walkPose', () => {
  it('only emits known bone names', () => {
    const pose = walkPose(0.3);
    for (const name of Object.keys(pose.bones)) {
      expect(BONE_NAMES).toContain(name as BoneName);
    }
  });

  it('swings the legs in counter-phase', () => {
    const pose = walkPose(0.21);
    expect(pose.bones.legR_thigh!.rx).toBeCloseTo(-pose.bones.legL_thigh!.rx, 10);
  });

  it('swings each arm opposite its own side leg', () => {
    const pose = walkPose(0.21);
    expect(Math.sign(pose.bones.armR_upper!.rx)).toBe(-Math.sign(pose.bones.legR_thigh!.rx));
    expect(Math.sign(pose.bones.armL_upper!.rx)).toBe(-Math.sign(pose.bones.legL_thigh!.rx));
  });

  it('keeps the gun hands quieter than the Necromancer swings its arms', () => {
    // The hands hover by the holsters, so the arm barely moves next to the leg.
    const pose = walkPose(0.21);
    expect(Math.abs(pose.bones.armR_upper!.rx)).toBeLessThan(
      Math.abs(pose.bones.legR_thigh!.rx) * 0.5,
    );
  });

  it('trails each forearm behind its own shoulder', () => {
    const pose = walkPose(0.21);
    for (const side of ['R', 'L'] as const) {
      const upper = pose.bones[`arm${side}_upper`]!.rx;
      const fore = pose.bones[`arm${side}_fore`]!.rx;
      expect(Math.sign(fore)).toBe(Math.sign(upper));
      expect(Math.abs(fore)).toBeLessThan(Math.abs(upper));
    }
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
      const a = walkPose(t);
      const b = walkPose(t + STRIDE_PERIOD);
      expect(everyAngle(b)).toEqual(everyAngle(a).map((v) => expect.closeTo(v, 10)));
      expect(b.rootLift).toBeCloseTo(a.rootLift, 10);
    }
  });

  it('mirrors the legs half a stride apart', () => {
    const a = walkPose(0.1);
    const b = walkPose(0.1 + STRIDE_PERIOD / 2);
    expect(b.bones.legR_thigh!.rx).toBeCloseTo(a.bones.legL_thigh!.rx, 10);
  });

  it('counter-rolls the hips against the shoulders', () => {
    const pose = walkPose(0.21);
    expect(Math.sign(pose.bones.hips!.rz)).toBe(-Math.sign(pose.bones.torso!.rz));
  });

  it('keeps every angle within a plausible range', () => {
    for (let i = 0; i <= 200; i += 1) {
      for (const angle of everyAngle(walkPose((i / 200) * STRIDE_PERIOD))) {
        expect(Math.abs(angle)).toBeLessThan(Math.PI / 2);
      }
    }
  });

  it('never lifts the root above the ground line', () => {
    for (let i = 0; i <= 100; i += 1) {
      const { rootLift } = walkPose((i / 100) * STRIDE_PERIOD);
      expect(rootLift).toBeLessThanOrEqual(0);
      expect(rootLift).toBeGreaterThan(-0.05);
    }
  });

  it('scales with the stride option', () => {
    const small = walkPose(0.21, { stride: 0.1 });
    const large = walkPose(0.21, { stride: 0.8 });
    expect(Math.abs(large.bones.legR_thigh!.rx)).toBeGreaterThan(
      Math.abs(small.bones.legR_thigh!.rx),
    );
  });
});

describe('shootPose', () => {
  it('only emits known bone names', () => {
    const pose = shootPose(0.5);
    for (const name of Object.keys(pose.bones)) {
      expect(BONE_NAMES).toContain(name as BoneName);
    }
  });

  it('starts and ends at rest', () => {
    for (const t of [0, 1]) {
      for (const angle of everyAngle(shootPose(t))) {
        expect(angle).toBeCloseTo(0, 6);
      }
      expect(shootPose(t).rootLift).toBeCloseTo(0, 6);
    }
  });

  it('clamps progress outside 0..1', () => {
    expect(everyAngle(shootPose(-2))).toEqual(everyAngle(shootPose(0)));
    expect(everyAngle(shootPose(4))).toEqual(everyAngle(shootPose(1)));
  });

  it('raises both guns to aim before the first shot', () => {
    // Negative rx is forward/up for the arms.
    const pose = shootPose(0.35);
    expect(pose.bones.armR_upper!.rx).toBeLessThan(-1);
    expect(pose.bones.armL_upper!.rx).toBeLessThan(-1);
  });

  it('holsters again by the end', () => {
    expect(shootPose(0.95).bones.armR_upper!.rx).toBeGreaterThan(
      shootPose(0.8).bones.armR_upper!.rx,
    );
  });

  it('fires the right hand before the left', () => {
    // At the right hand's shot the right shoulder is driven back relative to
    // its own aim, while the left is still holding steady.
    const aiming = shootPose(0.35).bones.armR_upper!.rx;
    const firing = shootPose(SHOT_R_PEAK);
    expect(firing.bones.armR_upper!.rx).toBeGreaterThan(aiming);
    expect(firing.bones.armL_upper!.rx).toBeLessThan(firing.bones.armR_upper!.rx);
  });

  it('fires the left hand after the right has recovered', () => {
    const firing = shootPose(SHOT_L_PEAK);
    expect(firing.bones.armL_upper!.rx).toBeGreaterThan(firing.bones.armR_upper!.rx);
  });

  it('flips the muzzle up as the shoulder kicks back', () => {
    const firing = shootPose(SHOT_R_PEAK);
    const aiming = shootPose(0.35);
    // Shoulder goes back (less negative), forearm goes further forward/up.
    expect(firing.bones.armR_upper!.rx).toBeGreaterThan(aiming.bones.armR_upper!.rx);
    expect(firing.bones.armR_fore!.rx).toBeLessThan(aiming.bones.armR_fore!.rx);
  });

  it('rocks the torso back on each shot and keeps the head level', () => {
    for (const peak of [SHOT_R_PEAK, SHOT_L_PEAK]) {
      const pose = shootPose(peak);
      expect(pose.bones.torso!.rx).toBeGreaterThan(0);
      expect(Math.sign(pose.bones.head!.rx)).toBe(-Math.sign(pose.bones.torso!.rx));
    }
  });

  it('never bends a knee forwards', () => {
    for (let i = 0; i <= 200; i += 1) {
      const pose = shootPose(i / 200);
      expect(pose.bones.legR_shin!.rx).toBeGreaterThanOrEqual(0);
      expect(pose.bones.legL_shin!.rx).toBeGreaterThanOrEqual(0);
    }
  });

  it('stays within a plausible range throughout', () => {
    for (let i = 0; i <= 200; i += 1) {
      for (const angle of everyAngle(shootPose(i / 200))) {
        expect(Math.abs(angle)).toBeLessThan(Math.PI / 2);
      }
    }
  });

  it('never lifts the root above the ground line', () => {
    for (let i = 0; i <= 200; i += 1) {
      const { rootLift } = shootPose(i / 200);
      expect(rootLift).toBeLessThanOrEqual(1e-12);
      expect(rootLift).toBeGreaterThan(-0.05);
    }
  });

  it('is continuous everywhere, including the shot seams', () => {
    let previous = shootPose(0);
    for (let i = 1; i <= 1000; i += 1) {
      const pose = shootPose(i / 1000);
      const a = everyAngle(previous);
      const b = everyAngle(pose);
      for (let k = 0; k < a.length; k += 1) {
        expect(Math.abs(b[k] - a[k])).toBeLessThan(0.05);
      }
      previous = pose;
    }
  });

  it('scales with the reach option', () => {
    const shallow = shootPose(0.35, { reach: 0.5 });
    const deep = shootPose(0.35, { reach: 1.4 });
    expect(deep.bones.armR_upper!.rx).toBeLessThan(shallow.bones.armR_upper!.rx);
  });
});
