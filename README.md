# Impostor Run

A 3D three-lane endless runner for web game portals (CrazyGames, Poki,
YouTube Playables-ready): sprint down a space-station corridor with an
**impostor at your heels**, dodging impostors that block your lane, jumping
floor vents, and sliding under energy gates while collecting coins. Get
caught and the chaser pounces. Jump onto **long cargo platforms** and run
along their glowing tops for coin trails; slide-under obstacles alternate
between energy gates and hover drones. The environment cycles every 400 m
(station corridor → open hull → reactor section), and you can pick your
crewmate's color on the menu (persisted via the platform save).

A post-processing pass (bloom + a custom "juice" shader: chromatic
aberration, speed vignette, pickup pulses, death/revive flashes) keeps the
feedback loop punchy; `?fx=0` disables it, and it auto-disables on devices
that can't hold frame rate. Rapid coin streaks climb in pitch.

**Built phone-first**: portrait and landscape both keep all three lanes in
frame (aspect-aware camera rig), swipes register the instant the finger
crosses the threshold (no lift needed), flat-shaded materials + a
degradation ladder (post-FX off → adaptive resolution, floor 0.5×) keep
weak devices above 30 fps, and the UI respects notch safe areas.

Three.js + TypeScript + Vite, zero runtime dependencies beyond Three, zero
binary assets — every model is procedural geometry, textures are generated
canvases, and SFX are WebAudio synthesis. The production build is **~0.5 MB
total (~140 KB gzipped)** against Poki's 8 MB budget.

All characters are an original design (bean-bodied astronauts with antennae
and offset visors) — deliberately distinct from any existing IP so the game
is safe for commercial portal distribution.

> The previous 2D Phaser version is preserved at git tag `v0.1-2d`
> (commit `b32f1f6`).

## Run

```bash
npm install
npm run dev        # http://localhost:5173 — plays against the `local` provider
npm run typecheck  # strict TS, no emit
npm run build      # production bundle → dist/
npm run preview    # serve the production build
npm run build:zip  # dist/ → game.zip (single-ZIP bundle for portal upload)
```

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Switch lane | ← / → | swipe left/right |
| Jump (clears vents; grabs arc coins) | ↑ or Space | swipe up |
| Slide (clears energy gates) | ↓ | swipe down |

Impostors can't be jumped or slid past — change lanes.

## Platform providers

All portal integration goes through one interface
(`src/platform/PlatformSDK.ts`); gameplay code never touches a vendor SDK.
The active provider is chosen at runtime by `src/platform/detect.ts`:

1. Query param: `?provider=poki`, `?provider=crazy`, `?provider=local`
2. Auto-detect by injected vendor global (`PokiSDK` / `window.CrazyGames`)
3. Fallback: `local` (no-op ads, localStorage saves, verbose event logging)

Every provider is wrapped in `LifecycleGuard`, which enforces the portal QA
event-timing contract (strict `gameplayStart`/`gameplayStop` pairing, no SDK
events during ads, audio muted + input frozen + render loop frozen while an
ad runs).

Useful dev query params:

- `?seed=12345` — deterministic run (spawns, difficulty, coin placement).
  With the `local` provider a spawn log is exposed at `window.__spawnLog`.
- `?aa=0` — disable antialiasing (low-end devices / software-GL test rigs).
- `?useLocalSdk=true` — CrazyGames SDK local-testing mode (their flag).

## Portal builds

Same `dist/` output for every portal — only the runtime-detected provider
differs:

- **Poki:** upload `dist/` (or `game.zip`). The portal injects its own SDK
  script; the `<script>` tags in `index.html` only give local dev the globals.
- **CrazyGames:** upload `game.zip`. Select **“Yes, using the Data Module”**
  in the submission flow or cloud saves are disabled.
- **YouTube Playables:** `npm run build:zip` produces the single-ZIP bundle.
  The game itself makes no external network calls at runtime — but remember
  to **remove the two vendor SDK `<script>` tags** from `index.html` for the
  Playables build (they exist only so local dev has the portal globals). Swap
  the stub `YouTubePlayablesProvider` for the real SDK when access lands.

Before submitting anywhere, re-verify the vendor calls against
[`INTEGRATION.md`](./INTEGRATION.md) — SDKs drift, and it flags the items
that need human verification.

## Project layout

- `src/platform/` — ⭐ the SDK spine (interface, guard, providers, detect)
- `src/game/` — Three.js shell: `Game.ts` (loop/camera/state machine),
  `Track.ts` (corridor), `entities/` (procedural crewmate, impostor, vent,
  gate, coin), input, collision
- `src/systems/` — engine-independent logic: seeded RNG, wave spawner with
  solvability guarantee, difficulty ramp, scoring, pooling
- `src/ui/UI.ts` — DOM overlay (menu / HUD / game-over / pause)

See [`docs/ENDLESS_RUNNER_SPEC.md`](./docs/ENDLESS_RUNNER_SPEC.md) for the
original build spec (written for the 2D version; the platform-SDK contract,
gameplay scope, and acceptance criteria still govern). Deferred ideas live
in [`BACKLOG.md`](./BACKLOG.md), not in the code.
