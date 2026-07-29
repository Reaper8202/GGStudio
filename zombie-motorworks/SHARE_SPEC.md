# Share-a-build spec

Let a player share their rig: copy a build code or a share link, and have the
recipient's garage load that exact blueprint. The game is static with no
server, so the code must carry the whole build.

Work only in `zombie-motorworks/`. Two phases — **finish and verify phase 1
before starting phase 2.**

Owner decisions already made (do not redesign these):

1. A shared build **always transfers intact and for free**. Parts the recipient
   has not unlocked come in flagged, and block **TEST DRIVE** / **Fight
   Zombies** until bought. Sharing stays frictionless; progression stays
   intact.
2. On import, **ask every time**: "Load as new slot" or "Replace current
   build", plus cancel.
3. Long copy-paste code plus a `?build=` share link. Nobody types it by hand.

---

## Phase 1 — core codec (`src/core/shareCode.ts`)

### API

```ts
export class ShareCodeError extends Error {}
export function encodeShareCode(bp: VehicleBlueprint): string;
export function decodeShareCode(code: string): VehicleBlueprint;
export function lockedDefIdsFor(
  bp: VehicleBlueprint,
  unlockedDefIds: readonly string[],
): string[];   // distinct, catalog order, defIds used by bp but not unlocked
```

Keep it **synchronous**. Do not use `CompressionStream` — it is async and drags
that through the UI and boot path for a modest size win.

### Encoding

Emit a byte buffer, then base64url (`-`/`_`, no `=` padding).

```
magic      "ZMB1"  (4 bytes ASCII) - reject anything else outright
u8         schemaVersion
varint     name byte length, then UTF-8 name bytes
varint     defId table length, then each entry: varint byte length + UTF-8 defId
varint     part count
per part:
  varint   index into the defId table
  zigzag varint  pos.x, pos.y, pos.z
  u8       orient (0-23)
  varint   config field bitmask
  ...      only the config fields whose bit is set, in a fixed documented order
```

The **defId table is deduplicated and carried in the code as strings**. Do not
encode defIds as catalog indices — a later patch that inserts a catalog part
would silently corrupt every code shared before it. The string table costs
bytes and cannot rot.

`config` (`PartConfig` in `src/core/types.ts`) currently holds `level`,
`driven`, `steering`, `steerInverted`, `braking`, `activeAbility`,
`abilitySlot`, `suspensionPreset`, `paint`. Encode booleans in the bitmask
itself. `suspensionPreset` and `paint` are string unions — encode them as an
index into a **frozen, append-only** list declared in this module, and add a
unit test that fails if a new union member is missing from that list, so this
cannot rot silently either. Omit absent fields; `undefined` must round-trip as
`undefined`, since `steering` being underived is load-bearing for wheel layout.

### Decoding

Decode to a plain object, then hand it to the existing
`deserializeBlueprint` (`src/core/serialize.ts`) via `JSON.stringify`, so
schema migrations and the existing hardened validation both apply. Do not
write a second validator.

Every malformed input must throw `ShareCodeError` with a short human message —
truncated buffer, bad magic, bad base64, unknown defId table index, trailing
bytes, part count that overruns the buffer. **Never throw a raw decode error
at the UI, and never crash the garage on a hostile code.**

### Phase 1 tests (`unit/share-code.test.ts`)

1. Round-trips the starter blueprint exactly (`toEqual`).
2. Round-trips a rig exercising every `PartConfig` field, including
   `steering: undefined` staying undefined and `steering: false` staying false.
3. Round-trips negative and multi-digit grid coordinates (zigzag varint).
4. Round-trips a non-ASCII build name.
5. Codes are base64url only: `/^[A-Za-z0-9_-]+$/`.
6. Rejects, with `ShareCodeError`: empty string, garbage text, wrong magic, a
   truncated code, and a code with trailing junk bytes.
7. `lockedDefIdsFor` returns exactly the used-but-not-unlocked defIds, is
   deduplicated, and returns `[]` when everything is unlocked.
8. The frozen `suspensionPreset` / `paint` lists cover every member of those
   unions (guards against silent rot).
9. A realistic ~40-part rig produces a code under 1200 characters.

---

## Phase 2 — editor UI and boot wiring

### Locked parts block play

`EditorMode.refreshAnalysis` (`src/editor/EditorMode.ts:1793`) already computes
`validation.errors` and calls `this.ui.setTestDriveEnabled(enabled, blockedBy)`,
which drives both TEST DRIVE and **Fight Zombies** (`ui.ts:1464-1470`).

Compute `lockedDefIdsFor(this.bp, profile.unlockedDefIds)` there and fold it in:
play is enabled only when `validation.errors.length === 0` **and** there are no
locked parts **and** `parts.length > 0`. Add a clear blocked reason naming the
locked parts.

Do **not** put this in `src/core/placement.ts`'s `validateBlueprint` — that is
profile-independent and shared with the runtime. Unlock state belongs in the
editor layer where the profile lives.

Also surface it visually: a banner in the garage listing the locked parts with
a one-click "Buy missing parts" action, priced with the existing economy
helpers and disabled when unaffordable. Follow the existing selected-part /
economy UI patterns rather than inventing a new style.

### Share and import UI

Add to the garage panel, near the existing save/slot controls:

- **Copy build code** — `encodeShareCode(this.bp)` to the clipboard.
- **Copy share link** — same code as `?build=<code>` on `location.origin +
  location.pathname`.
- **Paste box + Import** — accepts a raw code *or* a full share link (parse the
  `build` param out if it looks like a URL), then runs the import flow.

Use `navigator.clipboard.writeText` with a fallback for insecure contexts, and
report success/failure through the existing `this.ui.setStatus(...)`.

### Import flow

Show a modal with three choices: **Load as new slot**, **Replace current
build**, **Cancel**. Mirror the existing `garage-confirm-overlay` dialog in
`src/editor/ui.ts:655-690` — same class conventions, `role="dialog"`,
`aria-modal`, labelled/described ids, focus restore on close. It is keyboard
accessible and `Esc` cancels.

- *New slot*: save under the code's own name; if that name already exists,
  suffix it (`"Name (shared)"`, then `"Name (shared 2)"`, …) so an import can
  never silently overwrite an existing build.
- *Replace*: overwrite the loaded build only after the player picks it.
- Decode failures never open the modal — show the `ShareCodeError` message via
  `setStatus`.

### Share link on boot

In `src/app/main.ts` (which already reads `URLSearchParams` at line 23), or in
`App.start`, read `?build=`. Decode and run the same import flow once the
garage is up. Then strip the param with `history.replaceState` so a refresh or
a browser back does not re-import.

A malformed `?build=` must show a friendly message and drop the player into the
normal garage — never a crash or a blank screen.

### Phase 2 tests

Unit-test the pure helpers you extract — share-link building, extracting a code
from a pasted URL vs a raw code, and the slot-name de-duplication. Do not try
to unit-test DOM wiring.

---

## Constraints

- Mobile-first: the new controls must work at narrow widths and be tappable.
  Do not let a long code string blow out the panel width.
- Match the surrounding code style and comment density; explain *why* for
  anything non-obvious.
- Do not touch steering, physics, zombies, or the economy rules themselves.
- Do not delete `SHARE_SPEC.md`.

## Verification

Run `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npx vite build`.

Note `npm run typecheck` and `npm run build` have **15 pre-existing failures**
on this branch, all about `empLevel`/`piercingLevel` on `PartConfig` in
`unit/economy.test.ts`, `unit/serialize.test.ts`, `unit/summaries.test.ts`,
`unit/turret-piercing.test.ts`, `unit/weapon-ammo.test.ts`. They are not yours.
Do not "fix" them and do not let them hide a real regression: your work must
add zero new failures.

**Never run Playwright / `npm test` / any browser test** — see `AGENTS.md`.
