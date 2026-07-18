# Zombie Motorworks

**Zombie Motorworks** is a Bad Piggies-style 3D vehicle workshop crossed with zombie-wave survival. Build a rig from grid-snapped parts, validate its balance and structure, then take that exact blueprint into a Rapier-powered graveyard and try to keep its chassis and driver alive.

The game is a static Three.js + Rapier web build: no game engine and no server.

## Player flow

1. Start in the garage with a valid starter rig, or build a new one around its required **Chassis Core**.
2. Place, rotate, paint, sell, and upgrade parts. The editor checks placement and shows structural/stability analysis; hard validation errors prevent driving.
3. Use **TEST DRIVE** to try the current blueprint in the physics chamber. This is a safe sandbox: returning to the garage does not change the blueprint.
4. Use **Fight Zombies** to begin a run. After a three-second countdown, drive the same blueprint through a graveyard wave.
5. Kills pay money immediately; clearing a wave pays its wave bonus. Surviving parts are retained and destroyed or detached parts are removed before the **Build Phase**.
6. In the Build Phase, spend the shared wallet to buy, sell, unlock, or upgrade parts, then choose **Start Wave N+1**.
7. The run ends when the Chassis Core is lost or no attached control part remains. The garage shows the run summary; previously cleared-wave damage remains part of the current blueprint.

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

Every part must stay within the grid and connect to the Chassis Core through face-to-face structural sockets. The editor tracks a 24-orientation integer grid, so rotations and mirrored builds remain exact. Wheels are normalized as driven and braking; wheels ahead of the axle midpoint steer. The play gate requires a root chassis, a control part, an engine, and one connected structure; analysis warns about poor wheel setups.

The build card reports weight, rollover risk, validation errors, and analysis warnings. Warnings are advice; errors block **TEST DRIVE** and **Fight Zombies**.

## Development quickstart

Requires Node.js 20.19 or later.

```sh
npm install
npm run dev
npm run build
npm run test:unit
npm test
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

- [Architecture](docs/ARCHITECTURE.md)
- [Integration status and implementation contract](docs/INTEGRATION_SPEC.md)
- [Vehicle editor data model](docs/vehicle_editor/DATA_MODEL.md)
- [Editor architecture](docs/vehicle_editor/ARCHITECTURE.md)
- [How to build](docs/HOW_TO_BUILD.md)
