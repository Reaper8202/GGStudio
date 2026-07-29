# GGStudio
Premier gaming development studio  

## Structure

- `/docs` — repo-wide guides ([index](docs/README.md))
- `/saved` — raw source assets kept for re-running pipelines
- `/Shared` — cross-game assets (art, audio, fonts) tracked via Git LFS
- `/glb-pipeline` — voxelizes + optimizes a GLB into a game asset, in one command
- `/glb-rigger` — splits a static GLB into rigid parts on an animatable hierarchy
- Each game (HTML5 or Unity) lives in its own top-level folder, e.g. `/MyGame1`, `/MyGame2`

Turn a raw AI-generated GLB into a runtime-ready asset:

```sh
cd glb-pipeline && npm install
node pipeline.mjs ../saved/models/gunslinger-source.glb -o hero.glb
```

See [`docs/glb-pipeline.md`](docs/glb-pipeline.md) for the full pipeline, and
[`docs/glb-rigging.md`](docs/glb-rigging.md) for rigging and animating the result.

Requires [Git LFS](https://git-lfs.com) — run `git lfs install` before cloning or pulling to fetch binary assets correctly.
