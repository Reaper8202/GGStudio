# Lane Runner

A 3-lane instant-play endless runner for web game portals (CrazyGames, Poki,
YouTube Playables-ready). Phaser 4 + TypeScript + Vite, zero runtime
dependencies beyond Phaser, zero binary assets — all art and sound are
generated procedurally at boot, so the initial load is essentially the code
bundle (well under Poki's 8 MB target).

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
| Jump (clears low barriers) | ↑ or Space | swipe up |
| Slide (clears overhead gates) | ↓ | swipe down |

Full blocks can't be jumped or slid — change lanes.

## Platform providers

All portal integration goes through one interface
(`src/platform/PlatformSDK.ts`); gameplay code never touches a vendor SDK.
The active provider is chosen at runtime by `src/platform/detect.ts`:

1. Query param: `?provider=poki`, `?provider=crazy`, `?provider=local`
2. Auto-detect by injected vendor global (`PokiSDK` / `window.CrazyGames`)
3. Fallback: `local` (no-op ads, localStorage saves, verbose event logging)

Every provider is wrapped in `LifecycleGuard`, which enforces the portal QA
event-timing contract (strict `gameplayStart`/`gameplayStop` pairing, no SDK
events during ads, audio muted + input frozen + game loop asleep while an ad
runs).

Useful dev query params:

- `?seed=12345` — deterministic run (spawns, difficulty, coin placement).
  With the `local` provider a spawn log is exposed at `window.__spawnLog`.
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

See [`docs/ENDLESS_RUNNER_SPEC.md`](./docs/ENDLESS_RUNNER_SPEC.md) for the
full build spec. Deferred ideas live in [`BACKLOG.md`](./BACKLOG.md), not in
the code.
