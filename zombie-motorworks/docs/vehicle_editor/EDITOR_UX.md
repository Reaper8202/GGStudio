# Editor UX

## Layout

- Full-window Three.js canvas; DOM overlay UI (parent-repo convention: DOM for UI, canvas for world).
- Left: part palette grouped by category, with part info card (mass/cost/description).
- Right: inspector for the selected part (wheel config toggles: driven/steering/braking/preset; weapon info) + live analysis panel (mass, CoM height, distributions, power/weight, stability, warnings list).
- Top bar: blueprint name, save/load/new/duplicate/rename, undo/redo, symmetry toggle, view controls, **Test Drive** button (disabled only on hard errors, tooltip lists them).
- Bottom: active layer slider (height slicing) + view-mode toggles.

## Camera & views

Orbit (drag), pan (right-drag/shift), wheel zoom, perspective default; ortho front/rear/side/top buttons (keys 1–5). Visible grid at active layer; height-layer slicing dims cells above the slice.

## Placement

- Palette selection arms a **ghost**: follows raycast against placed parts' faces / ground plane, snapped to grid; green = valid, red = invalid with the placement issue shown in a tooltip near the cursor.
- R/F rotate yaw/pitch through the part's allowed orientations; click places; Esc disarms.
- Symmetry mode mirrors ghost + placement across X=0 (wheel config mirrored too).
- Select by click; multi-select via **Shift+click**; rotate, duplicate (Ctrl+D re-arms as ghost), mirror, delete (Del). Plain left-drag always orbits. (Box select is deferred — see KNOWN_LIMITATIONS.md.)
- Every oriented part carries a bright notch on its local +Z face so R/F rotation reads spatially.
- The chamber names failures as they happen (banner): VEHICLE FLIPPED, WHEELS SPINNING, WHEELS OFF THE GROUND, OUT OF FUEL.
- Editor camera, layer slice, and undo history survive the editor↔chamber round trip.
- Everything runs through reversible commands (`core/commands.ts`); Ctrl+Z / Ctrl+Shift+Z.

## Visual analysis modes

- X-ray (structure ghosting), hide shell, hide armour, structure-only.
- CoM marker (checkered sphere + vertical drop line).
- Expected wheel contacts (discs) + support polygon (green/amber/red by stability margin).
- Structural connection lines (thickness = strength, red = weak/near-failure).
- Wheel clearance and steering-arc fans on selected wheels; weapon firing-arc fans on selected weapons.

## Warnings surfacing

Analysis panel groups warnings by severity with affected-part highlight on hover. Warnings never block Test Drive; hard errors (from ValidationReport) do, and each names its cells/parts.

## Test chamber loop

Test Drive serializes the *current* blueprint, switches to the chamber scene (same page, no reload), spawns the vehicle. Chamber UI: scenario buttons (flat, brake, turns, ramp, side slope, bumps, zombies, recoil, drop), reset vehicle, **Back to Editor** (blueprint restored from the serialized copy — runtime damage never writes back).
