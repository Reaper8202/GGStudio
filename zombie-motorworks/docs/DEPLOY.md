# Deploying the playtest build (Vercel)

The game is a static Vite bundle with no server side, so hosting it is "build
and serve a folder". Vercel is the folder host; nothing in the game knows or
cares that it is there.

Deploys come from GitHub: every push to `main` republishes the production URL,
and every pull request gets its own preview URL. Nobody runs a deploy command.

## Project settings (once, in the Vercel dashboard)

Import `JosephLiao542211/GGStudio` and accept the defaults. Root Directory stays
at the repo root; the root `package.json` and `vercel.json` point the build at
the game, so there is nothing to type.

| Setting           | Value           | Why                                         |
| ----------------- | --------------- | ------------------------------------------- |
| Root Directory    | ` ` (repo root) | Where the root `vercel.json` lives.         |
| Framework Preset  | Other           | The build is driven by `vercel.json`.       |
| Production Branch | `main`          | The default, and where finished work lands. |
| Node.js Version   | 22.x            | The default. The game asks for ≥20.19.0.    |

The alternative — setting Root Directory to `zombie-motorworks` and letting
Vercel detect Vite — works too, but then the root config is dead weight and only
one of the two can be right. Pick the root and leave the dashboard empty.

Building from the repo root means a push to any other project in the monorepo
also rebuilds the game. The checkout stays cheap regardless: the 750-odd large
files in `Shared/`, `saved/` and `comfy-zoo/` are Git LFS, and Vercel does not
fetch LFS, so they arrive as pointer stubs. Nothing under `zombie-motorworks/`
is LFS, so every asset the game actually needs is a real blob.

Do **not** set `VITE_CRAZYGAMES_ENCRYPTION_KEY` on this project. Without it the
game falls back to its local leaderboard, which is the right behaviour outside
the CrazyGames frame; that key belongs only to the build submitted to them.

## What Vercel actually runs

From the repo root: `npm run install:game`, then `npm run build`. Both delegate
into this directory with `npm --prefix`, so what finally runs is `npm ci` and
then `tsc --noEmit && vite build` — the same two commands as a local build. Two
consequences worth knowing before a deploy fails at 2am:

- A type error anywhere fails the deploy instead of shipping. That is the point.
- `npm ci` refuses to run if `package-lock.json` has drifted from
  `package.json`. `npm install --package-lock-only` is the fix, and the result
  has to be committed. This has already broken `main` once.

Run the gate before pushing and neither happens:

```sh
npm run test:unit && npm run lint && npm run build
```

## Config that lives in the repo

All three files sit at the **repo root**, not in this directory, because that is
where the deploy starts from.

- `package.json` — exists so a host that lands at the repo root can find its way
  into a game. It holds no dependencies; `install:game` and `build` both hand
  straight off to `zombie-motorworks`.
- `vercel.json` — install command, build command, output directory
  (`zombie-motorworks/dist`), and cache headers. The headers are the only
  non-obvious part: `dist/assets/` holds both content-hashed bundles, which can
  be cached forever, and everything copied out of `public/`, which keeps its
  filename across deploys. Caching the second group the same way would leave a
  returning tester quietly playing against yesterday's models, so those
  revalidate.
- `.vercelignore` — the other projects in the monorepo, plus this game's docs,
  screenshots, tests and probe scripts. Only `dist/` is ever served, so this is
  build weight, not exposure.

## Known limits of the playtest build

- **Desktop only.** There are no touch controls on `main` (the unmerged
  `Zombie-car_V1` branch has a first pass). Say so when sharing the link.
- **17 MB of build output**, of which 5.5 MB is rigged zombie models, 5.5 MB is
  the graveyard, 2 MB is the Rapier physics bundle and 2 MB is audio. That fits
  under the 20 MB initial-download budget a CrazyGames submission has to meet,
  but only because nothing else has been added since. How much of the 17 MB a
  cold load actually pulls has not been measured — do that from the deployed
  build's network panel, not from the folder size.
- **Hobby plan is non-commercial** and capped at 100 GB/month — roughly 6,000
  cold loads, and a returning player re-downloads almost nothing.

## Dev links

`?dev=1` unlocks the tuner panel, the feel log and the wave-clear rating card.
`?dev=1&wave=N` jumps into wave N with the wallet and unlocks a player would
have arriving there. Both work on the deployed build exactly as they do
locally. Keep them out of the link handed to testers; use them to reproduce
what a tester reports.
