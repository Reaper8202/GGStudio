# GGStudio
Premier gaming development studio  

## Structure

- `/Shared` — cross-game assets (art, audio, fonts) tracked via Git LFS
- `/glb-voxelizer` — Blender CLI pipeline for block-remeshing textured GLB assets
- `/glb-optimizer` — remeshes and compresses GLB assets down to a triangle budget
- `/glb-rigger` — splits a static GLB into rigid parts on an animatable hierarchy
- Each game (HTML5 or Unity) lives in its own top-level folder, e.g. `/MyGame1`, `/MyGame2`

See [`GLB_PIPELINE.md`](GLB_PIPELINE.md) for running the full character pipeline
end to end: raw GLB → voxelized → optimized → rigged → animated.

Requires [Git LFS](https://git-lfs.com) — run `git lfs install` before cloning or pulling to fetch binary assets correctly.
