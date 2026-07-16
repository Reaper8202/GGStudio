import { describe, expect, it } from 'vitest';
import {
  CommandHistory,
  batchCommand,
  duplicateCommand,
  mirrorCommand,
  moveCommand,
  placeCommand,
  removeCommand,
  rotateCommand,
  updateConfigCommand,
} from '../src/core/commands.ts';
import { createEmptyBlueprint, getPart } from '../src/core/blueprint.ts';
import { mirrorCellX, rotateVec, worldCells } from '../src/core/grid.ts';
import { getPartDef } from '../src/core/parts.ts';
import type { EditorCommand } from '../src/core/commands.ts';
import type { PlacedPart, VehicleBlueprint } from '../src/core/types.ts';

function part(
  id: string,
  defId: string,
  x: number,
  y = 0,
  z = 0,
  orient = 0,
  config = {},
): PlacedPart {
  return { id, defId, pos: { x, y, z }, orient, config };
}

function blueprint(parts: PlacedPart[] = []): VehicleBlueprint {
  return { ...createEmptyBlueprint('commands'), id: 'commands-test', parts };
}

function expectRoundTrip(
  original: VehicleBlueprint,
  command: EditorCommand,
): void {
  const history = new CommandHistory();
  const applied = history.execute(original, command);
  expect(history.undo(applied)).toEqual(original);
  expect(history.redo(original)).toEqual(applied);
}

describe('editor commands', () => {
  it('round trips place, remove, move, rotate, duplicate, and config updates', () => {
    const original = blueprint([
      part('p1', 'frame-box', 0, 0, 0, 0, { driven: true }),
    ]);

    expectRoundTrip(original, placeCommand(part('p2', 'frame-reinforced', 1)));
    expectRoundTrip(original, removeCommand('p1'));
    expectRoundTrip(original, moveCommand('p1', { x: 2, y: 1, z: -1 }));
    expectRoundTrip(original, rotateCommand('p1', 7));
    expectRoundTrip(
      original,
      duplicateCommand('p1', 'p2', { x: -2, y: 0, z: 1 }),
    );
    expectRoundTrip(
      original,
      updateConfigCommand('p1', {
        steering: true,
        steerInverted: true,
        braking: true,
      }),
    );
  });

  it('round trips a mirrored copy and preserves mirrored wheel geometry', () => {
    const original = blueprint([
      part('wheel-left', 'wheel-standard', -2, 1, 2, 0, {
        driven: true,
        steering: true,
        steerInverted: true,
      }),
    ]);
    const history = new CommandHistory();
    const command = mirrorCommand('wheel-left', 'wheel-right');
    const applied = history.execute(original, command);
    const left = getPart(applied, 'wheel-left')!;
    const right = getPart(applied, 'wheel-right')!;
    const wheelDef = getPartDef('wheel-standard');

    expect(right.pos).toEqual({ x: 2, y: 1, z: 2 });
    expect(right.config).toEqual(left.config);
    expect(worldCells(wheelDef.cells, right.pos, right.orient)).toEqual(
      worldCells(wheelDef.cells, left.pos, left.orient).map(mirrorCellX),
    );
    const leftAxle = rotateVec(left.orient, wheelDef.wheel!.axleAxis);
    const rightAxle = mirrorCellX(
      rotateVec(right.orient, wheelDef.wheel!.axleAxis),
    );
    expect(rightAxle.x).toBe(-leftAxle.x);
    expect(history.undo(applied)).toEqual(original);
    expect(history.redo(original)).toEqual(applied);
  });

  it('updates configuration by full replacement and restores the exact prior configuration', () => {
    const original = blueprint([
      part('p1', 'wheel-standard', 0, 1, 0, 0, {
        driven: true,
        suspensionPreset: 'off-road',
      }),
    ]);
    const command = updateConfigCommand('p1', {
      steering: true,
      steerInverted: true,
    });
    const applied = command.apply(original);

    expect(getPart(applied, 'p1')!.config).toEqual({
      steering: true,
      steerInverted: true,
    });
    expect(command.invert(original).apply(applied)).toEqual(original);
  });

  it('supports ordered undo/redo and clears redo after a new command', () => {
    const history = new CommandHistory();
    const original = blueprint();
    const afterOne = history.execute(
      original,
      placeCommand(part('p1', 'frame-box', 0)),
    );
    const afterTwo = history.execute(
      afterOne,
      placeCommand(part('p2', 'frame-box', 1)),
    );
    const afterThree = history.execute(
      afterTwo,
      placeCommand(part('p3', 'frame-box', 2)),
    );

    const afterUndoOne = history.undo(afterThree)!;
    const afterUndoTwo = history.undo(afterUndoOne)!;
    expect(afterUndoTwo).toEqual(afterOne);
    expect(history.canRedo).toBe(true);

    const afterRedo = history.redo(afterUndoTwo)!;
    expect(afterRedo).toEqual(afterTwo);
    history.execute(afterRedo, placeCommand(part('p4', 'frame-box', 3)));
    expect(history.canRedo).toBe(false);
  });

  it('undos a symmetry placement batch atomically', () => {
    const original = blueprint();
    const left = part('wheel-left', 'wheel-standard', -2, 1, 0);
    const symmetry = batchCommand('Place wheel pair', [
      placeCommand(left),
      mirrorCommand('wheel-left', 'wheel-right'),
    ]);
    const history = new CommandHistory();
    const applied = history.execute(original, symmetry);

    expect(applied.parts.map((entry) => entry.id)).toEqual([
      'wheel-left',
      'wheel-right',
    ]);
    expect(history.undo(applied)).toEqual(original);
    expect(history.canUndo).toBe(false);
    expect(history.redo(original)).toEqual(applied);
  });

  it('throws for an unknown removal without changing history', () => {
    const history = new CommandHistory();
    const original = blueprint();

    expect(() => history.execute(original, removeCommand('missing'))).toThrow(
      'unknown part id: missing',
    );
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo(original)).toBeNull();
  });

  it('rejects placement with an existing part id', () => {
    const original = blueprint([part('p1', 'frame-box', 0)]);

    expect(() =>
      placeCommand(part('p1', 'frame-reinforced', 1)).apply(original),
    ).toThrow('duplicate part id: p1');
  });
});
