# Scrap Rig — Vehicle Editor Architecture

> Focused record of the original vehicle-editor design. For current whole-game
> ownership, run lifecycle, persistence, and integration contracts, start with
> [`CONTEXT.md`](../../CONTEXT.md),
> [`ARCHITECTURE.md`](../ARCHITECTURE.md), and
> [`INTEGRATION_SPEC.md`](../INTEGRATION_SPEC.md).

## Context

- **Repo conventions:** self-contained subproject (like `clip-campus/`), Vite + strict TypeScript, Vitest for pure logic, Playwright for browser verification, ESLint + Prettier, CrazyGames web target.
- **Engine decision:** the parent repo has no 3D engine (2D canvas). We use **Three.js** (rendering) + **@dimforge/rapier3d-compat** (rigid-body physics, WASM). Unity was considered and rejected: no existing Unity project, web deployment target, and the repo's toolchain is npm/Vite.

## Layering

```
src/core/     Pure simulation-independent model. No three/rapier imports. Vitest-covered.
  types.ts      Shared data model (PartDefinition, PlacedPart, VehicleBlueprint, results...)
  grid.ts       24 axis-aligned orientations, footprints, faces, occupancy, mirroring
  parts.ts      Part catalog (definitions only)
  blueprint.ts  Blueprint construction/query helpers
  structural.ts Structural graph: socket edges, connectivity, island computation
  placement.ts  Centralized placement validation service
  analysis.ts   Deterministic build-time vehicle analyzer
  commands.ts   Reversible editor commands, undo/redo
  serialize.ts  Versioned (de)serialization + migrations
src/runtime/  Rapier-side. Assembles blueprints into physics, wheels, drivetrain, damage, weapons.
src/editor/   Three.js editor scene, cameras, ghost, overlays, DOM UI.
src/app/      Shell: mode switching editor <-> test chamber, save slots.
```

Rule: `core` never imports `runtime`/`editor`. `runtime` and `editor` consume `core` results; they never re-implement validation or analysis.

## Vehicle representation (coordinated models)

1. **Occupancy grid** — integer cells, X=width, Y=height(up), Z=forward; `CELL_SIZE = 0.5 m`. Parts have footprints, clearance volumes, allowed orientations, face sockets.
2. **Structural graph** — nodes are placed parts; edges are compatible touching face-socket pairs with maxForce/maxTorque/health. Everything must reach the root chassis.
3. **Drivetrain graph** — engine → (automatic transmission) → driven wheels. Routing is automatic across the connected structural graph in the MVP; driven wheels are explicit config. Interfaces keep engine/wheel endpoints as ids so gearboxes/shafts/diffs can be inserted later.
4. **Resource networks** — fuel/electrical/ammo/control reachability = structural connectivity in the MVP (recomputed after damage). No manual pipes/wires, but network membership is computed per-part so later versions can replace the reachability function.

## Physics strategy (decision)

**One compound rigid body** for the connected vehicle: a single Rapier dynamic body with one cuboid collider per part (per-collider mass from the part definition; Rapier accumulates mass/CoM/inertia). Wheels are **raycast suspension** (no separate wheel bodies, no joints): spring-damper along the wheel's suspension axis, slip-based tire friction clamped by normal load. This is the industry-standard arcade-vehicle approach — stable at any vehicle size, and wheel/axle misorientation, missing ground contact, load transfer, and rollover all emerge naturally.

Per-frame-block jointed bodies were rejected: joint stacks of 50+ bodies are unstable in every engine, and the brief forbids that path unless required.

**Detachment:** structural connections are tracked logically. When a connection breaks, connected components are recomputed; the component with the root stays as the vehicle body; each detached island becomes a *new* compound rigid body with its parts' colliders, inheriting point velocity. See PHYSICS_MODEL.md.

## Determinism / testability

- All build-time judgement (placement legality, warnings, analysis numbers) lives in `core` and is unit-tested.
- Runtime uses those same core outputs (e.g. assembler consumes `VehicleAnalysisReport` CoM only for validation cross-checks; Rapier computes runtime mass from per-collider masses so runtime and analyzer are independently derived and compared in tests).
- Browser tests drive the real editor + test chamber via a `?debug=1` seam (parent-repo convention).
