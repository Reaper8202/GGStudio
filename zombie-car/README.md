# Zombie Vehicle Survival — Level 1 Prototype

Top-down 3D wave-survival prototype: drive an armed vehicle through a moonlit
voxel graveyard, survive endless zombie waves, and spend wave rewards on upgrades
until the vehicle is destroyed. Built with TypeScript, Vite, Three.js, and Rapier
(`@dimforge/rapier3d-compat`); the graveyard and zombies use bundled voxel OBJ
assets while the HUD is plain HTML/CSS — no backend and static-host friendly.

## Setup

```bash
npm install
npm run dev      # dev server (http://localhost:5173)
npm run build    # type-checks (tsc --noEmit) then builds static site to dist/
npm run preview  # serve the production build locally
```

## Controls

- **Drive:** WASD or arrow keys, or the virtual joystick (bottom-left, touch +
  mouse). Input is a desired world-space direction: the vehicle steers toward
  it, and pointing more than ~120° behind the current heading reverses.
- **Turret:** fully automatic — targets the nearest zombie in range.
- **Between waves:** buy upgrades in the panel, then press **Start Next Wave**
  (waves never auto-start).
- **HUD buttons:** Reset Vehicle (appears when stuck/overturned), mute toggle.

## Game rules

- 3-second countdown → wave starts. Wave *n*: `8 + 3n` zombies
  (max `min(8 + n, 30)` active), health ×`1 + 0.12(n−1)`, speed
  ×`1 + min(0.025(n−1), 0.5)`. Completing it awards `$100 + 25n` plus per-kill
  rewards; starting money is $200.
- Seven upgrades: Weapon Damage, Fire Rate, Weapon Range, Vehicle Armor,
  Engine Power, Reinforced Chassis, Anti-Swarm — each shows level, current
  effect, next effect, and price, and applies immediately on purchase.
- Zombies clinging to the vehicle slow it down (capped — you can always
  crawl); the HUD shows **SWARMED** when it's significant.
- When the vehicle is destroyed: game-over stats (waves, kills, money earned)
  and an in-place restart (no page reload).

## Architecture

Systems communicate only through a typed event bus and the shared contracts in
`src/types/` — no direct cross-imports between gameplay systems.

| Path | Responsibility |
| --- | --- |
| `src/core/` | Fixed-step 60 Hz game loop (clamped dt, pauses when tab hidden), `GameDirector` phase machine (Countdown → WaveActive → Upgrade → GameOver), event bus |
| `src/types/` | Frozen shared contracts: `GamePhase`, `VehicleBlueprint`, `WeaponStats`, `UpgradeDefinition`, events, collision groups |
| `src/world/` | Open graveyard layout, cached voxel asset loading, sparse trunk/perimeter collision, moon/fill/local/player lighting, zombie spawn points |
| `src/vehicle/` | Data-driven vehicle factory (built from a `VehicleBlueprint` — chassis, N wheels, bumper, engine, turret mount), arcade Rapier controller (momentum, lateral slip, speed-dependent steering, stuck/flip recovery), health |
| `src/input/` | Keyboard + virtual joystick → one normalized world-space direction |
| `src/camera/` | Angled top-down follow camera: look-ahead, speed zoom, impact shake, bounds clamping |
| `src/zombies/` | Pooled zombie entities (Spawning/Chasing/Attacking/KnockedBack/Dead), direct steering (no navmesh), swarm-contact tracking |
| `src/waves/` | Wave scaling, throttled spawning from far spawn points, wave-complete detection |
| `src/weapons/` | Auto-turret with pooled projectiles; reads upgrade modifiers live |
| `src/economy/` + `src/ui/` | Money/kills, upgrade panel, HUD, countdown/game-over overlays |
| `src/config/` | **All tuning lives here** — one file per system (`vehicleTuning.ts`, `waveConfig.ts`, `zombieConfig.ts`, `weaponConfig.ts`, `upgradeDefs.ts`, `economyConfig.ts`, `gameConfig.ts`, `blueprints.ts`) |

Docs: `docs/BUILD_SPEC.md` (canonical spec), `docs/STATUS.md` (ownership map +
progress + integration contract).

## Known limitations

- Single level / single vehicle blueprint (the factory supports arbitrary
  blueprints, but only the starter is defined).
- Audio is minimal procedural placeholder (WebAudio blips), not sound design.
- Zombie spawn points are a fixed ring validated against the current map by
  hand; editing the world geometry near the perimeter requires re-checking
  them (a stuck-zombie teleport watchdog guarantees waves complete either way).
- Zombie avoidance is a light steering correction — they can still pile up on
  tree trunks or the perimeter fence (the stuck-zombie watchdog recovers them).
- No persistence: money/upgrades are run-scoped by design for Level 1.

## Recommended next step

A second vehicle blueprint + a vehicle-select screen would exercise the
blueprint/factory system end-to-end and is the highest-value follow-up; after
that, level variants reusing the same `WorldApi`.
