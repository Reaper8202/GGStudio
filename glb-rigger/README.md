# GLB Rigger

Splits a static `.glb` into rigid body-part chunks parented into an animatable
node hierarchy, so a character can be animated in code without any skinning.

Third of the three GLB tools here: `../glb-voxelizer` restyles a model,
`../glb-optimizer` makes it cheap to render, and this one makes it move.

## Why rigid chunks

Conventional skinning wants a T-pose or A-pose bind pose. Models straight out of
Meshy usually are not in one — the Necromancer stands in a casting stance — so
skin weights bake bad shoulder and elbow deformation, and auto-riggers like
Mixamo tend to choke.

Rotating a rigid chunk about its joint works from *any* starting pose, and
hard-edged voxel art hides the absence of vertex blending. It is the same reason
Minecraft-style characters get away with rigid limbs.

## Requirements

- Node.js 20.19+ (`npm install` in this directory)

No Blender needed.

## Usage

```sh
cd glb-rigger
npm install
node rig.mjs model.glb --config model.rig.json
```

The default output is `model.rigged.glb` beside the input.

```sh
node rig.mjs input.glb -c necromancer.rig.json -o out/necro.glb --list
node rig.mjs input.glb -c necromancer.rig.json --debug-colors out/debug.glb
```

Run `node rig.mjs --help` for the full flag list.

## Rig definition

Each joint has a model-space position, a parent, and a `tip`. The bone is the
segment `pos -> tip`; every triangle is assigned to whichever bone segment its
centroid is nearest.

```json
{
  "joints": [
    { "name": "hips",  "parent": null,   "pos": [0.02, 0.02, -0.22], "tip": [0, 0.16, -0.24], "radius": 0.95 },
    { "name": "torso", "parent": "hips", "pos": [0, 0.16, -0.24], "tip": [-0.02, 0.7, -0.15], "radius": 1.55 }
  ]
}
```

`radius` divides the measured distance, so a bigger radius makes a bone greedier
for contested mass. This is the main tuning knob: the Necromancer's coat is
geometrically nearer the thighs than the spine, and only a greedy torso keeps
the whole coat on the torso where it belongs.

`tip` may be omitted when a joint has exactly one child, in which case the
child's position is used. A joint that branches must state its own tip.

### Overrides

Some props defeat distance alone. The Necromancer's tome hangs nearer the coat
than the hand carrying it, so it gets split in half. An override box forces
every triangle whose centroid falls inside it onto one bone, after all other
assignment:

```json
"overrides": [
  { "bone": "armL_fore", "min": [0.19, -0.16, 0.04], "max": [0.56, 0.36, 0.52] }
]
```

## Shell snapping

Voxel meshes arrive as hundreds of disconnected shells — the Necromancer is 292
of them, because UV seams split every voxel cluster. Assigning purely per
triangle can tear a single cluster across two parts.

So shells of `--snap-max` triangles or fewer (default 32) are snapped whole to
whichever bone won the most of their triangles. Larger shells keep per-triangle
assignment, because a big shell usually spans a joint — the whole lower leg is
often one shell, and snapping it drags the shin into the foot.

`--no-snap` disables this entirely.

## Verifying a rig

`--debug-colors` writes a second GLB with each part flat-shaded in a distinct
color. Render it and check that every body part reads as one solid region with
clean joint boundaries. Expect to iterate the joint positions a few times; this
is by far the fastest way to see what the segmentation actually did.

`--list` prints per-bone triangle counts and warns about bones that got no
geometry at all, which usually means a joint is buried inside another part.

## Output

- One glTF node per bone, named after the joint, in the configured hierarchy.
- Geometry stored in joint-local space, with the node carrying the offset from
  its parent joint, so setting `node.rotation` spins the part about its joint.
- All parts share the source material — so it stays one material, though N parts
  do cost N draw calls.
- `POSITION`, `NORMAL`, `TEXCOORD_0`, and `COLOR_0` are all carried through.
  Vertex colours matter for voxelizer output, which bakes its colour into
  `COLOR_0` and has no texture at all — drop the attribute and the model comes
  out flat grey. `--debug-colors` deliberately strips `COLOR_0`, because glTF
  multiplies it into the base colour and it would tint the debug palette.
- **Uncompressed.** Meshopt and quantization both write dequantization
  transforms onto nodes, which would fight the animated bone transforms. Run the
  optimizer *before* rigging, not after.

## Animating the result

`zombie-motorworks/src/tools/necromancerPose.ts` has pure `walkPose(t)` and
`castPose(progress)` functions returning per-bone Euler angles. The preview page
at `zombie-motorworks/necromancer.html` loads the rigged GLB and drives it:

```sh
cd ../zombie-motorworks && npm run dev   # then open /necromancer.html
```

The page has buttons for both rigs and both clips, a speed slider, and a
"color parts" toggle that swaps in flat per-part colours so you can inspect the
segmentation live. State can be deep-linked: `?model=voxel&clip=cast&speed=0.5`.

Like `portrait.html`, the preview is a dev-server tool and is not part of the
production build.

Verified convention: the Necromancer faces +Z, so a **negative** rotation about
a bone's local X swings it forward and a positive one swings it back.

## Pipeline

Two rigs ship here, both with identical bone names so one set of pose curves
drives either. The preview page switches between them.

```sh
# Textured: optimize to a triangle budget, then split into rigid parts.
cd glb-optimizer
node optimize.mjs raw.glb -o necromancer.6k.glb --budget 6000
cd ../glb-rigger
node rig.mjs ../path/necromancer.6k.glb -c necromancer.rig.json \
  -o ../zombie-motorworks/public/assets/zombies/necromancer.rigged.glb

# Voxelized: rig the voxelizer output directly, keeping its vertex colours.
node rig.mjs ../path/necromancer.voxel7.glb -c necromancer-voxel.rig.json \
  -o ../zombie-motorworks/public/assets/zombies/necromancer-voxel.rigged.glb
```

The two source models are *not* interchangeable, which is why there are two
configs. The depth-7 voxelizer output is 1.90 tall rather than 2.00, slightly
narrower, and has lost the tome and floating magic to the voxel grid and
`--keep-largest`. Reusing the textured joint positions on it would misplace
every limb.

The voxel rig is 31k triangles and ~4.8 MB uncompressed, against 6k and 859 KB
for the textured one. If that matters, run the voxel model through
`glb-optimizer` first — its planar dissolve is near-lossless on voxel geometry
(31,264 to 6,608 triangles with no visible change) — and rig the result.

## Limitations

- Rigid parts do not deform, so joints show hard seams. Fine for voxel and
  hard-surface art; wrong for organic characters, which want real skinning.
- N parts means N draw calls. Good for a boss, expensive for a crowd.
- Input must be a single material. Run it through `glb-optimizer` first, which
  joins primitives.
- Animations and skins on the input are not carried over.
