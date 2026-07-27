# INTEGRATION.md — Verified vendor SDK mappings

Maps the `PlatformSDK` interface (Section 5 of the spec) to **actual, current** PokiSDK and CrazyGames v3 calls. Signatures verified against official docs on **18 Jul 2026**. Vendor SDKs drift — re-check the two source links before final submission.

- PokiSDK (`@poki/sdk`): https://sdk.poki.com/sdk-documentation + npm `@poki/sdk`
- CrazyGames v3 (HTML5): https://docs.crazygames.com/sdk/ (Game, Video ads, Data pages)

> ⚠️ **One item is NOT fully verified** and is flagged `HUMAN-VERIFY` below: Poki cross-device cloud save. The core `@poki/sdk` package does **not** expose a save/load method. `PokiProvider` therefore uses `localStorage` for persistence. If you want Poki cross-device save, wire up Poki's separate "Arbitrary User Data Store" product and confirm its API first.

---

## 0. Loading the vendor SDK

Neither SDK is bundled — both are injected by the portal at runtime, OR loaded via script tag. **Do not `npm install` the vendor SDK into the bundle** (adds weight, and the portal injects its own). Load via `<script>` in `index.html` and treat the global as possibly-absent.

```html
<!-- index.html — loaded only so local/dev has the globals; portals inject their own -->
<!-- Poki: -->
<script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>
<!-- CrazyGames v3: -->
<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
```

Providers must **never assume the global exists**. If missing → behave like `LocalProvider` (no-op ads, `localStorage` save). Poki throws `PokiSDK not loaded` on use if the script is absent; CrazyGames throws on any non-`crazygames`/local environment. Guard everything.

> **Phaser 4 note:** Poki publishes an official `@poki/phaser-3` plugin. It is **Phaser 3 only** — do **not** use it. Call the core `PokiSDK` global directly from `PokiProvider`, as below.

---

## 1. Interface → vendor call map

| `PlatformSDK` method | Poki (`PokiSDK.*`) | CrazyGames v3 (`window.CrazyGames.SDK.*`) |
|---|---|---|
| `init()` | `PokiSDK.init()` → `Promise<void>` | `await SDK.init()` |
| `loadingProgress(f)` | *(no-op — not in current SDK)* | *(fold into `game.loadingStart()` at boot)* |
| `loadingFinished()` | `PokiSDK.gameLoadingFinished()` | `SDK.game.loadingStop()` |
| `gameplayStart()` | `PokiSDK.gameplayStart()` | `SDK.game.gameplayStart()` |
| `gameplayStop()` | `PokiSDK.gameplayStop()` | `SDK.game.gameplayStop()` |
| `commercialBreak()` | `PokiSDK.commercialBreak(onStart?)` → `Promise<void>` | `SDK.ad.requestAd("midgame", cbs)` (callback → wrap in Promise) |
| `rewardedBreak()` | `PokiSDK.rewardedBreak()` → `Promise<boolean>` | `SDK.ad.requestAd("rewarded", cbs)` (resolve `true` on `adFinished`) |
| `save(k,v)` | `localStorage` (see HUMAN-VERIFY) | `SDK.data.setItem(k, v)` |
| `load(k)` | `localStorage` | `SDK.data.getItem(k)` |
| `isReal` | `true` if `PokiSDK` present | `true` if env is `crazygames` |

Key semantic differences the agent must handle:
- **Poki ads are Promise-based; CrazyGames ads are callback-based.** The CrazyGames provider wraps `requestAd` callbacks (`adStarted`/`adFinished`/`adError`) into a Promise.
- **CrazyGames auto-pauses** the game frame during an ad request; you must still mute audio and stop input yourself.
- Poki `commercialBreak(onStart)` takes an optional onStart callback (mute audio there) and resolves when done.

---

## 2. PokiProvider (drop-in)

```typescript
// src/platform/providers/PokiProvider.ts
import type { PlatformSDK } from '../PlatformSDK';

declare const PokiSDK: any; // injected global

export class PokiProvider implements PlatformSDK {
  readonly isReal = typeof (globalThis as any).PokiSDK !== 'undefined';

  async init(): Promise<void> {
    if (!this.isReal) return;
    try {
      await PokiSDK.init();
      PokiSDK.setDebug(false);
    } catch (e) {
      // init can reject (e.g. adblock context) — never throw to caller
      console.warn('PokiSDK.init failed', e);
    }
  }

  loadingProgress(_fraction: number): void {
    // Current @poki/sdk has no progress fraction API — intentional no-op.
  }

  loadingFinished(): void {
    if (this.isReal) PokiSDK.gameLoadingFinished();
  }

  gameplayStart(): void {
    if (this.isReal) PokiSDK.gameplayStart();
  }

  gameplayStop(): void {
    if (this.isReal) PokiSDK.gameplayStop();
  }

  async commercialBreak(): Promise<void> {
    if (!this.isReal) return;
    try {
      await PokiSDK.commercialBreak(() => {
        // onStart: mute audio + disable input HERE
      });
    } catch { /* resume regardless */ }
  }

  async rewardedBreak(): Promise<boolean> {
    if (!this.isReal) return true; // local dev grants reward
    try {
      // returns true only if the user watched the full video
      return await PokiSDK.rewardedBreak();
    } catch {
      return false;
    }
  }

  // HUMAN-VERIFY: core @poki/sdk exposes no cloud-save method.
  // Using localStorage. For cross-device save, integrate Poki's
  // "Arbitrary User Data Store" product and confirm its API first.
  async save(key: string, value: string): Promise<void> {
    try { localStorage.setItem(key, value); } catch {}
  }
  async load(key: string): Promise<string | null> {
    try { return localStorage.getItem(key); } catch { return null; }
  }
}
```

**Poki reference flow (canonical, from docs):**
```typescript
PokiSDK.gameLoadingFinished();
PokiSDK.commercialBreak().then(() => {
  PokiSDK.gameplayStart();
  startGame();
});
// on death:
PokiSDK.gameplayStop();
PokiSDK.rewardedBreak().then((withReward) => {
  if (withReward) { PokiSDK.gameplayStart(); revive(); }
});
```
Notes: not every `commercialBreak()` shows an ad — Poki paces them, so signal as many opportunities as you like. `rewardedBreak()` resets the commercial-break ad timer. Always pause game + mute audio + disable keyboard during both.

---

## 3. CrazyGamesProvider (drop-in)

```typescript
// src/platform/providers/CrazyGamesProvider.ts
import type { PlatformSDK } from '../PlatformSDK';

declare global { interface Window { CrazyGames?: any } }

export class CrazyGamesProvider implements PlatformSDK {
  private sdk: any | null = null;
  isReal = false;

  async init(): Promise<void> {
    const cg = window.CrazyGames?.SDK;
    if (!cg) return;
    try {
      await cg.init();
      this.sdk = cg;
      // environmentData.isRealCrazyGames / environment tells us if ads are live
      this.isReal = cg.environment === 'crazygames';
      cg.game.loadingStart(); // pair with loadingStop() in loadingFinished()
    } catch (e) {
      console.warn('CrazyGames init failed', e);
    }
  }

  loadingProgress(_fraction: number): void { /* no per-fraction API */ }

  loadingFinished(): void {
    try { this.sdk?.game.loadingStop(); } catch {}
  }

  gameplayStart(): void {
    try { this.sdk?.game.gameplayStart(); } catch {}
  }

  gameplayStop(): void {
    try { this.sdk?.game.gameplayStop(); } catch {}
  }

  async commercialBreak(): Promise<void> {
    return this.requestAd('midgame').then(() => void 0);
  }

  async rewardedBreak(): Promise<boolean> {
    return this.requestAd('rewarded');
  }

  /** Wrap callback-based requestAd into a Promise. Resolves true only on adFinished. */
  private requestAd(type: 'midgame' | 'rewarded'): Promise<boolean> {
    if (!this.sdk || !this.isReal) return Promise.resolve(type === 'rewarded');
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
      this.sdk.ad.requestAd(type, {
        adStarted: () => { /* mute audio + pause input HERE */ },
        adFinished: () => { /* unmute + resume */ done(true); },
        adError:   (_e: any) => { /* unmute + resume */ done(false); },
      });
    });
  }

  // Data module = localStorage-compatible API, synced cross-device for logged-in users.
  // MUST select the "Progress Save" toggle in the submission flow or this is disabled.
  async save(key: string, value: string): Promise<void> {
    try { this.sdk ? this.sdk.data.setItem(key, value) : localStorage.setItem(key, value); } catch {}
  }
  async load(key: string): Promise<string | null> {
    try { return this.sdk ? this.sdk.data.getItem(key) : localStorage.getItem(key); }
    catch { return null; }
  }
}
```

**CrazyGames v3 verified calls:**
- Init: `await window.CrazyGames.SDK.init();`
- Gameplay: `SDK.game.gameplayStart()` / `SDK.game.gameplayStop()`
- Loading: `SDK.game.loadingStart()` / `SDK.game.loadingStop()`
- Ads: `SDK.ad.requestAd("midgame" | "rewarded", { adStarted, adError, adFinished })`
- Data: `SDK.data.setItem/getItem/removeItem/clear` — same API as `localStorage`.

---

## 4. Environment detection (`detect.ts`)

```typescript
// src/platform/detect.ts
import { LocalProvider } from './providers/LocalProvider';
import { PokiProvider } from './providers/PokiProvider';
import { CrazyGamesProvider } from './providers/CrazyGamesProvider';
import type { PlatformSDK } from './PlatformSDK';

export function selectProvider(): PlatformSDK {
  const q = new URLSearchParams(location.search).get('provider');
  if (q === 'poki')  return new PokiProvider();
  if (q === 'crazy') return new CrazyGamesProvider();
  if (q === 'local') return new LocalProvider();

  // Auto-detect by injected global; fall back to local.
  if (typeof (globalThis as any).PokiSDK !== 'undefined') return new PokiProvider();
  if (typeof window.CrazyGames !== 'undefined')           return new CrazyGamesProvider();
  return new LocalProvider();
}
```
CrazyGames local testing: append `?useLocalSdk=true` to force the SDK's local environment (ads show an overlay instead of failing).

---

## 5. Cloud-save specifics & limits

- **CrazyGames:** 1 MB total data cap per game (`dataLimitExcedeed` error above it). Writes are debounced ~1s (up to 30s under load). For guests it uses `localStorage` and auto-migrates to the account on login. **Rely solely on the Data Module** when it's enabled — don't double-write to `localStorage`, and select "Yes, using the Data Module" at submission or it's disabled. Always `load` before `save` to avoid clobbering progress.
- **Poki:** `HUMAN-VERIFY` — no core-SDK save. `localStorage` is fine for a single high-score integer; wire the Arbitrary User Data Store only if cross-device is needed.

---

## 6. Rejection-trigger checklist (portal QA fails these)

- `gameplayStart()` fired on load instead of first input, or fired twice without an intervening `gameplayStop()`.
- Any SDK event fired **during** an ad.
- Audio not muted / input not disabled during `commercialBreak` / rewarded ad.
- Page scrolls on arrow keys / space when embedded (must `preventDefault`).
- More than 1 click from portal load to gameplay.
- Third-party trackers/analytics added without portal consent (Poki especially).
- Initial load over budget (Poki target 8 MB; Playables hard 30 MB; CrazyGames Basic 50 MB / 1500 files).
- **CrazyGames sitelock:** confirm the game runs when embedded from CrazyGames domains only if you enable sitelock — test the embedded build, not just localhost.

---

## 7. Explicitly UNVERIFIED / confirm before submit

1. `HUMAN-VERIFY` Poki cloud-save API (Arbitrary User Data Store) — not implemented; localStorage used.
2. Exact CrazyGames v3 script CDN URL and `SDK.environment` value string — confirm on the current SDK intro page (`environment` may be exposed as `environment` or via `SDK.environmentData`; the provider guards either way via try/catch, but verify the truthy branch actually enables ads in the CrazyGames preview tool).
3. Poki SDK v2 script URL — confirm current path in Poki's HTML5 integration page; the portal injects its own in production, so this only affects local testing.
