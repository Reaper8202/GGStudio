# Data Model

Canonical definitions live in `src/core/types.ts` (single source of truth). Summary:

- **PartDefinition** — id, name, category, footprint `cells` (orientation 0), `clearanceCells`, `allowedOrientations`, `sockets` (per-cell per-face, typed), `requiresMount`, mass, health, cost, reinforcement, `unique`/`isRoot`/`providesControl`, and optional payloads: `wheel`, `engine`, `weapon`, `armour`, `fuelCapacity`, `batteryCapacity`, `ammoCapacity`, `cargoCapacity`.
- **PlacedPart** — instance id, defId, integer `pos`, `orient` (0–23), `config` (`driven`, `steering`, `steerInverted`, `braking`, `suspensionPreset`).
- **VehicleBlueprint** — `schemaVersion`, id, name, `parts[]`. Serializable ids/positions/rotations/config only; no runtime references.
- **StructuralSocket / StructuralConnection** — sockets are on definitions; connections are *derived* (not serialized) from adjacency + compatibility, carrying maxForce/maxTorque/health at runtime.
- **DrivetrainConnection** — engineId → wheelId pairs, derived from graph + config.
- **PlacementResult / ValidationIssue / ValidationReport** — structured `{severity, code, message, partIds, cells, suggestion}`. Errors block test-driving; warnings never do.
- **VehicleAnalysisReport** — mass, CoM, distributions, wheel contact estimates, support polygon, stability margin, rollover risk, track/wheelbase/clearance, power-to-weight, slope estimate, fuel, cost, warnings.

## Serialization & versioning

- `BLUEPRINT_SCHEMA_VERSION = 2` (v1 is a synthetic legacy format kept to exercise real migration).
- `serializeBlueprint(bp): string`, `deserializeBlueprint(json): VehicleBlueprint` — validates structure, unknown defIds, orientation range, duplicate instance ids; throws `BlueprintFormatError` with a reason on invalid data.
- Migrations: `MIGRATIONS[fromVersion] = (raw) => raw'` chain applied until current. Round-trip and migration are unit-tested.
- Storage: localStorage slots under `scraprig.blueprints.v1` + JSON export/import in UI.

## Face-mounted armour mechanism (normative)

Armour/shell definitions have `cells: []` (no volume) and one canonical `'armour'` socket on face `pz` of local cell (0,0,0). A placed armour's `pos` is the **host cell** (a cell occupied by a structural part) and `rotateFace(orient, 'pz')` is the **covered face**. It connects structurally to the host part through the host's `'frame'` socket on that face (compat pair `frame`+`armour`). Face occupancy: at most **one** face-mounted part (armour *or* cosmetic shell) per host face — they are separate systems by behaviour (protection vs looks), not stackable on one face. Mass acts half a cell outward from the host cell centre (see `core/mass.ts`).

## Decisions from architecture review

- Shared per-cell mass split lives in `src/core/mass.ts`; analyzer and runtime assembler must both use it so independently derived CoM values agree exactly.
- `Vec3` (metres) vs `Vec3i` (cells) stay structurally identical, **unbranded** — branding taxes every literal across six modules; convention instead: metre-valued fields carry an `M` suffix or live in `Vec3`-typed fields named point/centre/com. Same for id strings (no branded id types).
- Multiple engines allowed; torque sums (see PHYSICS_MODEL.md).
- Suspension: `WheelDefinition.suspension` is the base; `SUSPENSION_PRESET_MULTIPLIERS[config.suspensionPreset]` scales it. `WheelDefinition.maxLoad` = tire rating; `suspension.maxLoad` = spring rating.

## Grid conventions

- X = width (+X right), Y = height (up), Z = forward. `CELL_SIZE = 0.5 m`. Bounds `GRID_MIN/GRID_MAX` in types.ts (13×9×17 cells).
- Orientation = index into canonical 24 proper rotations table (`grid.ts`); parts restrict via `allowedOrientations`.
- Mirroring across X=0 via conjugated orientation (`mirrorOrientationX`) + mirrored position; wheel `steerInverted`/axle handedness preserved by the same transform.
