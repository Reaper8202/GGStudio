# Zombie Motorworks — integration status

This document records the implementation that exists in `zombie-motorworks/`. It supersedes the earlier forward-looking integration contract; paths are relative to this worktree. `../zombie-car/` is reference material only and is not imported by the game.

## Completed phases

| Phase | Status | Delivered |
| --- | --- | --- |
| 1 — vehicle editor core | Complete | Pure blueprint model, 24 grid orientations, catalog, placement/structural validation, analysis, reversible commands, and versioned serialization. |
| 2 — survival mode | Complete | `SurvivalMode` builds the editor blueprint as a runtime vehicle in the graveyard and returns to the garage through `App`. |
| 3 — zombie waves | Complete | Pooled capsule zombies, chase/attack/ram behavior, graveyard spawning, scaling wave director, follow camera, HUD, and countdown. |
| 4 — schema v4, upgrades, weapons | Complete | Per-part levels, effective definition resolution, armour plate, Heavy Cannon, automatic turret aim, and manual weapon aiming. |
| 5 — profile, economy, Build Phase | Complete | Persistent wallet/unlocks, placing/selling/upgrading, survivor pruning between waves, and the resume-wave loop. |
| 6 — verification seams | Complete | Unit coverage, browser seam, deterministic fixed-step controls, fixtures, and Playwright scenarios. |
| 7a — documentation | Complete | README, architecture reference, schema-v4 data model, and this status document. |

## Implemented contracts

### Mode ownership

`App` owns the renderer, loaded `PlayerProfile`, active blueprint, command history, and mode transitions. Rapier initializes once in `App.start()`.

- `EditorMode` receives the shared profile and either begins a fresh run or resumes the Build Phase's next wave.
- `ChamberMode` is a sandbox. It clones/uses a runtime blueprint and **Back to editor** does not mutate the saved garage design.
- `SurvivalMode` receives the blueprint and `RunState { wave }`, deep-clones it for runtime use, and reports rewards, wave clears, exits, or game-over through callbacks.

The implemented survival loop is: editor → survival countdown (three seconds) → active wave → cleared wave → Build Phase editor → next-wave countdown. Loss of the root chassis or every attached control provider selects game over. Wave clearing credits the bonus only after the fixed step confirms survival; the cleared-wave blueprint is then pruned to its surviving attached parts and command history is cleared.

### Survival systems

- `src/survival/Graveyard.ts` builds the graveyard world; `VoxelAssetLoader.ts` provides environment/zombie asset loading.
- `src/survival/zombies/` owns a fixed pool of 34 zombie bodies, their visuals, chase/attack/knockback states, separation, spawn selection, and stuck recovery.
- Base zombies have 30 health, 3.2 speed, 6 direct-damage attacks every second, and a `$10` kill reward. Vehicle impacts at speed 5 or above damage and knock back zombies.
- `WaveManager` starts wave `w` with `8 + 3w` zombies, caps active zombies at `min(8 + w, 30)`, raises health by 12% per prior wave and speed by up to 50%, and pays `100 + 25w` on clear.
- `AutoAim` supplies per-weapon inputs for auto weapons. Manual weapons use mouse yaw and mouse click or `F`; the runtime field is `weaponAim`, not the earlier proposed `perWeaponAim`.

### Data, profile, and economy

- Blueprints are schema v4. The actual migration chain is v1 → v2 → v3 → v4; v3 → v4 is a version pass-through because `PartConfig.level` is optional and defaults at resolution to level 1.
- `scraprig.profile.v1` stores a version-1 profile. Missing/corrupt profiles reset safely to `$200` and starter unlocks.
- `scraprig.blueprints.v1` stores named serialized blueprint slots; `currentBlueprintName` selects the active slot.
- Placing charges catalog cost. Selling returns floored half of base plus paid-upgrade investment. Upgrade prices are `round(basePrice × priceGrowth^(targetLevel - 2))`; the current catalog helper uses 60% of base part cost and 1.6 growth. Locked parts charge their one-time unlock cost before normal placement.

### Runtime integration

`deriveConnections` derives the structural graph from the one authoritative blueprint. `assembleVehicle` creates one compound Rapier body, attached mass-only wheel colliders, and raycast suspension. `RuntimeVehicle` owns drivetrain/resources/weapons; collision and zombie direct damage feed `resolveStructure`, which destroys parts and detaches non-root islands.

Collision memberships are terrain `0x0001`, vehicle `0x0002`, wheel `0x0004`, debris `0x0008`, and zombie `0x0010`. Attached wheels deliberately filter all physical contacts and raycast terrain instead. Vehicle colliders contact terrain/debris/zombies; debris contacts terrain/debris/zombies/vehicles; zombies contact terrain/vehicles/zombies.

## Corrected divergences from the original proposal

- There is no VirtualJoystick port in this project; the implemented controls are keyboard and pointer input.
- There is no separate `src/ui/` survival module or event bus. Survival UI is created in `SurvivalMode` and updated through direct state polling.
- Current `armour-plate` is one occupied cell, not a face-mounted slab. The generic runtime code retains face-mounted support for future definitions.
- Game over returns to the garage with a run summary. It does not prune the losses from the in-progress losing wave; pruning occurs only when a wave clears.
- The required test commands are available as `npm run test:unit` and `npm test`; the package also provides `npm run build`, `npm run typecheck`, and `npm run lint`.

## Verification scope

Vitest covers core grid/parts/placement/structural/serialization/profile/economy/upgrade logic and survival helpers. Playwright uses `?debug=1` for editor, runtime, economy, and deterministic fixed-step seams, with fixture blueprints including balanced, unstable, bad-wheel, armoured, and multi-weapon rigs.
