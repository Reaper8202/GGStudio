"""Blender-side GLB block voxelizer with texture-to-vertex-color projection.

Run through voxelize.py; this file is executed inside Blender and requires bpy.
"""

from __future__ import annotations

import argparse
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


COLOR_ATTRIBUTE = "VoxelColor"

# Per-process caches. blender_voxelize.py runs once per Blender subprocess
# (one input file), so these never need invalidating within a run.
_principled_node_cache: dict[int, Optional[Any]] = {}
_image_pixel_cache: dict[int, "np.ndarray"] = {}


def parse_args() -> argparse.Namespace:
    try:
        separator = sys.argv.index("--")
    except ValueError as error:
        raise SystemExit("Expected Blender arguments after `--`.") from error

    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--depth", type=int, default=5)
    parser.add_argument("--color-samples", type=int, choices=(1, 5), default=5)
    parser.add_argument("--keep-largest", action="store_true")
    parser.add_argument("--min-part", type=float, default=0.05)
    parser.add_argument("--per-face-color", action="store_true")
    args = parser.parse_args(sys.argv[separator + 1 :])
    if not 1 <= args.depth <= 10:
        parser.error("--depth must be between 1 and 10")
    if not 0.0 < args.min_part <= 1.0:
        parser.error("--min-part must be greater than 0 and at most 1")
    return args


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials):
        # Imported GLB data is reconstructed below, so orphan data is safe to clear.
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def import_glb(path: Path) -> list[Any]:
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh objects found in {path}")
    return meshes


def join_meshes(meshes: list[Any]) -> Any:
    """Join all imported meshes into one world-space static mesh."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    result = bpy.context.view_layer.objects.active
    result.name = "Voxelized"

    # Make remesh resolution consistent across differently transformed source parts.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return result


@dataclass
class SurfaceSampler:
    mesh: Any
    bvh: BVHTree
    triangles: list[Any]
    materials: list[Any]

    @classmethod
    def from_object(cls, source: Any) -> "SurfaceSampler":
        mesh = source.data
        mesh.calc_loop_triangles()
        triangles = list(mesh.loop_triangles)
        vertices = [vertex.co.copy() for vertex in mesh.vertices]
        polygons = [tuple(triangle.vertices) for triangle in triangles]
        bvh = BVHTree.FromPolygons(vertices, polygons, all_triangles=True)
        return cls(mesh, bvh, triangles, list(source.data.materials))

    def color_at(self, point: Vector) -> tuple[float, float, float, float]:
        nearest = self.bvh.find_nearest(point)
        if not nearest or nearest[2] is None:
            return (0.8, 0.8, 0.8, 1.0)

        location, _normal, triangle_index, _distance = nearest
        triangle = self.triangles[triangle_index]
        coordinates = [
            self.mesh.vertices[vertex_index].co for vertex_index in triangle.vertices
        ]
        barycentric = barycentric_weights(location, *coordinates)
        polygon = self.mesh.polygons[triangle.polygon_index]
        material = (
            self.materials[polygon.material_index]
            if polygon.material_index < len(self.materials)
            else None
        )
        uv = self.uv_at(triangle, barycentric)
        corner_colors = self.source_color_at(triangle, barycentric)
        return material_color(material, uv, corner_colors)

    def uv_at(
        self, triangle: Any, weights: tuple[float, float, float]
    ) -> Optional[Vector]:
        uv_layer = self.mesh.uv_layers.active
        if uv_layer is None:
            return None
        uvs = [uv_layer.data[loop_index].uv for loop_index in triangle.loops]
        return sum_vectors(uvs, weights)

    def source_color_at(
        self, triangle: Any, weights: tuple[float, float, float]
    ) -> Optional[tuple[float, float, float, float]]:
        attributes = getattr(self.mesh, "color_attributes", None)
        if not attributes or not attributes.active_color:
            return None
        attribute = attributes.active_color
        if attribute.domain == "CORNER":
            colors = [attribute.data[index].color for index in triangle.loops]
        elif attribute.domain == "POINT":
            colors = [attribute.data[index].color for index in triangle.vertices]
        else:
            return None
        color = [sum(colors[i][channel] * weights[i] for i in range(3)) for channel in range(4)]
        return tuple(color)


def barycentric_weights(
    point: Vector, a: Vector, b: Vector, c: Vector
) -> tuple[float, float, float]:
    v0 = b - a
    v1 = c - a
    v2 = point - a
    d00 = v0.dot(v0)
    d01 = v0.dot(v1)
    d11 = v1.dot(v1)
    d20 = v2.dot(v0)
    d21 = v2.dot(v1)
    denominator = d00 * d11 - d01 * d01
    if abs(denominator) < 1e-12:
        return (1.0, 0.0, 0.0)
    v = (d11 * d20 - d01 * d21) / denominator
    w = (d00 * d21 - d01 * d20) / denominator
    u = 1.0 - v - w
    return (u, v, w)


def sum_vectors(values: list[Any], weights: tuple[float, float, float]) -> Vector:
    result = Vector((0.0, 0.0))
    for value, weight in zip(values, weights):
        result += value * weight
    return result


def clamp_color(value: Any) -> tuple[float, float, float, float]:
    components = list(value) if hasattr(value, "__len__") else [float(value)]
    if len(components) == 1:
        components = components * 3 + [1.0]
    elif len(components) == 3:
        components.append(1.0)
    return tuple(max(0.0, min(1.0, float(component))) for component in components[:4])


def get_principled_node(material: Any) -> Optional[Any]:
    """Resolve (and cache) the Principled BSDF driving a material's output.

    The node-tree search below is O(nodes) and identical every time it is
    called for the same material, but color sampling calls this once per
    voxel-face sample point (potentially hundreds of thousands of times for
    a dense remesh). Caching per material turns that into a one-time cost.
    """
    key = material.as_pointer()
    if key in _principled_node_cache:
        return _principled_node_cache[key]

    output = next(
        (
            node
            for node in material.node_tree.nodes
            if node.type == "OUTPUT_MATERIAL" and node.is_active_output
        ),
        None,
    )
    principled = find_upstream_principled(output)
    if principled is None:
        principled = next(
            (node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
            None,
        )
    _principled_node_cache[key] = principled
    return principled


def alpha_mode_of(material: Any) -> str:
    """Approximate the material's glTF alphaMode (OPAQUE/CLIP/BLEND).

    Blender's glTF importer encodes alphaMode as blend_method (pre-4.2:
    OPAQUE/CLIP/HASHED/BLEND) or surface_render_method (4.2+: DITHERED for
    cutout/hashed looks, BLENDED for true blending). Either way, textures
    frequently carry data unrelated to transparency in their alpha channel
    (packed masks, AO, etc.) that only actually means "see-through" when the
    material was authored as CLIP or BLEND; OPAQUE materials must ignore it
    per the glTF spec.
    """
    blend_method = getattr(material, "blend_method", None)
    if blend_method is not None:
        return blend_method
    render_method = getattr(material, "surface_render_method", None)
    if render_method == "BLENDED":
        return "BLEND"
    if render_method == "DITHERED":
        return "CLIP"
    return "OPAQUE"


def material_color(
    material: Any,
    uv: Optional[Vector],
    source_vertex_color: Optional[tuple[float, float, float, float]],
) -> tuple[float, float, float, float]:
    if material is None:
        return source_vertex_color or (0.8, 0.8, 0.8, 1.0)
    fallback = clamp_color(material.diffuse_color)
    if not material.use_nodes or not material.node_tree:
        return fallback

    principled = get_principled_node(material)
    if principled is None:
        return fallback

    # Shared per-sample cache so Base Color and Alpha, which frequently read
    # the same upstream image texture node, only sample that texture once.
    node_cache: dict[int, tuple[float, float, float, float]] = {}

    base_socket = principled.inputs.get("Base Color")
    color = (
        evaluate_socket(base_socket, uv, source_vertex_color, set(), node_cache)
        if base_socket
        else fallback
    )

    alpha_mode = alpha_mode_of(material)
    alpha_socket = principled.inputs.get("Alpha")
    if alpha_mode == "OPAQUE" or not alpha_socket:
        alpha_value = 1.0
    else:
        alpha = evaluate_socket(alpha_socket, uv, source_vertex_color, set(), node_cache)
        alpha_value = alpha[0]
        if alpha_mode != "BLEND":
            # CLIP and HASHED are cutout modes, not translucency: every
            # pixel is either fully opaque or fully invisible (HASHED just
            # dithers which is which). A soft averaged alpha here would
            # render voxel blocks as ghostly/see-through instead of the
            # solid faces a Blocks remesh actually produced.
            threshold = getattr(material, "alpha_threshold", 0.5)
            alpha_value = 1.0 if alpha_value >= threshold else 0.0

    color = (color[0], color[1], color[2], alpha_value)
    return clamp_color(color)


def find_upstream_principled(output: Any) -> Optional[Any]:
    if output is None:
        return None
    stack = [link.from_node for link in output.inputs["Surface"].links]
    visited: set[int] = set()
    while stack:
        node = stack.pop()
        if id(node) in visited:
            continue
        visited.add(id(node))
        if node.type == "BSDF_PRINCIPLED":
            return node
        for socket in node.inputs:
            stack.extend(link.from_node for link in socket.links)
    return None


def socket_default(socket: Any) -> tuple[float, float, float, float]:
    value = getattr(socket, "default_value", 0.0)
    return clamp_color(value)


def evaluate_socket(
    socket: Any,
    uv: Optional[Vector],
    source_vertex_color: Optional[tuple[float, float, float, float]],
    visited: set[int],
    cache: dict[int, tuple[float, float, float, float]],
) -> tuple[float, float, float, float]:
    if socket is None or not socket.is_linked:
        return socket_default(socket) if socket is not None else (0.0, 0.0, 0.0, 1.0)
    link = socket.links[0]
    node = link.from_node
    output_name = link.from_socket.name
    if id(node) in visited:
        return socket_default(socket)
    next_visited = visited | {id(node)}

    if node.type == "TEX_IMAGE":
        node_key = id(node)
        sampled = cache.get(node_key)
        if sampled is None:
            sampled = sample_image(node, uv)
            cache[node_key] = sampled
        if output_name == "Alpha":
            return (sampled[3], sampled[3], sampled[3], 1.0)
        return sampled
    if node.type in {"VERTEX_COLOR", "ATTRIBUTE"}:
        sampled = source_vertex_color or (1.0, 1.0, 1.0, 1.0)
        if output_name in {"Alpha", "Fac"}:
            return (sampled[3], sampled[3], sampled[3], 1.0)
        return sampled
    if node.type == "RGB":
        return socket_default(node.outputs.get("Color"))
    if node.type == "VALUE":
        return socket_default(node.outputs.get("Value"))
    if node.type == "MIX_RGB":
        factor = evaluate_socket(node.inputs[0], uv, source_vertex_color, next_visited, cache)[0]
        first = evaluate_socket(node.inputs[1], uv, source_vertex_color, next_visited, cache)
        second = evaluate_socket(node.inputs[2], uv, source_vertex_color, next_visited, cache)
        return mix_colors(first, second, factor, node.blend_type)
    if node.type == "MIX":
        rgba_inputs = [input_socket for input_socket in node.inputs if input_socket.type == "RGBA"]
        factor_inputs = [input_socket for input_socket in node.inputs if input_socket.name.startswith("Factor")]
        if len(rgba_inputs) >= 2:
            factor = evaluate_socket(
                factor_inputs[-1] if factor_inputs else None,
                uv,
                source_vertex_color,
                next_visited,
                cache,
            )[0]
            first = evaluate_socket(rgba_inputs[-2], uv, source_vertex_color, next_visited, cache)
            second = evaluate_socket(rgba_inputs[-1], uv, source_vertex_color, next_visited, cache)
            return mix_colors(first, second, factor, getattr(node, "blend_type", "MIX"))
    if node.type == "MATH":
        value_inputs = [input_socket for input_socket in node.inputs if input_socket.type == "VALUE"]
        values = [
            evaluate_socket(input_socket, uv, source_vertex_color, next_visited, cache)[0]
            for input_socket in value_inputs
        ]
        first = values[0] if values else 0.0
        second = values[1] if len(values) > 1 else 0.0
        operation = node.operation
        if operation == "MULTIPLY":
            result = first * second
        elif operation == "ADD":
            result = first + second
        elif operation == "SUBTRACT":
            result = first - second
        elif operation == "DIVIDE":
            result = first / second if abs(second) > 1e-12 else 0.0
        elif operation == "MINIMUM":
            result = min(first, second)
        elif operation == "MAXIMUM":
            result = max(first, second)
        elif operation == "POWER":
            result = math.pow(max(0.0, first), second)
        else:
            result = first
        result = max(0.0, min(1.0, result)) if node.use_clamp else result
        return (result, result, result, 1.0)
    if node.type == "GAMMA":
        color = evaluate_socket(node.inputs.get("Color"), uv, source_vertex_color, next_visited, cache)
        gamma = evaluate_socket(node.inputs.get("Gamma"), uv, source_vertex_color, next_visited, cache)[0]
        return tuple(math.pow(max(0.0, component), gamma) for component in color[:3]) + (color[3],)
    if node.type == "BRIGHTCONTRAST":
        return evaluate_socket(node.inputs.get("Color"), uv, source_vertex_color, next_visited, cache)

    # For pass-through/group nodes, favor the first linked color input.
    for input_socket in node.inputs:
        if input_socket.is_linked and input_socket.type in {"RGBA", "VALUE"}:
            return evaluate_socket(input_socket, uv, source_vertex_color, next_visited, cache)
    return socket_default(socket)


def mix_colors(
    first: tuple[float, float, float, float],
    second: tuple[float, float, float, float],
    factor: float,
    blend_type: str,
) -> tuple[float, float, float, float]:
    factor = max(0.0, min(1.0, factor))
    if blend_type == "MULTIPLY":
        rgb = [
            first[index] * ((1.0 - factor) + factor * second[index]) for index in range(3)
        ]
    elif blend_type == "ADD":
        rgb = [first[index] + factor * second[index] for index in range(3)]
    elif blend_type == "SUBTRACT":
        rgb = [first[index] - factor * second[index] for index in range(3)]
    else:
        rgb = [
            first[index] * (1.0 - factor) + second[index] * factor for index in range(3)
        ]
    alpha = first[3] * (1.0 - factor) + second[3] * factor
    return clamp_color((*rgb, alpha))


def get_image_pixels(image: Any) -> "np.ndarray":
    """Return the image's pixels as a cached (height, width, channels) array.

    Indexing Blender's `image.pixels` one element at a time (the previous
    approach) pays a full RNA property-access round trip per float; for a
    4K texture sampled thousands of times across voxel faces that dominates
    runtime. `foreach_get` bulk-copies the buffer once into numpy, after
    which every sample is a plain array lookup.
    """
    key = image.as_pointer()
    cached = _image_pixel_cache.get(key)
    if cached is not None:
        return cached
    try:
        image.pixels[0]
    except (RuntimeError, IndexError):
        image.reload()
    width, height = image.size[:]
    channels = image.channels
    flat = np.empty(width * height * channels, dtype=np.float32)
    image.pixels.foreach_get(flat)
    pixels = flat.reshape((height, width, channels))
    _image_pixel_cache[key] = pixels
    return pixels


def sample_image(
    node: Any, uv: Optional[Vector]
) -> tuple[float, float, float, float]:
    image = node.image
    if image is None or uv is None or image.size[0] == 0 or image.size[1] == 0:
        return (1.0, 1.0, 1.0, 1.0)
    pixels = get_image_pixels(image)

    u, v = float(uv.x), float(uv.y)
    extension = getattr(node, "extension", "REPEAT")
    if extension == "REPEAT":
        u %= 1.0
        v %= 1.0
    elif extension == "CLIP" and not (0.0 <= u <= 1.0 and 0.0 <= v <= 1.0):
        return (0.0, 0.0, 0.0, 0.0)
    else:
        u = max(0.0, min(1.0, u))
        v = max(0.0, min(1.0, v))

    width, height = image.size[:]
    if getattr(node, "interpolation", "Linear") == "Closest":
        return image_pixel(pixels, round(u * (width - 1)), round(v * (height - 1)))

    x = u * (width - 1)
    y = v * (height - 1)
    x0, y0 = math.floor(x), math.floor(y)
    x1, y1 = min(x0 + 1, width - 1), min(y0 + 1, height - 1)
    tx, ty = x - x0, y - y0
    bottom = lerp_color(image_pixel(pixels, x0, y0), image_pixel(pixels, x1, y0), tx)
    top = lerp_color(image_pixel(pixels, x0, y1), image_pixel(pixels, x1, y1), tx)
    return lerp_color(bottom, top, ty)


def image_pixel(pixels: "np.ndarray", x: int, y: int) -> tuple[float, float, float, float]:
    channels = pixels.shape[2]
    values = pixels[y, x]
    if channels == 1:
        value = float(values[0])
        return (value, value, value, 1.0)
    if channels == 2:
        value = float(values[0])
        return (value, value, value, float(values[1]))
    if channels == 3:
        return (float(values[0]), float(values[1]), float(values[2]), 1.0)
    return (float(values[0]), float(values[1]), float(values[2]), float(values[3]))


def lerp_color(first: Any, second: Any, factor: float) -> tuple[float, float, float, float]:
    return tuple(first[index] * (1.0 - factor) + second[index] * factor for index in range(4))


def apply_blocks_remesh(
    obj: Any, depth: int, keep_largest: bool, min_part: float = 0.05
) -> None:
    modifier = obj.modifiers.new(name="Voxelize Blocks", type="REMESH")
    modifier.mode = "BLOCKS"
    modifier.octree_depth = depth
    modifier.use_remove_disconnected = keep_largest
    if hasattr(modifier, "threshold"):
        # Blender reads `threshold` as "keep components at least this large,
        # as a ratio of the largest one". At 1.0 it keeps ONLY the largest,
        # which silently amputates any body part the voxel grid left
        # disconnected -- a zombie with a severed midsection loses both legs.
        # Default to a small ratio so this removes specks, as documented.
        modifier.threshold = min_part
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    result = bpy.ops.object.modifier_apply(modifier=modifier.name)
    if "FINISHED" not in result:
        raise RuntimeError("Blender could not apply the Blocks Remesh modifier.")
    if not obj.data.polygons:
        raise RuntimeError(
            "Remesh produced no faces. Try a larger --depth or repair the source mesh."
        )
    for polygon in obj.data.polygons:
        polygon.use_smooth = False


def face_sample_points(mesh: Any, polygon: Any, count: int) -> list[Vector]:
    center = polygon.center.copy()
    if count == 1:
        return [center]
    vertices = [mesh.vertices[index].co for index in polygon.vertices]
    # Pull corner samples inward so neighboring faces do not dominate boundary colors.
    return [center] + [center.lerp(vertex, 0.72) for vertex in vertices[:4]]


def voxel_size_of(mesh: Any) -> float:
    """Edge length of one cube face. Blocks remesh emits uniform axis-aligned
    squares, so any face edge is the grid pitch."""
    for polygon in mesh.polygons:
        vertices = [mesh.vertices[index].co for index in polygon.vertices]
        if len(vertices) < 2:
            continue
        length = (vertices[1] - vertices[0]).length
        if length > 1e-9:
            return length
    raise RuntimeError("Could not measure the voxel grid pitch from the remeshed mesh.")


def group_faces_by_voxel(mesh: Any, size: float) -> dict[tuple[int, int, int], list[int]]:
    """Map each cube to the faces that bound it.

    A face's owning cube centre sits half a voxel behind the face along its
    inward normal; quantizing that centre onto the grid gives every face of the
    same cube an identical key.
    """
    centers = []
    for polygon in mesh.polygons:
        centers.append(polygon.center - polygon.normal * (size * 0.5))

    if not centers:
        return {}

    # Quantize relative to a corner of the lattice so keys are stable
    # non-negative integers and never land on a .5 rounding boundary.
    origin = Vector(
        (
            min(center.x for center in centers),
            min(center.y for center in centers),
            min(center.z for center in centers),
        )
    )

    groups: dict[tuple[int, int, int], list[int]] = {}
    for index, center in enumerate(centers):
        key = (
            int(math.floor((center.x - origin.x) / size + 0.5)),
            int(math.floor((center.y - origin.y) / size + 0.5)),
            int(math.floor((center.z - origin.z) / size + 0.5)),
        )
        groups.setdefault(key, []).append(index)
    return groups


def dominant_color(
    samples: list[tuple[float, float, float, float]],
) -> tuple[float, float, float, float]:
    """Pick the most representative colour of a voxel rather than the mean.

    Averaging is what washes voxel art out: a cube straddling a skin/blood
    boundary averages to pink mud. Bucketing the samples and taking the modal
    bucket keeps the source palette crisp, which is the whole point of the
    pixel-art look. Ties go to the more saturated bucket so detail colours
    survive against large flat regions.
    """
    if not samples:
        return (1.0, 1.0, 1.0, 1.0)

    levels = 12
    buckets: dict[tuple[int, int, int], list[tuple[float, float, float, float]]] = {}
    for sample in samples:
        key = tuple(min(levels - 1, int(sample[channel] * levels)) for channel in range(3))
        buckets.setdefault(key, []).append(sample)  # type: ignore[arg-type]

    def score(entry: tuple[Any, list[tuple[float, float, float, float]]]) -> tuple[int, float]:
        members = entry[1]
        mean = [sum(m[c] for m in members) / len(members) for c in range(3)]
        saturation = max(mean) - min(mean)
        return (len(members), saturation)

    winner = max(buckets.items(), key=score)[1]
    return tuple(  # type: ignore[return-value]
        sum(member[channel] for member in winner) / len(winner) for channel in range(4)
    )


def paint_voxel_faces(
    obj: Any,
    sampler: SurfaceSampler,
    samples_per_face: int,
    per_face: bool = False,
) -> None:
    mesh = obj.data
    attribute = mesh.color_attributes.get(COLOR_ATTRIBUTE)
    if attribute is None:
        attribute = mesh.color_attributes.new(
            name=COLOR_ATTRIBUTE, type="BYTE_COLOR", domain="CORNER"
        )

    # Sample every face once; grouping below decides how widely each result is
    # shared. Sampling is the expensive part, so it never runs twice.
    face_samples = [
        [
            sampler.color_at(point)
            for point in face_sample_points(mesh, polygon, samples_per_face)
        ]
        for polygon in mesh.polygons
    ]

    if per_face:
        # Legacy look: each of a cube's six faces keeps its own colour, so a
        # voxel can be lit differently per side.
        groups = {index: [index] for index in range(len(mesh.polygons))}.values()
    else:
        groups = group_faces_by_voxel(mesh, voxel_size_of(mesh)).values()

    transparent = False
    for face_indices in groups:
        pooled = [sample for index in face_indices for sample in face_samples[index]]
        color = dominant_color(pooled)
        transparent = transparent or color[3] < 0.999
        for index in face_indices:
            for loop_index in mesh.polygons[index].loop_indices:
                attribute.data[loop_index].color = color

    material = bpy.data.materials.new("Voxel Material")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    vertex_color = nodes.new("ShaderNodeVertexColor")
    vertex_color.layer_name = COLOR_ATTRIBUTE
    links.new(vertex_color.outputs["Color"], shader.inputs["Base Color"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    shader.inputs["Roughness"].default_value = 1.0
    specular = shader.inputs.get("Specular IOR Level") or shader.inputs.get("Specular")
    if specular:
        specular.default_value = 0.0

    if transparent:
        # Only wire Alpha (and mark the material non-opaque) when some face
        # genuinely sampled translucent source geometry. Linking this
        # unconditionally makes Blender's glTF exporter always write
        # alphaMode=BLEND, even when every alpha value is 1.0 -- most
        # realtime glTF viewers skip depth-writes for BLEND materials, so a
        # dense, self-occluding voxel mesh renders its many overlapping
        # faces in draw order instead of depth order, which looks like
        # random blocks turning transparent even though nothing is.
        links.new(vertex_color.outputs["Alpha"], shader.inputs["Alpha"])
        if hasattr(material, "surface_render_method"):
            material.surface_render_method = "DITHERED"
        elif hasattr(material, "blend_method"):
            material.blend_method = "BLEND"

    mesh.materials.clear()
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.material_index = 0


def export_glb(obj: Any, output_path: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
    )


def main() -> None:
    args = parse_args()
    input_path = args.input.resolve()
    output_path = args.output.resolve()
    if not input_path.is_file():
        raise FileNotFoundError(input_path)

    clear_scene()
    meshes = import_glb(input_path)
    voxel = join_meshes(meshes)

    source = voxel.copy()
    source.data = voxel.data.copy()
    bpy.context.collection.objects.link(source)
    source.name = "Color Source"
    sampler = SurfaceSampler.from_object(source)

    apply_blocks_remesh(voxel, args.depth, args.keep_largest, args.min_part)
    paint_voxel_faces(voxel, sampler, args.color_samples, args.per_face_color)
    export_glb(voxel, output_path)

    print(
        f"VOXELIZER_RESULT input={input_path} output={output_path} "
        f"depth={args.depth} faces={len(voxel.data.polygons)} "
        f"color={'face' if args.per_face_color else 'voxel'}"
    )


if __name__ == "__main__":
    main()
