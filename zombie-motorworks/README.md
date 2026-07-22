# Zombie Motorworks

**Zombie Motorworks** is a Bad Piggies-style 3D vehicle workshop crossed with zombie-wave survival. Build a rig from grid-snapped parts, validate its balance and structure, then take that exact blueprint into a Rapier-powered graveyard and try to keep its chassis and driver alive.

The game is a static Three.js + Rapier web build: no game engine and no server.

## Player flow

1. Start in the garage with a valid starter rig, or build a new one around its required **Chassis Core**.
2. Place, rotate, paint, sell, and upgrade parts. The editor checks placement and shows structural/stability analysis; hard validation errors prevent driving.
3. Use **TEST DRIVE** to try the current blueprint in the physics chamber. This is a safe sandbox: returning to the garage does not change the blueprint.
4. Use **Fight Zombies** to begin a run. After a three-second countdown, drive the same blueprint through a graveyard wave.
5. Kill rewards stay pending during the active wave. Clearing banks those rewards plus the wave bonus, then checkpoints surviving parts and their current HP.
6. Choose **Continue Now** with the current damage, or enter **Garage / Repair** to repair, replace, buy, sell, unlock, or upgrade before the next wave.
7. Failure discards that wave's pending rewards and restores its start checkpoint. The run ends, earlier cleared-wave part losses remain committed, and checkpoint survivors recover for the ordinary garage.

## Controls

### Garage

- Click a palette part, hover a valid green placement ghost, then click to place. `Esc` cancels the active tool.
- Click a placed part to select it. `R` turns it; `F` flips it; use the palette swatches to paint it.
- Right-click, the erase tool, `Delete`, or `Backspace` sells selected non-root parts. `Ctrl/Cmd+Z` undoes and `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` redoes.
- Drag to orbit, scroll to zoom, and use `1`–`5` for 3D, front, rear, side, and top views. **Build both sides** mirrors placements. The build-height slider hides upper layers for editing.

### Test chamber and survival

- `W` / `S` — throttle / brake
- `A` / `D` — steer
- `Space` — brake
- Mouse — aim manual weapons
- Mouse click or `F` — fire manual weapons
- Auto turrets find and fire at live zombies on their own. The Heavy Cannon is manual.

## Build rules

Every part must stay within the grid and connect to the Chassis Core through face-to-face structural sockets. The editor tracks a 24-orientation integer grid, so rotations and mirrored builds remain exact. Wheels are normalized as driven and braking, and wheels ahead of the axle midpoint steer unless you tick the box yourself — an explicit choice is never overwritten. The play gate requires a root chassis, a control part, an engine, and one connected structure; analysis warns about poor wheel setups.

Movement parts trade off against each other. The **Standard** and **Monster** wheels are the all-rounders; the **Speedy Wheel** is light with a big steering lock but a low load rating, so it buckles under a heavy rig; the **Tank Tread** is a three-block belt that is slow and very tough. Treads do not angle their hubs — they skid-steer, turning by driving one side of the vehicle harder than the other, so a fully tracked rig pivots on the spot. Mixing treads and wheels gives you both behaviours at once.

The build card reports weight, rollover risk, validation errors, and analysis warnings. Warnings are advice; errors block **TEST DRIVE** and **Fight Zombies**.

## Development quickstart

Requires Node.js 20.19 or later.

```sh
npm install
npm run dev
npm run build
npm run test:unit
npm test
npm run context:check
```

`npm run dev` prints the local URL. `npm test` runs the Playwright browser suite. Add `?debug=1` to expose the browser-test seam during development.

## Project layout

| Path | Responsibility |
| --- | --- |
| `src/core/` | Pure blueprint model, grid/orientations, catalog, validation, analysis, commands, serialization, upgrades, and economy rules. |
| `src/runtime/` | Rapier vehicle assembly, raycast wheels, drivetrain, damage/island detachment, and weapons. |
| `src/editor/` | Three.js garage, editor UI, meshes, overlays, save slots, and tutorial. |
| `src/chamber/` | Isolated physics test chamber and scenarios. |
| `src/survival/` | Graveyard, follow camera, zombie pool/AI, auto-aim, wave director, and survival mode. |
| `src/app/` | Renderer boot, profile storage, and editor/chamber/survival lifecycle. |
| `unit/` | Vitest coverage for core rules and integration-facing helpers. |
| `tests/` | Playwright coverage, fixtures, and debug seam. |
| `docs/` | Architecture, integration status, and editor reference. |

## Documentation

- [Agent entry point](AGENTS.md)
- [Agent context and task router](CONTEXT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Integration contract](docs/INTEGRATION_SPEC.md)
- [Generated TypeScript module map](docs/generated/module-map.md)
- [Vehicle editor data model](docs/vehicle_editor/DATA_MODEL.md)
- [Editor architecture](docs/vehicle_editor/ARCHITECTURE.md)
- [How to build](docs/HOW_TO_BUILD.md)
