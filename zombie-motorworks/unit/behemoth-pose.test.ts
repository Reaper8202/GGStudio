import { describe, expect, it } from 'vitest';

import { SMASH_IMPACT, smashPose, walkPose } from '../src/tools/behemothPose';
import { BONE_NAMES, type BoneName } from '../src/tools/rigPose';

const CADENCE = 0.9;
const STRIDE_PERIOD = 1 / CADENCE;

function everyAngle(pose: ReturnType<typeof walkPose>): number[] {
  return Object.values(pose.bones).flatMap((bone) => [bone.rx, bone.ry, bone.rz]);
}

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
      expect(rootLift).toBeGreaterThan(-0.1);
    }
  });

  it('scales with the stride option', () => {
    const small = walkPose(0.21, { stride: 0.1 });
    const large = walkPose(0.21, { stride: 0.8 });
    expect(Math.abs(large.bones.legR_thigh!.rx)).toBeGreaterThan(
      Math.abs(small.bones.legR_thigh!.rx),
    );
  });

  it('is the heaviest-bobbing walk in the horde by default', () => {
    // Bigger stride/bob than the Necromancer's shamble (0.52 stride, 0.035 bob)
    // is the whole point of this rig — a lumbering giant, not a stalker.
    const pose = walkPose(STRIDE_PERIOD / 4);
    expect(Math.abs(pose.bones.legR_thigh!.rx)).toBeGreaterThan(0.5);
  });
});

describe('smashPose', () => {
  it('only emits known bone names', () => {
    const pose = smashPose(0.5);
    for (const name of Object.keys(pose.bones)) {
      expect(BONE_NAMES).toContain(name as BoneName);
    }
  });

  it('starts and ends at rest', () => {
    for (const t of [0, 1]) {
      for (const angle of everyAngle(smashPose(t))) {
        expect(angle).toBeCloseTo(0, 6);
      }
      expect(smashPose(t).rootLift).toBeCloseTo(0, 6);
    }
  });

  it('clamps progress outside 0..1', () => {
    expect(everyAngle(smashPose(-2))).toEqual(everyAngle(smashPose(0)));
    expect(everyAngle(smashPose(4))).toEqual(everyAngle(smashPose(1)));
  });

  it('raises both arms together overhead through the wind-up', () => {
    // Negative rx raises an arm; both hands go up together for a two-handed
    // overhead slam, unlike the Gunslinger's independently timed guns.
    const pose = smashPose(0.3);
    expect(pose.bones.armR_upper!.rx).toBeLessThan(-0.5);
    expect(pose.bones.armL_upper!.rx).toBeCloseTo(pose.bones.armR_upper!.rx, 10);
  });

  it('keeps both arms perfectly in sync across the whole clip', () => {
    for (let i = 0; i <= 200; i += 1) {
      const pose = smashPose(i / 200);
      expect(pose.bones.armL_upper!.rx).toBeCloseTo(pose.bones.armR_upper!.rx, 10);
      expect(pose.bones.armL_fore!.rx).toBeCloseTo(pose.bones.armR_fore!.rx, 10);
    }
  });

  it('swings the arms down past straight through the strike', () => {
    // At the moment gameplay treats as impact, the arms have driven past the
    // bind pose (positive rx) rather than merely returning to it.
    const impact = smashPose(SMASH_IMPACT);
    expect(impact.bones.armR_upper!.rx).toBeGreaterThan(0);
  });

  it('exports an impact frame strictly inside the clip', () => {
    expect(SMASH_IMPACT).toBeGreaterThan(0);
    expect(SMASH_IMPACT).toBeLessThan(1);
  });

  it('never bends a knee backwards', () => {
    for (let i = 0; i <= 200; i += 1) {
      const pose = smashPose(i / 200);
      expect(pose.bones.legR_shin!.rx).toBeGreaterThanOrEqual(0);
      expect(pose.bones.legL_shin!.rx).toBeGreaterThanOrEqual(0);
    }
  });

  it('stays within a plausible range throughout', () => {
    for (let i = 0; i <= 200; i += 1) {
      for (const angle of everyAngle(smashPose(i / 200))) {
        expect(Math.abs(angle)).toBeLessThan(Math.PI);
      }
    }
  });

  it('never lifts the root above the ground line', () => {
    for (let i = 0; i <= 200; i += 1) {
      const { rootLift } = smashPose(i / 200);
      expect(rootLift).toBeLessThanOrEqual(1e-12);
      expect(rootLift).toBeGreaterThan(-0.2);
    }
  });

  it('is continuous everywhere, including the impact frame', () => {
    let previous = smashPose(0);
    for (let i = 1; i <= 1000; i += 1) {
      const pose = smashPose(i / 1000);
      const a = everyAngle(previous);
      const b = everyAngle(pose);
      for (let k = 0; k < a.length; k += 1) {
        expect(Math.abs(b[k] - a[k])).toBeLessThan(0.1);
      }
      previous = pose;
    }
  });

  it('scales with the reach option', () => {
    const shallow = smashPose(0.3, { reach: 0.5 });
    const deep = smashPose(0.3, { reach: 1.8 });
    expect(deep.bones.armR_upper!.rx).toBeLessThan(shallow.bones.armR_upper!.rx);
  });
});
