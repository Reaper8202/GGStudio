/**
 * Reversible, immutable editing operations for vehicle blueprints.
 * Placement validity is owned by placement.ts; these commands only enforce
 * operations that cannot be meaningfully applied to the current blueprint.
 */

import {
  getPart,
  withPartAdded,
  withPartRemoved,
  withPartUpdated,
} from './blueprint.ts';
import { mirrorCellX, mirrorOrientationX } from './grid.ts';
import type { PartConfig, PlacedPart, VehicleBlueprint } from './types.ts';

export interface EditorCommand {
  readonly label: string;
  readonly moneyDelta: number;
  apply(bp: VehicleBlueprint): VehicleBlueprint;
  invert(bpBefore: VehicleBlueprint): EditorCommand;
}

interface HistoryEntry {
  readonly command: EditorCommand;
  readonly inverse: EditorCommand;
}

function clonePart(part: PlacedPart): PlacedPart {
  return {
    ...part,
    pos: { ...part.pos },
    config: { ...part.config },
  };
}

function cloneBlueprint(bp: VehicleBlueprint): VehicleBlueprint {
  return { ...bp, parts: bp.parts.map(clonePart) };
}

function requirePart(bp: VehicleBlueprint, partId: string): PlacedPart {
  const part = getPart(bp, partId);
  if (part === undefined) throw new Error(`unknown part id: ${partId}`);
  return part;
}

function requireNewPartId(bp: VehicleBlueprint, partId: string): void {
  if (getPart(bp, partId) !== undefined)
    throw new Error(`duplicate part id: ${partId}`);
}

function inverseMoneyDelta(moneyDelta: number): number {
  return moneyDelta === 0 ? 0 : -moneyDelta;
}

export function placeCommand(
  part: PlacedPart,
  moneyDelta = 0,
): EditorCommand {
  const placed = clonePart(part);
  return {
    label: `Place ${placed.defId}`,
    moneyDelta,
    apply(bp) {
      requireNewPartId(bp, placed.id);
      return withPartAdded(bp, placed);
    },
    invert() {
      return removeCommand(placed.id, inverseMoneyDelta(moneyDelta));
    },
  };
}

export function removeCommand(partId: string, moneyDelta = 0): EditorCommand {
  return {
    label: `Remove ${partId}`,
    moneyDelta,
    apply(bp) {
      requirePart(bp, partId);
      return withPartRemoved(bp, partId);
    },
    invert(bpBefore) {
      return placeCommand(
        clonePart(requirePart(bpBefore, partId)),
        inverseMoneyDelta(moneyDelta),
      );
    },
  };
}

export function moveCommand(
  partId: string,
  toPos: PlacedPart['pos'],
  moneyDelta = 0,
): EditorCommand {
  const destination = { ...toPos };
  return {
    label: `Move ${partId}`,
    moneyDelta,
    apply(bp) {
      requirePart(bp, partId);
      return withPartUpdated(bp, partId, (part) => ({
        ...part,
        pos: { ...destination },
      }));
    },
    invert(bpBefore) {
      return moveCommand(
        partId,
        requirePart(bpBefore, partId).pos,
        inverseMoneyDelta(moneyDelta),
      );
    },
  };
}

export function rotateCommand(
  partId: string,
  toOrient: PlacedPart['orient'],
  moneyDelta = 0,
): EditorCommand {
  return {
    label: `Rotate ${partId}`,
    moneyDelta,
    apply(bp) {
      requirePart(bp, partId);
      return withPartUpdated(bp, partId, { orient: toOrient });
    },
    invert(bpBefore) {
      return rotateCommand(
        partId,
        requirePart(bpBefore, partId).orient,
        inverseMoneyDelta(moneyDelta),
      );
    },
  };
}

export function updateConfigCommand(
  partId: string,
  config: PartConfig,
  moneyDelta = 0,
): EditorCommand {
  const nextConfig = { ...config };
  return {
    label: `Update ${partId} configuration`,
    moneyDelta,
    apply(bp) {
      requirePart(bp, partId);
      return withPartUpdated(bp, partId, (part) => ({
        ...part,
        config: { ...nextConfig },
      }));
    },
    invert(bpBefore) {
      return updateConfigCommand(
        partId,
        requirePart(bpBefore, partId).config,
        inverseMoneyDelta(moneyDelta),
      );
    },
  };
}

export function duplicateCommand(
  partId: string,
  newId: string,
  toPos: PlacedPart['pos'],
  moneyDelta = 0,
): EditorCommand {
  const destination = { ...toPos };
  return {
    label: `Duplicate ${partId}`,
    moneyDelta,
    apply(bp) {
      const source = requirePart(bp, partId);
      requireNewPartId(bp, newId);
      return withPartAdded(bp, {
        id: newId,
        defId: source.defId,
        pos: destination,
        orient: source.orient,
        config: { ...source.config },
      });
    },
    invert() {
      return removeCommand(newId, inverseMoneyDelta(moneyDelta));
    },
  };
}

export function mirrorCommand(
  partId: string,
  newId: string,
  moneyDelta = 0,
): EditorCommand {
  return {
    label: `Mirror ${partId}`,
    moneyDelta,
    apply(bp) {
      const source = requirePart(bp, partId);
      requireNewPartId(bp, newId);
      return withPartAdded(bp, {
        id: newId,
        defId: source.defId,
        pos: mirrorCellX(source.pos),
        orient: mirrorOrientationX(source.orient),
        config: { ...source.config },
      });
    },
    invert() {
      return removeCommand(newId, inverseMoneyDelta(moneyDelta));
    },
  };
}

export function batchCommand(
  label: string,
  commands: readonly EditorCommand[],
): EditorCommand {
  const members = [...commands];
  return {
    label,
    moneyDelta: members.reduce(
      (total, command) => total + command.moneyDelta,
      0,
    ),
    apply(bp) {
      return members.reduce((current, command) => command.apply(current), bp);
    },
    invert(bpBefore) {
      let current = bpBefore;
      const inverses: EditorCommand[] = [];
      for (const command of members) {
        inverses.push(command.invert(current));
        current = command.apply(current);
      }
      return batchCommand(label, inverses.reverse());
    },
  };
}

/** Replaces the whole build while preserving undo/redo and wallet accounting. */
export function replaceBlueprintCommand(
  nextBlueprint: VehicleBlueprint,
  moneyDelta = 0,
  label = 'Replace blueprint',
): EditorCommand {
  const replacement = cloneBlueprint(nextBlueprint);
  return {
    label,
    moneyDelta,
    apply() {
      return cloneBlueprint(replacement);
    },
    invert(bpBefore) {
      return replaceBlueprintCommand(
        bpBefore,
        inverseMoneyDelta(moneyDelta),
        label,
      );
    },
  };
}

export class CommandHistory {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];

  constructor(
    /** Must validate before mutation, or roll its own mutation back before throwing. */
    private readonly mutateMoney: (moneyDelta: number) => void = () => {},
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabels(): string[] {
    return this.undoStack.map((entry) => entry.command.label);
  }

  get redoLabels(): string[] {
    return this.redoStack.map((entry) => entry.command.label);
  }

  execute(bp: VehicleBlueprint, command: EditorCommand): VehicleBlueprint {
    const next = command.apply(bp);
    const inverse = command.invert(bp);
    this.applyMoneyDelta(command.moneyDelta);
    this.undoStack.push({ command, inverse });
    this.redoStack.length = 0;
    return next;
  }

  undo(bp: VehicleBlueprint): VehicleBlueprint | null {
    const entry = this.undoStack.at(-1);
    if (entry === undefined) return null;

    const next = entry.inverse.apply(bp);
    this.applyMoneyDelta(entry.inverse.moneyDelta);
    this.undoStack.pop();
    this.redoStack.push(entry);
    return next;
  }

  redo(bp: VehicleBlueprint): VehicleBlueprint | null {
    const entry = this.redoStack.at(-1);
    if (entry === undefined) return null;

    const next = entry.command.apply(bp);
    this.applyMoneyDelta(entry.command.moneyDelta);
    this.redoStack.pop();
    this.undoStack.push(entry);
    return next;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  private applyMoneyDelta(moneyDelta: number): void {
    if (moneyDelta !== 0) this.mutateMoney(moneyDelta);
  }
}
