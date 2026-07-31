"""Blender-side remesh stage for the GLB optimizer.

Run via `blender --background --factory-startup --python blender_remesh.py -- ...`.

The stage rebuilds mesh topology while keeping the material/UV setup intact so
the downstream glTF-Transform stage can still compress the original textures.
"""

from __future__ import annotations

import argparse
import math
import sys
from typing import List, Optional

import bpy


RESULT_PREFIX = "REMESH_RESULT"


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    """Parse the arguments Blender forwards after the `--` separator."""
    if argv is None:
        argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

    parser = argparse.ArgumentParser(prog="blender_remesh.py")
    parser.add_argument("input", metavar="INPUT.glb")
    parser.add_argument("output", metavar="OUTPUT.glb")
    parser.add_argument(
        "--mode",
        choices=("auto", "planar", "collapse", "voxel", "none"),
        default="auto",
        help="Remesh strategy (default: auto = planar, then collapse if over budget).",
    )
    parser.add_argument(
        "--budget",
        type=int,
        default=0,
        help="Target triangle count. 0 disables the collapse pass.",
    )
    parser.add_argument(
        "--planar-angle",
        type=float,
        default=1.0,
        help="Planar dissolve angle limit in degrees (default: 1.0).",
    )
    parser.add_argument(
        "--weld-distance",
        type=float,
        default=0.0001,
        help="Merge-by-distance threshold in scene units (default: 0.0001). 0 disables.",
    )
    parser.add_argument(
        "--voxel-size",
        type=float,
        default=0.02,
        help="Voxel remesh size, only used by --mode voxel (default: 0.02).",
    )
    parser.add_argument(
        "--keep-uvs",
        dest="keep_uvs",
        action="store_true",
        default=True,
        help="Delimit planar dissolve by UV/seam/material so texturing survives (default).",
    )
    parser.add_argument(
        "--no-keep-uvs",
        dest="keep_uvs",
        action="store_false",
        help="Allow dissolve across UV borders. Smaller mesh, distorted textures.",
    )
    return parser.parse_args(argv)


def mesh_objects() -> List[bpy.types.Object]:
    return [obj for obj in bpy.data.objects if obj.type == "MESH"]


def triangle_count() -> int:
    """Triangle count across every mesh object, matching what glTF will export."""
    total = 0
    for obj in mesh_objects():
        for polygon in obj.data.polygons:
            total += max(len(polygon.vertices) - 2, 0)
    return total


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def select_only(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_modifier(obj: bpy.types.Object, modifier: bpy.types.Modifier) -> None:
    select_only(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def weld_vertices(obj: bpy.types.Object, distance: float) -> None:
    """Merge coincident vertices. Meshy exports frequently duplicate them."""
    if distance <= 0:
        return
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=distance)
    bpy.ops.object.mode_set(mode="OBJECT")


def planar_dissolve(obj: bpy.types.Object, angle_degrees: float, keep_uvs: bool) -> None:
    """Merge coplanar faces into n-gons.

    Near-lossless on hard-surface and voxel-style meshes, where large flat areas
    are tessellated into many redundant triangles.
    """
    modifier = obj.modifiers.new(name="PlanarDecimate", type="DECIMATE")
    modifier.decimate_type = "DISSOLVE"
    modifier.angle_limit = math.radians(angle_degrees)
    # Delimiting by UV/seam/material keeps texture islands from being merged
    # across their borders, which would smear the base color map.
    modifier.delimit = {"UV", "SHARP", "MATERIAL", "SEAM"} if keep_uvs else {"MATERIAL"}
    apply_modifier(obj, modifier)


def collapse_to_ratio(obj: bpy.types.Object, ratio: float) -> None:
    """Quadric edge-collapse decimation. Preserves UVs by interpolating them."""
    if ratio >= 1.0:
        return
    modifier = obj.modifiers.new(name="CollapseDecimate", type="DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = max(ratio, 0.0)
    modifier.use_collapse_triangulate = True
    apply_modifier(obj, modifier)


def voxel_remesh(obj: bpy.types.Object, voxel_size: float) -> None:
    """Full retopology onto a uniform voxel grid. Discards UVs."""
    modifier = obj.modifiers.new(name="VoxelRemesh", type="REMESH")
    modifier.mode = "VOXEL"
    modifier.voxel_size = max(voxel_size, 0.0001)
    apply_modifier(obj, modifier)


def triangulate(obj: bpy.types.Object) -> None:
    """Convert n-gons back to triangles so the exported counts are predictable."""
    modifier = obj.modifiers.new(name="Triangulate", type="TRIANGULATE")
    modifier.min_vertices = 4
    apply_modifier(obj, modifier)


def import_glb(path: str) -> None:
    bpy.ops.import_scene.gltf(filepath=path)


def export_glb(path: str) -> None:
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=True,
        # Tangents are re-derivable at runtime from normals + UVs; shipping them
        # costs 16 bytes/vertex for no visual gain.
        export_tangents=False,
        export_apply=True,
        export_yup=True,
    )


def run(args: argparse.Namespace) -> int:
    reset_scene()
    import_glb(args.input)

    objects = mesh_objects()
    if not objects:
        print(f"{RESULT_PREFIX} error=no_mesh_found", file=sys.stderr)
        return 1

    before = triangle_count()

    if args.mode == "voxel":
        for obj in objects:
            weld_vertices(obj, args.weld_distance)
            voxel_remesh(obj, args.voxel_size)
    elif args.mode != "none":
        for obj in objects:
            weld_vertices(obj, args.weld_distance)
            planar_dissolve(obj, args.planar_angle, args.keep_uvs)
            triangulate(obj)

    # Collapse only once the cheap passes are done, so we spend the lossy budget
    # on geometry that planar dissolve could not remove.
    if args.budget > 0 and args.mode in ("auto", "collapse", "voxel"):
        current = triangle_count()
        if current > args.budget:
            ratio = args.budget / current
            for obj in mesh_objects():
                collapse_to_ratio(obj, ratio)

    after = triangle_count()
    export_glb(args.output)

    print(
        f"{RESULT_PREFIX} input={args.input} output={args.output} "
        f"mode={args.mode} tris_before={before} tris_after={after}"
    )
    return 0


def main() -> int:
    try:
        return run(parse_args())
    except Exception as error:  # noqa: BLE001 - surface the reason to the launcher
        print(f"{RESULT_PREFIX} error={type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
