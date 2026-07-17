# Physics Model

Target: accessible, physically believable game physics. Bad designs fail for real reasons; no arbitrary stat penalties.

## Compound body

- One Rapier `RigidBodyDesc.dynamic()` per structurally connected vehicle.
- One cuboid collider per part cell-box, with explicit mass = part mass (multi-cell parts: mass split evenly across their cells' colliders). Rapier derives total mass, CoM, and inertia tensor from colliders — so a tall stack of armour genuinely raises the CoM.
- Parts keep a runtime registry entry (health, collider handles, mesh) keyed by placed-part id.

## Wheels (raycast suspension)

Each wheel keeps an integrated **spin state ω** (rad/s) with inertia `I = 0.6·m_wheel·r²`:
`ω̇ = (driveTorque − brakeTorque·sign(ω) − r·F_long − rollingResistance·N·r) / I`. When
grounded with grip, `F_long` couples ω to ground speed (slip = ω·r − v_long drives the
force); when unloaded (`N≈0`), nothing resists drive torque, so driven wheels visibly
spin up — and engine rpm (derived from driven-wheel ω) revs out. Wheel meshes render ω.

Per wheel, per physics step (fixed 1/60 s):

1. Cast a ray from the wheel anchor along the wheel's **placed** suspension direction, length = restLength + radius.
2. If hit: suspension compression x = (restLength + radius − hitDist); spring force `F = k·x − c·ẋ` along suspension axis, applied to the chassis **at the anchor point** (load transfer emerges).
3. Tire frame: forward = spin direction = `up × axle` (from the placed orientation, plus steer yaw); lateral = axle.
4. Slip model: longitudinal force from drive/brake torque limited by `μ_long · N`; lateral force `= −clamp(k_lat · v_lat, μ_lat · N)` (linear-to-saturation approximation of a slip curve). N = current spring force. Surface multiplies μ.
5. No hit → no forces: airborne wheels do nothing (natural failure).

Consequences that emerge without special-casing: wheels above ground don't propel; axle mounted facing forward gives lateral friction against travel (vehicle won't roll); unloaded driven wheels spin (F ≤ μN); narrow track + high CoM rolls over; suspension mismatch gives uneven stance (per-wheel spring preset).

## Steering

Configured steering wheels get a steer angle each frame. For a recognized left/right pair (same z, mirrored x) we apply **approximate Ackermann**: inner wheel `atan(L / (L/tanδ − T/2))`, outer `atan(L / (L/tanδ + T/2))` with L = wheelbase, T = track. Unpaired/odd steering wheels get the raw angle — scrubbing and instability are allowed outcomes. `steerInverted` supports rear-steer.

## Drivetrain

- Engine: torque curve sampled by rpm, idle/max rpm, simple automatic gearbox (fixed ratio ladder, shift at rpm thresholds), fuel consumption ∝ throttle.
- Engine rpm is estimated from mean driven-wheel angular speed × total ratio, clamped to [idle, max].
- Available wheel torque = engineTorque(rpm) × ratio × efficiency, split equally across connected driven wheels (open-diff approximation), clamped per-wheel by `driveTorqueLimit`.
- **Multiple engines are allowed**: each connected engine contributes torque to the same pool (torques sum); rpm is derived per-engine from the same driven-wheel mean ω. No build error — mass/fuel cost is the natural tradeoff.
- Driven wheels must be structurally connected to a working engine via the graph; detached/destroyed engine ⇒ no torque.
- Underpowered + heavy ⇒ low acceleration and slope failure emerge from F = torque/r ≤ μN.

## Suspension presets

| preset | stiffness | damping | travel | maxLoad |
|---|---|---|---|---|
| light | low | low | short | low |
| standard | mid | mid | mid | mid |
| heavy-duty | high | high | short | high |
| off-road | mid | mid | long | mid+ |

Values are per-wheel-definition multipliers; overload (static N > maxLoad) warns at build time and bottoms out at runtime (bump-stop force spike + damage).

## Surfaces

`SurfaceKind = asphalt | dirt | mud | rubble` with `{ μ_long, μ_lat, rollingResistance }` multipliers, resolved from the collider the wheel ray hits (userData). Extensible to snow/ice/metal.

## Damage & islands

- Collision events (Rapier contact force events) above a threshold damage the nearest part(s) and the structural connections within the impact cell neighbourhood, proportional to impulse.
- Weapon recoil = impulse at the mount, opposite fire direction (destabilization emerges).
- When a connection's health reaches 0 it is removed from the graph; connected components are recomputed. The root component keeps the existing body (colliders of lost parts removed, mass auto-recomputed). Each other island spawns a new dynamic body at the same world pose with those parts' colliders, given the old body's **point velocity at the island CoM**: `v_island = v_body + ω × (r_islandCoM − r_bodyCoM)` plus the angular velocity — a plain linvel copy is wrong for off-axis debris.
- Split pitfall: colliders across the break plane touch exactly (same-body pairs never collided); as separate bodies the solver sees interpenetration and can pop. Mitigation: newly split islands get a collision-group grace period (~150 ms) against the parent body before normal filtering resumes.
- After a split: drivetrain and resource reachability recomputed; parts that lost control/fuel/engine connectivity are disabled.

## Rapier lifecycle (runtime contract)

- `RAPIER.init()` exactly once at app boot, before any chamber entry.
- One `World` per test-chamber session; `world.free()` on exit (bodies/colliders are WASM memory — the editor↔chamber loop must not leak per round-trip).
- Damage relies on contact force events: colliders register `ActiveEvents.CONTACT_FORCE_EVENTS` with a `contactForceEventThreshold`; the `EventQueue` is drained every step.

## Test scenarios (test chamber)

Flat acceleration, emergency braking, tight turns L/R, ramp climb (parametric slope), side slope, bump field, zombie/obstacle collision, weapon recoil while stationary, drop test. Each is a spawn preset in the chamber; blueprint is never mutated by runtime damage.
