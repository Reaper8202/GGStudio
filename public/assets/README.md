# Assets

Intentionally empty: the MVP generates all textures procedurally at boot
(`src/scenes/BootScene.ts`) and synthesizes sound with WebAudio
(`src/audio/Sfx.ts`), so the initial load is just the code bundle.

When a real art pass happens (see BACKLOG.md):

- `atlas/`  — one trimmed, power-of-two texture atlas (.png + .json)
- `audio/`  — one audio sprite (.mp3/.ogg + .json)
- `fonts/`  — bitmap font (avoid webfonts; load size)

Load them in `src/scenes/PreloadScene.ts`, which already owns the
loading-progress handshake with the platform SDK.
