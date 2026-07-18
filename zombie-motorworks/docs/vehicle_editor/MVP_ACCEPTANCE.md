# MVP Acceptance Criteria

A player can:

1. Build a vehicle in the 3D grid (place/move/rotate/mirror/duplicate/delete).
2. Orbit/pan/zoom and use ortho views + layer slicing + x-ray/hide modes.
3. Place frame, driver cab (root), engine (on engine mount), fuel tank, wheel mounts, wheels with suspension.
4. Configure driven / steering / braking wheels and suspension presets.
5. Add face-mounted armour and cosmetic shell (separate systems).
6. Add a fixed forward gun and a rotating turret on hardpoints.
7. See structured placement errors and never-blocking design warnings.
8. See mass + CoM marker; wheel contacts + support polygon overlays.
9. Save, load, duplicate, rename blueprints (versioned, migrating).
10. Undo/redo every editing action.
11. Enter the test chamber quickly and return without blueprint corruption.
12. Drive with raycast-suspension wheel physics on varied surfaces.
13. Watch bad designs fail naturally: airborne wheels don't propel, wrong axle orientation doesn't roll, tall/narrow rigs roll over, weak engines crawl on slopes, unloaded driven wheels spin, overloaded suspension bottoms out.
14. Damage armour/frame by collision; break connections; watch islands detach with preserved velocity; lose drivetrain/fuel when their parts detach.
15. Fire weapons with ammo/power consumption and recoil destabilization.

Explicitly excluded (MVP): freeform placement, soft-body/tire deformation, motorsport tire model, manual fuel/wiring/ammo routing, aero, camber/toe/caster, manual gear ratios, multiplayer, trailers, articulated multi-body vehicles, destructible terrain.
