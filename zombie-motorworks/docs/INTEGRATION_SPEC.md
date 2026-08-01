# Zombie Motorworks Integration Contract

This document records the current cross-Module contracts. It deliberately omits
volatile tuning values and per-file inventories. Use `CONTEXT.md` for task
routing, `ARCHITECTURE.md` for design rationale, and
`generated/module-map.md` for structural lookup.

## Sources Of Truth

| Concern                    | Authority                                                             | Contract tests                                                                         |
| -------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Serializable vehicle shape | `src/core/types.ts`, `src/core/serialize.ts`                          | `unit/serialize.test.ts`, `unit/blueprint.test.ts`                                     |
| Placement and play gate    | `src/core/placement.ts`                                               | `unit/placement.test.ts`, `tests/editor.spec.ts`                                       |
| Effective stats and prices | `src/core/upgrades.ts`, `src/core/economy.ts`                         | `unit/upgrades.test.ts`, `unit/economy.test.ts`, `unit/repair.test.ts`                 |
| Run checkpoint lifecycle   | `src/app/App.ts`                                                      | `unit/run-checkpoint.test.ts`, `unit/pending-rewards.test.ts`, `tests/runloop.spec.ts` |
| Saved-run compatibility    | `src/core/runSave.ts`, `src/app/runSaveStore.ts`                      | `unit/run-save.test.ts`                                                                |
| Wave composition/tuning    | `src/survival/WaveManager.ts`, `src/survival/zombies/zombieConfig.ts` | `unit/waves.test.ts`, `unit/zombie-balance.test.ts`       |
| Survival phase behavior    | `src/survival/SurvivalMode.ts`                                        | `tests/runloop.spec.ts`, `tests/failure.spec.ts`, `tests/combat.spec.ts`               |
| CrazyGames platform state  | `src/app/crazyGamesSdk.ts`                                            | `unit/crazygames-sdk.test.ts`, `unit/audio-volume.test.ts`                             |
| Browser verification Seam  | `src/app/App.ts` (`debugSeam`), `tests/seam.ts`                       | affected Playwright specs                                                              |

## CrazyGames Platform Contract

`main.ts` begins SDK v3 initialization before importing the application. A
three-second boot watchdog prevents a slow or unavailable CDN from blocking the
game, but does not cancel the underlying attempt. Failed initialization is
released after a cooldown so later gameplay or score calls can retry.

- Loading events bracket application Module loading only when the SDK became
  ready during boot.
- App owns gameplay reporting for Title, Garage, and Test Chamber. Survival
  reports its phase/settings changes through `onGameplayActiveChanged`.
- Gameplay starts for Garage, Test Chamber, countdown, and active waves. It
  stops for Title, Survival settings, cleared-wave cards, and game over.
- Focus, blur, and visibility changes are not forwarded; CrazyGames owns them.
- `game.settings.muteAudio` overrides the live SFX/music mix without changing
  stored player volumes.
- The disabled environment and every SDK/network failure are non-fatal.

## Blueprint Contract

`VehicleBlueprint` is engine-independent serialized data. A valid Blueprint has
schema version 4, stable unique part IDs, known catalog definition IDs, integer
grid positions, canonical orientation indices, and validated configuration.

Rules:

- Runtime references, part HP, wallet state, and live resources never enter the
  Blueprint schema.
- `deserializeBlueprint` is the only supported untrusted-JSON entry. It validates
  schema and content and runs migrations 1 -> 2 -> 3 -> 4.
- Callers use immutable helpers in `blueprint.ts` or commands in `commands.ts`.
- `validateBlueprint` is the play gate. `canPlacePart` is the per-placement gate.
- Part IDs survive upgrades, repairs, mode transitions, and checkpoints. New
  placement obtains a new ID; destroyed/sold parts do not retain HP entries.

## Effective-Part Contract

`getEffectiveDef(placed)` is the shared Interface for resolving upgrade effects.
Consumers include analysis, runtime assembly, weapons, repair maxima, investment
calculation, and upgrade preview.

Rules:

- Base catalog definitions remain immutable.
- A missing/invalid level resolves safely to level 1.
- Upgrade preview must run the real effective-definition and analysis paths on a
  temporary Blueprint.
- A damaged part upgraded during Build Phase preserves its HP percentage against
  the new effective maximum.

## Editor Contract

`App.openEditor` supplies `EditorMode` with:

- authoritative Blueprint
- shared `CommandHistory`
- shared mutable `PlayerProfile`
- a persistence callback for Profile transactions
- saved camera/layer view when available
- optional active-run context and repair Adapter
- optional run summary/notice
- callbacks for Test Chamber, Survival, and Title
- an optional semantic SFX callback for tactile button feedback, successful
  garage actions, and denials; App maps those cues to presentation assets

App owns the Garage music lifecycle: it starts the loop after constructing an
Editor and stops it before switching to Title, Test Chamber, or Survival.

Editor responsibilities:

- Validate and execute Blueprint changes.
- Keep Profile money, unlocks, and Inventory consistent with commands.
- Autosave successful garage mutations into the selected Blueprint slot.
- Preserve normal Inventory semantics while arming a purchased part immediately.
- Expose in-run repair only when App provides a repair Adapter.

Transaction requirements:

- A locked Store action charges and persists only the catalog unlock; it grants
  no Inventory. Once unlocked, a later Store action charges the shelf price,
  grants one Inventory copy, and arms placement. Each transaction independently
  succeeds or rolls back.
- Placing consumes one Inventory copy; undo restores it.
- Selling removes the part and refunds the pure `sellRefund` value; undo reverses
  both changes.
- `New Garage` requires explicit confirmation based on the calculated installed
  investment/refund/forfeit summary.
- Ordinary editor work may use undo/redo. A cleared wave clears history because
  permanent destruction can invalidate referenced part IDs.

The tutorial is an Editor-owned coach-mark overlay over the live garage. It
reads Blueprint and Inventory state to know when a step is satisfied and writes
nothing back beyond its local completion flag; it is not an isolated cross-mode
tutorial session. `EditorMode` feeds it a snapshot from both `refresh` and
`refreshProfile`, because a purchase only goes through the latter.

## Test Chamber Contract

`App.enterChamber` disposes the Editor after storing its view state and passes
the current Blueprint to `ChamberMode`.

- Chamber constructs its own Rapier world and Runtime Vehicle.
- Chamber damage, movement, ammo, and reset state are transient.
- Back to Garage recreates EditorMode with the authoritative Blueprint and
  preserved command/view state.
- Chamber never changes Profile money, progression, run saves, or Run Checkpoint.

## Survival Construction Contract

`App.enterSurvival` constructs `SurvivalMode` from:

- the committed Blueprint
- checkpoint-derived `{ wave, partHp, kills }`
- callbacks for Profile/run balances, clear/failure transitions, progression,
  reset, save/quit, and debug money

`SurvivalMode` owns live phase state:

```text
countdown -> active -> cleared -> countdown
                  \-> gameOver -> Garage
```

It creates a disposable physics world, Runtime Vehicle, Graveyard, ZombieSystem,
WaveManager, AutoAim, Minimap, hazards, HUD, and overlays. `dispose` must remove
listeners/DOM and release mode-owned resources before another mode is created.

The Arena Interface exposes both driving-surface lookup and solid-obstacle
classification by collider handle. Survival uses the former for wheel physics
and terrain audio, and the latter to distinguish scenery/fence collisions from
ordinary chassis contacts.

## Run Checkpoint Contract

`RunCheckpoint` is App-owned and contains:

```ts
{
  wave: number; // wave to play next
  blueprint: VehicleBlueprint; // committed survivors
  partHp: Record<string, number>; // committed HP by surviving part ID
  kills: number; // committed cumulative kills
  bankedEarnings: number; // rewards already credited to Profile
}
```

### New run

1. App clears any resumable run save.
2. `createInitialRunCheckpoint` clones/prunes the Garage Blueprint and records
   full effective HP.
3. Survival starts at wave 1 from that checkpoint.

### Active wave reward

1. A zombie death records a wave kill and adds its reward to
   `pendingWaveKillReward`.
2. The HUD labels this value as pending.
3. Profile money, run banked earnings, and checkpoint earnings remain unchanged.

### Clear

1. `WaveManager` reports complete only after every assignment is spawned and no
   active zombie remains.
2. `SurvivalMode.onWaveComplete` records the clear bonus as pending.
3. The completed physics step resolves before transition. Vehicle death wins
   over a simultaneous clear.
4. On a valid clear, `bankPendingWaveRewards` invokes App's reward callback once.
5. App records lifetime wave progression/unlocks.
6. App commits the next wave's checkpoint from surviving root-attached IDs,
   current HP, cumulative kills, and banked earnings.
7. The victory UI may now offer Continue or Garage; both consume the committed
   checkpoint state.

### Continue

- `onWaveAdvance` supplies the shared wave-clear payload.
- Survival begins the next countdown without rebuilding the scene.
- Destroyed parts remain absent and surviving HP remains unchanged.

### Garage / Repair

- `onBuildPhase` supplies the same wave-clear payload.
- App commits before opening EditorMode and persists the pruned Blueprint.
- New parts begin at full HP. Selling removes their HP entry. Upgrading scales
  carried HP by percentage. Repair mutates checkpoint HP only after payment.
- Starting the next wave calls `prepareCheckpointForGarageFight` so garage edits
  and HP are reconciled by stable part ID.

### Failure

- Survival reports the amount of current-wave pending reward discarded.
- App restores the failed wave's starting checkpoint, not the run's first
  Blueprint and not the live losing vehicle.
- The run ends. Prior cleared-wave losses remain committed.
- Surviving checkpoint parts recover to full HP for the ordinary Garage.
- The next Fight Zombies action creates a fresh wave-1 run.

### Reset Wave

- Pending reward and live damage are discarded.
- App reconstructs Survival from the current wave-start checkpoint.
- No reward, progression, or part loss from the reset attempt is committed.

### Save & Quit / Resume

- App serializes the checkpoint, never the live wave.
- Current-wave damage, kills, pending reward, zombies, mines, projectiles, and
  elapsed time are intentionally absent.
- Every checkpoint commit also writes the save. Storage failure reports once and
  play continues; it must never abort a mode transition.
- The save carries `phase` and `activeWave`. Resume restores Blueprint, HP,
  committed kills/earnings, and wave, then either starts that wave from its
  countdown (`wave`) or reopens the run Garage (`build`).
- A `build` resume prefers the persisted garage Blueprint over the checkpoint's
  so an interrupted shopping trip survives, falling back to the checkpoint when
  the slot is unreadable.
- `EditorMode` exposes `onSaveAndQuit` alongside `onMenu`; the two topbar
  buttons are mutually exclusive on run context.

## Survival Callback Ordering

The `SurvivalCallbacks` Interface is an ordering contract, not just a group of
functions.

| Callback                      | Owner action                              | Ordering requirement                                   |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| `profileMoney`, `runEarnings` | Read App-owned balances                   | Read-only; Survival must not retain a second wallet    |
| `onReward`                    | Credit Profile and banked run earnings    | Clear only, exactly once, before checkpoint commit     |
| `onWaveCleared`               | Update highest wave and milestone unlocks | Valid clear only                                       |
| `onPhoneAddictKilled`         | Update lifetime kill gate                 | Real kill only; debug suppression is explicit          |
| `onWaveCheckpoint`            | Commit survivor Blueprint/HP after clear  | Before a post-clear action can be processed            |
| `onWaveAdvance`               | Continue in current Survival scene        | Uses the already resolved clear payload                |
| `onBuildPhase`                | Open run Garage                           | Commit/persist damage before editor actions            |
| `onGameOver`                  | End run and show failure summary          | Receives discarded pending amount                      |
| `onResetWave`                 | Rebuild from checkpoint                   | Must not use live HP/rewards                           |
| `onSaveAndQuit`               | Persist checkpoint and show Title         | Must not use live wave snapshot beyond display context |
| `onGameplayActiveChanged`     | Report Survival play/break state to SDK   | Phase/settings-derived; no focus/visibility forwarding |

Changing this sequence requires updates to the run checkpoint, pending reward,
run-save, and Playwright run-loop tests.

## Profile And Progression Contract

Profile schema 1 contains safe-integer money, known unlocked definition IDs,
positive Inventory counts, optional current Blueprint name, highest cleared wave,
and lifetime Phone Addict kills.

- Decode always restores starter unlocks and rejects unknown catalog IDs.
- Corrupt or invalid top-level data returns a default Profile.
- Money mutations are safe-integer checked and persisted through App's Profile
  Adapter.
- Mine Sweeper and turret-module gates are derived from Profile progression
  helpers. Presentation should consume those helpers rather than restating
  thresholds in independent UI logic.

## Storage Contract

| Key                      | Schema                              | Failure behavior                                                     |
| ------------------------ | ----------------------------------- | -------------------------------------------------------------------- |
| `scraprig.profile.v1`    | Profile 1                           | Normalize valid fields; otherwise use default Profile                |
| `scraprig.blueprints.v1` | map of serialized Blueprint 4 slots | Preserve bad slot; load starter and display notice                   |
| `scraprig.run.v1`        | Saved Run 5, migration from 1-4     | Return null for malformed data; ordinary Title/Garage remains usable |

Storage keys are versioned separately from payload schemas. A payload migration
does not require renaming a key when its decoder remains backward compatible.

## Wave And Enemy Contract

`WaveManager` is the single source for wave composition, active cap, health,
speed, damage, clear reward, and horde interval. `waveBalanceReport` derives
effective total HP and possible reward for tests/debugging; production behavior
does not depend on the report.

`ZombieSystem` owns a fixed per-kind pool. `WaveManager` requests kinds
explicitly, so specialist availability is not random. A wave clears only after
all scheduled assignments have spawned and the active pool count reaches zero.

Enemy kinds are `walker`, `thrower`, `worker`, `phone-addict`, and `boss`.
Kind-specific health/speed/reward and hazard constants live in
`zombieConfig.ts`. Progression warnings derive from the same composition
functions in `waveBalance.ts`.

Every wave that is a multiple of `BOSS_WAVE_INTERVAL` is a boss wave: the horde
is replaced entirely by one boss, which heads the spawn queue. A boss is a
pooled zombie of kind `boss` whose stats, attack, capsule size, and placeholder
visual all come from a `BossDefinition` in `zombies/bossConfig.ts`;
`WaveManager` selects it with `bossForWave` and hands it to
`ZombieSystem.setBossDefinition` at wave start. `BOSS_ROTATION` is indexed by
boss-wave number, so consecutive boss waves are different encounters. Adding a
boss means adding a registry entry and putting its id into the rotation, not
adding a class.

`BossDefinition.attack` is a discriminated union. A `slam` boss closes to melee
and damages every part inside a telegraphed ground ring; a `vial` boss holds at
range, backs away when the rig closes inside its disengage ring, and lobs pooled
projectiles that deal a small direct splash to the part they strike, fanning
several per throw once below its phase-two health fraction. Both kinds route
through the same `WindingUp` state; only the callback fired on completion
differs (`onBossSlam` vs `onBossVials`). A new attack kind is therefore the one
change that a new boss cannot make from the registry alone.

Boss projectiles share the pooled ballistic system in `ThrowerProjectiles.ts`
with the thrower. A `ProjectileSpec` carries per-shot speed, lifetime, damage,
hit radius, and visual variant, so mixed projectiles coexist in one pool and the
owning system's impact callback receives the damage per projectile rather than
reading a global constant. Boss vial damage comes from the `BossDefinition` and
so scales with the wave; the thrower's stays the flat tuner value.

A vial's real payload is the puddle it leaves wherever it lands (vehicle or bare
ground), not the direct splash: `ThrowerProjectiles.update`'s optional `onLand`
callback fires once per despawning projectile with its `ProjectileSpec.puddle`
payload, and `ZombieSystem` hands that to `AcidPuddles.spawn`, a small pooled
system of flat ground discs (no Rapier body) mirroring `Landmines.ts`. Poison
ticks on a half-second clock rather than every physics step — `applyDirectDamage`
floors any nonzero hit to at least 1 HP, which would otherwise turn a per-frame
dose into 60 HP/s regardless of the configured `poisonDamagePerSecond` — and when
puddles overlap a part takes the strongest single puddle's dose, not the sum, so
standing in a multi-puddle overlap is exactly as risky as standing in the
strongest one. `The Alchemist` (`acid-alchemist`) is also the one boss whose body
renders as a plain capsule rather than the shared voxel placeholder
(`BossDefinition.bodyVisual: 'capsule'`), toggled in `Zombie.applyBossVisualSizing`.

Because a boss occupies an ordinary pool slot, wave clear, kill accounting,
weapon routing, and ability AoE need no boss-specific cases. Bosses do cap ram
damage and resist knockback, so a high-speed ram cannot one-shot one.

## Runtime Damage Contract

- Vehicle contacts and zombie attacks resolve to a live attached part.
- `RuntimeVehicle` owns per-part HP and returns structural/detachment results.
- Root-island parts remain vehicle-owned; non-root islands become debris.
- Survival checkpoint capture includes only alive, root-attached parts.
- Weapon hits use `DamageType`; shield and module behavior keys off that type.
- Runtime and analysis share effective definitions, mass, and wheel-layout rules.

## Debug And Test Contract

The browser Seam exists only when debug mode is enabled. Tests access it through
`tests/seam.ts` rather than reimplementing boot or polling logic.

The Seam may:

- inspect Blueprint, Profile, Run State, checkpoint HP, and telemetry
- place/configure/select/sell/upgrade/repair through real editor paths
- enter modes and set deterministic controls/fixed steps
- set explicit progression or money for scenario setup
- start/complete waves and inspect zombie positions

Debug operations should call the same production Interfaces where practical.
They must not silently alter normal-mode behavior. Any new cross-mode behavior
needs a unit test for its pure contract and a Playwright test for the integrated
transition.

## Compatibility Checklist

Before merging a cross-Module change, check the affected items:

- Blueprint/profile/run schema and migration behavior
- App-to-mode callback ordering
- undo/redo and Profile/Inventory atomicity
- effective-definition reuse between UI, analysis, and runtime
- checkpoint HP and pending/banked reward semantics
- listener/DOM disposal across repeated mode transitions
- debug Seam compatibility and focused Playwright coverage
- `npm run context:generate` when TypeScript structure changed
- `npm run context:check`, unit tests, lint, build, and relevant browser tests
