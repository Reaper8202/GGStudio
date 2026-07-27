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
