# Deploying the playtest build (Vercel)

The game is a static Vite bundle with no server side, so hosting it is "build
and serve a folder". Vercel is the folder host; nothing in the game knows or
cares that it is there.

Deploys come from GitHub: every push to `main` republishes the production URL,
and every pull request gets its own preview URL. Nobody runs a deploy command.

## Project settings (once, in the Vercel dashboard)

Importing `JosephLiao542211/GGStudio` gets the first row wrong by default,
because the repo is a monorepo and the game is not at its root.

| Setting            | Value               | Why                                                                            |
| ------------------ | ------------------- | ------------------------------------------------------------------------------ |
| **Root Directory** | `zombie-motorworks` | The repo root has no `package.json`. Vercel finds nothing and the build fails. |
| Framework Preset   | Vite                | Auto-detected once the root directory is right.                                |
| Production Branch  | `main`              | The default, and where finished work lands.                                    |
| Node.js Version    | 22.x                | The default. `package.json` asks for ≥20.19.0.                                 |

Build command and output directory come from `vercel.json` and need no dashboard
entry.

Do **not** set `VITE_CRAZYGAMES_ENCRYPTION_KEY` on this project. Without it the
game falls back to its local leaderboard, which is the right behaviour outside
the CrazyGames frame; that key belongs only to the build submitted to them.

## What Vercel actually runs

`npm ci`, then `npm run build` — which is `tsc --noEmit && vite build`. Two
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

- `vercel.json` — framework preset, build command, output directory, and cache
  headers. Hashed bundles are immutable; everything copied out of `public/`
  keeps its filename across deploys and so must revalidate, or a returning
  tester silently plays against yesterday's models.
- `.vercelignore` — keeps docs, screenshots, tests and probe scripts out of the
  upload. Only `dist/` is ever served, so this is upload weight, not exposure.

## Known limits of the playtest build

- **Desktop only.** There are no touch controls on `main` (the unmerged
  `Zombie-car_V1` branch has a first pass). Say so when sharing the link.
- **29 MB of build output**, of which 18 MB is rigged zombie models and 5.5 MB
  is the graveyard. Fine on a laptop, slow on a phone tether, and over the 20 MB
  initial-download budget a CrazyGames submission has to fit. The in-flight
  asset pass takes the zombies to roughly 5.5 MB, which is what closes that gap.
  How much of the 29 MB a cold load actually pulls has not been measured yet —
  do that from the deployed build's network panel, not from the folder size.
- **Hobby plan is non-commercial** and capped at 100 GB/month — roughly 6,000
  cold loads, and a returning player re-downloads almost nothing.

## Dev links

`?dev=1` unlocks the tuner panel, the feel log and the wave-clear rating card.
`?dev=1&wave=N` jumps into wave N with the wallet and unlocks a player would
have arriving there. Both work on the deployed build exactly as they do
locally. Keep them out of the link handed to testers; use them to reproduce
what a tester reports.
