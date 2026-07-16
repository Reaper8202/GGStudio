# Scrap Rig — Zombie Motorworks

A 3D modular vehicle construction game: build a zombie-apocalypse rig block by
block in a 3D grid (frames, engine, fuel, wheels, armour, weapons), inspect it
with real engineering analysis, then drive it in a physics test chamber where
bad designs fail for real, physical reasons.

Three.js rendering + Rapier (WASM) rigid-body physics. No game engine, no
server, CrazyGames-ready static build.

## Run

Requires Node.js 20.19+.

```sh
npm install
npm run dev
```

Open the printed URL. The **editor** loads with a drivable starter rig.

**New to the editor?** It opens a Help overlay on first launch (the **? Help**
button brings it back any time), and [docs/HOW_TO_BUILD.md](docs/HOW_TO_BUILD.md)
is a full step-by-step walkthrough from empty grid to drivable truck.

Quick orientation:

- Left palette: click a part to arm the placement ghost; click in the world to
  place (green = valid, red shows the blocking rule). `R`/`F` rotate the ghost,
  `Esc` disarms. Symmetry mode mirrors placements across the centreline.
- Click parts to select: the inspector configures wheels (driven / steering /
  braking / suspension preset) and offers rotate/mirror/duplicate/delete.
- `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo everything. Keys `1–5` switch
  perspective/front/rear/side/top views; the bottom bar has layer slicing,
  x-ray, structure-only, hide armour/shell, and analysis overlays
  (centre of mass, wheel contacts, support polygon, connections, arcs).
- The right panel shows live analysis: mass, CoM, weight distribution, track,
  wheelbase, clearance, power/weight, stability, and design warnings.
  Warnings never block you; hard errors (no driver, no engine, disconnected
  parts…) disable **TEST DRIVE** with an explanation.

**TEST DRIVE** enters the chamber: `W/S` throttle/brake, `A/D` steer, `Space`
brake, mouse aims turrets, `F`/click fires. Scenario buttons: flat (with mud
and dirt strips), ramp, side slope, bumps, zombies, drop test. Collisions
damage parts and break structural connections — sections detach as real
debris. **Back to editor** always restores your untouched blueprint.

## Verification

```sh
npm run typecheck && npm run lint && npm run test:unit && npm run build && npm test
```

Unit tests (Vitest) cover the pure core: grid math, catalog, placement rules,
structural graph, analyzer, serialization/migration, undo/redo. Browser tests
(Playwright) drive the real app: placement validation, save/load, driving,
steering, braking, rollover of tall rigs, sideways-wheel failure, weapons,
drop-test damage, and blueprint integrity across the editor↔chamber loop.

`?debug=1` exposes the test seam (`window.__scrapRig`); production URLs hide it.

## Architecture

- `src/core/` — engine-independent model: types, 3D grid/orientations,
  part catalog, blueprint, structural graph, placement validation, analyzer,
  reversible commands, versioned serialization. Fully unit-tested.
- `src/runtime/` — Rapier side: compound-body assembler, raycast suspension +
  slip tire model, engine/gearbox/torque distribution, damage + island
  splitting, weapons.
- `src/editor/` — Three.js editor (cameras, ghost, overlays, DOM UI).
- `src/chamber/` — test chamber scenarios, HUD, zombies, chase camera.
- `docs/vehicle_editor/` — architecture, physics model, data model, UX,
  acceptance criteria, agent task split, test plan.
