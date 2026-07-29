#!/usr/bin/env node
/**
 * Splits a static GLB into rigid body-part chunks parented into an animatable
 * node hierarchy — the "rigid chunks" approach to animating voxel characters.
 *
 * No skinning is involved: each triangle belongs wholly to one bone, and each
 * bone becomes a glTF node whose geometry is stored in joint-local space. That
 * means a part rotates about its joint from wherever it already sits, so the
 * source model does not need to be in a T-pose or A-pose.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, prune } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

/**
 * Connected shells at or below this many triangles are snapped whole to one
 * bone. Voxel clusters sit well under it; shells that span a joint sit above.
 */
const DEFAULT_SNAP_MAX = 32;

/** Buffer-compression extensions that must not survive into the rigged file. */
const COMPRESSION_EXTENSIONS = new Set([
  'EXT_meshopt_compression',
  'KHR_mesh_quantization',
  'KHR_draco_mesh_compression',
]);

/** Distinct hues for --debug-colors, in config order. */
const DEBUG_PALETTE = [
  [0.90, 0.20, 0.20], [0.95, 0.55, 0.15], [0.95, 0.90, 0.20],
  [0.40, 0.85, 0.25], [0.15, 0.65, 0.35], [0.20, 0.85, 0.80],
  [0.20, 0.55, 0.95], [0.25, 0.25, 0.85], [0.55, 0.30, 0.90],
  [0.90, 0.35, 0.85], [0.95, 0.55, 0.65], [0.55, 0.35, 0.20],
  [0.75, 0.75, 0.80],
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  return `Usage: rig.mjs INPUT.glb --config RIG.json [options]

  -c, --config PATH      Rig definition JSON (required).
  -o, --output PATH      Output GLB (default: <input>.rigged.glb).
      --debug-colors PATH  Also write a flat per-part colored GLB for verification.
      --no-snap           Assign triangles individually instead of snapping small
                          connected shells to one bone.
      --snap-max N        Largest shell (in triangles) that gets snapped whole
                          (default: ${DEFAULT_SNAP_MAX}).
      --list              Print per-bone triangle counts.
      --dry-run           Report the plan without writing anything.
  -h, --help             Show this help.
`;
}

export function parseArgs(argv) {
  const options = {
    input: null,
    config: null,
    output: null,
    debugColors: null,
    snap: true,
    snapMaxTriangles: DEFAULT_SNAP_MAX,
    list: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case '-h':
      case '--help':
        return { help: true };
      case '-c':
      case '--config':
        options.config = next();
        break;
      case '-o':
      case '--output':
        options.output = next();
        break;
      case '--debug-colors':
        options.debugColors = next();
        break;
      case '--no-snap':
        options.snap = false;
        break;
      case '--snap-max': {
        const value = Number(next());
        if (!Number.isFinite(value) || value < 0) {
          throw new Error('--snap-max expects a non-negative number');
        }
        options.snapMaxTriangles = value;
        break;
      }
      case '--list':
        options.list = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        if (options.input) throw new Error('Only one input GLB is supported.');
        options.input = arg;
    }
  }

  if (!options.input) throw new Error('An input GLB is required.');
  if (!options.config) throw new Error('--config is required.');
  if (!options.output) {
    const dir = path.dirname(options.input);
    const stem = path.basename(options.input, path.extname(options.input));
    options.output = path.join(dir, `${stem}.rigged.glb`);
  }
  return options;
}

// ---------------------------------------------------------------------------
// Rig definition
// ---------------------------------------------------------------------------

export function loadRig(config) {
  if (!Array.isArray(config.joints) || !config.joints.length) {
    throw new Error('Rig config must contain a non-empty "joints" array.');
  }

  const byName = new Map();
  for (const joint of config.joints) {
    if (!joint.name) throw new Error('Every joint needs a "name".');
    if (byName.has(joint.name)) throw new Error(`Duplicate joint: ${joint.name}`);
    if (!Array.isArray(joint.pos) || joint.pos.length !== 3) {
      throw new Error(`Joint "${joint.name}" needs a 3-number "pos".`);
    }
    byName.set(joint.name, joint);
  }

  const roots = [];
  for (const joint of config.joints) {
    if (joint.parent == null) {
      roots.push(joint.name);
      continue;
    }
    if (!byName.has(joint.parent)) {
      throw new Error(`Joint "${joint.name}" has unknown parent "${joint.parent}".`);
    }
  }
  if (roots.length !== 1) {
    throw new Error(`Rig must have exactly one root joint, found ${roots.length}.`);
  }

  // Reject cycles up front; the node graph below assumes a tree.
  for (const joint of config.joints) {
    const seen = new Set([joint.name]);
    let cursor = joint.parent;
    while (cursor != null) {
      if (seen.has(cursor)) throw new Error(`Cycle in rig at "${joint.name}".`);
      seen.add(cursor);
      cursor = byName.get(cursor).parent;
    }
  }

  const bones = config.joints.map((joint, index) => {
    // A bone is the segment pos->tip. Without an explicit tip, fall back to the
    // only child's position; a joint that branches must state its own tip.
    let tip = joint.tip;
    if (!tip) {
      const children = config.joints.filter((other) => other.parent === joint.name);
      if (children.length !== 1) {
        throw new Error(
          `Joint "${joint.name}" has ${children.length} children, so it needs an explicit "tip".`,
        );
      }
      tip = children[0].pos;
    }
    return {
      index,
      name: joint.name,
      parent: joint.parent ?? null,
      pos: joint.pos.map(Number),
      tip: tip.map(Number),
      radius: Number(joint.radius ?? 1),
    };
  });

  const boneIndex = new Map(bones.map((bone) => [bone.name, bone.index]));
  const overrides = (config.overrides ?? []).map((override, i) => {
    if (!boneIndex.has(override.bone)) {
      throw new Error(`Override ${i} targets unknown bone "${override.bone}".`);
    }
    for (const key of ['min', 'max']) {
      if (!Array.isArray(override[key]) || override[key].length !== 3) {
        throw new Error(`Override ${i} needs a 3-number "${key}".`);
      }
    }
    return {
      bone: boneIndex.get(override.bone),
      min: override.min.map(Number),
      max: override.max.map(Number),
    };
  });

  return { bones, overrides, root: roots[0] };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Squared distance from point p to segment ab. */
export function distSqToSegment(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const lenSq = abx * abx + aby * aby + abz * abz;
  let t = lenSq > 0 ? (apx * abx + apy * aby + apz * abz) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Pick the bone whose segment is nearest the point. Distance is divided by the
 * bone's radius, so a greedier bone can claim mass that is geometrically closer
 * to a neighbour (the coat belongs to the torso, not the upper arms).
 */
export function nearestBone(point, bones) {
  let best = 0;
  let bestScore = Infinity;
  for (const bone of bones) {
    const score = Math.sqrt(distSqToSegment(point, bone.pos, bone.tip)) / bone.radius;
    if (score < bestScore) {
      bestScore = score;
      best = bone.index;
    }
  }
  return best;
}

/** Union-find over the index buffer, grouping vertices into welded shells. */
export function connectedComponents(indices, vertexCount) {
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < indices.length; i += 3) {
    union(indices[i], indices[i + 1]);
    union(indices[i + 1], indices[i + 2]);
  }
  const label = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) label[i] = find(i);
  return label;
}

/**
 * Assign every triangle to a bone.
 *
 * Small connected shells are snapped whole to whichever bone won the most of
 * their triangles, so an individual voxel cluster is never torn in half. Shells
 * larger than `snapMaxTriangles` keep per-triangle assignment: a big shell
 * typically spans a joint (the whole lower leg is often one shell), and snapping
 * it would drag the shin into the foot.
 */
export function assignTriangles(
  positions,
  indices,
  bones,
  { snap = true, snapMaxTriangles = DEFAULT_SNAP_MAX, overrides = [] } = {},
) {
  const triangleCount = indices.length / 3;
  const assignment = new Int32Array(triangleCount);
  const centroids = new Float32Array(triangleCount * 3);
  const centroid = [0, 0, 0];

  for (let t = 0; t < triangleCount; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    for (let k = 0; k < 3; k++) {
      centroid[k] = (positions[a * 3 + k] + positions[b * 3 + k] + positions[c * 3 + k]) / 3;
      centroids[t * 3 + k] = centroid[k];
    }
    assignment[t] = nearestBone(centroid, bones);
  }

  if (!snap) return applyOverrides(centroids, assignment, overrides);

  const label = connectedComponents(indices, positions.length / 3);
  const votes = new Map();
  const sizes = new Map();
  for (let t = 0; t < triangleCount; t++) {
    const key = label[indices[t * 3]];
    sizes.set(key, (sizes.get(key) ?? 0) + 1);
    let tally = votes.get(key);
    if (!tally) votes.set(key, (tally = new Map()));
    tally.set(assignment[t], (tally.get(assignment[t]) ?? 0) + 1);
  }
  const winner = new Map();
  for (const [key, tally] of votes) {
    if (sizes.get(key) > snapMaxTriangles) continue;
    let bestBone = 0, bestCount = -1;
    for (const [bone, count] of tally) {
      if (count > bestCount) { bestCount = count; bestBone = bone; }
    }
    winner.set(key, bestBone);
  }
  for (let t = 0; t < triangleCount; t++) {
    const forced = winner.get(label[indices[t * 3]]);
    if (forced !== undefined) assignment[t] = forced;
  }
  return applyOverrides(centroids, assignment, overrides);
}

/**
 * Force triangles whose centroid falls inside a box to a named bone. Runs last,
 * so it beats both nearest-bone and shell snapping. This is the escape hatch for
 * props that geometry alone cannot resolve — the tome hangs nearer the coat than
 * the hand holding it, so distance alone tears it in half.
 */
export function applyOverrides(centroids, assignment, overrides) {
  if (!overrides.length) return assignment;
  for (let t = 0; t < assignment.length; t++) {
    const x = centroids[t * 3], y = centroids[t * 3 + 1], z = centroids[t * 3 + 2];
    for (const { bone, min, max } of overrides) {
      if (
        x >= min[0] && x <= max[0] &&
        y >= min[1] && y <= max[1] &&
        z >= min[2] && z <= max[2]
      ) {
        assignment[t] = bone;
        break;
      }
    }
  }
  return assignment;
}

// ---------------------------------------------------------------------------
// Document I/O
// ---------------------------------------------------------------------------

async function createIO() {
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

/** Flatten every primitive in the document into one vertex/index pool. */
function mergeGeometry(document) {
  const primitives = [];
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) primitives.push(primitive);
  }
  if (!primitives.length) throw new Error('Input GLB contains no primitives.');

  const materials = new Set(primitives.map((p) => p.getMaterial()));
  if (materials.size > 1) {
    throw new Error(
      `Input has ${materials.size} materials; rig.mjs expects a single material. ` +
        'Run it through glb-optimizer (which joins primitives) first.',
    );
  }

  // Voxelizer output carries its colour in COLOR_0 rather than a texture, so it
  // has to survive segmentation or the rigged model comes out flat grey.
  const colorSizes = new Set(
    primitives.map((p) => p.getAttribute('COLOR_0')?.getType()).map((t) => (t === 'VEC4' ? 4 : t === 'VEC3' ? 3 : 0)),
  );
  const hasColors = !colorSizes.has(0);
  const colorSize = hasColors ? Math.max(...colorSizes) : 0;

  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  let base = 0;

  for (const primitive of primitives) {
    const pos = primitive.getAttribute('POSITION');
    const nrm = primitive.getAttribute('NORMAL');
    const uv = primitive.getAttribute('TEXCOORD_0');
    const col = primitive.getAttribute('COLOR_0');
    const idx = primitive.getIndices();
    const count = pos.getCount();

    for (let i = 0; i < count; i++) {
      const p = pos.getElement(i, [0, 0, 0]);
      positions.push(p[0], p[1], p[2]);
      const n = nrm ? nrm.getElement(i, [0, 0, 0]) : [0, 1, 0];
      normals.push(n[0], n[1], n[2]);
      const t = uv ? uv.getElement(i, [0, 0]) : [0, 0];
      uvs.push(t[0], t[1]);
      if (hasColors) {
        // getElement denormalises, so mixed ubyte/float sources land as floats.
        const c = col.getElement(i, [1, 1, 1, 1]);
        for (let k = 0; k < colorSize; k++) colors.push(c[k] ?? 1);
      }
    }
    if (idx) {
      for (let i = 0; i < idx.getCount(); i++) indices.push(base + idx.getScalar(i));
    } else {
      for (let i = 0; i < count; i++) indices.push(base + i);
    }
    base += count;
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    colorSize,
    indices: new Uint32Array(indices),
    material: primitives[0].getMaterial(),
    hasUVs: primitives.every((p) => p.getAttribute('TEXCOORD_0')),
    hasColors,
  };
}

/**
 * Rebuild the document as one node per bone. Geometry is translated into
 * joint-local space and the node carries the offset from its parent joint, so
 * setting node.rotation spins the part about its real joint.
 */
function buildHierarchy(document, geometry, bones, assignment, { debugColors }) {
  const root = document.getRoot();
  const buffer = root.listBuffers()[0] ?? document.createBuffer();
  const scene = root.listScenes()[0] ?? document.createScene();

  // Bucket triangles per bone.
  const buckets = bones.map(() => []);
  for (let t = 0; t < assignment.length; t++) buckets[assignment[t]].push(t);

  const boneByName = new Map(bones.map((bone) => [bone.name, bone]));
  const nodes = new Map();

  for (const bone of bones) {
    const node = document.createNode(bone.name);
    const parent = bone.parent ? boneByName.get(bone.parent) : null;
    node.setTranslation([
      bone.pos[0] - (parent ? parent.pos[0] : 0),
      bone.pos[1] - (parent ? parent.pos[1] : 0),
      bone.pos[2] - (parent ? parent.pos[2] : 0),
    ]);
    nodes.set(bone.name, node);

    const triangles = buckets[bone.index];
    if (!triangles.length) continue;

    // Remap only the vertices this bone actually uses.
    const remap = new Map();
    const pos = [], nrm = [], uv = [], col = [], idx = [];
    for (const t of triangles) {
      for (let k = 0; k < 3; k++) {
        const original = geometry.indices[t * 3 + k];
        let mapped = remap.get(original);
        if (mapped === undefined) {
          mapped = pos.length / 3;
          remap.set(original, mapped);
          pos.push(
            geometry.positions[original * 3] - bone.pos[0],
            geometry.positions[original * 3 + 1] - bone.pos[1],
            geometry.positions[original * 3 + 2] - bone.pos[2],
          );
          nrm.push(
            geometry.normals[original * 3],
            geometry.normals[original * 3 + 1],
            geometry.normals[original * 3 + 2],
          );
          uv.push(geometry.uvs[original * 2], geometry.uvs[original * 2 + 1]);
          for (let k = 0; k < geometry.colorSize; k++) {
            col.push(geometry.colors[original * geometry.colorSize + k]);
          }
        }
        idx.push(mapped);
      }
    }

    const primitive = document
      .createPrimitive()
      .setAttribute(
        'POSITION',
        document.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer),
      )
      .setAttribute(
        'NORMAL',
        document.createAccessor().setType('VEC3').setArray(new Float32Array(nrm)).setBuffer(buffer),
      )
      .setIndices(
        document.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer),
      );

    if (geometry.hasUVs && !debugColors) {
      primitive.setAttribute(
        'TEXCOORD_0',
        document.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer),
      );
    }

    // glTF multiplies COLOR_0 into the base colour, so leaving it on the debug
    // variant would tint the flat per-part palette and make it unreadable.
    if (geometry.hasColors && !debugColors) {
      primitive.setAttribute(
        'COLOR_0',
        document
          .createAccessor()
          .setType(geometry.colorSize === 4 ? 'VEC4' : 'VEC3')
          .setArray(new Float32Array(col))
          .setBuffer(buffer),
      );
    }

    if (debugColors) {
      const [r, g, b] = DEBUG_PALETTE[bone.index % DEBUG_PALETTE.length];
      primitive.setMaterial(
        document
          .createMaterial(`debug_${bone.name}`)
          .setBaseColorFactor([r, g, b, 1])
          .setMetallicFactor(0)
          .setRoughnessFactor(1),
      );
    } else {
      primitive.setMaterial(geometry.material);
    }

    node.setMesh(document.createMesh(bone.name).addPrimitive(primitive));
  }

  // Wire parents, then hang the single root off the scene.
  for (const bone of bones) {
    if (!bone.parent) continue;
    nodes.get(bone.parent).addChild(nodes.get(bone.name));
  }
  for (const node of scene.listChildren()) scene.removeChild(node);
  for (const bone of bones) {
    if (!bone.parent) scene.addChild(nodes.get(bone.name));
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function writeVariant(inputPath, outputPath, rig, options, debugColors) {
  const io = await createIO();
  const document = await io.read(inputPath);
  // The optimizer emits quantized + meshopt-compressed buffers; decode them so
  // positions are plain floats we can partition and re-emit uncompressed.
  await document.transform(dequantize());
  // Drop the compression extensions themselves. Left attached, the writer tries
  // to re-encode with an encoder we never registered, and their dequantization
  // transforms would land on the very nodes we animate.
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (COMPRESSION_EXTENSIONS.has(extension.extensionName)) extension.dispose();
  }

  const geometry = mergeGeometry(document);
  const assignment = assignTriangles(geometry.positions, geometry.indices, rig.bones, {
    snap: options.snap,
    snapMaxTriangles: options.snapMaxTriangles,
    overrides: rig.overrides,
  });

  const oldMeshes = document.getRoot().listMeshes();
  const oldNodes = document.getRoot().listNodes();
  const buckets = buildHierarchy(document, geometry, rig.bones, assignment, { debugColors });
  for (const mesh of oldMeshes) mesh.dispose();
  for (const node of oldNodes) node.dispose();
  if (debugColors) {
    // The debug variant paints flat per-part colors, so the source material and
    // its textures are dead weight; prune sweeps them once nothing references them.
    geometry.material?.dispose();
    await document.transform(prune());
  }

  // Meshopt/quantize would write dequantization transforms onto these nodes,
  // fighting the animated bone transforms — so the rigged file stays plain.
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await io.write(outputPath, document);
  return buckets;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${usage()}`);
    return 1;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const inputPath = path.resolve(options.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input does not exist: ${inputPath}`);
    return 1;
  }

  let rig;
  try {
    rig = loadRig(JSON.parse(fs.readFileSync(path.resolve(options.config), 'utf8')));
  } catch (error) {
    console.error(`Bad rig config: ${error.message}`);
    return 1;
  }

  const outputPath = path.resolve(options.output);
  if (outputPath === inputPath) {
    console.error('Output must differ from input to avoid overwriting the source.');
    return 1;
  }

  if (options.dryRun) {
    console.log(`${inputPath} -> ${outputPath}`);
    console.log(`bones=${rig.bones.length} root=${rig.root} snap=${options.snap}`);
    return 0;
  }

  console.log(`${path.basename(inputPath)} -> ${outputPath}`);
  const buckets = await writeVariant(inputPath, outputPath, rig, options, false);

  const total = buckets.reduce((sum, bucket) => sum + bucket.length, 0);
  console.log(`  ${rig.bones.length} parts, ${total.toLocaleString('en-US')} triangles`);
  if (options.list) {
    const width = Math.max(...rig.bones.map((bone) => bone.name.length));
    for (const bone of rig.bones) {
      const count = buckets[bone.index].length;
      const share = total ? ((count / total) * 100).toFixed(1) : '0.0';
      const flag = count === 0 ? '  <-- EMPTY' : '';
      console.log(`  ${bone.name.padEnd(width)}  ${String(count).padStart(6)}  ${share.padStart(5)}%${flag}`);
    }
  }

  const empty = rig.bones.filter((bone) => buckets[bone.index].length === 0);
  if (empty.length) {
    console.warn(`  ! ${empty.length} bone(s) got no geometry: ${empty.map((b) => b.name).join(', ')}`);
  }

  if (options.debugColors) {
    const debugPath = path.resolve(options.debugColors);
    await writeVariant(inputPath, debugPath, rig, options, true);
    console.log(`  debug colors -> ${debugPath}`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
