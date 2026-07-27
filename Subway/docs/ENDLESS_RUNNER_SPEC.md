# Endless Runner — Project Skeleton & Build Spec

**Audience:** Claude Code (planning w/ Fable 5, execution via Sonnet agents).
**Mode:** One-shot. Plan the full build from this doc, then implement. Ask no clarifying questions unless a decision below is genuinely undefined.

---

## 0. Agent instructions (read first)

- Build the **complete, playable MVP** described here. Not a stub, not a demo scene — a shippable endless runner.
- **Scope is fixed.** Do not add features outside Section 3. If tempted to add polish, put it in `BACKLOG.md` instead of building it.
- **Load size is a first-class constraint**, not an afterthought. Every asset decision is measured against the 8 MB initial-load ceiling (Section 6). Fail the build mentally if you'd blow it.
- The **platform SDK layer (Section 5) is the architectural spine.** All ad/lifecycle calls route through one interface. No SDK-specific code anywhere in gameplay.
- Work in this order: scaffold → config → platform layer (with `local` provider) → core loop → systems → UI → polish → provider adapters. Keep the game runnable at every step against the `local` provider.
- Definition of done = Section 9 acceptance criteria all pass.

---

## 1. Product summary

A 3-lane instant-play endless runner (Subway Surfers archetype) for web game portals. Run forward automatically, dodge obstacles by switching lanes / jumping / sliding, collect coins, survive as long as possible, beat your high score.

**Distribution goal:** validate on CrazyGames + Poki → use that traction to earn YouTube Playables access. The code must run identically across all three; only the active SDK provider changes.

---

## 2. Tech stack (fixed)

| Concern | Choice | Notes |
|---|---|---|
| Engine | **Phaser 4.2.0** | Current (Jun 2026). `import Phaser from 'phaser'` (ESM default export works as of 4.1+). |
| Language | **TypeScript** (strict) | |
| Bundler | **Vite** | Single-file-ish output, tree-shaken, minified. |
| Deps | **Phaser only** | No UI frameworks, no state libs, no lodash. Every dependency is load-size debt. |
| Rendering | WebGL (Phaser default), Canvas fallback auto | |
| Target | 16:9 responsive, desktop + mobile web | 60fps target / 30fps floor |

Do **not** introduce React/Vue/Tailwind — this is a canvas game, HUD is drawn in Phaser.

---

## 3. Gameplay scope (MVP — build exactly this)

- **Lanes:** 3 fixed lanes. Player snaps between them (tweened, ~120ms).
- **Controls:**
  - Desktop: ← → (lanes), ↑ / Space (jump), ↓ (slide).
  - Mobile: swipe left/right (lanes), swipe up (jump), swipe down (slide).
  - Prevent default page scroll on arrow keys / space when embedded.
- **Auto-run:** world scrolls toward player at increasing speed.
- **Obstacles:** procedurally spawned, per-lane. At minimum: low barrier (jump over), high barrier (slide under), full block (must change lane). No two adjacent patterns should be unavoidable — generator must guarantee a solvable path.
- **Coins:** spawned in lanes and in arcs (over jumps). Collecting increments coin count + score.
- **Difficulty ramp:** scroll speed + spawn density increase with distance. Deterministic given a seed.
- **Collision:** hitting an obstacle = game over.
- **Scoring:** score = f(distance) + coins. Persist high score (see Section 5 cloud-save; fall back to `localStorage` only in `local` provider).
- **States:** Boot → Preload → Menu (1-tap start) → Play → GameOver (1-tap restart or rewarded revive).
- **Revive:** one rewarded-ad revive per run (resumes at same position with brief invulnerability).
- **Onboarding:** teach through play in <30s. **No tutorial screen.** First obstacle is trivially avoidable.

**Explicit non-goals (do NOT build):** multiple characters, shop/upgrades, multiple biomes, power-ups beyond revive invuln, leaderboards, accounts, sound settings menu, multiplayer, save slots. Log these in `BACKLOG.md`.

---

## 4. Directory structure

```
endless-runner/
├─ index.html
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ README.md
├─ BACKLOG.md                 # deferred ideas go here, not into code
├─ public/
│  └─ assets/
│     ├─ atlas/               # texture atlas (.png + .json) — ONE atlas if possible
│     ├─ audio/               # audio sprite (.mp3/.ogg + .json)
│     └─ fonts/               # bitmap font (avoid webfonts for load size)
└─ src/
   ├─ main.ts                 # Phaser.Game config + boot
   ├─ config/
   │  ├─ GameConfig.ts        # tunables: lanes, speeds, spawn rates, ramp curve
   │  └─ constants.ts         # keys, depths, event names, scene keys
   ├─ scenes/
   │  ├─ BootScene.ts         # init platform SDK, set scaling
   │  ├─ PreloadScene.ts      # load atlas/audio, report load progress to SDK
   │  ├─ MenuScene.ts         # 1-tap start
   │  ├─ PlayScene.ts         # main loop; owns systems
   │  └─ GameOverScene.ts     # score, restart, rewarded revive
   ├─ systems/
   │  ├─ LaneManager.ts       # lane x-positions, snap logic
   │  ├─ InputController.ts   # keyboard + swipe → intents (unified)
   │  ├─ Spawner.ts           # obstacle + coin generation, solvability guarantee
   │  ├─ DifficultyDirector.ts# speed + density ramp from distance/seed
   │  ├─ CollisionSystem.ts   # player vs obstacle / coin
   │  ├─ ScoreManager.ts      # distance + coins → score, high-score persistence
   │  └─ ObjectPool.ts        # reuse obstacle/coin sprites (no GC churn)
   ├─ entities/
   │  ├─ Player.ts            # state machine: run / jump / slide / dead / invuln
   │  ├─ Obstacle.ts
   │  └─ Coin.ts
   ├─ ui/
   │  ├─ Hud.ts               # score, coins, distance (drawn in Phaser)
   │  └─ Overlay.ts           # start/gameover panels
   └─ platform/               # ⭐ THE SPINE — see Section 5
      ├─ PlatformSDK.ts       # interface + provider selection
      ├─ providers/
      │  ├─ LocalProvider.ts  # dev/no-op, localStorage save, fake ads
      │  ├─ PokiProvider.ts
      │  └─ CrazyGamesProvider.ts
      └─ detect.ts            # choose provider at runtime
```

---

## 5. Platform SDK abstraction (⭐ critical)

All portals share the same event model. Build **one interface**; gameplay code never touches a vendor SDK directly. Provider is chosen at runtime by `detect.ts` (env/host/query-param). Ship with `LocalProvider` so the game is fully runnable with zero portal dependency.

### 5.1 Interface

```typescript
// src/platform/PlatformSDK.ts
export interface PlatformSDK {
  /** Call once at boot. Loads/inits the vendor SDK. Never throws to caller. */
  init(): Promise<void>;

  /** Report asset-load progress 0..1 during Preload (Poki wants this). */
  loadingProgress(fraction: number): void;
  loadingFinished(): void;

  /** Fire on the player's FIRST input of a run — NOT on scene load. */
  gameplayStart(): void;

  /** Fire on ANY interruption: game over, pause, menu open, revive prompt. */
  gameplayStop(): void;

  /**
   * Interstitial between runs / returning from pause.
   * MUST await before resuming gameplay. No game logic runs during the ad.
   */
  commercialBreak(): Promise<void>;

  /**
   * Rewarded video (used for revive). Resolves true if fully watched.
   * Caller grants the reward only on true.
   */
  rewardedBreak(): Promise<boolean>;

  /** Cloud save/load (falls back to localStorage in LocalProvider). */
  save(key: string, value: string): Promise<void>;
  load(key: string): Promise<string | null>;

  /** true only on a real portal environment (ads available). */
  readonly isReal: boolean;
}
```

### 5.2 Event timing contract (portal QA rejects violations)

- `gameplayStart()` fires on **first input**, once per run. Never on load, never twice without an intervening `gameplayStop()`.
- `gameplayStop()` fires on every interruption before any ad or menu.
- **No SDK events may fire during an ad** (commercial or rewarded).
- `commercialBreak()` is awaited when leaving a pause / between runs, then gameplay resumes.
- Pair start/stop strictly: never two `gameplayStart()` in a row, never `gameplayStop()` after `gameplayStop()`.

### 5.3 Provider notes

- **LocalProvider:** all ad methods resolve immediately (rewarded → `true` after a fake 1s), `save/load` via `localStorage`, `isReal=false`. This is the default in dev.
- **PokiProvider:** wrap PokiSDK. `gameplayStart/Stop`, `commercialBreak`, `rewardedBreak`, `gameLoadingProgress`/`gameLoadingFinished`. Use Poki's data-store for `save/load`. Poki forbids third-party trackers without consent — **do not add analytics SDKs.**
- **CrazyGamesProvider:** wrap CrazyGames SDK v3. Map `gameplayStart/Stop` to their gameplay events, `commercialBreak` → midgame ad, `rewardedBreak` → rewarded ad, cloud saves via their data module. SDK only works on `crazygames` (and local) environments — guard calls so other hosts no-op.
- **YouTube Playables:** no adapter yet (early-access/invite-only in 2026). But **honor its hard rules now** so the port is trivial later: no external network calls at runtime, single ZIP bundle, correct pause/resume lifecycle. Keep a `YouTubePlayablesProvider.ts` placeholder stub implementing the interface as no-ops.

---

## 6. Load-size & performance budget (hard)

- **Initial load < 8 MB** (Poki's target — strictest, so it governs). CrazyGames allows 50 MB but design to 8.
- **No external network calls at runtime** (Playables rule; also good for offline resilience). Everything bundled under `public/assets/`.
- **One texture atlas** and **one audio sprite** if achievable. Trim, power-of-two, compress.
- Bitmap font over webfont.
- **Object-pool** all obstacles/coins — zero per-frame allocation in the run loop.
- 60fps target on mid-range mobile; never drop below 30.
- Prevent arrow-key/space page scroll when embedded (`preventDefault`).
- Land the player in gameplay in **≤1 click** from portal load.

---

## 7. Key config surface (`GameConfig.ts`)

Expose these as tunables so balancing needs no code changes:

```typescript
export const GameConfig = {
  lanes: 3,
  laneSwitchMs: 120,
  baseScrollSpeed: 420,      // px/s
  maxScrollSpeed: 1100,
  speedRampPerMeter: 0.35,
  jumpMs: 600,
  slideMs: 550,
  spawn: {
    baseGapMs: 1400,
    minGapMs: 650,
    coinChance: 0.55,
  },
  reviveInvulnMs: 1500,
  seed: undefined as number | undefined, // set for deterministic runs/tests
};
```

---

## 8. Build & deploy config

- `package.json`: `phaser@^4.2.0`, `vite`, `typescript`. Scripts: `dev`, `build`, `preview`, `typecheck`.
- `vite.config.ts`: base `'./'` (portals serve from arbitrary paths), minify, assets inlined where small, output to `dist/`.
- Provide a `build:zip` script that produces the single ZIP bundle Playables/portals expect.
- `README.md`: how to run, how to switch providers (`?provider=poki|crazy|local`), how to build each portal target.

---

## 9. Acceptance criteria (definition of done)

The build is done only when **all** pass:

1. `npm run dev` → playable end-to-end against `local` provider, no console errors.
2. Full loop works: menu → 1-tap start → run → collision → game over → restart, and rewarded revive resumes the same run.
3. Lane switch, jump, slide all work on keyboard **and** touch/swipe.
4. Spawner never produces an unavoidable obstacle sequence (verify with fixed seed).
5. Difficulty ramps smoothly; deterministic under a set seed.
6. High score persists across reloads.
7. `gameplayStart` fires on first input only; `gameplayStop` on every interruption; no events during ads. (Assert with `local` provider logging.)
8. Production build initial load **< 8 MB**; no runtime external network requests.
9. Runs 60fps desktop, ≥30fps throttled-mobile; no per-frame allocations in the run loop (pooled).
10. `?provider=poki` and `?provider=crazy` select the right adapter without touching gameplay code; unknown host → `local`.
11. `typecheck` clean under strict TS.

---

## 10. Deliverables

- Full source per the tree in Section 4.
- `LocalProvider` fully working; `PokiProvider` + `CrazyGamesProvider` implemented against their public SDKs; `YouTubePlayablesProvider` stub.
- `README.md`, `BACKLOG.md`, working `dev`/`build`/`build:zip`.
- A short `INTEGRATION.md` listing exactly which vendor SDK calls each provider maps to, so a human can verify against current portal docs before submitting.
