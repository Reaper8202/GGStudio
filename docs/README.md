# GGStudio Documentation

Repo-wide guides. Per-game docs live inside each game folder (for example
`zombie-motorworks/docs/`).

## 3D character asset pipeline

Raw AI-generated GLB → voxelized → optimized → rigged → animated.

| Guide | Covers | Tool |
| --- | --- | --- |
| [glb-pipeline.md](glb-pipeline.md) | Voxelize + optimize, in one command | `glb-pipeline/` |
| [glb-rigging.md](glb-rigging.md) | Rigid-part rigging and animation | `glb-rigger/` |

Start here:

```sh
cd glb-pipeline && npm install
node pipeline.mjs ../saved/models/gunslinger-source.glb -o hero.glb
```

## Assets

Raw source models kept for re-running the pipeline live in `saved/models/`.
Everything derived from them is regenerable and is not committed — build it with
the command above.
