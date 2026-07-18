You are Codex Agent D on the Scrap Rig project (3D modular vehicle builder, web, strict TypeScript).

READ FIRST (contracts — use verbatim, MUST NOT edit): src/core/types.ts, src/core/grid.ts, src/core/blueprint.ts, src/core/parts.ts. Another agent concurrently owns src/core/analysis.ts — do not create or import it.

YOU OWN EXCLUSIVELY: src/core/commands.ts, unit/commands.test.ts. Touch nothing else.

TASK — src/core/commands.ts: reversible editor commands + history. All commands are pure over VehicleBlueprint (no mutation; use blueprint.ts helpers where they fit).

Design:
- `export interface EditorCommand { readonly label: string; apply(bp: VehicleBlueprint): VehicleBlueprint; invert(bpBefore: VehicleBlueprint): EditorCommand; }` — invert receives the blueprint state BEFORE apply and returns the inverse command.
- Factories:
  - `placeCommand(part: PlacedPart)` ↔ inverse removes that id.
  - `removeCommand(partId)` ↔ inverse re-places the exact removed part (captured from bpBefore).
  - `moveCommand(partId, toPos)` ↔ inverse moves back to prior pos.
  - `rotateCommand(partId, toOrient)` ↔ inverse restores prior orient.
  - `updateConfigCommand(partId, config: PartConfig)` (full replace) ↔ inverse restores prior config.
  - `duplicateCommand(partId, newId, toPos)` — copy def/orient/config to a new id ↔ inverse removes newId.
  - `mirrorCommand(partId, newId)` — mirrored copy across X=0: pos = mirrorCellX applied to pos, orient = mirrorOrientationX(orient), config copied with steerInverted preserved ↔ inverse removes newId. (Use grid.ts mirror helpers; for face-mounted armour this mirrors the covered face automatically via orientation.)
  - `batchCommand(label, commands[])` — applies in order; inverse = batch of member inverses in REVERSE order. Used for symmetry placement and box-delete.
- `export class CommandHistory { execute(bp, cmd): VehicleBlueprint; undo(bp): VehicleBlueprint | null; redo(bp): VehicleBlueprint | null; canUndo/canRedo: boolean; clear(): void; readonly undoLabels/redoLabels: string[] }` — execute pushes the inverse pair and CLEARS the redo stack; undo/redo swap between stacks. Throws nothing on empty (returns null).
- Commands may assume placements were validated by the caller (placement.ts is the gate); apply() should still throw Error on impossible operations (unknown partId, duplicate id on place) — history must not push a command whose apply threw.

TESTS — unit/commands.test.ts with the real catalog: for EVERY factory: apply then undo yields deep-equal original blueprint; redo yields deep-equal applied state. Sequences: place 3, undo 2, redo 1, execute new → redo stack cleared (canRedo false). Batch: symmetry pair (place + mirror) undoes atomically to the exact original. Mirror: wheel at x=-3 with orient identity mirrors to x=+3 with mirrored orientation (assert via worldCells equality of mirrored footprints and rotateVec on the axle: mirrored wheel's axle x-component flips). updateConfig roundtrip. Errors: removing unknown id throws and history stays clean (canUndo unchanged).

RULES: `npm run typecheck` and `npx vitest run` must pass. No new dependencies. No edits outside your two files. Report exactly: Done / Files changed / Tests run / Assumptions / Issues / Next recommended task.
