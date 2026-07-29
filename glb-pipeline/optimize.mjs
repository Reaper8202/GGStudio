#!/usr/bin/env node
/**
 * GLB optimizer: remesh + compress static models into runtime-ready assets.
 *
 * Stage 1 (optional, Blender): rebuild topology - weld, dissolve coplanar
 * faces, collapse down to a triangle budget.
 * Stage 2 (glTF-Transform): dedup/join/weld geometry, shrink and re-encode
 * textures, then compress the buffers.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  draco,
  flatten,
  getGLPrimitiveCount,
  join,
  meshopt,
  prune,
  quantize,
  resample,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const BLENDER_SCRIPT = path.join(TOOL_DIR, 'blender_remesh.py');

const REMESH_MODES = ['auto', 'planar', 'collapse', 'voxel', 'none'];
const COMPRESSION_MODES = ['meshopt', 'draco', 'quantize', 'none'];
const TEXTURE_FORMATS = ['webp', 'jpeg', 'png', 'avif', 'keep'];

const DROPPABLE_SLOTS = {
  normal: 'normalTexture',
  mr: 'metallicRoughnessTexture',
  metallicRoughness: 'metallicRoughnessTexture',
  emissive: 'emissiveTexture',
  occlusion: 'occlusionTexture',
};

const BLENDER_CANDIDATES = [
  process.env.BLENDER,
  '/Applications/Blender.app/Contents/MacOS/Blender',
  'C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe',
  'C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe',
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  return `Usage: optimize.mjs INPUT.glb [INPUT.glb ...] [options]

Output:
  -o, --output PATH        Output GLB path (single input only).
      --output-dir DIR     Directory for <input>.opt.glb outputs.

Geometry:
      --budget N           Target triangle count (default: 40000). 0 = unlimited.
      --remesh MODE        ${REMESH_MODES.join(' | ')} (default: auto).
                           Requires Blender; falls back to --simplify without it.
      --planar-angle DEG   Planar dissolve angle limit (default: 1).
      --weld-distance N    Merge-by-distance threshold (default: 0.0001).
      --voxel-size N       Voxel size for --remesh voxel (default: 0.02).
      --simplify           Force meshoptimizer simplification instead of Blender.
      --simplify-error N   Max simplification error, fraction of radius (default: 0.001).
      --no-remesh          Skip all topology changes; compress only.

Textures:
      --texture-size N     Max texture dimension (default: 1024). 0 = keep.
      --texture-format FMT ${TEXTURE_FORMATS.join(' | ')} (default: webp).
      --texture-quality N  Quality 1-100 for color maps (default: 82).
      --normal-quality N   Quality 1-100 for normal maps (default: 95).
      --drop LIST          Comma-separated maps to remove: ${Object.keys(DROPPABLE_SLOTS).join(',')}.

Encoding:
      --compress MODE      ${COMPRESSION_MODES.join(' | ')} (default: meshopt).

Other:
      --blender PATH       Blender executable (BLENDER env var also works).
      --keep-intermediate  Keep the Blender stage output for inspection.
      --dry-run            Report the plan without writing anything.
  -h, --help               Show this help.
`;
}

export function parseArgs(argv) {
  const options = {
    inputs: [],
    output: null,
    outputDir: null,
    budget: 40000,
    remesh: 'auto',
    planarAngle: 1,
    weldDistance: 0.0001,
    voxelSize: 0.02,
    simplify: false,
    simplifyError: 0.001,
    textureSize: 1024,
    textureFormat: 'webp',
    textureQuality: 82,
    normalQuality: 95,
    drop: [],
    compress: 'meshopt',
    blender: null,
    keepIntermediate: false,
    dryRun: false,
  };

  const number = (raw, flag) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${flag} expects a number, got "${raw}"`);
    return value;
  };
  const oneOf = (raw, allowed, flag) => {
    if (!allowed.includes(raw)) throw new Error(`${flag} must be one of: ${allowed.join(', ')}`);
    return raw;
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
      case '-o':
      case '--output':
        options.output = next();
        break;
      case '--output-dir':
        options.outputDir = next();
        break;
      case '--budget':
        options.budget = number(next(), arg);
        break;
      case '--remesh':
        options.remesh = oneOf(next(), REMESH_MODES, arg);
        break;
      case '--no-remesh':
        options.remesh = 'none';
        break;
      case '--planar-angle':
        options.planarAngle = number(next(), arg);
        break;
      case '--weld-distance':
        options.weldDistance = number(next(), arg);
        break;
      case '--voxel-size':
        options.voxelSize = number(next(), arg);
        break;
      case '--simplify':
        options.simplify = true;
        break;
      case '--simplify-error':
        options.simplifyError = number(next(), arg);
        break;
      case '--texture-size':
        options.textureSize = number(next(), arg);
        break;
      case '--texture-format':
        options.textureFormat = oneOf(next(), TEXTURE_FORMATS, arg);
        break;
      case '--texture-quality':
        options.textureQuality = number(next(), arg);
        break;
      case '--normal-quality':
        options.normalQuality = number(next(), arg);
        break;
      case '--drop':
        options.drop = next()
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
        break;
      case '--compress':
        options.compress = oneOf(next(), COMPRESSION_MODES, arg);
        break;
      case '--blender':
        options.blender = next();
        break;
      case '--keep-intermediate':
        options.keepIntermediate = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        options.inputs.push(arg);
    }
  }

  if (!options.inputs.length) throw new Error('At least one input GLB is required.');
  if (options.output && options.inputs.length > 1) {
    throw new Error('--output only works with a single input; use --output-dir for batches.');
  }
  for (const entry of options.drop) {
    if (!(entry in DROPPABLE_SLOTS)) {
      throw new Error(`--drop got "${entry}"; expected one of: ${Object.keys(DROPPABLE_SLOTS).join(', ')}`);
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findBlender(explicit) {
  const candidates = [explicit, ...BLENDER_CANDIDATES].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['blender'], {
    encoding: 'utf8',
  });
  if (which.status === 0) {
    const resolved = which.stdout.trim().split('\n')[0];
    if (resolved) return resolved;
  }
  return null;
}

export function outputPathFor(inputPath, options) {
  if (options.output) return path.resolve(options.output);
  const dir = options.outputDir ? path.resolve(options.outputDir) : path.dirname(inputPath);
  return path.join(dir, `${path.basename(inputPath, path.extname(inputPath))}.opt.glb`);
}

function documentStats(document) {
  const root = document.getRoot();
  let triangles = 0;
  let vertices = 0;
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      triangles += getGLPrimitiveCount(primitive);
      vertices += primitive.getAttribute('POSITION')?.getCount() ?? 0;
    }
  }
  let textureBytes = 0;
  for (const texture of root.listTextures()) {
    textureBytes += texture.getImage()?.byteLength ?? 0;
  }
  return {
    triangles,
    vertices,
    textureBytes,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    animations: root.listAnimations().length,
    skins: root.listSkins().length,
  };
}

const formatMB = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;
const formatInt = (value) => value.toLocaleString('en-US');

function reduction(before, after) {
  if (!before) return 'n/a';
  const delta = (1 - after / before) * 100;
  return `${delta >= 0 ? '-' : '+'}${Math.abs(delta).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Stage 1: Blender remesh
// ---------------------------------------------------------------------------

function runBlenderRemesh(blender, inputPath, outputPath, options) {
  const args = [
    '--background',
    '--factory-startup',
    '--python',
    BLENDER_SCRIPT,
    '--',
    inputPath,
    outputPath,
    '--mode',
    options.remesh,
    '--budget',
    String(Math.max(0, Math.round(options.budget))),
    '--planar-angle',
    String(options.planarAngle),
    '--weld-distance',
    String(options.weldDistance),
    '--voxel-size',
    String(options.voxelSize),
  ];

  const result = spawnSync(blender, args, { encoding: 'utf8' });
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    const reason = combined
      .split('\n')
      .filter((line) => line.includes('REMESH_RESULT') || line.startsWith('Error'))
      .join('\n');
    throw new Error(`Blender remesh failed.\n${reason || combined.slice(-1500)}`);
  }

  const line = combined.split('\n').find((entry) => entry.startsWith('REMESH_RESULT'));
  const stats = {};
  if (line) {
    for (const token of line.split(/\s+/).slice(1)) {
      const [key, value] = token.split('=');
      if (key && value !== undefined) stats[key] = value;
    }
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Stage 2: glTF-Transform
// ---------------------------------------------------------------------------

async function createIO() {
  const [decoder, encoder] = await Promise.all([
    draco3d.createDecoderModule(),
    draco3d.createEncoderModule(),
  ]);
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;

  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': decoder,
    'draco3d.encoder': encoder,
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
}

function dropTextureSlots(document, slots) {
  for (const material of document.getRoot().listMaterials()) {
    if (slots.has('baseColorTexture')) material.setBaseColorTexture(null);
    if (slots.has('normalTexture')) material.setNormalTexture(null);
    if (slots.has('metallicRoughnessTexture')) material.setMetallicRoughnessTexture(null);
    if (slots.has('emissiveTexture')) material.setEmissiveTexture(null);
    if (slots.has('occlusionTexture')) material.setOcclusionTexture(null);
  }
}

/** True if any primitive still carries UVs to sample textures with. */
function hasTexCoords(document) {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getAttribute('TEXCOORD_0')) return true;
    }
  }
  return false;
}

async function optimizeDocument(document, options, { allowSimplify }) {
  const transforms = [dedup()];

  // flatten/join bake node transforms into geometry, which would break any
  // animated or skinned hierarchy. Only safe for static props.
  const stats = documentStats(document);
  const isStatic = stats.animations === 0 && stats.skins === 0;
  if (isStatic) transforms.push(flatten(), join());

  transforms.push(weld());

  if (allowSimplify && options.budget > 0 && stats.triangles > options.budget) {
    transforms.push(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: options.budget / stats.triangles,
        error: options.simplifyError,
      }),
    );
  }

  transforms.push(resample());

  // Discard unwanted maps before the texture passes, so we never spend time
  // re-encoding an image that is about to be pruned.
  const drop = new Set(options.drop.map((entry) => DROPPABLE_SLOTS[entry]));
  if (!hasTexCoords(document)) {
    // Voxel remesh (and some source models) leave no UVs. Textures would then
    // only ever sample (0,0), so they are dead weight in the file.
    for (const slot of Object.values(DROPPABLE_SLOTS)) drop.add(slot);
    drop.add('baseColorTexture');
  }
  if (drop.size) transforms.push((doc) => dropTextureSlots(doc, drop));

  transforms.push(prune({ keepAttributes: false, keepLeaves: false }));

  if (options.textureSize > 0 || options.textureFormat !== 'keep') {
    const resize =
      options.textureSize > 0 ? [options.textureSize, options.textureSize] : undefined;
    const targetFormat = options.textureFormat === 'keep' ? undefined : options.textureFormat;

    // Normal maps carry directional data and band badly under aggressive lossy
    // compression, so they get their own higher-quality pass.
    transforms.push(
      textureCompress({
        encoder: sharp,
        targetFormat,
        resize,
        quality: options.textureQuality,
        slots: /^(?!normalTexture$).*/,
      }),
      textureCompress({
        encoder: sharp,
        targetFormat,
        resize,
        quality: options.normalQuality,
        slots: /^normalTexture$/,
      }),
    );
  }

  transforms.push(prune({ keepAttributes: false, keepLeaves: false }));

  await document.transform(...transforms);

  // Buffer compression runs last: it rewrites accessors into an encoded form
  // that the earlier geometry passes cannot operate on.
  switch (options.compress) {
    case 'meshopt':
      await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
      break;
    case 'draco':
      await document.transform(draco());
      break;
    case 'quantize':
      await document.transform(quantize());
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function processFile(io, inputPath, outputPath, options, blender) {
  const sourceBytes = fs.statSync(inputPath).size;
  const sourceDocument = await io.read(inputPath);
  const before = documentStats(sourceDocument);

  let remeshStats = null;
  let workingPath = inputPath;
  let intermediatePath = null;

  const wantsRemesh = options.remesh !== 'none' && !options.simplify;
  const isStatic = before.animations === 0 && before.skins === 0;

  if (wantsRemesh && !isStatic) {
    console.warn(
      '  ! Skipping Blender remesh: model has animations or skins, which the ' +
        'remesh stage does not preserve. Using meshoptimizer simplification instead.',
    );
  } else if (wantsRemesh && !blender) {
    console.warn('  ! Blender not found; using meshoptimizer simplification instead.');
  } else if (wantsRemesh) {
    intermediatePath = path.join(
      options.keepIntermediate ? path.dirname(outputPath) : fs.mkdtempSync(path.join(os.tmpdir(), 'glb-opt-')),
      `${path.basename(inputPath, path.extname(inputPath))}.remesh.glb`,
    );
    fs.mkdirSync(path.dirname(intermediatePath), { recursive: true });
    remeshStats = runBlenderRemesh(blender, inputPath, intermediatePath, options);
    workingPath = intermediatePath;
    console.log(
      `  remesh   ${formatInt(Number(remeshStats.tris_before ?? before.triangles))} -> ` +
        `${formatInt(Number(remeshStats.tris_after ?? 0))} tris (mode=${remeshStats.mode ?? options.remesh})`,
    );
  }

  const document = workingPath === inputPath ? sourceDocument : await io.read(workingPath);
  // Fall back to meshoptimizer only when the Blender stage did not already hit
  // the budget. `--remesh none` means compress-only, so it opts out entirely
  // unless simplification was requested explicitly.
  const allowSimplify = !remeshStats && (options.simplify || options.remesh !== 'none');
  // Blender's exporter re-encodes textures losslessly; the remesh stage keeps
  // them, so texture work still happens here in stage 2.
  await optimizeDocument(document, options, { allowSimplify });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await io.write(outputPath, document);

  if (intermediatePath && !options.keepIntermediate) {
    fs.rmSync(path.dirname(intermediatePath), { recursive: true, force: true });
  }

  const after = documentStats(document);
  const outputBytes = fs.statSync(outputPath).size;

  const rows = [
    ['triangles', formatInt(before.triangles), formatInt(after.triangles), reduction(before.triangles, after.triangles)],
    ['vertices', formatInt(before.vertices), formatInt(after.vertices), reduction(before.vertices, after.vertices)],
    ['draw calls', formatInt(before.meshes), formatInt(after.meshes), reduction(before.meshes, after.meshes)],
    ['textures', formatMB(before.textureBytes), formatMB(after.textureBytes), reduction(before.textureBytes, after.textureBytes)],
    ['file size', formatMB(sourceBytes), formatMB(outputBytes), reduction(sourceBytes, outputBytes)],
  ];
  const widths = [12, 12, 12, 8];
  for (const row of rows) {
    console.log(
      '  ' + row.map((cell, index) => String(cell).padEnd(widths[index])).join(' '),
    );
  }

  return { sourceBytes, outputBytes };
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

  const jobs = [];
  for (const raw of options.inputs) {
    const inputPath = path.resolve(raw);
    if (!fs.existsSync(inputPath)) {
      console.error(`Input does not exist: ${inputPath}`);
      return 1;
    }
    if (path.extname(inputPath).toLowerCase() !== '.glb') {
      console.error(`Input must be a .glb file: ${inputPath}`);
      return 1;
    }
    const outputPath = outputPathFor(inputPath, options);
    if (outputPath === inputPath) {
      console.error(`Output must differ from input to avoid overwriting the source: ${inputPath}`);
      return 1;
    }
    jobs.push({ inputPath, outputPath });
  }

  const blender = options.remesh === 'none' || options.simplify ? null : findBlender(options.blender);

  if (options.dryRun) {
    for (const { inputPath, outputPath } of jobs) {
      console.log(`${inputPath} -> ${outputPath}`);
    }
    console.log(
      `remesh=${options.remesh} budget=${options.budget} texture=${options.textureFormat}@${options.textureSize} ` +
        `compress=${options.compress} blender=${blender ?? 'not found'}`,
    );
    return 0;
  }

  const io = await createIO();
  let totalIn = 0;
  let totalOut = 0;

  for (const { inputPath, outputPath } of jobs) {
    console.log(`\n${path.basename(inputPath)} -> ${outputPath}`);
    try {
      const { sourceBytes, outputBytes } = await processFile(io, inputPath, outputPath, options, blender);
      totalIn += sourceBytes;
      totalOut += outputBytes;
    } catch (error) {
      console.error(`  ! Failed: ${error.message}`);
      return 1;
    }
  }

  if (jobs.length > 1) {
    console.log(`\nTotal: ${formatMB(totalIn)} -> ${formatMB(totalOut)} (${reduction(totalIn, totalOut)})`);
  }
  return 0;
}

// Only run when invoked as a CLI, so the helpers above stay importable by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
