# Comfy Zoo — Design & Technical Plan

A cozy, low-poly, top-down zoo/ranch simulator for web game portals (CrazyGames, YouTube Playables, Reddit Devvit, Poki). You wander a stylized valley, befriend wild animals, herd them into shelters you place on a tile grid, and keep them fed and happy while your collection grows.

---

## 1. Market Research Summary (what the platforms reward)

### Platform constraints (hard requirements)

| Constraint | CrazyGames | YouTube Playables | Reddit (Devvit Web) |
|---|---|---|---|
| Initial load | ≤ 50 MB (fast first frame heavily rewarded) | **≤ 30 MB, fully self-contained ZIP, zero external network calls** | Webview bundle, keep small |
| Total size | ≤ 250 MB, ≤ 1500 files | All-in-one bundle | — |
| Input | Mouse required (pointer-lock guidance) | **Touch AND mouse for every interaction** | Touch + mouse |
| Aspect ratio | Desktop-first, responsive | **All aspect ratios, no orientation lock, pause/resume lifecycle** | Embedded in feed, portrait-friendly |
| Content rating | PEGI 12 max | No excessive violence | Devvit Rules |
| SDK | CrazyGames SDK mandatory (GameplayStart event, video ads, cloud save) | Playables API (no external links, no share prompts) | Devvit Web APIs |
| Monetization | Rewarded + midgame video ads | Platform-handled | Developer Funds (viewership milestones) |

**The binding constraint is YouTube Playables' 30 MB / no-network rule.** If we build for that, CrazyGames and Reddit are supersets. This rules out Unity WebGL (empty builds ≈ 10–25 MB before assets) and points squarely at **Three.js**, which also loads our glTF assets natively.

### Retention & monetization findings

- CrazyGames flags **10+ min average session** as the "hooked" threshold; **cloud save significantly boosts long-term retention** — integrate their auth/cloud-save from day one.
- **Rewarded ads have the highest eCPM and best player sentiment** (opt-in, tied to meaningful benefit). Players who engage with rewarded ads show up to **3.5× higher retention**.
- Idle/simulation web games should monetize **almost exclusively via rewarded ads**; interstitials only at genuine break points, **no more often than every 120–240 s**, and never in the first minutes of a session.
- Day-1 retention is won in the **first 60 seconds**: skip splash screens (CrazyGames full-launch requires direct entry into gameplay), deliver the first reward fast, tutorialize by doing.
- Simulation genre averages D7 ≈ 2.4% on portals — collection mechanics ("gotta catch 'em all" logs), daily content, and offline progress are the proven levers to beat that.
- Reddit's Developer Funds pays on **viewership milestones and community creation** — a daily/streak hook and shareable moments (rare catches) fit their "daily games" category.

Sources: [CrazyGames requirements](https://docs.crazygames.com/requirements/intro/) · [CrazyGames ad monetization guide](https://docs.crazygames.com/resources/ad-monetization-guide/) · [CrazyGames launch metrics](https://docs.crazygames.com/resources/basic-launch-metrics/) · [YouTube Playables developer docs](https://developers.google.com/youtube/gaming/playables) · [Playables design requirements](https://developers.google.com/youtube/gaming/playables/certification/requirements_design) · [Playables certification](https://developers.google.com/youtube/gaming/playables/certification/requirements) · [Reddit Developer Funds](https://support.reddithelp.com/hc/en-us/articles/27958169342996-Reddit-Developer-Funds-H1-2026-Terms) · [Reddit daily games hackathon](https://redditdailygames2026.devpost.com/) · [Playgama monetization best practices](https://wiki.playgama.com/playgama/guides/monetization/best-practices) · [Rewarded ads performance stats](https://maf.ad/en/blog/rewarded-ads-stats/) · [D1–D7 retention guide](https://maf.ad/en/blog/game-retention/) · [Retention by genre](https://blog.playio.co/retention-by-game-genre)

---

## 2. Asset Inventory (exact files we ship)

All three packs include glTF (or FBX→glTF-convertible) low-poly models sharing one stylized aesthetic.

### Animals — `Ultimate Animated Animals - July 2021/glTF/`
12 rigged, animated animals, plus 6 dinosaurs from the companion pack (below) forming the ad-gated top tier.

| Tier | Animals (exact files) |
|---|---|
| Common | `Cow.gltf`, `Donkey.gltf`, `Alpaca.gltf` |
| Uncommon | `Horse.gltf`, `Bull.gltf`, `Deer.gltf` |
| Rare | `Fox.gltf`, `Husky.gltf`, `ShibaInu.gltf` |
| Epic | `Stag.gltf`, `Wolf.gltf` |
| Legendary (ad-gated) | `Horse_White.gltf` ("Spirit Horse"), plus material-tinted variants: Golden Stag, Shadow Wolf, Snow Fox (same rigs, recolored + emissive + particle aura) |
| Mythic (ad-gated) | Dinosaurs — see below |

Rare **skins** (ad-gated cosmetics) are pure material swaps on existing rigs — zero extra download weight.

### Dinosaurs — `Dinosaur Animated Pack - Dec 2018/FBX/` (convert to glTF)
Six rigged, animated dinosaurs, same low-poly style — the **Mythic ad-gated tier** from the original outline, exactly as designed:

| Mythic unlock order | File | Role |
|---|---|---|
| 1 | `Velociraptor.fbx` | First dino encounter — small, fits early pens |
| 2 | `Parasaurolophus.fbx` | Gentle herbivore |
| 3 | `Stegosaurus.fbx` | |
| 4 | `Triceratops.fbx` | |
| 5 | `Apatosaurus.fbx` | Huge — needs max-level habitat |
| 6 | `Trex.fbx` | Final collection trophy (kept friendly/goofy — PEGI-safe) |

Dinosaurs stream in as a **background-loaded bundle** (§8) so they cost nothing against the first-frame budget.

### Nature — `Ultimate Stylized Nature - May 2022/`
- **Trees** (glTF): `BirchTree_1..5`, `MapleTree_1..5`, `DeadTree_1..10`; (FBX→glTF): `PineTree_1..5`, `NormalTree_1..5`, `PalmTree_1..5`
- **Ground cover** (glTF): `Grass_Small`, `Grass_Large`, `Grass_Large_Extruded`, `Flower_1..5_Clump`, `Bush`, `Bush_Small`, `Bush_Large`, `Bush_Flowers`, `Bush_Small_Flowers`, `Bush_Large_Flowers`
- **Props** (FBX→glTF): `Rock_1..5`, `Plant_1..2`, `Petals_1..4` (falling-petal ambience particles)
- **Textures**: shared atlas JPG/PNGs → convert to KTX2

### Buildings — `Farm Buildings - Sept 2018/FBX/` (convert to glTF)
| Game use | File |
|---|---|
| Shelter tier 1 / 2 / 3 | `SmallBarn.fbx` / `Barn.fbx` / `BigBarn.fbx` |
| Open shelter (herbivores) | `OpenBarn.fbx` |
| Small-animal shelter (fox/dogs) | `ChickenCoop.fbx` |
| Feed storage upgrade | `Silo.fbx`, `Silo_House.fbx` |
| Water supply | `WaterTower.fbx`, `Well.fbx` |
| Decor / wind ambience | `Windmill.fbx`, `TowerWindmill.fbx` |
| Pen boundaries | `Fence.fbx`, `Fence2.fbx` |

### Sound — `Sound/OGG/`
A cozy UI SFX pack (17 OGG files) covering the entire UI sound design in §6:

| Game event | File |
|---|---|
| Menu open / close | `UI SFX_InGameMenu_Open.ogg` / `UI SFX_InGameMenu_Close.ogg` |
| Button hover / scroll | `UI SFX_MENU_Hover.ogg`, `UI SFX_MENU_Scroll.ogg` |
| Confirm / back | `UI SFX_MENU_Confirm.ogg`, `UI SFX_MENU_Back.ogg` |
| Capture success / quest complete | `UI SFX_FEEDBACK_Positive.ogg` |
| Capture fail / can't afford | `UI SFX_FEEDBACK_Negative.ogg` (softened, paired with the coin-shake) |
| Animal hungry alert | `UI SFX_FEEDBACK_Alert.ogg` |
| Reward modal appear / dismiss | `UI SFX_FEEDBACK_Woop.ogg` / `UI SFX_FEEDBACK_Woom.ogg` |
| Coin fly-to-counter ticks | `UI SFX_EXTRA_Glockenspiel Hopping.ogg`, `UI SFX_EXTRA_Marimba Hopping.ogg` |
| First-play start | `UI SFX_EXTRA_Start Button.ogg` |
| Save / load | `UI SFX_InGameMenu_Save.ogg`, `UI SFX_InGameMenu_Load.ogg` |
| Sad-animal moment | `UI SFX_EXTRA_Quick Sub Descending.ogg` |

Still needed (not in any pack): looping calm music track, ambient bird/wind layer, footsteps, and animal vocalizations — source from a cozy music pack or commission (~1.5 MB budget remains).

### Fonts — `Fonts/`
Both SIL OFL 1.1 (safe for commercial web embedding), tiny, self-hosted — satisfying the Playables no-external-calls rule with room to spare:

| File | Size | Role |
|---|---|---|
| `Lillita_One/LilitaOne-Regular.ttf` | 28 KB | **Primary UI face** — headings, buttons, numbers, coin counter. Chunky, rounded, extremely legible at small sizes; a casual-game staple that reads instantly in portal thumbnails |
| `Yuyu/Yuyu-Regular.ttf` | 56 KB | **Flavor face** — ZooPedia journal entries, quest chip text, animal names. Playful handwritten style that sells the storybook feel |

Subset both to WOFF2 at build time (Latin basic + digits, ~15–25 KB each). Lilita One is single-weight display — any dense body text (settings, credits) falls back to the system rounded stack (`ui-rounded, system-ui`).

### Icons — `Icon/SVG/`
55 flat, rounded, single-color silhouette icons in three sets: `No Background` (white glyphs), `Background` (glyphs on a filled shape), and `CursorIcons` (10 custom cursors: `Arrow`, `Hand`, `No`, resize set, etc.). The chunky rounded style matches §6's sticker aesthetic exactly, and solid silhouettes recolor freely via CSS `mask-image` — one SVG serves every palette color.

Direct mappings to game UI (named PNGs identify the set; ship the SVGs):

| Game use | Icon |
|---|---|
| Watch-ad buttons | `Movie` |
| Daily login gift | `Gift` |
| Quest chip / goals | `Target`, `Medal` |
| Capture heart / happiness | `Heart`, `Smile` |
| Hungry / sad alerts | `Alert`, `Warning1` |
| Build-placement valid / invalid | `Correct`, `Wrong` |
| ZooPedia locked/unlocked cards | `Locked`, `Unlocked` |
| Shop & build menu | `Shop`, `Plus`, `Minus`, `Trash` |
| Settings, audio, pause | `Settings`, `VolumeOn`/`VolumeOff`, `Play`/`Pause` |
| Day/night ambience toggle | `Sun`, `Moon` |
| Desktop custom cursor | `CursorIcons/Hand` (restyled as a paw-adjacent pointer) |

**Gaps** — the set is generic-UI, so the handful of signature nature icons from §6 (paw print, leaf menu, acorn coin, berry, hammer) still need to be drawn; matching the set's rounded silhouette style makes that a small task. **License: the `Icon/` folder ships no license file — confirm the source and usage terms before launch** (portal certification requires all assets properly licensed).

---

## 3. Tech Stack & Architecture

### Stack
- **Three.js** + **TypeScript** + **Vite** — small runtime (~150 KB gz), native glTF loading, tree-shakeable.
- **Asset pipeline**: FBX → glTF via Blender CLI script, then `gltf-transform` for meshopt compression + KTX2 texture compression + palette/atlas merge. Target: **entire game < 15 MB initial**, comfortably under the Playables 30 MB cap.
- **No physics engine.** Top-down movement needs only circle-vs-circle and circle-vs-AABB checks on a spatial hash grid — hand-rolled, deterministic, tiny.
- **Rendering**: single directional light + hemisphere light, baked-look via vertex colors/matcaps, soft shadow only under player and animals (blob shadows), `InstancedMesh` for all vegetation and fences. Target 60 fps on mid-range phones.
- **Audio**: Howler.js or raw WebAudio; one looping calm track + one ambient layer (birds/wind) + the `Sound/OGG/` UI SFX pack (§2). Budget ≤ 2 MB total (OGG + AAC fallback for Safari).

### Project structure

```
src/
  main.ts                 // bootstrap, platform detect, first-frame fast path
  platform/               // ⭐ SDK abstraction layer
    PlatformAdapter.ts    // interface: init, gameplayStart/Stop, showRewarded,
                          //   showInterstitial, saveCloud, loadCloud, happyTime
    CrazyGamesAdapter.ts
    PlayablesAdapter.ts
    DevvitAdapter.ts
    LocalAdapter.ts       // dev/standalone: localStorage, fake ads
  core/
    Game.ts               // fixed-timestep loop, scene graph root
    SaveSystem.ts         // versioned JSON schema, autosave, cloud sync
    EventBus.ts           // typed pub/sub decoupling systems from UI
    AssetManager.ts       // manifest-driven, phased loading (see §7)
  world/
    TileGrid.ts           // placement grid, occupancy, pathable flags
    WorldGen.ts           // hand-authored map layout + prop instancing
    ResourceNode.ts       // berry bush / hay / water spawn-respawn logic
  entities/
    Player.ts             // input → movement, interact radius
    Animal.ts             // data-driven from animals.json
    AnimalBrain.ts        // FSM: Wild(Wander|Flee) / Herded(Follow) / Housed(Idle|Eat|Sleep|Hungry)
    Shelter.ts            // capacity, level, assigned species, feed trough
  systems/
    HerdingSystem.ts
    HungerSystem.ts
    EconomySystem.ts
    QuestSystem.ts        // session goals + daily tasks
    OfflineProgress.ts
  ui/                     // HTML/CSS overlay (crisp text on all DPRs —
                          //   avoids the Playables text-rendering cert failure)
    HUD.ts  BuildMenu.ts  ZooPedia.ts  RewardModal.ts  Onboarding.ts
  data/
    animals.json  shelters.json  resources.json  quests.json  balance.json
```

**Rules:** all tuning lives in `data/*.json`, never in code. Systems communicate only via `EventBus` events (`animal:captured`, `animal:hungry`, `shelter:placed`…) so UI, analytics, and platform hooks stay decoupled. Every ad, save, and analytics call goes through `PlatformAdapter` — porting to a new portal means writing one adapter file.

---

## 4. Core Gameplay Loop

```
Explore → Spot animal → Approach (sneak) → Capture minigame → Herd home
   ↑                                                            ↓
Collect resources ← Feed & upgrade shelters ← Unlock new species/zones
```

Target session shape: a satisfying loop completes in **60–90 seconds**; a "chapter" (new species unlocked) every **4–6 minutes** — aligned with the 10-min "hooked" session threshold.

### Player & controls
- Top-down third-person, camera at ~50° pitch, gentle follow lerp.
- **Desktop**: WASD/arrows + `E`/click to interact. **Mobile**: floating virtual joystick + one context-sensitive action button. Every interaction must work with touch alone and mouse alone (Playables cert requirement).
- No fail states, no combat, no timer pressure anywhere in the core loop — comfy is the brand.

### Herding / capture mechanic
1. Wild animals wander near their biome. Approaching inside a **flee radius** (varies by rarity) may spook them: they dash away and calm down after a few seconds.
2. Get inside the **interact radius** → press the action button → **capture roll**:
   - Common 90% · Uncommon 70% · Rare 50% · Epic 30% · Legendary/Mythic (ad-gated events only, guaranteed capture)
   - Failure = animal flees (never despawns — no hard punishment). Each failed attempt on the *same individual* adds +10% ("it's warming up to you") so streaks of bad luck can't kill a session.
   - Success = heart burst particles, soft chime, animal enters **Follow** state trailing the player (max 3 followers, upgradeable).
3. Optional depth (Phase 2): holding a food item matching the species' diet raises the base odds by 15% — teaches the resource loop through the capture loop.
4. Walk followers into any matching shelter's pen → they hop in, counter ticks up, XP + coins awarded.

### Shelter mechanic (tile-based building)
- The map has grassy **build plots** on a tile grid (`TileGrid`). Open Build Menu → pick a shelter → ghost preview snaps to grid, green/red validity tint → confirm.
- Each shelter accepts specific species (data-driven in `shelters.json`) and has **capacity** and **level**:
  - Level 1 `SmallBarn` (cap 2) → Level 2 `Barn` (cap 4) → Level 3 `BigBarn` (cap 8) — upgrades swap the model with a satisfying build-poof.
  - `ChickenCoop` houses small animals (Fox, Husky, ShibaInu); `OpenBarn` is the herbivore meadow pen (Deer, Stag, Alpaca).
- **Placing a species' first shelter is what unlocks that species spawning in the wild** — building is the progression gate, exactly as in the outline.
- Auto-fenced pen (instanced `Fence.fbx`) is generated around each shelter's footprint.

### Resource collection & feeding
- **Resource nodes** respawn on timers around the map: berry bushes (`Bush_Flowers` variants), hay patches (`Grass_Large_Extruded`), water (from placed `Well`/`WaterTower`), and mushroom-analog forage (`Plant_1/2`). Walk over + hold action → collect with a progress ring.
- Each housed animal consumes food on a slow tick. Feed by depositing resources into the shelter's trough; a full trough = passive **coin + happiness income** (the idle engine that makes returning tomorrow worthwhile).
- **Hunger, softened for the comfy brand**: unfed animals never *die on screen*. They become Sad (visible droop + "Zzz" cloud), stop producing, and after a long grace period **wander back to the wild** (recapturable later at the original odds). This keeps real stakes for the ad-rescue mechanic without corpses in a pastel zoo — important for PEGI-12 vibes and player sentiment. `balance.json` keys: `hungerTickSeconds`, `sadGraceMinutes`, `wanderOffMinutes`.

### Progression spine
1. Tutorial-by-doing: spawn 5 m from a docile Cow; capture it in the first 30 seconds; free `SmallBarn` pre-placed. First reward inside a minute.
2. Coins (from happy animals + quests) buy shelters, upgrades, follower-cap increases, and cosmetic decor (`Windmill`, flower beds).
3. **ZooPedia** collection log: every species/skin has a card with a silhouette until caught — the completionist retention hook.
4. Zones unlock by total-animals milestones: Meadow (start, birch/maple) → Pine Forest (`PineTree_1..5`, Epic spawns) → Palm Oasis (`PalmTree_1..5`, Legendary events + **Dino Grove**: dinosaur habitats among palms and `DeadTree_1..10`, where Mythic encounters happen).

---

## 5. Rarity, Ads & Monetization

Design principle from the research: **rewarded-first, interstitial-sparse, never punish**.

### Rewarded ad placements (all opt-in, all high-value)
| Placement | Trigger | Reward |
|---|---|---|
| **Rescue** | An animal is Sad and you lack its food | Instantly feed + cheer up that shelter |
| **Legendary encounter** | Golden paw-print trail appears (1–2×/session) | Watch ad → Legendary animal (Spirit Horse `Horse_White.gltf`, Golden Stag, Shadow Wolf, Snow Fox) spawns nearby with a guaranteed-capture sequence |
| **Mythic dino egg** | Giant footprints appear in Dino Grove (rate-limited) | Watch ad → a dinosaur egg hatches the next dino in the unlock order (`Velociraptor` → … → `Trex`); its habitat plot unlocks with it |
| **Rare skin** | ZooPedia card for owned species | Unlock a color-variant skin |
| **Double harvest** | On resource-node collect, occasionally offered | 2× resources for 3 minutes |
| **Instant build** | Shelter upgrade timer (Phase 2) | Skip the wait |

### Interstitials
Only at genuine breaks — returning from the Build Menu after a placement, or on zone transition — never before the first capture, and throttled to the platform-recommended ≥ 180 s interval. Call the SDK's `happytime()` equivalent on captures and upgrades (CrazyGames celebratory hook).

### Platform notes
- **CrazyGames**: full SDK — `sdk.game.gameplayStart/Stop` around play vs. menus, rewarded/midgame video, **user account + cloud save** (their data shows this materially lifts retention).
- **YouTube Playables**: no ad SDK — Mythic/Rescue gates fall back to **soft timers** ("the Spirit Horse returns in 10 min") via `PlatformAdapter` capability flags; revenue there is platform-side.
- **Reddit**: lean on Developer Funds → optimize for daily-visit hooks (below) and a shareable "I caught the Golden Stag" moment (screenshot-worthy capture frame, no external share links).

---

## 6. UI Design — Minimal, Diegetic, Nature-Styled

Guiding rule: **the world is the interface**. The low-poly valley and animals are the visual product; UI exists only to answer "what can I do right now?" and then get out of the way. Every screen element must justify itself against the question *"could the world itself communicate this instead?"*

### Diegetic-first (show it in the world, not in a panel)
- **Animal states live above the animal, not in a HUD**: a small heart burst on capture, a `Zzz`/droop for Sad, a food-icon thought bubble when hungry, an exclamation ripple when spooked. No health bars, no floating stat blocks.
- **Shelter status on the building**: a tiny wooden sign by each shelter shows `3/4` occupancy carved into it; the trough model visibly fills and empties with hay. Walking close reveals a soft radial glow marking the interact zone.
- **Capture odds are felt, not numbered**: flee risk is communicated by the animal's head-turn and ear-flick animations as you approach — players learn to read the animal, which *is* the gameplay. Exact percentages live only in the ZooPedia card for the curious.
- **Progress rings render in-world**: collecting a resource or attempting a capture draws a thin ring around the player/animal in 3D space, not a 2D bar in a corner.
- **Wayfinding without a minimap**: at launch there is **no minimap**. Mythic encounters leave actual glowing paw prints on the terrain leading to the animal; quest targets get a soft firefly/god-ray column visible over the treeline. (A corner minimap is a Phase-2 option only if playtests show people getting lost.)

### The HUD — four elements, nothing else during play
```
┌───────────────────────────────────────────────┐
│ 🌰 128        (twig-frame quest chip)      🍃 │   ← top: coins · current quest · menu leaf
│                                               │
│                                               │
│                 (pure game view)              │
│                                               │
│                                               │
│  (joystick, touch only)         ( 🐾 action ) │   ← bottom: inputs only
└───────────────────────────────────────────────┘
```
1. **Coin count** (top-left): acorn icon + number, no container box — just text with a soft drop shadow sitting directly on the world.
2. **Quest chip** (top-center): one line, current goal only ("House 2 Deer · 1/2"), framed by a slim hand-drawn twig border. Tapping expands the 3-quest list, which auto-collapses. Completing a quest makes the chip bloom (flower-burst animation) before the next slides in.
3. **Menu leaf** (top-right): a single leaf icon opening a radial menu (Build / ZooPedia / Settings). No toolbar rows, ever.
4. **Action button** (bottom-right) + **virtual joystick** (bottom-left, touch only, fading to 30% opacity when idle). The action button is context-sensitive — paw print near animals, berry near resources, hammer near build plots — so no labels and no extra buttons are needed. On desktop neither renders; a small `E` keycap hint appears once per new context, then never again.

Everything else — build menu, ZooPedia, reward modals — is summoned, used, and dismissed. **Zero persistent panels.**

### Menus as objects, not screens
- **Build menu**: a wooden signpost card sliding up over the bottom third of the screen; the world stays visible and gently desaturated behind it — never a full-screen takeover. Shelters appear as **live 3D model thumbnails** on parchment cards (not 2D icons), cost underneath, locked entries as silhouettes with a paw-count requirement.
- **ZooPedia**: a leather-and-leaf journal. Each spread is one animal: the real 3D model on a slow turntable on the left page; name, diet, and rarity (stars drawn as flower blossoms, 1–5) on the right. Uncaught animals are charcoal silhouettes. The journal doubles as the skin selector — swipe the turntable to preview owned and ad-locked color variants.
- **Reward/ad modals**: a small centered card with the reward's 3D model bouncing gently, one big rounded "Watch to Rescue 🎬" button, and a quiet "not now" text link below. Never full-screen, never more than two choices.

### Visual language (design tokens)
- **Palette** (sampled from the asset packs so UI and world read as one piece): warm cream `#F6EEDD` (card/parchment fill), soft bark brown `#8A6B4D` (frames and text), leaf green `#7FB069` (confirm/positive), sky blue `#9BC8E3` (info), sunset peach `#F2A65A` (rewards and rares); muted red reserved for the single "not enough coins" shake. **No pure black, no pure white anywhere.**
- **Shape**: heavily rounded corners (16–24 px), a random 1–2° rotation on cards and stickers for a handmade feel, thin 2 px bark-brown outlines instead of heavy drop shadows. No gradients, gloss, or bevels — flat fills that match the low-poly world rather than generic "mobile game chrome."
- **Typography** (from `Fonts/`, both OFL, subset to WOFF2): **Lilita One** for everything interactive — headings, buttons, numbers, coin counter — chunky and instantly legible; **Yuyu** for flavor — ZooPedia journal entries, quest text, animal names — the handwritten storybook voice. Two sizes per face, nothing else. Every number pairs with an icon so the game is **playable by a 7-year-old who can't read yet**, which is also exactly what makes it parse instantly in a 3-second portal-thumbnail decision.
- **Iconography** (from `Icon/SVG/`): the 55-icon rounded-silhouette set tinted to bark brown via CSS `mask-image`, placed on sticker-like rounded backgrounds — `Movie` on every watch-ad button, `Gift` for dailies, `Heart` for captures, `Locked` silhouettes in the ZooPedia (full mapping in §2). Five signature nature icons still to draw in matching style: leaf = menu, acorn = currency, paw = animals/action, berry = forage, hammer = build; rarity stars drawn as flower blossoms.
- **Motion**: every appear/dismiss is a 150–250 ms scale-pop with slight overshoot (spring easing); buttons squash on press; coins fly as arcing particles from their source to the counter. Motion is the "juice" channel for younger players precisely *because* the layout is so quiet — calm at rest, lively on touch.
- **Sound-paired**: each UI action gets a soft cozy cue from `Sound/OGG/` (hover, confirm, menu open/close, marimba coin ticks — full mapping in §2) — never harsh electronic bleeps.

### Implementation notes
- Built as the HTML/CSS overlay layer from §3 (`ui/`) — DOM text stays crisp at every DPR (avoiding the Playables text-rendering cert failure) and CSS handles the spring animations for free. The 3D thumbnails in menus render through a single shared secondary `WebGLRenderer` drawing into small `<canvas>` elements on the cards.
- All tokens (colors, radii, durations) live in one `ui/theme.css` custom-properties file — the whole skin is tunable without touching components.
- **Safe-area aware and aspect-agnostic**: HUD corners anchor to `env(safe-area-inset-*)`; layout verified from 9:21 portrait to 21:9 ultrawide (Playables requires all aspect ratios). In extreme portrait the quest chip docks under the coin counter instead of the center.
- Onboarding has **zero tutorial text walls**: an animated paw cursor demonstrates each first-time action (move, capture, build) in-world, then hands control back.

---

## 7. Retention Systems

- **First 60 seconds**: playable before full asset load (see §7), first capture ≤ 30 s, first shelter filled ≤ 2 min, first "new species unlocked!" ≤ 4 min.
- **Session goals**: 3 rotating quests always visible ("House 2 Deer", "Collect 10 berries") from `quests.json` — gives every session a start and an end point.
- **Daily loop**: daily login gift (escalating streak), one **Daily Visitor** — a rare animal that appears once per calendar day (the Reddit "daily game" hook), and daily quest refresh.
- **Offline progress**: on return, a warm "While you were away…" summary of coins earned by happy animals (capped at ~4 h) — the single biggest reason to come back tomorrow in this genre.
- **Cloud save** on CrazyGames accounts; versioned localStorage everywhere else, autosave every 30 s and on every meaningful event.
- **Long tail**: ZooPedia completion %, decor customization, zone unlocks, shelter max-outs.

Analytics via the platform dashboards + lightweight custom events (`session_length`, `first_capture_time`, `ad_offer_shown/accepted`, `d1_return`) through the adapter — tune `balance.json` against D1/D7 after soft launch.

---

## 8. Performance & Loading Plan

- **Phased loading**: boot bundle (< 5 MB: player, Cow, starter meadow chunk, UI) → interactive immediately → stream remaining animals/zones in the background via the `AssetManager` manifest. This satisfies CrazyGames' "getting to the first frame" guidance and keeps Playables certification happy.
- **Budgets**: initial ≤ 15 MB, total ≤ 30 MB, ≤ 300 files, 60 fps on a 2020 mid-range Android, cold-load-to-gameplay ≤ 5 s on 4G.
- meshopt + KTX2 everywhere; all vegetation/fences as `InstancedMesh`; animals share skeleton/animation clips where the pack allows; single merged texture atlas for nature props.
- **Lifecycle**: pause loop + mute on `visibilitychange`/Playables pause events (a listed common cert failure); resume cleanly.
- HTML/CSS UI (not canvas text) for crisp rendering across DPRs — the other listed common cert failure.

---

## 9. Milestones

| Phase | Deliverable | Acceptance criteria |
|---|---|---|
| **0. Pipeline** (wk 1) | FBX→glTF conversion scripts, compression pipeline, Vite project, `LocalAdapter`, asset manifest | All 3 packs load in a Three.js scene; total compressed size measured < 30 MB |
| **1. Core loop vertical slice** (wk 2–3) | Player movement (touch+mouse), wander/flee FSM, capture roll, follow, 1 shelter type, 1 resource, hunger tick, save/load | A stranger plays 5 min unprompted and captures ≥ 3 animals |
| **2. Full systems** (wk 4–5) | All 12 animals + 6 dinosaurs with tiers, tile build menu, upgrades, all resources, ZooPedia, quests, onboarding flow | First capture ≤ 30 s from cold load; loop-complete ≤ 90 s |
| **3. Comfy pass** (wk 6) | Lighting, petals/particles, music + SFX, UI polish, decor items, day ambience | "Feels cozy" playtest sign-off; 60 fps on target phone |
| **4. Platform + monetization** (wk 7) | `CrazyGamesAdapter` (ads, cloud save, gameplayStart, happytime, QA tool pass), interstitial throttling, rewarded placements | Passes CrazyGames QA tool; soft-launch submission |
| **5. Soft launch & tune** (wk 8+) | CrazyGames launch, watch D1/session-length, tune `balance.json`; then Playables ZIP build + cert, then Devvit port with daily-visitor emphasis | ≥ 10 min avg session; D1 above genre baseline before wide rollout |

### Explicit deviations from the original outline (and why)
1. **"Death" → "wanders back to the wild"** — identical stakes and identical ad-rescue placement, but compatible with the comfy brand, PEGI-12 review, and portal moderation. Watching your animal leave sad is motivating; watching it die in a pastel game reads as hostile and hurts reviews.
2. **Three.js over a heavy engine** — forced by the Playables 30 MB self-contained rule; also gives the fastest first frame on CrazyGames, which their launch metrics reward directly.
