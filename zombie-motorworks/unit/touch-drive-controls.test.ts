import { describe, expect, it } from 'vitest';
import {
  createTouchDriveState,
  reduceTouchDriveState,
  touchDriveInput,
} from '../src/survival/TouchDriveControls.ts';

describe('touch drive controls', () => {
  it('combines directions held by simultaneous pointers', () => {
    const forward = reduceTouchDriveState(createTouchDriveState(), {
      type: 'press',
      pointerId: 11,
      direction: 'forward',
    });
    const forwardLeft = reduceTouchDriveState(forward, {
      type: 'press',
      pointerId: 22,
      direction: 'left',
    });

    expect(touchDriveInput(forwardLeft)).toEqual({
      forward: true,
      reverse: false,
      left: true,
      right: false,
    });
    // Reducer preserves prior snapshots for deterministic event handling.
    expect(touchDriveInput(forward).left).toBe(false);
  });

  it('releases only the pointer that ended', () => {
    let state = createTouchDriveState();
    state = reduceTouchDriveState(state, {
      type: 'press',
      pointerId: 1,
      direction: 'right',
    });
    state = reduceTouchDriveState(state, {
      type: 'press',
      pointerId: 2,
      direction: 'right',
    });
    state = reduceTouchDriveState(state, {
      type: 'release',
      pointerId: 1,
    });

    expect(touchDriveInput(state).right).toBe(true);
    state = reduceTouchDriveState(state, {
      type: 'release',
      pointerId: 2,
    });
    expect(touchDriveInput(state).right).toBe(false);
  });

  it('moves a reused pointer to its latest direction', () => {
    let state = reduceTouchDriveState(createTouchDriveState(), {
      type: 'press',
      pointerId: 7,
      direction: 'forward',
    });
    state = reduceTouchDriveState(state, {
      type: 'press',
      pointerId: 7,
      direction: 'reverse',
    });

    expect(touchDriveInput(state)).toEqual({
      forward: false,
      reverse: true,
      left: false,
      right: false,
    });
  });

  it('clears every held pointer on reset', () => {
    let state = reduceTouchDriveState(createTouchDriveState(), {
      type: 'press',
      pointerId: 3,
      direction: 'forward',
    });
    state = reduceTouchDriveState(state, {
      type: 'press',
      pointerId: 4,
      direction: 'right',
    });
    state = reduceTouchDriveState(state, { type: 'reset' });

    expect(touchDriveInput(state)).toEqual({
      forward: false,
      reverse: false,
      left: false,
      right: false,
    });
  });

  it('returns immutable input snapshots', () => {
    const input = touchDriveInput(createTouchDriveState());

    expect(Object.isFrozen(input)).toBe(true);
  });
});
