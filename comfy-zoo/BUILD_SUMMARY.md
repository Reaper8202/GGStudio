# Comfy Zoo — Build Summary

*Status as of 2026-07-10, branch `joseph/zoo-sim`. Implements `COMFY_ZOO_PLAN.md` through Milestone 3 (pipeline → core-loop vertical slice → full systems → comfy pass). Built by an orchestrator + three parallel subagents (asset pipeline, core game systems, UI overlay) working against shared contracts.*

---

## 1. What exists now

A playable, cozy, low-poly, top-down zoo/ranch sim in **Three.js + TypeScript + Vite** that boots straight into gameplay, runs with **zero runtime errors**, and fits web-portal budgets with huge margin.

```
npm run dev            # play locally
npm run assets         # regenerate public/assets from ../Shared packs (idempotent)
npm run build          # production build to dist/
npm run typecheck      # tsc --noEmit (currently clean, zero errors)
node scripts/smoke-test.mjs   # headless-Chrome boot check + screenshot
```

## 2. Architecture (per CONTRACTS.md)

- **Shared contracts** (orchestrator-owned): typed `EventBus` (~50 events + read-only `GameQuery` surface for the UI), `PlatformAdapter` interface, and all tuning data in `src/data/*.json` — 22 species (12 animals, 4 legendary tints, 6 dinos in mythic unlock order), 7 shelters, 4 resources, 16 quests, `balance.json`. No tunable numbers live in code.
- **Strict decoupling**: systems ↔ UI communicate only via the EventBus; UI emits only `ui:*` events; `main.ts` is the single composition point. Porting to a new portal = one adapter file.
- Runtime dependency is `three` only. No physics engine (hand-rolled spatial hash), no Howler (raw WebAudio), HTML/CSS DOM UI (crisp text at all DPRs — Playables cert requirement).

## 3. Asset pipeline (`scripts/`)

- **Blender not installed** → plan adapted: `FBX2glTF` npm binary (via Rosetta 2) + `gltf-transform` v4.
- Script-first and idempotent: `build-assets.mjs` converts 6 rigged dinos + 13 farm buildings + 25 nature FBX props, compresses those plus 12 animal glTFs and 34 nature glTFs to **meshopt + WebP** `.glb`; copies 17 UI SFX OGGs and the SVG icon set; subsets both OFL fonts to WOFF2 (~24 KB total); emits `manifest.json` with **boot / main / dinos** loading phases and per-file byte sizes.
- `validate-assets.mjs`: 91 models validated — every animal/dino retains its animation clips.
- **Budgets vs. plan caps**: 12.2 MB total assets (cap 30 MB) · boot phase 1.8 MB + 196 KB gz code ≈ **2.5 MB initial load** (target ≤ 15 MB) · 168 files (cap 300) · dinos stream separately (0.7 MB).

## 4. Core game (`src/core|world|entities|systems|platform`)

- **Game.ts**: fixed 60 Hz timestep, WebGLRenderer (pixelRatio ≤ 2), hemisphere + one directional light, procedural blob shadows (no shadow maps), ~50°-pitch follow camera, pause/mute on `visibilitychange` + adapter lifecycle.
- **World**: 2 m tile grid, hand-authored valley with three zones (Meadow → Pine Forest → Palm Oasis + Dino Grove) gated by total-housed milestones; all vegetation/fences as `InstancedMesh`; respawning resource nodes (berry/hay/forage/water).
- **Entities**: primitive-built "ranch keeper" player (zero asset weight; WASD + virtual joystick + E/action button), animal FSM **Wild(Wander|Flee) / Herded(Follow) / Housed(Idle|Eat|Sleep|Hungry|Sad)**, shelters with auto-fenced pens, occupancy signs, and visible trough fill.
- **Systems**: capture rolls with per-individual pity (+10 %/fail) and diet-match bonus; herding/deposit; hunger → Sad → wanders-back-to-wild (never death — comfy brand); coin economy + income ticks; 3 rotating quests; build mode with grid ghost + validity tint (first shelter of a type unlocks its species in the wild); ad-event system (legendary paw-trail encounters, mythic dino eggs, sad-animal rescue, double harvest) — rewards granted only on completed rewarded ads, soft-timer fallback where ads unavailable; offline progress (capped 4 h); daily streak gift + Daily Visitor; interstitials throttled ≥ 180 s and never before first capture.
- **Save**: versioned JSON, autosave 30 s + event-driven, via adapter (localStorage locally, cloud on CrazyGames).
- **Platform adapters**: `LocalAdapter` (full, fake ads), `CrazyGamesAdapter` (SDK dynamically injected only when detected), `PlayablesAdapter` (soft timers, no ads), `DevvitAdapter` (stub).

## 5. UI overlay (`src/ui`)

- Four-element diegetic HUD only: acorn coin counter (count-up, coin-fly particles, can't-afford shake), one-line quest chip (expandable, flower-burst on complete), leaf button → radial menu, context-sensitive action button + fading joystick (touch only; desktop gets once-per-context `E` keycap hints).
- **Build menu**: bottom-third signpost card, world desaturates behind, live 3D model thumbnails, locked silhouettes with unlock hints. **ZooPedia**: journal spread with turntable model / charcoal `???` silhouettes, blossom-star rarity, skin selector with ad-locked variants. **Reward modals**: bouncing 3D model, one watch button + quiet "not now"; also offline summary, daily gift, soft-timer messages.
- Paw-cursor onboarding (zero text walls), WebAudio SFX mapped to all 17 pack sounds, full design-token `theme.css` (cream/bark/leaf palette, Lilita One + Yuyu, spring-pop motion, safe-area + portrait handling).

## 6. Bugs caught in integration (headless-Chrome probes with screenshots)

| Bug | Root cause | Fix |
|---|---|---|
| Animals enormous (cow ≈ barn-sized) | Dino pack authored ~100× oversized (native T-Rex 98 m); packs inconsistent | `scale` redefined as target height in meters; bbox normalization at load; shelters normalized to tile footprint |
| Animal frozen lying on its side | Packs name the run clip `Gallop`; resolver fell through to `Death` | Resolver maps run→gallop; death/attack/hit clips can never be selected |
| Dark jagged foliage artifacts | Leaf cards exported as alpha-`BLEND` (unsortable double-sided planes) | Pipeline post-pass flips foliage to alpha-cutout `MASK` |
| Missing favicon 404 | — | Paw `favicon.svg` added |

## 7. Verified working (automated probes)

Boot → daily gift modal → movement → **cow captured, quest completed and rotated** → radial menu → build menu with live thumbnails → ZooPedia. `tsc` clean, `vite build` succeeds, smoke test passes with zero console/page errors.

## 8. Remaining (plan Milestones 4–5 — not doable locally)

- CrazyGames QA-tool pass + submission; Playables self-contained ZIP cert; Devvit port; soft-launch `balance.json` tuning against D1/session metrics.
- Looping calm music + ambient layer (not in any owned pack — UI SFX fully wired; ~1.5 MB budget reserved).
- **Icon pack ships no license file** — confirm usage terms before launch.
- Nothing committed yet: all work is uncommitted on `joseph/zoo-sim`; `public/assets` is regenerable, commit or ignore by preference.
