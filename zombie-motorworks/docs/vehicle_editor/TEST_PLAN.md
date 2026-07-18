# Test Plan

## Unit (Vitest, `unit/`)

- grid: 24 orientations, det=+1, inverse/compose, face rotation, footprint rotation, bounds, mirror involution. (done)
- parts/blueprint: catalog integrity (sockets on real cells/faces, wheel parts have wheel defs, exactly one root), blueprint helpers.
- serialize: round trip, corrupt-data rejection (bad json, unknown def, dup ids, bad orientation), v1→v2 migration.
- structural: edge derivation from touching compatible sockets, connectivity to root, island computation after edge removal, disconnected part detection.
- placement: bounds, overlap, socket compatibility, requiresMount (wheel on wheel-mount, engine on engine-mount, weapon on hardpoint), armour face occupancy (no double armour on a face), clearance volumes (wheel travel, weapon breech), unique-part restriction, structured issue codes.
- analysis: total mass, CoM (hand-computed asymmetric fixtures), left/right + front/rear distribution, support polygon hull, stability margin sign, rollover categories, power/weight, driven-load fraction, ground clearance, warning thresholds (no driven wheels, no steering, high CoM, narrow track, overload...).
- commands: place/remove/move/rotate/mirror/duplicate/delete each undo/redo to identical blueprint (deep-equal), redo stack cleared on new command, batch (symmetry) commands atomic.
- drivetrain math (pure parts): torque curve sampling, gear selection, per-wheel split, clamps.

## Browser (Playwright, `tests/`)

- smoke: editor boots, palette renders, canvas non-black (pixel sample).
- build flow: place cab→frames→engine→tank→mounts→wheels via debug seam; analysis panel shows mass/CoM; Test Drive enabled.
- validation flow: wheel in mid-air ⇒ warning shown, still drivable; no engine ⇒ Test Drive blocked with error.
- drive: enter chamber, throttle 2 s, assert forward displacement via debug seam; return to editor, blueprint unchanged (deep equal).
- failure physics: vehicle with unpowered config doesn't move; tall-narrow preset rolls on turn scenario (angular displacement assert).
- persistence: save, reload page, load, parts identical.

## Verification gate (per integration)

`npm run typecheck && npm run lint && npm run test:unit && npm run build && npm test` + Playwright screenshot visual check (Read the PNG; scene must not be black/empty) — Codex sandbox cannot run Chromium, so the orchestrator runs this gate after every Codex merge.
