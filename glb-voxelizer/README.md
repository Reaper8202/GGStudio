# GLB Voxelizer

A small Blender-powered pipeline that turns static `.glb` models into blocky,
pixel-style `.glb` models.

It follows Blender's **Remesh → Blocks → Octree Depth** workflow. Since Blocks
remeshing removes the original UV map, the tool projects the source model's
material and texture color onto every new voxel face and exports that appearance
as glTF vertex colors.

## Requirements

- Python 3.9+
- Blender 3.6 or newer

Blender must be on `PATH`, supplied with `--blender`, or set in the `BLENDER`
environment variable.

## Usage

```sh
cd glb-voxelizer
python3 voxelize.py model.glb --depth 5
```

The default output is `model.voxel.glb` beside the input.

Set an explicit output:

```sh
python3 voxelize.py model.glb -o build/model-pixel.glb --depth 6
```

Process several files:

```sh
python3 voxelize.py models/*.glb --output-dir build/voxel --depth 5
```

If Blender is not on `PATH`:

```sh
python3 voxelize.py model.glb \
  --blender /Applications/Blender.app/Contents/MacOS/Blender \
  --depth 5
```

## Resolution flag

`--depth` (also `--factor` or `-d`) is Blender's Blocks Remesh
**Octree Depth**:

| Depth | Result | Typical use |
| --- | --- | --- |
| 4 | Large blocks, very low detail | Props and strong pixel style |
| 5 | Medium blocks | Good default |
| 6 | Small blocks, more detail | Characters and detailed props |
| 7 | Fine blocks, heavier mesh | Close-up assets |

Each increase can create substantially more geometry. Start at `5`.

## Color behavior

The default `--color-samples 5` samples the center and four inset corners of
each voxel face, then averages them. This gives stable colors near texture
boundaries. Use `--color-samples 1` for a faster, harder pixel look.

The color projector supports the standard glTF/GLB material setup used by
Blender's importer: base-color textures, base-color factors, vertex colors,
alpha, and common Mix/Multiply nodes. The output uses one material with a
`VoxelColor` face-corner color attribute, so no texture atlas or external image
files are needed.

## Limitations

- The output is a single static mesh. Armatures, morph targets, and animations
  are intentionally not retained.
- The source should be a closed or mostly closed mesh. Very thin, open, or
  non-manifold surfaces may disappear; increase `--depth` or repair the source.
- Procedural Blender-only shaders cannot be evaluated exactly. Standard GLB
  PBR materials and textures are supported.
- All input meshes are joined before remeshing so they share one consistent
  voxel grid.

Use `--keep-largest` to remove small disconnected pieces during remeshing.
