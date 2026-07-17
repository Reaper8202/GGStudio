# Zombie Motorworks architecture

## Module map

| Module | Role |
| --- | --- |
| `src/core/` | Engine-independent data types, catalog, 24-orientation grid, blueprint helpers, placement/structural validation, analysis, commands, serialization, profile codec, upgrades, and economy math. It imports neither Three.js, Rapier, DOM, nor storage. |
| `src/runtime/` | Converts a blueprint into Rapier simulation: assembly, raycast suspension, drivetrain, surfaces, impact/direct damage, detachment, and weapons. It is Three-free. |
| `src/editor/` | Three.js garage scene, placement and selection interaction, overlays, DOM UI, tutorial, and blueprint-slot UI. |
| `src/chamber/` | Disposable test-drive world with terrain scenarios, simple zombies, HUD, and vehicle camera. It never mutates the garage blueprint. |
| `src/survival/` | Graveyard world, pooled zombie AI, wave manager, follow camera, auto-aim, tracer visuals, HUD, and run transitions. |
| `src/app/` | Boots Rapier once, owns the renderer, profile, active blueprint, command history, and switches editor, chamber, and survival modes. |

## Blueprint to runtime pipeline

```text
VehicleBlueprint
  ├─ placement validation + analyzeVehicle (garage feedback)
  ├─ deriveConnections (socket graph)
  └─ assembleVehicle → RuntimeVehicle
       ├─ one compound Rapier body and per-part colliders
       ├─ raycast suspension + drivetrain
       ├─ damage → resolveStructure → detached debris islands
       └─ weapon state and hitscan shots
```

`VehicleBlueprint` is the authority. Both chamber and survival deep-clone it at entry, derive its structural connections, and build a `RuntimeVehicle`. The runtime resolves a placed part through its upgrade level before analysis, assembly, or weapon creation. On a cleared survival wave, `App` prunes the garage blueprint to the runtime's surviving attached IDs; it also clears undo history because old commands may reference destroyed parts.

The connected vehicle is one compound dynamic body. Attached wheel colliders contribute mass but have no physical collision filter; wheel-ground contact is simulated with suspension rays. Structural damage can destroy parts or split the connection graph. The root island remains the vehicle; non-root islands become independent debris bodies with inherited point velocity.

## Mode lifecycle and run loop

```text
Garage editor
  ├─ Test Drive → chamber → Back to Garage (blueprint unchanged)
  └─ Fight Zombies → 3-second countdown → active wave
                              │
                    wave cleared + vehicle alive
                              ↓
              pay bonus → prune survivors → Build Phase in garage
                              │
                    Start Wave N+1 ───────┘

Chassis Core lost or no attached control part → game over → garage summary
```

The profile wallet is shared across modes. Each zombie kill credits its reward immediately; the wave bonus is credited only after the fixed step confirms that the vehicle survived the clear. A game-over return does not prune losses from the in-progress wave, while losses already checkpointed at earlier Build Phases remain.

## Collision groups

Rapier groups use `(membership << 16) | filter`.

| Group | Membership | Collides/queries against | Notes |
| --- | ---: | --- | --- |
| Terrain | `0x0001` | All filters in chamber/survival terrain | Fixed ground and graveyard colliders. |
| Vehicle | `0x0002` | Terrain, debris, zombies | Attached non-wheel part colliders emit contact-force events. |
| Wheel | `0x0004` | Nothing while attached | Carries wheel mass only; suspension rays query terrain. |
| Debris | `0x0008` | Terrain, debris, zombies, vehicle | Created for detached structural islands. |
| Zombie | `0x0010` | Terrain, vehicle, zombies | Dynamic pooled capsule bodies. |

Weapon hitscan rays query terrain, zombies, and debris. Wheel rays query terrain only.

## Persistence and schemas

### Player profile

`localStorage['scraprig.profile.v1']` holds the version-1 `PlayerProfile`:

```ts
{ schemaVersion: 1, money, unlockedDefIds, currentBlueprintName? }
```

Missing, corrupt, fractional, or unsafe money data becomes the default profile: `$200` and the starter unlocks (`chassis-core`, `frame-box`, `wheel-standard`, `driver-seat`, `engine-small`, `fuel-tank`, `turret`). The decoder also preserves starter unlocks and discards unknown catalog IDs.

### Blueprint slots and schema v4

`localStorage['scraprig.blueprints.v1']` is a JSON object whose keys are slot names and whose values are serialized blueprint JSON. The profile's optional `currentBlueprintName` selects the slot loaded at boot.

Blueprints currently serialize as schema **v4**. Deserialization validates IDs, positions, orientation range, duplicate instance IDs, and upgrade levels, then follows this migration chain:

| From | To | Migration |
| --- | --- | --- |
| v1 | v2 | Converts `type` to `defId` and Euler-like rotation steps to the canonical orientation index. |
| v2 | v3 | Maps retired catalog IDs, expands `beam-long` into frame boxes, and drops retired armour/shell panels. |
| v3 | v4 | Version pass-through; `PartConfig.level` is optional and resolves to level 1. |

## Economy

- Placing a part costs its catalog `cost` and creates a command with a negative wallet delta.
- Selling a non-root part returns `floor(50% × investment)`, where investment is the base cost plus every paid upgrade. The Chassis Core cannot be sold.
- A part with upgrade metadata starts at level 1. Moving to target level `L` costs `round(basePrice × priceGrowth^(L - 2))`; catalog helpers set `basePrice` to `round(cost × 0.6)` and `priceGrowth` to `1.6`.
- Level effects are resolved consistently: all parts gain 8% health per step; engines gain 10% torque/power, wheels 6% grip, weapons 12% damage and 8% fire rate, and armour 15% protection per step.
- Locked catalog parts require a one-time `unlockCost` before their regular placement cost. Current costs are Reinforced Frame `$150`, Off-road Wheel `$250`, Armour Plate `$200`, and Heavy Cannon `$500`.
- Commands apply money deltas on execute/undo/redo. Successful editor transactions autosave the blueprint, and wallet changes persist the profile.
