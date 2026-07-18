You are Codex Agent G on Scrap Rig (3D vehicle builder, strict TS). Implement the CORE + PHYSICS half of the approved simplification spec.

READ FIRST: docs/agent-reports/kids-simplification-review.md (the spec — sections A, D, E, F), then src/core/types.ts (already updated: PAINT_COLORS/PaintColor/PartConfig.paint exist, BLUEPRINT_SCHEMA_VERSION is now 3).

ORCHESTRATOR AMENDMENTS to the spec (these override it):
- No "kids"/"simple" wording anywhere; this is just the editor.
- KID_LABELS: trim to exactly the kept catalog ids (8 + chassis-core). SIMPLE_PART_IDS: the 8 visible tiles in spec order (chassis-core is NOT in the palette — it is pre-seeded and locked).
- Keep the `armour`/mount SocketTypes REMOVED from types? NO — do not edit types.ts at all (frozen). Instead: remove all catalog usage of 'wheel-mount'/'engine-mount'/'hardpoint'/'armour' sockets, remove requiresMount from every kept def, and remove the MISSING_MOUNT/ARMOUR_* validation paths from placement.ts (delete dead code paths and their issue codes; keep OVERLAP/OUT_OF_BOUNDS/NO_CONNECTION/CLEARANCE_*/UNIQUE/ROOT/NO_ROOT/NO_CONTROL/NO_PROPULSION/DISCONNECTED/INVALID_DEF). structural.ts: SOCKET_COMPAT becomes [['frame','frame']] and CONNECTION_STRENGTH only 'frame-frame': { maxForce: 120000, maxTorque: 32000 }.

YOU OWN EXCLUSIVELY: src/core/parts.ts, src/core/placement.ts, src/core/structural.ts, src/core/serialize.ts, src/core/tutorial.ts, src/runtime/damage.ts, src/runtime/assembler.ts, ALL unit/*.test.ts files. Do NOT touch src/core/types.ts, src/core/grid.ts, src/core/blueprint.ts, src/core/commands.ts, src/core/analysis.ts, src/core/mass.ts, src/editor/*, src/app/*, src/chamber/*, tests/* (another agent owns those concurrently).

TASK 1 — Catalog (spec A): PART_CATALOG keeps ONLY: chassis-core (unchanged, isRoot, unique), frame-box, frame-reinforced, wheel-standard, wheel-offroad, driver-seat, engine-small, fuel-tank, turret. Delete all other defs. Changes to kept defs:
- wheel-standard / wheel-offroad: socket type 'frame' (still on face px, id keep), NO requiresMount, keep clearanceCells [(0,-1,0)], keep wheel payload as-is.
- engine-small: NO requiresMount; its ny socket becomes type 'frame' (so it snaps to the top of any block; it already has frame sockets on the other faces — keep them so side attachment also works).
- turret: NO requiresMount; ny socket type 'frame'; keep clearance (0,1,0); ADD ammoCapacity: 200 and batteryCapacity: 500 (self-contained — the runtime already pools these from part defs).
- fuel-tank: health 60 → 80.

TASK 2 — Physics retune (spec D), exactly:
- src/runtime/assembler.ts: setContactForceEventThreshold(2500 → 100_000) everywhere it appears.
- src/runtime/damage.ts: replace the damage model with the impulse form at dt = 1/60:
  SAFE_IMPACT_FORCE_N = 100_000; IMPACT_DAMAGE_SCALE = 1/65 (HP per N·s above safe); CONNECTION_DAMAGE_SCALE = 1/5_000; REFERENCE_CONNECTION_FORCE_N = 120_000.
  applyImpactDamage(vehicle, colliderToPart, colliderHandle, forceMagnitude): impulse = max(0, force - SAFE) * (1/60); part.health -= impulse * IMPACT_DAMAGE_SCALE; split impulse EVENLY across the part's live incident connections (health>0), each: conn.health -= share * CONNECTION_DAMAGE_SCALE * REFERENCE_CONNECTION_FORCE_N / conn.maxForce. Keep applyDirectDamage and resolveStructure logic unchanged (armour absorb path in applyDirectDamage may stay dormant).

TASK 3 — Serialization (spec F): MIGRATIONS[2] (v2 → v3): map removed defIds: wheel-mount/frame-light/battery/ammo-box/cargo-crate/engine-mount/hardpoint → 'frame-box'; engine-big → 'engine-small'; gun-fixed → 'turret'; beam-long → three 'frame-box' parts at the beam's three occupied world cells (use grid rotateVec on local cells (0,0,0),(0,0,1),(0,0,2) with the part's orient; ids: original id, id+'b', id+'c'; orient 0); armour-panel/shell-panel entries are DROPPED. Config fields driven/steering/braking etc pass through. deserializeBlueprint must still reject unknown defIds AFTER migration.

TASK 4 — Tutorial (spec E): TUTORIAL_STEPS becomes the 6 steps listed in the spec (frame ≥4 blocks incl. strong; wheels ≥4; driver; engine; fuel; drive with validation guard). Update KID_LABELS/SIMPLE_PART_IDS per amendments. createTutorialBlueprint unchanged.

TASK 5 — Unit tests: update ALL unit tests to the new world (spec F lists the files/lines): no mounts (wheels attach to frame-box sides directly: wheel at (±2,1,z) next to a frame at (±1,1,z), right side yaw180 as before), new CONNECTION_STRENGTH, new catalog membership assertions, tutorial 6 steps, serialize: v2→v3 migration cases (each mapped id, beam expansion to 3 blocks at correct world cells, panel dropping, unknown-id rejection still works), fuel-tank 80 HP. Add a pure damage unit test file unit/damage-model.test.ts testing the new formulas numerically WITHOUT rapier: extract the impulse/damage math into small exported pure helpers in damage.ts (e.g. `impactImpulseNs(forceN)`, `partDamage(impulse)`, `connectionDamage(impulseShare, maxForce)`) and test: force 80kN → 0 damage; one-tick 3m-drop-force ~335kN → impulse 3.92 kN·s → partDamage ≈ 60.2 HP (below 80 floor), frame-frame connectionDamage with 1 incident edge ≈ 0.78 (< 1 → survives); one-tick 60 km/h wall ~727kN → partDamage ≈ 160 HP (kills a Block), connectionDamage ≥ 1.

RULES: `npm run typecheck` and `npx vitest run` must pass. Note: src/editor/* and src/app/* are being edited concurrently by another agent and may temporarily reference removed exports — if `npm run typecheck` fails ONLY in src/editor/, src/app/ or tests/, run `npx tsc --noEmit` scoped mentally and instead verify with `npx vitest run` + report the editor-side breakages in Issues rather than fixing them. No new dependencies. Report: Done / Files changed / Tests run / Assumptions / Issues / Next recommended task.
