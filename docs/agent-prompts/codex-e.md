You are Codex Agent E on Scrap Rig (3D vehicle builder for KIDS, web, strict TypeScript).

READ FIRST (contracts — MUST NOT edit): src/core/types.ts, src/core/grid.ts, src/core/parts.ts, src/core/blueprint.ts, src/core/placement.ts.

YOU OWN EXCLUSIVELY: src/core/tutorial.ts (a stub exists — keep the exported API EXACTLY as-is, fill in the TODOs) and unit/tutorial.test.ts. Touch nothing else. Another agent is concurrently editing src/editor/* against this exact API — do not change any export name or signature.

TASK 1 — complete KID_LABELS for EVERY id in PART_CATALOG (src/core/parts.ts). Kid-friendly, short, fun. Required names (blurbs: write one short line each, e.g. "Makes the truck go!"):
chassis-core "Truck Heart", frame-box "Block", frame-light "Light Block", frame-reinforced "Strong Block", beam-long "Long Beam", wheel-mount "Wheel Holder", engine-mount "Engine Stand", hardpoint "Gun Stand", driver-seat "Driver Seat", engine-small "Engine", engine-big "Mega Engine", fuel-tank "Fuel Tank", battery "Battery", ammo-box "Ammo Box", cargo-crate "Cargo Box", wheel-standard "Wheel", wheel-offroad "Monster Wheel", armour-panel "Armour Plate", shell-panel "Paint Panel", gun-fixed "Front Gun", turret "Zombie Blaster".

TASK 2 — implement `createTutorialBlueprint()`: empty blueprint named 'my-first-truck' with one part: id 'p1', defId 'chassis-core', pos {x:0,y:1,z:0}, orient 0, config {}.

TASK 3 — implement TUTORIAL_STEPS: exactly 7 steps. Count parts with a helper `countOf(bp, defId)` (wheels count wheel-standard + wheel-offroad together; engines count engine-small + engine-big). Steps:
1. id 'frame', title '🧱 Build the frame', text like "Click the Block and add 4 blocks around the orange Truck Heart to make your truck's body!", paletteDefId 'frame-box', complete when count(frame-box)+count(frame-light)+count(frame-reinforced)+count(beam-long) >= 4.
2. id 'mounts', title '🔩 Wheel Holders', text: add 4 Wheel Holders on the sides of the truck, paletteDefId 'wheel-mount', complete when count(wheel-mount) >= 4.
3. id 'wheels', title '🛞 Wheels on!', text: snap a Wheel onto the outside of each Wheel Holder (tip: press R if it shows red), paletteDefId 'wheel-standard', complete when wheels >= 4.
4. id 'driver', title '🧑‍✈️ The driver', text: every truck needs a driver — place the Driver Seat on top, paletteDefId 'driver-seat', complete when count(driver-seat) >= 1.
5. id 'engine', title '⚙️ Engine time', text: place an Engine Stand on the truck, then put the Engine ON TOP of it, paletteDefId 'engine-small', complete when engines >= 1.
6. id 'fuel', title '⛽ Fuel it up', text: engines are thirsty — add a Fuel Tank, paletteDefId 'fuel-tank', complete when count(fuel-tank) >= 1.
7. id 'drive', title '🏁 Ready to roll!', text: press the green TEST DRIVE button and take it for a spin! (no paletteDefId), complete when validateBlueprint(bp, getDef).errors.length === 0 AND steps 1–6 are complete (reuse their predicates so a broken build doesn't finish the tutorial).
Keep `tutorialProgress` as in the stub (first incomplete step).

TASK 4 — unit/tutorial.test.ts:
- KID_LABELS has an entry (non-empty name and blurb) for every key of PART_CATALOG, and no extra keys.
- SIMPLE_PART_IDS ⊆ catalog ids.
- createTutorialBlueprint: 1 part, chassis-core at (0,1,0); tutorialProgress === 0.
- Walk the tutorial: starting from createTutorialBlueprint(), add parts with blueprint.withPartAdded using the real catalog at VALID positions, asserting progress after each stage: blocks at (0,1,1),(0,1,-1),(1,1,0),(-1,1,0) → progress 1; wheel-mounts at (1,1,1),(-1,1,1),(1,1,-1),(-1,1,-1) → progress 2; wheels: left side (-2,1,1),(-2,1,-1) orient 0, right side (2,1,1),(2,1,-1) orient orientationFromSteps(0,2,0) → progress 3; driver-seat (0,2,0) → progress 4; engine-mount (0,1,2)… WAIT that cell needs adjacency: add one extra frame-box at (0,1,2)? No — engine-mount at (0,1,2) touches block (0,1,1) via its nz face, that's valid. engine-mount (0,1,2) then engine-small (0,2,2) → progress 5; fuel-tank (0,2,1) → progress 6; then use canPlacePart/validateBlueprint to sanity-check the final blueprint has no errors → progress 7 (=== TUTORIAL_STEPS.length).
- Out-of-order safety: a blueprint with an engine but no wheels reports progress 0 (first incomplete is still the frame step) — build a small fixture.
- Step 7 guard: a blueprint passing steps 1–6 but with a validation error (e.g. remove the driver seat after completing — or construct with a floating part via raw parts array) does not complete step 7.

RULES: `npm run typecheck` and `npx vitest run` must pass. No new dependencies. No edits outside your two files. Report: Done / Files changed / Tests run / Assumptions / Issues / Next recommended task.
