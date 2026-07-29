# Decisions — biome arenas

Running log for the multi-biome work. Newest last. Rationale only; numbers live in code.

## D1 — Surface table moves to `src/core/`

Biome recipes are pure data and live in `core`. They must name surface kinds, so leaving
`SurfaceKind`/`SURFACES` in `src/runtime/` would force `core -> runtime`, the wrong
dependency direction. The table has no Three.js or Rapier dependency, so the move is
mechanical. `CONTEXT.md` and `docs/ARCHITECTURE.md` ownership rows updated to match.

## D2 — Biome pressure is physics-only

No launch gates, no blocking garage warnings. A biome changes friction, sinkage, drag,
engine output and the stability assist; any build can enter any map, but a bad build feels
bad. Keeps the gentle-difficulty bar intact and avoids walling players out of content.

## D3 — The stability assist is biome-scaled, not just friction

`applyStabilityForces()` runs an anti-sideslip correction at
`LATERAL_STABILITY_RATE_PER_S = 4.2`. Lowering `muLat` alone does not produce a slide —
the assist absorbs it. Snow scales the assist down as well, which is what turns low
lateral grip into a drift the player can feel and catch. The two must be tuned together.

## D4 — Sinkage is what forces a lighter desert build

Rather than a flat "desert is slow" multiplier, soft surfaces add a rolling-drag term
proportional to how hard each wheel is loaded relative to its rating. Heavy builds dig in
and bog down; light builds skim. The pressure emerges from the existing physics instead of
being asserted, and it reuses the `maxLoad` rating already on every wheel.

## D5 — The graveyard stays authored; new biomes are procedural

Its gate, burial plot, caretaker corner and monument are deliberate composition, and
regenerating them procedurally would change a map that already plays well. So the recipe
format carries both `fixtures` (authored placements, copied through untouched) and
`scatters` (seeded procedural fill). The graveyard port is a data extraction with an empty
scatter list; snowfield and desert are fully procedural. One generator, one code path.

## D6 — Seed lives on the wave-start checkpoint

Save & Quit serializes only the checkpoint. A seed generated at scene-construction time
would silently reroll the world on resume, so `seed` and `biomeId` belong on
`RunCheckpoint` and `SavedRun`, not on `SurvivalMode`.

## D7 — Biome art comes from the local `Shared/` library, not a new download

`Shared/Ultimate Stylized Nature - May 2022/` is a Quaternius pack under **CC0 1.0**
(`License.txt` confirmed) and is already in the worktree: PineTree_1-5 for snowfield,
PalmTree_1-5 and Rock_1-5 for desert, DeadTree_1-10 for graveyard fill, in OBJ+MTL, which
is exactly what `VoxelAssetLoader` already consumes.

Caveat: its `Textures/` folder is 193 MB, with individual bark PNGs over 20 MB. Those must
be downscaled hard before anything ships — the loader forces `NearestFilter`, no mipmaps,
and flat-shaded Lambert, so 128 px textures look identical in-game and keep the CrazyGames
budget intact. Normal maps are unused by Lambert and get dropped entirely.

`Shared/voxel/env/Roads/` and `Buildings/` hold unused road and building variants from the
same voxel set as the current graveyard, and
`Shared/voxel/characters/ZombieAsset/obj/` has unused zombie variants — both worth
revisiting for biome-specific dressing later.

## D8 — The Test Chamber applies a biome's drive modifiers, not just its ground

A biome is more than its surface: snow only drifts because it also relaxes the
anti-sideslip assist. A chamber that replicated the ground alone would let a player tune a
rig that behaves differently in the real run, which defeats the point of test-driving
before committing to a map.

## D9 — Measured handling, and a known limit in braking contrast

Numbers from the chamber probe (starter rig, 45 km/h entry), asphalt -> snow:

| | asphalt | snow | sand |
| --- | ---: | ---: | ---: |
| 0-45 km/h | 2.0 s | 5.5 s | 3.75 s |
| stopping distance | 9.5 m | 12.0 m | 6.0 m |
| stopping time | 1.33 s | 1.87 s | 0.93 s |
| yaw swept at full lock | 81 deg | 38 deg | 97 deg |
| turn radius | 16 m | 35 m | 12 m |

Snow's dominant, unmistakable effect is that it will not turn: the same steering input
sweeps less than half the yaw and more than doubles the radius. Braking is worse but only
by ~1.25x in both distance and time.

That braking ceiling is structural, not a tuning miss. `stepWheels` clamps braking to a
fixed stop-response term as well as to grip, so once grip is merely adequate the response
term dominates and surface friction stops mattering. Dropping snow's `muLong` to 0.32 did
not produce a smooth curve — it fell off a cliff to a 66 m stop, which is unplayable in a
105 m arena. Snow sits at 0.34/0.24 as the point where cornering is dramatic and braking
is degraded without becoming uncontrollable.

Making snow braking genuinely frightening means reworking the brake model itself, which is
shared by every surface and every existing handling test. That is a deliberate follow-up
for after playtest, not something to slip in during a biome pass.

Sand deliberately stops *shorter* than asphalt: its rolling resistance and sinkage scrub
speed. Sand is about sluggishness and bogging down under weight, not about sliding.

## Steering: wheels drive and steer at the same time

Drive and steer were mutually exclusive, and three separate places enforced it. The
starter rig's `defaultWheelConfig(steering)` returned `driven: !steering`, so the front
wheel was explicitly locked out of drive and the rear pair explicitly locked out of
steering. Because an explicit `config.driven` beats the automatic layout, those flags
survived every rebuild and wheel swap. Underneath, `deriveAutomaticWheelLayout` capped
drive at two wheels and *preferred non-steering ones*, so even a blueprint with no
explicit flags derived to rear-drive-only. `defaultConfigForDef` disagreed with
`defaultWheelConfig` about the default, so behaviour depended on how a wheel got into the
blueprint.

Now every wheel drives by default and steering is always derived. `distributeTorque`
splits a fixed engine output across the driven set, so all-wheel drive spreads traction
rather than adding power. An explicit `driven: false` is still the opt-out.

## Steering: Ackermann without pair-matching

Ackermann was previously computed and then discarded — every steered wheel took the same
angle, so the inner tire scrubbed against the outer one. It had been removed because
left/right pair-matching mis-paired wheels that were asymmetric or remounted mid-run.

The fix keeps Ackermann but drops the pairing. Each wheel independently solves for the
angle that points it at one shared turn centre, from its own lateral and longitudinal
offset. That is exact for asymmetric rigs and the 3-wheel starter, and there is no pair to
get wrong.

The turn centre must sit on an axle that does not steer. When every wheel steers — a
single-axle rig, or a build where the player ticked steering on everything — Ackermann is
undefined, and solving anyway puts the pivot line through the steered wheels themselves,
zeroing their longitudinal offset and leaving the rig unable to turn at all. Single-axle
rigs are explicitly supported by the layout deriver, so that case falls back to giving
each hub the commanded angle.

## Steering: speed fade and asymmetric actuator rate

The old speed fade ran 1.02 -> 0.95, leaving ~95% of full lock at the 42 m/s top speed,
which is why the rig snapped and span. It also let the commanded angle exceed the wheel's
rated max. It now fades `1 / (1 + v/26)` with a 0.38 floor: 1.00 at rest, 0.50 at 26 m/s.
Reducing max steer angle as speed rises is the standard raycast-vehicle fix.

Turn-in and centring were one 14 rad/s rate. They are now split — 9 rad/s in, 18 rad/s
back — so corners load up progressively while recovery stays sharp. Note that
`Math.sign(0)` is 0: a naive sign comparison treats leaving dead centre, the most common
turn-in there is, as a cross-centre correction and hands it the fast centring rate. That
case is excluded explicitly and covered by a test.

No smoothing was added to the raw `controls.steer` input. The per-wheel rate limiter is
already the steering actuator; smoothing the input too would just add lag.

## Sharing a build: self-contained codes, no server

The game is static, so there is nowhere to store a build server-side and hand
back a short seed. A share code therefore carries the whole rig: a compact
binary encoding of the blueprint, base64url'd. The starter rig lands at 266
characters (a 314-character link), which is a paste, not something anyone types.
A real six-character seed would mean running a backend, which the no-server
architecture and the portal deploy model both rule out.

Two things in the encoding are deliberately verbose. The defId table carries
part-id *strings* rather than catalog indices, and the suspension-preset and
paint lists are hand-written append-only arrays rather than derived from the
catalog. Both cost bytes and both buy the same thing: a code shared today still
decodes after a patch inserts a catalog part or a paint colour. Index-based
encoding would corrupt old codes silently, which is the worst possible failure
for something players paste to each other. Tests pin the wire values.

Decoding hands off to the existing `deserializeBlueprint`, so schema migrations
and validation are reused rather than reimplemented, and a hostile or corrupt
code surfaces as a `ShareCodeError` message instead of a broken garage.

## Sharing: imports are free, but locked parts stay on the bench

A shared build always transfers intact, whatever the recipient owns. Parts they
have not unlocked come in flagged and hold **TEST DRIVE** and **Fight Zombies**
until bought, with a banner naming them and a one-click unlock priced from the
existing economy. Charging on import would make most shares simply fail, and
importing with no gate at all would let a wave-30 rig skip the whole
progression curve; this keeps sharing frictionless without letting it buy
progress.

The check lives in `EditorMode.refreshAnalysis`, not in `core/placement.ts`'s
`validateBlueprint`, because that validator is profile-independent and shared
with the runtime — unlock state belongs in the editor layer, where the profile
does. It is filtered through `isUnlocked` rather than the raw profile list, so
a part that costs nothing to unlock can never read as locked and strand a legal
build.

Import asks every time where the build should land, and "load as new slot"
suffixes the name (`(shared)`, `(shared 2)`, …) so it can never silently
overwrite a save. Unlike New Garage, importing refunds nothing: the outgoing
build is not sold, and refunding would hand back the value of a build that
"load as new slot" leaves sitting in its own slot.

The destination dialog mirrors the existing New Garage dialog rather than using
`window.confirm`/`prompt`. Native dialogs are unusable on mobile and are
suppressed outright inside the sandboxed iframes portals embed the game in,
which would have left importing silently dead in production.

## Tank treads: a three-cell belt was modelled as a one-cell wheel

Tread rigs did not steer usefully, and the cause was that a Tank Tread is a
three-cell part (1.5 m) the runtime treated exactly like a 0.5 m wheel: one
ball collider, one suspension raycast, one contact point. Measured on flat
asphalt at full lock, a two-belt tank spun at 7.35 rad/s — more than twice
`YAW_RATE_SOFT_LIMIT` — while a four-belt tank managed 0.42 rad/s at 0.3 m/s.
A 17.5x spread across belt counts is why tread builds felt broken.

Four things were wrong underneath that.

**Belt spin ran away.** `inertia = 0.6·massKg·radius²` is ~8.9 kg·m² against a
7200 N·m torque limit, so ω reached 990 rad/s — about 280 m/s of track speed.
Slip saturated after one step and stayed there, so tread traction sat pinned at
the friction ceiling and belt speed carried no information. Wheel spin is now
capped to a slip allowance that tracks actual vehicle speed.

**Skid-steer authority was a flat constant.** A fixed torque was added per
driven belt with no reference to rig mass, track width, or belt count, so a
light two-belt rig got far more than it could use and a heavy four-belt rig
nowhere near enough. It is now a yaw-rate servo: steer commands a target rate,
and the differential fades to zero as the rig reaches it. That is what makes
belt count stop mattering — the rig holds a rate instead of accelerating for as
long as the key is held.

The servo's sign was the subtle part. Positive steer turns toward -x, which is
a *negative* rotation about +Y. Written the obvious way round, the error term
saturates immediately and never corrects, which turns the controller into an
open-loop accelerator — exactly the runaway it was meant to prevent.

**Pivot in place was impossible.** `brakeInputWithAutoHold` applied the parking
brake whenever there was no throttle at low speed, so the documented excavator
behaviour ("full lock with the throttle shut rotates the chassis in place")
never happened — belt ω stayed at exactly 0. A commanded pivot on a skid-steer
rig now releases auto-hold; a coast with no input still parks.

**Treads then became too fast.** Once the spin runaway was bounded, the belts
stopped wasting their torque and a two-belt tank out-ran a car — 150 km/h
against 121. That top speed had never been designed; it was an accident of the
wheelspin bug. Wheel definitions now carry an explicit `maxSurfaceSpeedMps`,
and the tread's 17 m/s restores the intended "very slow flat-out" (61 km/h vs
the car's 121, against 57-69 km/h before this pass).

Results at full lock, by belt count: 3.00 / 2.52 rad/s (a 1.19x spread, from
17.5x), all under the yaw limit, with pivot-in-place working at 2.31 / 1.54
rad/s. The four-wheel car is unchanged at 2.36 rad/s and 19.3 m/s, which
`unit/tread-acceptance.test.ts` guards — treads must not be fixed by quietly
changing how wheels behave.

Not caused by the all-wheel-drive change in the steering pass: the previous
two-wheel drive cap picked *both left belts* on a four-tread rig, so that rig
was broken before and after, differently.
