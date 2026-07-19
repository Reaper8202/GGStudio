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

## Ideas parked during development

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
