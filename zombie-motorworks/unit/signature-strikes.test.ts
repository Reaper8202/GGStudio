/**
 * Guards on the window between a signature click and its blast.
 *
 * The queue is where the three signatures actually differ mechanically — one
 * lands instantly, one arcs, one falls under a telegraph — so these cover the
 * timing and the bookkeeping. What the blast looks like is verified by playing.
 */

import { describe, expect, it } from 'vitest';
import { SignatureStrikes, type StrikeImpact } from '../src/survival/SignatureStrikes.ts';
import type { SignatureStats } from '../src/core/signatures.ts';

function stats(overrides: Partial<SignatureStats> = {}): SignatureStats {
  return {
    damage: 100,
    radiusM: 4,
    cooldownSeconds: 3,
    rangeM: 30,
    travelSpeedMps: 0,
    delaySeconds: 0,
    burnSeconds: 0,
    shockSeconds: 0,
    autoFire: false,
    chainTargets: 1,
    chainRangeM: 0,
    chainFalloff: 1,
    ...overrides,
  };
}

const ORIGIN = { x: 0, y: 1, z: 0 };

describe('signature strike flight', () => {
  it('detonates an instant strike on the frame it was fired', () => {
    const strikes = new SignatureStrikes();
    const impacts: StrikeImpact[] = [];

    const immediate = strikes.fire(
      stats(),
      'lightning',
      ORIGIN,
      { x: 10, z: 0 },
      (impact) => impacts.push(impact),
    );

    expect(immediate).toBe(true);
    expect(impacts).toHaveLength(1);
    expect(strikes.activeCount).toBe(0);
  });

  it('holds a shell for its full fall before detonating exactly once', () => {
    const strikes = new SignatureStrikes();
    const impacts: StrikeImpact[] = [];
    strikes.fire(
      stats({ delaySeconds: 4 }),
      'nuke',
      ORIGIN,
      { x: 10, z: 0 },
      (impact) => impacts.push(impact),
    );
    expect(strikes.activeCount).toBe(1);

    // Just short of the fall time: still in the air.
    for (let i = 0; i < 39; i++) {
      strikes.step(0.1, (impact) => impacts.push(impact));
    }
    expect(impacts).toHaveLength(0);

    for (let i = 0; i < 5; i++) {
      strikes.step(0.1, (impact) => impacts.push(impact));
    }
    expect(impacts).toHaveLength(1);
    expect(strikes.activeCount).toBe(0);
  });

  it('makes a longer throw take longer to arrive', () => {
    const near = new SignatureStrikes();
    const far = new SignatureStrikes();
    const payload = stats({ travelSpeedMps: 10 });
    near.fire(payload, 'fireball', ORIGIN, { x: 5, z: 0 }, () => undefined);
    far.fire(payload, 'fireball', ORIGIN, { x: 25, z: 0 }, () => undefined);

    // A quarter second in, the near shot (0.5s of flight) is halfway there and
    // the far one (2.5s) has barely started.
    near.step(0.25, () => undefined);
    far.step(0.25, () => undefined);
    expect(near.visuals()[0].progress).toBeGreaterThan(
      far.visuals()[0].progress,
    );
  });

  it('drops a shell straight onto its target so the marked ring is honest', () => {
    const strikes = new SignatureStrikes();
    strikes.fire(
      stats({ delaySeconds: 4 }),
      'nuke',
      ORIGIN,
      { x: 20, z: 12 },
      () => undefined,
    );
    strikes.step(2, () => undefined);

    const [visual] = strikes.visuals();
    // Horizontally pinned to the impact point for the whole fall, and still
    // above the ground halfway through it.
    expect(visual.x).toBe(20);
    expect(visual.z).toBe(12);
    expect(visual.y).toBeGreaterThan(0);
    expect(visual.targetX).toBe(20);
  });

  it('lifts a lobbed bolus over the midpoint of its throw', () => {
    const strikes = new SignatureStrikes();
    strikes.fire(
      stats({ travelSpeedMps: 10 }),
      'fireball',
      ORIGIN,
      { x: 20, z: 0 },
      () => undefined,
    );
    strikes.step(1, () => undefined);

    const [visual] = strikes.visuals();
    // Halfway along the ground track, and higher than either end of it.
    expect(visual.x).toBeCloseTo(10, 5);
    expect(visual.y).toBeGreaterThan(ORIGIN.y + 1);
  });

  it('paces the telegraph instead of marking every frame', () => {
    const strikes = new SignatureStrikes();
    strikes.fire(
      stats({ delaySeconds: 4 }),
      'nuke',
      ORIGIN,
      { x: 10, z: 0 },
      () => undefined,
    );

    // A four-second fall drawn per frame would spend the whole particle budget
    // on a shot that has not landed yet.
    let marks = 0;
    for (let i = 0; i < 60; i++) {
      strikes.step(1 / 60, () => undefined);
      if (strikes.visuals()[0]?.drawMark) marks += 1;
    }
    expect(marks).toBeGreaterThan(5);
    expect(marks).toBeLessThan(20);
  });

  it('resolves several strikes in flight without losing any', () => {
    const strikes = new SignatureStrikes();
    const impacts: StrikeImpact[] = [];
    for (const delay of [1, 2, 3]) {
      strikes.fire(
        stats({ delaySeconds: delay }),
        'nuke',
        ORIGIN,
        { x: delay, z: 0 },
        (impact) => impacts.push(impact),
      );
    }
    expect(strikes.activeCount).toBe(3);

    strikes.step(2.5, (impact) => impacts.push(impact));
    expect(impacts).toHaveLength(2);
    strikes.step(1, (impact) => impacts.push(impact));
    expect(impacts).toHaveLength(3);
    expect(strikes.activeCount).toBe(0);
  });

  it('drops everything in the air on a wave reset without detonating it', () => {
    const strikes = new SignatureStrikes();
    const impacts: StrikeImpact[] = [];
    strikes.fire(
      stats({ delaySeconds: 4 }),
      'nuke',
      ORIGIN,
      { x: 10, z: 0 },
      (impact) => impacts.push(impact),
    );

    strikes.clear();

    expect(strikes.activeCount).toBe(0);
    strikes.step(10, (impact) => impacts.push(impact));
    // A shell fired at the last zombie of one wave must not land on the first
    // zombie of the next.
    expect(impacts).toHaveLength(0);
  });

  it('carries the status durations through to the blast', () => {
    const strikes = new SignatureStrikes();
    const impacts: StrikeImpact[] = [];
    strikes.fire(
      stats({ burnSeconds: 4, shockSeconds: 1 }),
      'fireball',
      ORIGIN,
      { x: 6, z: 0 },
      (impact) => impacts.push(impact),
    );

    expect(impacts[0].burnSeconds).toBe(4);
    expect(impacts[0].shockSeconds).toBe(1);
    // Blasts resolve at body height, not on the floor: `explodeAt` measures
    // falloff in 3D, so a ground-level centre would charge every zombie most
    // of a metre of distance it never travelled.
    expect(impacts[0].y).toBeGreaterThan(0.5);
  });
});
