#!/usr/bin/env node
/**
 * GLB pipeline: voxelize, then optimize, in one command.
 *
 * Stage 1 (voxelize.py -> Blender): block-remesh the model onto a voxel grid,
 * baking the source texture colour into COLOR_0. Output has no UVs.
 * Stage 2 (optimize.mjs): dissolve the redundant coplanar faces the voxel grid
 * creates, then compress down to a triangle budget.
 *
 * Both stages are spawned rather than imported: stage 1 is Python, and running
 * them as subprocesses keeps each tool's own CLI the single source of truth for
 * its flags.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const VOXELIZE_SCRIPT = path.join(TOOL_DIR, 'voxelize.py');
const OPTIMIZE_SCRIPT = path.join(TOOL_DIR, 'optimize.mjs');

function usage() {
  return `Usage: pipeline.mjs INPUT.glb [INPUT.glb ...] [options] [-- OPTIMIZE_ARGS]

Runs voxelize -> optimize. The default output is <input>.pipeline.glb.

Output:
  -o, --output PATH        Output GLB path (single input only).
      --output-dir DIR     Directory for <input>.pipeline.glb outputs.

Voxelize (stage 1):
      --depth N            Blocks remesh octree depth, 1-10 (default: 6).
                           Larger = smaller voxels and far more geometry.
      --color-samples N    Texture samples per voxel face: 1 or 5 (default: 5).
      --keep-largest       Drop small disconnected pieces while remeshing.
      --skip-voxelize      Source is already voxel art; optimize only.

Optimize (stage 2):
      --budget N           Target triangle count (default: 6000). 0 = unlimited.
      --skip-optimize      Stop after voxelizing.

Other:
      --blender PATH       Blender executable (BLENDER env var also works).
      --python PATH        Python 3 interpreter (default: python3).
      --keep-intermediate  Keep the stage 1 .voxel.glb next to the output.
      --dry-run            Report the plan without running anything.
  -h, --help               Show this help.

Anything after a lone -- is forwarded verbatim to optimize.mjs, e.g.
  pipeline.mjs hero.glb --depth 7 -- --compress draco --texture-size 512
`;
}

export function parseArgs(argv) {
  const options = {
    inputs: [],
    output: null,
    outputDir: null,
    depth: 6,
    colorSamples: 5,
    keepLargest: false,
    skipVoxelize: false,
    budget: 6000,
    skipOptimize: false,
    blender: null,
    python: 'python3',
    keepIntermediate: false,
    dryRun: false,
    optimizeArgs: [],
  };

  const number = (raw, flag) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${flag} expects a number, got "${raw}"`);
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Everything past a lone `--` belongs to stage 2.
    if (arg === '--') {
      options.optimizeArgs = argv.slice(i + 1);
      break;
    }

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
      case '--depth':
      case '--factor':
        options.depth = number(next(), arg);
        break;
      case '--color-samples':
        options.colorSamples = number(next(), arg);
        break;
      case '--keep-largest':
        options.keepLargest = true;
        break;
      case '--skip-voxelize':
      case '--no-voxelize':
        options.skipVoxelize = true;
        break;
      case '--budget':
        options.budget = number(next(), arg);
        break;
      case '--skip-optimize':
      case '--no-optimize':
        options.skipOptimize = true;
        break;
      case '--blender':
        options.blender = next();
        break;
      case '--python':
        options.python = next();
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
  if (options.skipVoxelize && options.skipOptimize) {
    throw new Error('--skip-voxelize and --skip-optimize together would do nothing.');
  }
  if (!Number.isInteger(options.depth) || options.depth < 1 || options.depth > 10) {
    throw new Error('--depth must be a whole number between 1 and 10.');
  }
  if (![1, 5].includes(options.colorSamples)) {
    throw new Error('--color-samples must be 1 or 5.');
  }
  return options;
}

export function outputPathFor(inputPath, options) {
  if (options.output) return path.resolve(options.output);
  const dir = options.outputDir ? path.resolve(options.outputDir) : path.dirname(inputPath);
  return path.join(dir, `${path.basename(inputPath, path.extname(inputPath))}.pipeline.glb`);
}

function run(command, args, label) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    throw new Error(`${label} could not start (${command}): ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}.`);
  }
}

function voxelizeArgsFor(inputPath, outputPath, options) {
  const args = [
    VOXELIZE_SCRIPT,
    inputPath,
    '-o',
    outputPath,
    '--depth',
    String(options.depth),
    '--color-samples',
    String(options.colorSamples),
  ];
  if (options.keepLargest) args.push('--keep-largest');
  if (options.blender) args.push('--blender', options.blender);
  return args;
}

function optimizeArgsFor(inputPath, outputPath, options) {
  const args = [OPTIMIZE_SCRIPT, inputPath, '-o', outputPath, '--budget', String(options.budget)];
  if (options.blender) args.push('--blender', options.blender);
  return args.concat(options.optimizeArgs);
}

function processFile(inputPath, outputPath, options) {
  // Stage 1 writes here; stage 2 reads it. When only one stage runs, that stage
  // writes the final output directly and no intermediate exists.
  let intermediateDir = null;
  let voxelPath = null;

  if (!options.skipVoxelize && !options.skipOptimize) {
    intermediateDir = options.keepIntermediate
      ? path.dirname(outputPath)
      : fs.mkdtempSync(path.join(os.tmpdir(), 'glb-pipeline-'));
    fs.mkdirSync(intermediateDir, { recursive: true });
    voxelPath = path.join(
      intermediateDir,
      `${path.basename(inputPath, path.extname(inputPath))}.voxel.glb`,
    );
  }

  try {
    if (!options.skipVoxelize) {
      const target = voxelPath ?? outputPath;
      console.log(`\n[1/2] voxelize  ${path.basename(inputPath)} -> ${target}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      run(options.python, voxelizeArgsFor(inputPath, target, options), 'Voxelize stage');
    } else {
      console.log('\n[1/2] voxelize  skipped (--skip-voxelize)');
    }

    if (!options.skipOptimize) {
      const source = voxelPath ?? inputPath;
      console.log(`\n[2/2] optimize  ${path.basename(source)} -> ${outputPath}`);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      run(process.execPath, optimizeArgsFor(source, outputPath, options), 'Optimize stage');
    } else {
      console.log('\n[2/2] optimize  skipped (--skip-optimize)');
    }
  } finally {
    if (intermediateDir && !options.keepIntermediate) {
      fs.rmSync(intermediateDir, { recursive: true, force: true });
    }
  }
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

  if (options.dryRun) {
    for (const { inputPath, outputPath } of jobs) {
      console.log(`${inputPath} -> ${outputPath}`);
    }
    console.log(
      `depth=${options.depth} budget=${options.budget} ` +
        `voxelize=${!options.skipVoxelize} optimize=${!options.skipOptimize}`,
    );
    return 0;
  }

  for (const { inputPath, outputPath } of jobs) {
    try {
      processFile(inputPath, outputPath, options);
    } catch (error) {
      console.error(`\n! ${path.basename(inputPath)}: ${error.message}`);
      return 1;
    }
    const bytes = fs.statSync(outputPath).size;
    console.log(`\n=> ${outputPath} (${(bytes / 1048576).toFixed(2)} MB)`);
  }
  return 0;
}

// Only run when invoked as a CLI, so the helpers above stay importable by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
