# Scrap Rig kids-simplification review

Priority: P0 fix picking/deletion, seed every new rig with a Truck Heart, and stop normal landings from causing damage; P1 remove mounts/advanced UI and ship the eight-part catalog; P2 add paint and legacy-save migration. Both orchestrator bug hypotheses are confirmed. A local untouched-starter probe also reproduced the physics report: ramp run `22→17` live, `4` detached, `2` wheels left; drop and bumps stayed intact.

## A. PART CATALOG

**Decision — one catalog, eight visible parts.** Keep `chassis-core` only as the locked, preplaced **Truck Heart**, then show these large icon tiles in this order (names already exist at `src/core/tutorial.ts:34-81`):

| id | kid tile | purpose |
|---|---|---|
| `frame-box` | 🧱 Block | default structure |
| `frame-reinforced` | 🛡️ Strong Block | one obvious durability/weight trade-off |
| `wheel-standard` | 🛞 Wheel | road movement |
| `wheel-offroad` | 🛞 Monster Wheel | large/long-travel alternative |
| `driver-seat` | 💺 Driver Seat | control |
| `engine-small` | ⚙️ Engine | propulsion |
| `fuel-tank` | ⛽ Fuel Tank | understandable resource |
| `turret` | 💥 Zombie Blaster | chamber toy/combat |

- Remove entirely: `frame-light`, `beam-long`, `wheel-mount`, `engine-mount`, `hardpoint`, `engine-big`, `battery`, `ammo-box`, `cargo-crate`, `armour-panel`, `shell-panel`, `gun-fixed` (`src/core/parts.ts:88-171,211-289,344-395`). Light/strong/beam/engine variants add optimization choices; panels add another face-mount grammar; ammo/battery make the fun weapon inert unless separately understood.
- Approve direct attachment. Delete `requiresMount`, `hasRequiredMount`, `MISSING_MOUNT`, specialized socket pairs, and their strengths (`src/core/types.ts:30-38,139-143`; `src/core/placement.ts:101-111,194-202,274-278`; `src/core/structural.ts:11-24`). Give wheels' one side socket and Engine/Blaster attachment sockets type `frame`; auto-orient the attachment face to the clicked block face. Do not make kids cycle 24 orientations.
- Preserve clearance: Wheel/Monster Wheel reserve local `(0,-1,0)`; Blaster reserves `(0,1,0)`; both candidate and existing clearance checks remain (`src/core/parts.ts:290-341,397-405`; `src/core/placement.ts:181-191`).
- Nothing valuable is lost from the physics-failure fantasy. Mounts add prerequisite blocks, not runtime behavior; bad wheel direction, narrow track, high CoM, overload, single-block necks, and impact damage already produce legible failure. Keep Strong Block: Block is `25 kg/150 HP/×1`, Strong Block `45 kg/320 HP/×2` (`src/core/parts.ts:75-113`).
- Make Blaster self-contained: add `ammoCapacity: 200`, `batteryCapacity: 500`; otherwise it requires resources omitted even from today's simple palette (`src/core/parts.ts:397-420`; `src/runtime/vehicle.ts:79-90`; `src/runtime/weapons.ts:90-114`).
- Replace the starter's four `wheel-mount` and one `engine-mount` instances one-for-one with `frame-box`; keep attachments at their existing coordinates. Mass becomes `727 kg`, topology stays familiar (`src/app/App.ts:130-155`).
- P0 adjacent bug: **New** currently creates an empty rig while the simple palette omits the only root, so no first part can connect (`src/editor/EditorMode.ts:132-136`; `src/core/tutorial.ts:13-25`; `src/core/placement.ts:194-199`). Every New/Tutorial rig must seed locked Truck Heart at `(0,1,0)`.

## B. EDITOR UI

- Top bar, exact: `Rigs ▾` (Name, New, Save, saved-slot + Load), `↩`, `↪`, `Build both sides` (symmetry, default off), `View ▾` (3D/Front/Rear/Side/Top; keep keys 1–5), `🎓 Tutorial`, `?`, and a visually dominant `▶ TEST DRIVE`. Remove standalone Duplicate and five standalone view buttons (`src/editor/ui.ts:57-115`).
- Palette: two columns, the eight tiles above plus a fixed red `🧽 Erase` tool and visible `× Cancel` only while placing. Delete Simple/More mode, storage key, category headings, mass/cost rows, and palette toggle (`src/editor/ui.ts:117-175`).
- Bottom: keep only `Build height: All/0…8` and short toast/status. Remove X-ray, Structure, Hide armour, Hide shell, CoM, Contacts, Support, Links, Arcs (`src/editor/ui.ts:195-266`). Above-slice parts must be non-pickable, not merely opacity `0.12` (`src/editor/EditorMode.ts:743-747`).
- Remove the permanent right inspector/stats/issues stack (`src/editor/ui.ts:177-193`). Replace it with a compact build card: `Weight: N kg`; `Stability: 😀 Great / 🙂 Okay / 😟 Tippy / 🛑 Will tip` for low/medium/high/extreme; then at most two actionable tips (errors first, warnings second), or `✅ Ready to drive`. This replaces 14 analysis rows (`src/editor/EditorMode.ts:768-784`).
- Remove driven/steering/inverted/braking checkboxes and four suspension presets (`src/editor/ui.ts:485-508`). Normalize after every wheel add/move/delete/load: all wheels `driven=true`, `braking=true`, `steerInverted=false`, `suspensionPreset='standard'`; steer wheels with `z > (minWheelZ+maxWheelZ)/2`, or all wheels when there is one axle. This corrects the current absolute `pos.z > 0` shortcut (`src/editor/EditorMode.ts:514-518`).
- Customization: selected-part toolbar gets six paint swatches `scrap #8A8F98`, `red #C84C4C`, `blue #4D79C7`, `green #5F9B55`, `yellow #D6A928`, `purple #8B5BB5`. Add a strict `paint` enum to `PartConfig`; today config has only wheel fields and colors are hard-coded by definition (`src/core/types.ts:166-173`; `src/editor/meshes.ts:12-45`). Do not retain Paint Panel.

## C. EDITING FEEL

1. **Stacking confirmed.** Every block adds recursive `LineSegments` (`src/editor/meshes.ts:48-58`); `updateGhost` accepts the first visible recursive hit before requiring `face` (`src/editor/EditorMode.ts:427-449`). Installed Three uses `Line.threshold=1` m—two `0.5` m cells (`node_modules/three/src/core/Raycaster.js:83-90`; `src/core/types.ts:265-270`)—and line hits have no face. Placement itself allows vertical adjacency (`src/core/placement.ts:145-202`).
2. Fix by tagging only occupied-cell cube meshes `placementSurface=true` and choosing the nearest visible `Mesh` hit with non-null face and that tag; also set `raycaster.params.Line.threshold=0` as defense-in-depth. Apply Mesh-only picking to `selectAt`; threshold zero alone still loses on an exact edge.
3. **Delete confirmed.** Arming clears selection; every primary click places until Esc; Delete and the visible trash action require a selection (`src/editor/EditorMode.ts:395-410,509-539,607-657`; `src/editor/ui.ts:523-527`). Clicking the active tile does not cancel (`src/editor/ui.ts:132-142`).
4. Placement is one-shot: after a successful click, disarm and select the new part. Do **not** continue stamping by default. Stationary right-click deletes the part under cursor even while a ghost is armed; `>6 px` right movement remains pan; suppress browser context menu; never delete root and toast `🔒 Truck Heart can’t be deleted`. Keep Erase, Del/Backspace, and Undo.
5. On select/place, project a floating toolbar beside the part: `Move`, `Turn`, `Flip`, six Paint swatches, `Delete`. Remove multi-select, selected Mirror/Duplicate, IDs/descriptions, and side inspector. `moveCommand` already exists but has no UI path (`src/core/commands.ts:73-90`; `src/editor/ui.ts:511-528`).
6. Revalidate at pointer-up against the current blueprint/orientation. R/F currently changes orientation without refreshing; commit trusts cached `ghostTarget.valid`, and commands do no placement validation (`src/editor/EditorMode.ts:458-468,509-520,644-652`; `src/core/commands.ts:1-5,46-53`). This also permits a no-move double-click to commit overlap. Store last cursor and refresh immediately after Turn/Flip/R/F.
7. Reuse the ghost mesh; pointer movement currently removes/recreates it without disposal (`src/editor/EditorMode.ts:466-479,598-601`). This is secondary to correctness but prevents editor stutter/leaks.

## D. PHYSICS ROBUSTNESS

- Current starter is exactly `694 kg`. A `3 m` drop gives `v=√(2gh)=7.67 m/s`, momentum `5.32 kN·s`, energy `20.4 kJ`; stopping over `0.22–0.35 m` is roughly `65–100 kN` average and `150–320 kN` peak total. Standard suspension caps at `2.5×42,000×0.22=23.1 kN/wheel`, `92.4 kN` total (`src/core/parts.ts:290-315`; `src/runtime/wheels.ts:167-186`). Attached wheel colliders do not collide, so damage occurs only on nose/belly strikes (`src/runtime/assembler.ts:145-153`).
- At `60 km/h=16.67 m/s`: momentum `11.57 kN·s`, energy `96.4 kJ`; one 60 Hz stop is about `694 kN`, and a rigid `0.05–0.10 m` stop averages `0.96–1.93 MN`. This separates a wall strike from the intended drop.
- Current tuning cannot: colliders emit above `2,500 N`; each callback subtracts `force/900` HP and `force/55,000×30,000/maxForce` joint health (`src/runtime/assembler.ts:206-224`; `src/runtime/damage.ts:30-50`). One event kills Fuel at `54 kN`, Driver at `72 kN`, Wheel at `81 kN`, Engine at `108 kN`, Frame at `135 kN`; joints one-shot at Frame `55 kN`, Wheel `44 kN`, Engine `47.7 kN`, Hardpoint `36.7 kN`.
- Implement this exact impulse retune at fixed `dt=1/60`:

```ts
CONTACT_FORCE_EVENT_THRESHOLD_N = 100_000
SAFE_IMPACT_FORCE_N = 100_000
IMPACT_DAMAGE_SCALE = 1 / 65          // HP per N·s above safe force
CONNECTION_DAMAGE_SCALE = 1 / 5_000  // health per N·s
REFERENCE_CONNECTION_FORCE_N = 120_000
impactImpulseNs = Math.max(0, forceN - SAFE_IMPACT_FORCE_N) * dt
```

- Part loss: `health -= impactImpulseNs * IMPACT_DAMAGE_SCALE`. Joint loss: split impulse evenly across the impacted part's live incident edges, then for each use `impulseShare * CONNECTION_DAMAGE_SCALE * REFERENCE_CONNECTION_FORCE_N / conn.maxForce`. Final `frame-frame = 120,000 N / 32,000 N·m`; delete mount/armour rows. Raise Fuel Tank `60→80 HP`; every other kept physical part is already at least 80 HP (`src/core/parts.ts:60-113,173-210,234-246,290-341,397-420`).
- Calibration before edge sharing for the proposed `727 kg` starter: worst one-tick 3 m stop ≈`3.91 kN·s` damaging impulse → `60.2 HP`, `0.78` frame-joint health, so the 80-HP floor and edge survive. A 60 km/h one-tick stop ≈`10.45 kN·s` → `160.8 HP`, `2.09` joint health, so a struck Block/single-edge appendage fails. `maxTorque` currently has no runtime consumer; max force only scales synthetic health (`src/core/structural.ts:86-95`; `src/runtime/damage.ts:49`).
- `resolveStructure` does **not** independently kill positive-HP parts; it correctly kills `health<=0`, but immediately detaches every non-root island after an upstream edge reaches zero (`src/runtime/damage.ts:64-103`). The eager behavior is the damage formula plus full force being charged to every incident edge, not island detection.
- Acceptance gate: 10 deterministic runs each of starter ramp, bumps, and 3 m drop must finish with `0` destroyed/`0` detached; a controlled `60 km/h` wall hit must destroy or detach `≥1`; a single-neck bad build must detach before a multiply-connected Strong-Block control. Replace the test that currently requires a correct drop to lose parts (`tests/combat.spec.ts:26-34`).

## E. TUTORIAL

1. `frame` / highlight `frame-box`: “Add 4 Blocks around the orange Truck Heart. Right-click a mistake to erase.” Complete when Block + Strong Block `>=4`.
2. `wheels` / `wheel-standard`: “Put 4 Wheels straight onto the outside Blocks. Wheels set themselves up.” Complete when Wheel + Monster Wheel `>=4`.
3. `driver` / `driver-seat`: “Put the Driver Seat on top.” Complete at `>=1`.
4. `engine` / `engine-small`: “Snap on an Engine.” Complete at `>=1`.
5. `fuel` / `fuel-tank`: “Add a Fuel Tank.” Complete at `>=1`.
6. `drive`: “Press TEST DRIVE!” Complete only when steps 1–5 pass and validation has no errors. This replaces the current seven-step mount/R-tip flow (`src/core/tutorial.ts:99-162`).

## F. RISKS / TEST MIGRATION

- Unit mount/tutorial tests: update `unit/placement.test.ts:9-52,112-145,175-188`, `unit/structural.test.ts:13-55,72-117`, `unit/tutorial.test.ts:15-37,83-103,127-145,164-229`.
- Catalog pruning: update `unit/parts.test.ts:83-114`, `unit/analysis.test.ts:47-62,112-116`, `unit/commands.test.ts:46-116,180`; add paint/catalog migration cases to `unit/serialize.test.ts:76-118`.
- Playwright layouts/UI: update shared `tests/seam.ts:81-121`, `tests/drive.spec.ts:91-135`, `tests/tutorial.spec.ts:4-59`, `tests/editor.spec.ts:4-45`, `tests/combat.spec.ts:4-34`, `tests/failure.spec.ts:4-28`; all `buildBasicRig` consumers need new 727 kg baselines.
- Add regressions: line-edge face stacking (including exact edge), one-shot placement, same-point double-click, Erase/right-delete while armed, R/F revalidation, New seeds root, wheel auto-config after move/load, and ramp/drop/wall damage gates.
- Removed IDs make old saves fail `unknown defId` (`src/core/serialize.ts:85-97`). Bump schema: mounts/light/battery/ammo/cargo → Block; Big Engine → Engine; Front Gun → Blaster; expand Long Beam into three oriented Blocks; drop face panels. Preserve instance IDs where one-to-one and generate deterministic suffixes for beam cells.

## Done

Review and implementation-ready specification complete; no product code changed. Baseline unit suite: 8 files / 64 tests passing.

## Files changed

- `docs/agent-reports/kids-simplification-review.md`

## Assumptions

- “Never breaks” means a correctly built starter survives intended ramps/bumps and terrain drops up to 3 m; deliberate approximately 60 km/h rigid impacts remain destructive.
- Mouse/keyboard is primary, with Erase and floating buttons supplying touch/trackpad-discoverable equivalents.

## Issues

- No blocking issue. Paint requires a schema/config addition; old saves require the migration above. Two unrelated pre-existing untracked files were left untouched.
