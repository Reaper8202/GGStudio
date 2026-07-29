# Zombie Motorworks Architecture

Read `CONTEXT.md` first. This document explains the design behind the task map;
it is not intended as the default entry point for every change. Generated
per-file exports and imports live in `docs/generated/module-map.md`.

## Dependency Shape

`src/core/` is the stable center. It is pure TypeScript and has no Three.js,
Rapier, DOM, or storage dependencies. Runtime and mode Modules build outward
from it, while `src/app/` is the composition root.

```text
                         src/app/
                  (boot, modes, persistence)
                    /        |        \
             src/editor/ src/chamber/ src/survival/
                  \          |          /
                   \     src/runtime/  /
                    \        |        /
                       src/core/

               src/ui/ supplies shared DOM primitives
```

The important dependency rule is not strict layering for its own sake. It is
Locality: gameplay formulas and serializable rules stay in `core`; transient
physics stays in `runtime`; mode-specific input/presentation stays in its mode;
cross-mode ordering and browser persistence stay in `app`.

## Module Map

| Module | Main responsibility | Important Interfaces |
| --- | --- | --- |
| `src/core/types.ts` | Serializable vehicle vocabulary | `VehicleBlueprint`, `PlacedPart`, `PartDefinition`, grid/vector/config types |
| `src/core/parts.ts` | Immutable part catalog | `PART_CATALOG`, `getPartDef` |
| `src/core/blueprint.ts` | Blueprint creation and immutable edits | add/remove/replace/prune helpers |
| `src/core/grid.ts` | Canonical 24-orientation integer transforms | compose, mirror, transform helpers |
| `src/core/placement.ts` | Occupancy, bounds, mount, and play-gate validation | `canPlacePart`, `validateBlueprint` |
| `src/core/structural.ts` | Socket graph, root reachability, and islands | `deriveConnections`, `computeIslands` |
| `src/core/analysis.ts` | Player-facing vehicle metrics and warnings | `analyzeVehicle` |
| `src/core/commands.ts` | Reversible Blueprint transactions with wallet deltas | `CommandHistory`, editor commands |
| `src/core/serialize.ts` | Blueprint schema validation and migrations | `serializeBlueprint`, `deserializeBlueprint` |
| `src/core/profile.ts` | Profile data, defaults, progression, codec | `PlayerProfile`, profile encode/decode |
| `src/core/runSave.ts` | Run-save schema and migration | `SavedRun`, run encode/decode |
| `src/core/economy.ts` | Purchase, investment, refund, repair math | pure economy helpers and `RunState` |
| `src/core/upgrades.ts` | Effective stat and upgrade-price resolution | `getEffectiveDef`, `upgradePrice` |
| `src/core/turretModules.ts` | Turret module levels, gates, prices, effects | module state/effect helpers |
| `src/runtime/assembler.ts` | Blueprint-to-Rapier construction | `assembleVehicle`, runtime part/wheel records |
| `src/runtime/vehicle.ts` | Fixed-step vehicle facade | controls, telemetry, damage, resources, weapons |
| `src/runtime/wheels.ts` | Raycast suspension and steering | wheel step and telemetry helpers |
| `src/runtime/drivetrain.ts` | Torque/power distribution | drivetrain step helpers |
| `src/runtime/damage.ts` | Part HP and structural resolution | damage application and debris results |
| `src/runtime/weapons.ts` | Runtime weapon creation and stepping | aim input, ammo, tracer results |
| `src/editor/EditorMode.ts` | Garage scene and editor orchestration | `EditorMode`, store/upgrade preview helpers |
| `src/editor/ui.ts` | Garage DOM Adapter | `buildEditorUI`, UI handler/data Interfaces |
| `src/chamber/ChamberMode.ts` | Disposable test-drive mode | `ChamberMode`, scenarios |
| `src/survival/SurvivalMode.ts` | Combat scene and phase orchestration | `SurvivalMode`, callbacks, telemetry |
| `src/survival/WaveManager.ts` | Pure wave formulas plus spawn scheduling | composition/multiplier helpers, `WaveManager` |
| `src/survival/waveBalance.ts` | Readable/reportable view of wave math | reports, composition labels, threat warnings |
| `src/survival/zombies/` | Pool, AI, specialist behavior, projectiles, mines | `ZombieSystem` and specialist Modules |
| `src/app/App.ts` | Composition root and lifecycle owner | mode transitions, Run Checkpoint, debug Seam |
| `src/app/profileStore.ts` | Profile storage Adapter | `ProfileStore` |
| `src/app/runSaveStore.ts` | Run storage Adapter | `RunSaveStore` |

## Blueprint Pipeline

`VehicleBlueprint` is the only persistent vehicle authority:

```text
VehicleBlueprint
  |-- canPlacePart / validateBlueprint
  |-- analyzeVehicle
  |-- serializeBlueprint / deserializeBlueprint
  `-- deriveConnections -> assembleVehicle -> RuntimeVehicle
                                      |-- raycast wheels + drivetrain
                                      |-- resources + weapons
                                      `-- damage -> root island + debris islands
```

Blueprints contain stable identifiers and configuration, not runtime object
references. A runtime mode builds a disposable representation. Per-part run HP
is carried beside the Blueprint in a Run Checkpoint because ordinary garage
saves imply full health.

Every stat-sensitive path resolves a Placed Part through `getEffectiveDef`.
That gives the analyzer, assembler, repair policy, weapons, and UI previews one
upgrade Implementation. Adding another upgrade formula elsewhere reduces
Locality and creates player-visible disagreement.

## Runtime Vehicle

`assembleVehicle` builds one compound dynamic Rapier body for the attached
vehicle. Non-wheel parts receive colliders; attached wheel colliders contribute
mass but filter physical contacts. `stepWheels` uses terrain raycasts for spring,
damping, environment-modified grip, load-dependent rolling drag, steering,
braking, and drive forces.

`RuntimeVehicle` is the deep Module over this machinery. Mode callers provide
controls and a fixed time step, then consume telemetry, shots, and structural
results. Callers should not coordinate wheel, drivetrain, damage, and weapon
ordering themselves.

When damage breaks the Connection Graph, the root-connected island remains on
the vehicle body. Other islands are removed from vehicle authority and emitted
as debris bodies with inherited point velocity. Survival reports only living,
root-attached part IDs when creating the next checkpoint.

### Collision Groups

Rapier groups use `(membership << 16) | filter`.

| Group | Membership | Purpose |
| --- | ---: | --- |
| Terrain | `0x0001` | Fixed chamber and graveyard colliders; suspension-ray target |
| Vehicle | `0x0002` | Attached non-wheel part colliders and damage contacts |
| Wheel | `0x0004` | Attached mass-only colliders; physical contacts filtered out |
| Debris | `0x0008` | Detached structural islands |
| Zombie | `0x0010` | Dynamic pooled zombie bodies |

Weapon rays query the groups appropriate to their damage mode. Wheel rays query
terrain only. Collision-group changes have a large blast radius and require
both runtime unit coverage and browser collision/drive coverage.

## Application And Mode Lifecycle

`App` initializes Rapier and one WebGL renderer, owns the animation loop, and
keeps at most one active gameplay mode. Modes are disposable: each owns its
scene, listeners, DOM, and physics world and must release them in `dispose`.

### Title And Garage

`TitleScreen` offers new, continue, and resumable-run paths. `App.openEditor`
constructs `EditorMode` with the shared Profile and Command History plus
optional run-repair and summary Adapters. The editor owns the Blueprint-slot
localStorage Adapter; Profile and Run persistence are owned by `app`.

Successful editor commands autosave. Undo and redo remain alive across ordinary
Garage/Test Chamber round trips, along with the camera/layer view. They are
cleared when permanent survival losses invalidate references to old part IDs.

### Test Chamber

`App.enterChamber` captures editor view state, disposes the Garage, and creates a
`ChamberMode`. The chamber assembles a runtime clone and never writes damage or
movement back into the saved Blueprint. Returning recreates the Garage.

### Survival Run

The run has three distinct state layers:

1. **Profile**: spendable wallet and lifetime progression.
2. **Run Checkpoint**: committed Blueprint, HP, wave, kills, and banked earnings.
3. **Live wave**: transient runtime HP, zombie state, elapsed time, and pending
   rewards.

At run start, `createInitialRunCheckpoint` records full effective HP. Survival
is created from `runStateFromCheckpoint`. A kill adds pending reward inside
`SurvivalMode`; Profile money changes only when `bankPendingWaveRewards` calls
the App reward callback after a valid wave clear.

The clear transition first resolves the completed physics step. If the vehicle
also died, the clear is rejected. Otherwise the reward is banked once, lifetime
progression is recorded, and `App.commitClearedWaveCheckpoint` prunes destroyed
parts and stores carried HP. Both post-clear actions consume this same state:

- **Continue Now** begins the next wave in the existing Survival scene.
- **Garage / Repair** recreates EditorMode with a repair Adapter over the
  checkpoint.

Failure discards live pending reward and restores the failed wave's checkpoint.
The run then ends; prior cleared-wave part losses stay absent, while surviving
checkpoint parts recover to full health in the ordinary Garage. Reset Wave and
Save & Quit also use the checkpoint, but Reset remains in the run and Save &
Quit persists it for resume.

## Persistence Architecture

Codecs and storage are separate Seams:

```text
unknown JSON -> core decoder -> normalized domain value -> App/Editor
App/Editor -> core encoder -> storage Adapter -> localStorage
```

- Profile schema 1 is decoded by `core/profile.ts` and stored by
  `app/profileStore.ts` at `scraprig.profile.v1`.
- Blueprint schema 4 is decoded by `core/serialize.ts`, with migrations from
  schemas 1-3, and stored as named slots by `EditorMode` at
  `scraprig.blueprints.v1`.
- Saved Run schema 2 is decoded by `core/runSave.ts`, including valid schema-1
  migration, and stored by `app/runSaveStore.ts` at `scraprig.run.v1`.

Decoders fail closed: corrupt Blueprint or Run data does not escape into a
runtime mode. Profile decoding normalizes known catalog IDs and safe-integer
economy values. Storage exceptions are caught where continued in-memory play is
possible; explicit transactions still report persistence failure to the UI.

## Economy Consistency

Profile money is the only spendable balance. Run earnings are an accounting
subset used for summaries, not a second wallet. `CommandHistory` applies money
deltas with Blueprint edits so execute/undo/redo remain symmetric.

Store unlock-and-buy uses one atomic editor transaction: deduct total price,
record unlock if needed, add Inventory, then arm placement. Rollback restores
all three on failure. Placement consumes Inventory. Selling returns the pure
`sellRefund` result. Repairs operate only through the in-run repair Adapter in
`App`, where Profile payment and checkpoint HP change together.

Upgrade previews create a temporary upgraded Blueprint and rerun the same
effective-definition and vehicle-analysis helpers used by gameplay. UI code
formats those results; it does not own formulas.

## Survival Composition

`SurvivalMode` owns the fixed-step loop, combat input, HUD, phase transitions,
and visual synchronization. It composes deeper Modules:

- `WaveManager`: total composition, active cap, multipliers, horde scheduling,
  remaining count, and clear notification.
- `ZombieSystem`: fixed body pool, kind selection, damage, kills, separation,
  and specialist coordination.
- `Landmines` and `ThrowerProjectiles`: pooled hazards.
- `AutoAim`: per-weapon target selection and aim inputs.
- `Minimap`: throttled 2D projection from a snapshot Interface.
- `Graveyard`: environment geometry, props, spawn locations, and feature data.

Balance formulas live in `WaveManager.ts`, base/specialist constants in
`zombies/zombieConfig.ts`, and diagnostic aggregation in `waveBalance.ts`.
Tests should assert those sources rather than copying tables into architecture
docs.

## Testing Architecture

Vitest exercises pure Interfaces and lifecycle helpers without rendering. Unit
tests should enter through the same Interface production callers use; extracting
a pass-through helper only for a test creates a shallow Module and misses
ordering bugs.

Playwright boots the real app through Vite. `App.debugSeam` installs
`window.__scrapRig` when `?debug=1` is present. `tests/seam.ts` is the browser
Adapter for boot, deterministic fixed stepping, Blueprint placement, controls,
and telemetry. Prefer extending this Seam over selecting internal DOM for
physics or state setup; retain visible assertions for user-facing workflows.

## Large-File Navigation

Three orchestration files contain most cross-Module ordering. Search by symbol
instead of reading them front to back:

| File | Search targets by concern |
| --- | --- |
| `src/app/App.ts` | `openEditor`, `enterChamber`, `startRun`, `resumeRun`, `enterSurvival`, `commitClearedWaveCheckpoint`, `enterBuildPhase`, `finishRun`, `repairPart`, `saveAndQuitRun`, `debugSeam` |
| `src/editor/EditorMode.ts` | exported store/preview helpers, `exec`, `buyUpgrade`, `repairPart`, `sellPart`, `buyAndArmPart`, `placeGhost`, selection methods, `persistGarage`, `refresh` |
| `src/survival/SurvivalMode.ts` | `SurvivalCallbacks`, `buildUI`, `stepFixed`, `onWaveComplete`, pending reward methods, `queueCompletedStepTransition`, `showVictory`, `queueGameOver`, `syncHud`, debug methods |

These files are integration owners, so callback order is part of their
Interface. If they are later split, use domain-owned deep Modules with small
Interfaces; splitting DOM, state, and ordering into pass-through files would
increase reading and coordination cost rather than reduce it.

## Documentation Boundaries

- `CONTEXT.md`: stable vocabulary, ownership, invariants, and task routing.
- This file: architectural rationale and runtime composition.
- `INTEGRATION_SPEC.md`: executable cross-Module contracts and callback order.
- `generated/module-map.md`: generated files, LOC, exports, imports, and tests.
- `vehicle_editor/`: focused editor design/reference material.
- `agent-prompts/` and `agent-reports/`: historical snapshots only.
