import { describe, expect, it } from 'vitest';

import {
  BONE_NAMES,
  castPose,
  smoothStep,
  walkPose,
  type BoneName,
} from '../src/tools/necromancerPose';

const CADENCE = 1.15;
const STRIDE_PERIOD = 1 / CADENCE;

function everyAngle(pose: ReturnType<typeof walkPose>): number[] {
  return Object.values(pose.bones).flatMap((bone) => [bone.rx, bone.ry, bone.rz]);
}

describe('smoothStep', () => {
  it('clamps outside 0..1 and is flat at both ends', () => {
    expect(smoothStep(-3)).toBe(0);
    expect(smoothStep(0)).toBe(0);
    expect(smoothStep(1)).toBe(1);
    expect(smoothStep(9)).toBe(1);
    expect(smoothStep(0.5)).toBeCloseTo(0.5, 10);
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

describe('castPose', () => {
  it('starts and ends at rest', () => {
    for (const t of [0, 1]) {
      for (const angle of everyAngle(castPose(t))) {
        expect(angle).toBeCloseTo(0, 6);
      }
    }
  });

  it('clamps progress outside 0..1', () => {
    expect(everyAngle(castPose(-2))).toEqual(everyAngle(castPose(0)));
    expect(everyAngle(castPose(4))).toEqual(everyAngle(castPose(1)));
  });

  it('raises the arms during the wind-up', () => {
    // Negative rx is forward/up for the arms.
    expect(castPose(0.45).bones.armL_upper!.rx).toBeLessThan(0);
  });

  it('drives the arms below the wind-up peak on release', () => {
    const peak = castPose(0.45).bones.armL_upper!.rx;
    const released = castPose(0.65).bones.armL_upper!.rx;
    expect(released).toBeGreaterThan(peak);
  });

  it('leads with the tome-carrying left arm', () => {
    const pose = castPose(0.45);
    expect(Math.abs(pose.bones.armL_upper!.rx)).toBeGreaterThan(
      Math.abs(pose.bones.armR_upper!.rx),
    );
  });

  it('never bends a knee forwards', () => {
    for (let i = 0; i <= 100; i += 1) {
      const pose = castPose(i / 100);
      expect(pose.bones.legR_shin!.rx).toBeGreaterThanOrEqual(0);
      expect(pose.bones.legL_shin!.rx).toBeGreaterThanOrEqual(0);
    }
  });

  it('stays within a plausible range throughout', () => {
    for (let i = 0; i <= 100; i += 1) {
      for (const angle of everyAngle(castPose(i / 100))) {
        expect(Math.abs(angle)).toBeLessThan(Math.PI / 2);
      }
    }
  });

  it('is continuous across the wind-up and release seams', () => {
    for (const seam of [0.45, 0.65]) {
      const before = castPose(seam - 0.001).bones.armL_upper!.rx;
      const after = castPose(seam + 0.001).bones.armL_upper!.rx;
      expect(Math.abs(after - before)).toBeLessThan(0.02);
    }
  });
});
