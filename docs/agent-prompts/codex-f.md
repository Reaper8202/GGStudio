You are Codex Agent F on Scrap Rig (3D vehicle builder for KIDS, web, strict TypeScript, Three.js editor with DOM UI).

READ FIRST (contracts — MUST NOT edit): src/core/tutorial.ts (another agent is filling in its bodies concurrently, but its EXPORTED API is frozen — code against it exactly: SIMPLE_PART_IDS, KID_LABELS, KidLabel, TutorialStep, TUTORIAL_STEPS, createTutorialBlueprint(), tutorialProgress(bp, getDef), GetDef), src/core/types.ts, src/core/parts.ts, src/core/blueprint.ts.
READ to understand what you're editing: src/editor/ui.ts, src/editor/EditorMode.ts, src/app/App.ts, src/style.css, tests/seam.ts.

YOU OWN: src/editor/ui.ts, src/editor/EditorMode.ts, src/app/App.ts, src/style.css, NEW src/editor/TutorialOverlay.ts, NEW tests/tutorial.spec.ts, tests/seam.ts (type declarations only). Do NOT touch src/core/*, src/runtime/*, src/chamber/*, other tests.

GOAL: this is a kids game. Simplify the palette, auto-configure wheels, and add an interactive guided tutorial.

TASK 1 — Simple palette (default) in ui.ts:
- Two palette modes, persisted in localStorage 'scraprig.palette-mode' ('simple' default | 'all').
- Simple mode: show ONLY SIMPLE_PART_IDS in that exact order, no category headers. Button shows KID_LABELS[id].name (bold) and KID_LABELS[id].blurb as the small line (replace the "X kg · $Y" line in simple mode).
- A toggle button pinned at the bottom of the palette: "🔧 More parts" ↔ "🧒 Simple parts". 'all' mode shows the current category-grouped full palette but using KID_LABELS names, keeping mass/cost as the small line.
- Keep `setArmedPart` working in both modes (partButtons map must contain whichever buttons are rendered; rebuild palette contents on toggle).
- Expose a method on the returned EditorUI: `highlightPaletteButton(defId: string | null): void` — adds/removes CSS class 'tutorial-glow' on that part button (clears any previous highlight; ignore ids not currently rendered).

TASK 2 — Auto wheel config in simple mode (EditorMode.ts):
- In placeGhost(), when palette mode is 'simple' (read the same localStorage key via a small helper) and the def has `wheel`: config = { driven: true, braking: true, steering: pos.z > 0, suspensionPreset: 'standard' } (front wheels steer). Advanced mode unchanged. Leave debugPlace() as is.

TASK 3 — src/editor/TutorialOverlay.ts (new): a DOM component driven from EditorMode.
- Constructor(root: HTMLElement, ui: EditorUI-ish { highlightPaletteButton }, onExit: () => void).
- Methods: `update(bp: VehicleBlueprint, getDef: GetDef): void` (recompute tutorialProgress, render current step), `dispose()`.
- Render: a panel (class 'panel tutorial-panel') centered near the bottom (above the bottombar): "Step N of 7" small, step.title big, step.text, and a [Skip tutorial ✕] button (calls onExit). Calls ui.highlightPaletteButton(step.paletteDefId ?? null).
- When progress === TUTORIAL_STEPS.length: show "🎉 You built a truck! Press the green TEST DRIVE button!" and highlight nothing (the editor already has the TEST DRIVE button; do not try to highlight it).
- Style in src/style.css: `.tutorial-panel { position:absolute; left:50%; transform:translateX(-50%); bottom:64px; width:min(520px,90vw); text-align:center; z-index:15 }` plus `.tutorial-glow { outline:3px solid #79e04d; animation: tut-pulse 1s infinite alternate }` and `@keyframes tut-pulse { from { outline-color:#79e04d } to { outline-color:#2c5f14 } }`.

TASK 4 — EditorMode.ts wiring:
- New public methods: `startTutorial(): void` — replaceBlueprint(createTutorialBlueprint()), create the overlay (disposing any existing), and set a flag; `stopTutorial()` — dispose overlay, clear highlight; `debugTutorialState(): { active: boolean; stepIndex: number; total: number }`.
- Call `overlay.update(this.bp, getPartDef)` at the end of refresh() when the tutorial is active.
- When the tutorial is active and the user presses TEST DRIVE (onTestDrive path), set localStorage 'scraprig.tutorial-done' = '1' and stopTutorial() before entering the chamber.
- Top bar: add a "🎓 Tutorial" button (in buildEditorUI, new handler `onStartTutorial()`).
- First-launch flow (replaces the current auto-open Help): when localStorage has NONE of 'scraprig.tutorial-done', 'scraprig.help-seen', 'scraprig.welcome-seen' AND not ?debug=1: show a small centered dialog (panel, z-index 25): "🚗 Want to learn how to build a zombie truck?" with buttons [🎓 Show me how!] (starts tutorial) and [🔧 I'll figure it out] (just closes). Either choice sets 'scraprig.welcome-seen'. The Help overlay no longer auto-opens (keep the ? Help button working; keep setting 'scraprig.help-seen' when opened manually).

TASK 5 — App.ts debug seam: add `startTutorial: () => this.editor?.startTutorial()` and `tutorialState: () => this.editor?.debugTutorialState()`. Update the Window type declarations in tests/seam.ts accordingly (types only — do not change helper functions).

TASK 6 — NEW tests/tutorial.spec.ts (WRITE ONLY — you cannot run Playwright; it will be run by the maintainer):
- boot via tests/seam.ts helpers; `startTutorial` via seam; assert tutorialState = {active:true, stepIndex:0, total:7}.
- Place through the seam (place() helper) in order, asserting stepIndex after each stage: 4 frame-box at (0,1,1),(0,1,-1),(1,1,0),(-1,1,0) → 1; 4 wheel-mount at (±1,1,±1) → 2; wheels: (-2,1,1),(-2,1,-1) orient 0 and (2,1,1),(2,1,-1) orient (await orientOf(page,'yaw180')), all with config {driven:true,braking:true} → 3; driver-seat (0,2,0) → 4; engine-mount (0,1,2) + engine-small (0,2,2) → 5; fuel-tank (0,2,1) → 6 or 7 (assert stepIndex >= 6); assert enterTest() === true.
- Second test: simple palette renders kid names — expect page text 'Wheel Holder' visible; click "🔧 More parts" and expect a category title (e.g. 'structural') visible.

RULES: `npm run typecheck` and `npx eslint .` must pass (npx vitest run should also still pass — you're not changing core). Do NOT run `npm test`/playwright. No new dependencies. Keep all existing editor behaviour (undo/redo, symmetry, save/load, overlays) working. Report: Done / Files changed / Tests run / Assumptions / Issues / Next recommended task.
