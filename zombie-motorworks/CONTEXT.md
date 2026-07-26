# Zombie Motorworks Context

This is the smallest useful map for implementation agents. It describes stable
domain language, ownership, lifecycle, invariants, and where to start. It is not
a changelog, balance sheet, or per-file encyclopedia.

## Product Loop

Zombie Motorworks is a static Three.js + Rapier game with four application
modes:

```text
Title -> Garage -> Test Chamber -> Garage
                -> Survival wave -> Continue Now -> next wave
                                 -> Garage / Repair -> next wave
                                 -> failure -> ordinary Garage
```

The player builds a grid-snapped vehicle, validates it, test-drives it without
consequences, then takes the same design into wave survival. Cleared-wave damage
and rewards persist through a run. Failed-wave damage and pending rewards roll
back to the wave-start checkpoint; the run then ends.

## Source-Of-Truth Order

When sources disagree, use this order:

1. Runtime code and tests.
2. This file for stable vocabulary and ownership.
3. `docs/INTEGRATION_SPEC.md` for cross-Module contracts.
4. `docs/ARCHITECTURE.md` for detailed design.
5. `docs/generated/module-map.md` for generated structural facts.
6. `docs/vehicle_editor/` for focused editor references.

Files under `docs/agent-prompts/` and `docs/agent-reports/` are historical.
They describe work at the time they were written and can be stale.

## Domain Vocabulary

- **Part Definition**: immutable catalog entry in `src/core/parts.ts`. It owns
  base cost, health, mass, occupied cells, sockets, and optional movement,
  weapon, armour, resource, unlock, and upgrade metadata.
- **Placed Part**: one blueprint instance with an ID, definition ID, integer
  position, canonical orientation, paint/config, and optional upgrade/module
  state.
- **Blueprint**: serializable vehicle authority. It never contains Three.js or
  Rapier objects, transient part HP, wallet state, or live weapon state.
- **Effective Definition**: a Part Definition after applying the Placed Part's
  upgrade level. Analysis, assembly, repair maxima, and weapons must resolve
  through `getEffectiveDef` rather than reimplement scaling.
- **Connection Graph**: socket-derived structural graph. The root island remains
  the controllable vehicle; detached non-root islands become debris.
- **Profile**: persistent wallet, unlocks, inventory, selected blueprint name,
  and lifetime progression counters.
- **Inventory**: purchased but unplaced part counts keyed by definition ID.
- **Run**: a sequence of survival waves sharing banked earnings, cumulative
  kills, committed part losses, and carried part HP.
- **Wave-Start Checkpoint**: immutable run state used by reset, failure, and
  save/quit. It owns the next wave, surviving blueprint, per-part HP, cumulative
  kills, and banked run earnings.
- **Pending Reward**: kill money earned during the active wave. It is visible but
  unspendable until the wave clears.
- **Build Phase**: the in-run Garage between cleared waves. It exposes repairs
  and preserves the checkpoint's damage; it is not an ordinary full-heal Garage.
- **Runtime Vehicle**: Rapier representation assembled from a Blueprint. It owns
  transient physics, resources, weapons, damage, and part detachment.
- **Debug Seam**: `window.__scrapRig` Interface installed by `App` for
  deterministic Playwright access under `?debug=1`.

## Module Ownership

Dependency direction is generally:

```text
app -> editor, chamber, survival
editor -> core
chamber -> runtime -> core
survival -> runtime, core
editor, survival -> ui
```

The diagram shows allowed conceptual dependencies, not every import. `app`
composes all modes. `editor` and `survival` may use shared UI and rendering
helpers. `core` stays engine- and browser-independent.

| Module | Owns | Must not own |
| --- | --- | --- |
| `src/core/` | Types, catalog, blueprint operations, placement, structure, analysis, commands, codecs, profile/run data, upgrades, economy, tutorial predicates, turret-module rules, surfaces, biome definitions | Three.js/Rapier objects, DOM, localStorage |
| `src/runtime/` | Rapier vehicle assembly, wheels, drivetrain, damage, detachment, weapon stepping | Mode transitions, profile persistence, DOM |
| `src/editor/` | Garage scene, placement/selection input, Store/Inventory UI, repair UI, tutorial overlay, blueprint-slot Adapter | Survival progression or run-save policy |
| `src/chamber/` | Disposable test-drive world, scenarios, chamber HUD/camera | Persistent blueprint mutation |
| `src/survival/` | Graveyard, waves, zombie pool/AI, specialists, mines, auto-aim, minimap, combat HUD, victory/game-over presentation | Browser persistence and profile ownership |
| `src/app/` | Boot, renderer, title/mode lifecycle, active Blueprint, Profile, command history, Run Checkpoint, storage Adapters, debug Seam | Duplicated physics or balance formulas |
| `src/ui/` | Shared DOM primitives and the UI museum | Gameplay state |

## Lifecycle Contracts

### Garage and Test Chamber

- `App.openEditor` creates `EditorMode` with the shared Profile, command history,
  saved view, optional run context, repair Adapter, and summary.
- Editor transactions mutate a Blueprint through commands, update Profile money
  or Inventory, and persist successful garage changes.
- `App.enterChamber` stores editor view state and creates a disposable
  `ChamberMode` from the Blueprint. Returning recreates the Garage with the
  authoritative Blueprint unchanged.

### Run Start and Wave Clear

- `App.startRun` creates the wave-1 checkpoint with full effective HP.
- `SurvivalMode` receives only the Blueprint plus checkpoint-derived Run State.
- Zombie kills increment cumulative kills and pending wave reward. They do not
  mutate Profile money.
- Wave clear banks pending kill reward plus clear bonus exactly once through the
  App callback, records progression unlocks, and commits surviving IDs and HP as
  the next wave's checkpoint.
- `Continue Now` stays in Survival with current damage. `Garage / Repair` opens
  an in-run Editor backed by the same checkpoint. Without repair, both choices
  produce equivalent next-wave vehicle state.

### Failure, Reset, and Save

- Failure and Reset Wave restore the failed wave's starting checkpoint and
  discard current-wave pending reward.
- Failure ends the run. Earlier cleared-wave part losses remain committed, while
  surviving checkpoint parts recover to full HP in the ordinary Garage.
- Save & Quit serializes only the wave-start checkpoint. Current-wave damage,
  kills, spawn state, and pending reward are intentionally discarded.
- Resuming loads the saved checkpoint directly into Survival at its recorded
  wave.
- Transient HP belongs to the Run Checkpoint, never the persistent Blueprint
  schema.

## Persistence

| Storage key | Codec/Adapter | Current payload |
| --- | --- | --- |
| `scraprig.profile.v1` | `src/core/profile.ts` / `src/app/profileStore.ts` | Profile schema 1: money, unlocks, inventory, current blueprint name, highest cleared wave, Phone Addict kills |
| `scraprig.blueprints.v1` | `src/core/serialize.ts` / `src/editor/EditorMode.ts` | Named Blueprint slots; Blueprint schema 4 with migrations from schemas 1-3 |
| `scraprig.run.v1` | `src/core/runSave.ts` / `src/app/runSaveStore.ts` | Saved Run schema 2; decoder migrates valid schema-1 saves |
| `scraprig.tutorial-done` | `src/editor/EditorMode.ts` | Existing editor tutorial completion flag |
| `scraprig.help-seen`, `scraprig.welcome-seen` | `src/editor/ui.ts` | Presentation-only acknowledgement flags |

Decoders validate persisted input and normalize or reject malformed values.
Storage access failures must not make the in-memory game unusable.

## Important Invariants And Traps

- The Chassis Core is the structural root and cannot be sold. A playable vehicle
  also needs attached control and engine capability.
- Grid positions and the 24 orientations are integer/canonical. Do not introduce
  free-form rotations into Blueprint data.
- Placement validity and structural connectivity are different questions.
  `placement.ts` owns occupancy/mount validation; `structural.ts` owns the graph.
- Analysis and runtime must agree. Shared mass, upgrade, wheel-layout, and
  effective-definition helpers exist to prevent formula drift.
- Attached wheels carry mass but do not physically collide; suspension rays
  query terrain. Changing collision filters can break handling globally.
- `CommandHistory` applies wallet deltas on execute, undo, and redo. Bypassing it
  for normal editor mutations can duplicate parts or money.
- Unlock-and-buy is atomic. A failed purchase must not leave a paid unlock or
  partial Inventory change.
- Selling refunds half of paid base/upgrade/module investment, floored. Repair
  uses base cost and missing effective HP; upgrading preserves HP percentage.
- The Mine Sweeper and EMP have progression gates in Profile/turret-module
  helpers. UI copy should derive from those rules, not duplicate thresholds.
- `App.ts`, `EditorMode.ts`, and `SurvivalMode.ts` are large orchestration
  Modules. Changes that span them need one integration owner because callback
  ordering is part of their Interface.
- The existing tutorial is editor-owned and resets the active editor Blueprint.
  Do not assume it is an isolated full-loop tutorial.

## Task Routing

Start with the first file and the named tests. Open supporting files only when
the task crosses their Interface.

| Task | Start here | Supporting Modules | Tests |
| --- | --- | --- | --- |
| Catalog part/stats/cost | `src/core/parts.ts` | `types.ts`, `upgrades.ts` | `unit/parts.test.ts`, `unit/upgrades.test.ts` |
| Grid/orientation/mirroring | `src/core/grid.ts` | `types.ts`, `placement.ts` | `unit/grid.test.ts`, `unit/placement.test.ts` |
| Placement/build validation | `src/core/placement.ts` | `structural.ts`, `wheelLayout.ts` | `unit/placement.test.ts`, `unit/structural.test.ts` |
| Vehicle analysis/metrics | `src/core/analysis.ts` | `mass.ts`, `upgrades.ts`, `wheelLayout.ts` | `unit/analysis.test.ts` |
| Blueprint schema/migration | `src/core/serialize.ts` | `types.ts`, `blueprint.ts` | `unit/serialize.test.ts`, `unit/blueprint.test.ts` |
| Profile/inventory/unlocks | `src/core/profile.ts` | `app/profileStore.ts`, `editor/EditorMode.ts` | `unit/profile.test.ts`, `unit/profile-store.test.ts`, `unit/store-flow.test.ts` |
| Economy/repair/upgrades | `src/core/economy.ts` | `upgrades.ts`, `editor/EditorMode.ts`, `app/App.ts` | `unit/economy.test.ts`, `unit/repair.test.ts`, `unit/store-flow.test.ts` |
| Garage input/placement | `src/editor/EditorMode.ts` | `editor/meshes.ts`, `editor/overlays.ts` | `tests/editor.spec.ts` |
| Garage DOM/store/inspector | `src/editor/ui.ts` | `EditorMode.ts`, `style.css`, `ui/system.ts` | `unit/store-flow.test.ts`, `tests/editor.spec.ts` |
| Test-drive physics | `src/chamber/ChamberMode.ts` | `runtime/vehicle.ts`, `runtime/assembler.ts` | `tests/drive.spec.ts`, `tests/collision.spec.ts` |
| Vehicle handling/wheels | `src/runtime/vehicle.ts` | `wheels.ts`, `drivetrain.ts`, `mass.ts` | `unit/wheel-*.test.ts`, `tests/drive.spec.ts`, `tests/reverse.spec.ts` |
| Weapons/modules/ammo | `src/runtime/weapons.ts` | `core/turretModules.ts`, `survival/AutoAim.ts` | `unit/turret-*.test.ts`, `unit/weapon-ammo.test.ts`, `tests/combat.spec.ts` |
| Run checkpoint/rewards/save | `src/app/App.ts` | `core/runSave.ts`, `app/runSaveStore.ts`, `SurvivalMode.ts` | `unit/run-checkpoint.test.ts`, `unit/pending-rewards.test.ts`, `unit/run-save.test.ts`, `tests/runloop.spec.ts` |
| Wave balance/composition | `src/survival/WaveManager.ts` | `waveBalance.ts`, `zombies/zombieConfig.ts` | `unit/waves.test.ts`, `unit/wave-balance.test.ts`, `unit/zombie-balance.test.ts` |
| Zombie AI/specialists | `src/survival/zombies/Zombie.ts` | `ZombieSystem.ts`, `Landmines.ts`, `ThrowerProjectiles.ts` | `unit/landmines.test.ts`, `tests/combat.spec.ts` |
| Survival HUD/transitions | `src/survival/SurvivalMode.ts` | `App.ts`, `WaveManager.ts`, `style.css` | `unit/summaries.test.ts`, `tests/runloop.spec.ts`, `tests/failure.spec.ts` |
| Minimap/mine detection | `src/survival/Minimap.ts` | `Graveyard.ts`, `Landmines.ts`, `turretModules.ts` | `unit/minimap.test.ts`, `unit/landmines.test.ts` |
| Tutorial | `src/core/tutorial.ts` | `editor/TutorialOverlay.ts`, `EditorMode.ts`, `ui.ts` | `unit/tutorial.test.ts`, `tests/tutorial.spec.ts` |
| Title/resume flow | `src/app/TitleScreen.ts` | `App.ts`, `runSaveStore.ts` | `tests/title.spec.ts`, `unit/app.test.ts` |
| Debug/browser Seam | `src/app/App.ts` (`installDebugSeam`) | `tests/seam.ts` | the affected Playwright spec |

## Documentation Update Rule

Update this file only for changes to vocabulary, Module ownership, lifecycle,
persistence, invariants, or task routing. Let generated structure and code-owned
constants change without copying them here. Run `npm run context:check` to catch
stale generated structure and broken local documentation links.
