# Known Limitations, Assumptions, Technical Debt

## Documented assumptions (decisions made during implementation)

- **Suspension is integrated into wheels** (base params on the wheel definition,
  scaled by player-facing presets) rather than a separate suspension part; the
  structural "wheel & suspension mount" part provides the attachment. The brief
  listed both — this collapse keeps the MVP part count sane without losing any
  physical behaviour.
- **Steering/braking are per-wheel config**, not separate part items.
- **Angled braces and sloped armour wedges** were skipped (box-only footprints
  in the MVP); the footprint/socket model supports them later.
- **Mirror plane** is the centre of grid column x=0 (x = 0.25 m), because cell
  centres sit at (i+0.5)·CELL_SIZE. Symmetric builds put their spine on column 0.
- **Mirrored wheels are normalized at assembly** (axle handedness flipped so
  both sides roll forward, like a real differential); genuinely wrong mounts
  (axle along Z, suspension sideways/up) stay broken on purpose.
- **Debris colliders are shrunk 6%** instead of using a collision-group grace
  period to avoid the break-plane interpenetration pop (deviation from the
  physics doc's suggested mitigation; simpler and works).
- **One face-mounted item per host face** (armour or shell, not both stacked).
- **Multiple engines sum torque**; rpm is derived per engine from driven-wheel
  mean speed. No reverse gear in the MVP (S = brake).
- **Turret aim** is mouse-x relative to the camera heading; fixed guns fire
  along their mount axis.

## Known limitations

- Wheel raycast is a single ray: very sharp terrain lips can momentarily miss
  contact (mitigated by fixed 60 Hz stepping and clamped suspension forces).
- Resource networks (fuel/electric/ammo) use structural connectivity, not
  routed lines; ammo/power are vehicle-wide pools with per-shot consumption.
- Zombies are simple capsule chasers; no pathfinding, no attack animation —
  they damage by contact force only.
- Box selection (Shift+drag) is specced but not implemented; multi-select via
  Shift+click works.
- Blueprint storage is localStorage only (no file export UI yet).
- Ortho-view OrbitControls are recreated on view switch; damping state resets.
- The analyzer's static wheel loads use an axle-lever approximation (documented
  in analysis.ts); >2-axle load distribution is approximate.
- Wheel visual spin uses accumulated angle without wrap; extremely long
  sessions could lose float precision (cosmetic only).

## Balance backlog (from the Phase-7 UX review)

- Off-road wheels are strictly better than standard on grip (1.15/1.0 vs
  1.0/0.95) with only mass/cost as a downside — the dominant build is a wide,
  flat, all-off-road AWD slab. Planned lever: per-wheel rolling-resistance /
  top-speed cost so standard wheels win on flat asphalt and off-road wheels
  only pay off on slopes/rubble/mud.
- Warning `suggestion` tooltips spell out the exact fix; consider gating hints
  until a design has failed once in the chamber, to preserve the discovery loop.

## Technical debt

- `EditorMode.refreshAnalysis`/`refreshOverlays` run `analyzeVehicle` twice per
  change; fine at MVP blueprint sizes, cache when parts count grows.
- Editor rebuilds all part meshes on every change (simple + robust; batch or
  diff if blueprints exceed a few hundred parts).
- Runtime wheel/drivetrain constants (slip saturations, gear ratios) live in
  code, not data; move to a tuning file when balancing starts in earnest.
- Playwright specs share rig-building helpers with slight duplication in
  drive.spec.ts (sideways-wheel variant builds its own part list).

## Deferred (explicit MVP exclusions honoured)

Freeform placement, soft-body/tire deformation, motorsport tire model, manual
fuel/wiring/ammo routing, aerodynamics, camber/toe/caster, manual gear ratios,
multiplayer, trailers, articulated vehicles, destructible terrain.
