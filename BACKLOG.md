# Backlog

Deferred ideas land here, not in the code. Scope of the MVP is fixed by
`docs/ENDLESS_RUNNER_SPEC.md` §3.

## Explicit non-goals from the spec (do not build without a new decision)

- Multiple characters / skins
- Shop and upgrades (coin sink)
- Multiple biomes / environment themes
- Power-ups beyond the revive invulnerability window
- Leaderboards
- Accounts / profiles
- Sound settings menu
- Multiplayer
- Save slots

## Ideas parked during the 3D rewrite

- ~~Chasing impostor visible behind the player~~ — shipped (polish iteration)
- ~~Impostor lunge animation on death~~ — shipped (polish iteration)
- ~~Environment variety: corridor → hull → reactor~~ — shipped (400 m cycle)
- ~~Player color picker (crew colors)~~ — shipped (menu swatches, persisted)
- Shadow-mapped lighting (currently cheap blob shadows)
- Post-processing bloom on visors/gates (needs a perf budget pass first)
- Chaser reacts to near-misses (surges closer when you graze an obstacle)
- Theme-specific obstacle skins (reactor vents glow, hull gates are airlocks)

## Ideas parked during 2D development

- Real art pass: replace procedural textures with a drawn texture atlas
  (drop-in: `public/assets/atlas/`, load in `PreloadScene`)
- Audio sprite with real SFX + a music loop (drop-in: `public/assets/audio/`)
- Poki cross-device cloud save via their Arbitrary User Data Store
  (`HUMAN-VERIFY` item in INTEGRATION.md — core SDK has no save API)
- Near-miss scoring bonus (grazing an obstacle without dying)
- Coin magnet window after collecting N coins in a row
- Pseudo-3D perspective scaling on obstacles as they approach
- Side-decor parallax (buildings/pillars outside the road)
- Haptics on mobile collision (`navigator.vibrate`)
- Reduced-motion accessibility toggle
