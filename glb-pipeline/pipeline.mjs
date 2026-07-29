#!/usr/bin/env node
/**
 * GLB pipeline: optimize, then voxelize, in one command.
 *
 * Stage 1 (optimize.mjs): decimate the textured source to a triangle budget and
 * shrink its textures, so the expensive colour sampling in stage 2 runs against
 * a far lighter mesh.
 * Stage 2 (voxelize.py -> Blender): block-remesh onto a voxel grid, baking the
 * source texture colour into one flat COLOR_0 per voxel. No UVs survive.
 * Stage 3 (optimize.mjs --no-remesh): buffer compression only.
 *
 * Voxelizing LAST is deliberate. The optimizer's planar dissolve merges
 * coplanar faces, and on voxel input nothing delimits it -- there are no UVs
 * and one material -- so it welds neighbouring cubes of different colours into
 * n-gons and re-triangulates, interpolating the colours into gradients. Running
 * it before the voxel stage keeps every cube flat. Stage 3 is geometry-neutral
 * for the same reason: --no-remesh skips the dissolve entirely.
 *
 * Stages are spawned rather than imported: stage 2 is Python, and running them
 * as subprocesses keeps each tool's own CLI the single source of truth.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const VOXELIZE_SCRIPT = path.join(TOOL_DIR, "voxelize.py");
const OPTIMIZE_SCRIPT = path.join(TOOL_DIR, "optimize.mjs");

function usage() {
  return `Usage: pipeline.mjs INPUT.glb [INPUT.glb ...] [options] [-- OPTIMIZE_ARGS]

Runs optimize -> voxelize -> compress. Default output is <input>.pipeline.glb.

Output:
  -o, --output PATH        Output GLB path (single input only).
      --output-dir DIR     Directory for <input>.pipeline.glb outputs.

Optimize (stage 1, on the textured source):
      --budget N           Target triangle count (default: 40000). 0 = unlimited.
                           Applies to the source mesh, before voxelizing --
                           final triangle count is set by --depth, not this.
      --skip-optimize      Voxelize the source as-is.

Voxelize (stage 2, produces the final look):
      --depth N            Blocks remesh octree depth, 1-10 (default: 5).
                           Larger = smaller voxels and far more geometry;
                           lower = chunkier blocks.
      --color-samples N    Texture samples per voxel face: 1 or 5 (default: 5).
      --per-face-color     Colour each cube face separately instead of giving
                           every voxel one flat colour.
      --keep-largest       Drop small disconnected pieces while remeshing.
      --min-part RATIO     With --keep-largest, smallest piece to keep as a
                           ratio of the largest (default: 0.05). 1.0 keeps only
                           the largest piece and will amputate limbs.
      --skip-voxelize      Optimize only; keep the textured look.

Compress (stage 3):
      --skip-compress      Leave the voxel output uncompressed.

Other:
      --blender PATH       Blender executable (BLENDER env var also works).
      --python PATH        Python 3 interpreter (default: python3).
      --keep-intermediate  Keep the per-stage GLBs next to the output.
      --dry-run            Report the plan without running anything.
  -h, --help               Show this help.

Anything after a lone -- is forwarded verbatim to the stage 1 optimizer, e.g.
  pipeline.mjs hero.glb --depth 7 -- --texture-size 2048 --drop normal
`;
}

export function parseArgs(argv) {
  const options = {
    inputs: [],
    output: null,
    outputDir: null,
    depth: 7,
    colorSamples: 5,
    perFaceColor: false,
    keepLargest: false,
    minPart: 0.05,
    skipVoxelize: false,
    budget: 40000,
    skipOptimize: false,
    skipCompress: false,
    blender: null,
    python: "python3",
    keepIntermediate: false,
    dryRun: false,
    optimizeArgs: [],
  };

  const number = (raw, flag) => {
    const value = Number(raw);
    if (!Number.isFinite(value))
      throw new Error(`${flag} expects a number, got "${raw}"`);
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Everything past a lone `--` belongs to stage 2.
    if (arg === "--") {
      options.optimizeArgs = argv.slice(i + 1);
      break;
    }

    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };

    switch (arg) {
      case "-h":
      case "--help":
        return { help: true };
      case "-o":
      case "--output":
        options.output = next();
        break;
      case "--output-dir":
        options.outputDir = next();
        break;
      case "--depth":
      case "--factor":
        options.depth = number(next(), arg);
        break;
      case "--color-samples":
        options.colorSamples = number(next(), arg);
        break;
      case "--per-face-color":
      case "--per-face-colour":
        options.perFaceColor = true;
        break;
      case "--keep-largest":
        options.keepLargest = true;
        break;
      case "--min-part":
        options.minPart = number(next(), arg);
        break;
      case "--skip-voxelize":
      case "--no-voxelize":
        options.skipVoxelize = true;
        break;
      case "--budget":
        options.budget = number(next(), arg);
        break;
      case "--skip-optimize":
      case "--no-optimize":
        options.skipOptimize = true;
        break;
      case "--skip-compress":
      case "--no-compress":
        options.skipCompress = true;
        break;
      case "--blender":
        options.blender = next();
        break;
      case "--python":
        options.python = next();
        break;
      case "--keep-intermediate":
        options.keepIntermediate = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
        options.inputs.push(arg);
    }
  }

  if (!options.inputs.length)
    throw new Error("At least one input GLB is required.");
  if (options.output && options.inputs.length > 1) {
    throw new Error(
      "--output only works with a single input; use --output-dir for batches.",
    );
  }
  if (options.skipVoxelize && options.skipOptimize) {
    throw new Error(
      "--skip-voxelize and --skip-optimize together would do nothing.",
    );
  }
  if (options.skipVoxelize && options.budget === 0) {
    throw new Error(
      "--skip-voxelize with --budget 0 leaves nothing for the optimizer to do.",
    );
  }
  if (
    !Number.isInteger(options.depth) ||
    options.depth < 1 ||
    options.depth > 10
  ) {
    throw new Error("--depth must be a whole number between 1 and 10.");
  }
  if (![1, 5].includes(options.colorSamples)) {
    throw new Error("--color-samples must be 1 or 5.");
  }
  if (!(options.minPart > 0) || options.minPart > 1) {
    throw new Error("--min-part must be greater than 0 and at most 1.");
  }
  return options;
}

export function outputPathFor(inputPath, options) {
  if (options.output) return path.resolve(options.output);
  const dir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.dirname(inputPath);
  return path.join(
    dir,
    `${path.basename(inputPath, path.extname(inputPath))}.pipeline.glb`,
  );
}

function run(command, args, label) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    throw new Error(
      `${label} could not start (${command}): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}.`);
  }
}

function voxelizeArgsFor(inputPath, outputPath, options) {
  const args = [
    VOXELIZE_SCRIPT,
    inputPath,
    "-o",
    outputPath,
    "--depth",
    String(options.depth),
    "--color-samples",
    String(options.colorSamples),
  ];
  args.push("--min-part", String(options.minPart));
  if (options.perFaceColor) args.push("--per-face-color");
  if (options.keepLargest) args.push("--keep-largest");
  if (options.blender) args.push("--blender", options.blender);
  return args;
}

function optimizeArgsFor(inputPath, outputPath, options) {
  const args = [
    OPTIMIZE_SCRIPT,
    inputPath,
    "-o",
    outputPath,
    "--budget",
    String(options.budget),
  ];
  if (options.blender) args.push("--blender", options.blender);
  return args.concat(options.optimizeArgs);
}

/**
 * Buffer compression only. --no-remesh keeps the optimizer away from the
 * geometry, which is what stops it dissolving neighbouring voxels of different
 * colours into gradient-shaded n-gons.
 */
function compressArgsFor(inputPath, outputPath) {
  return [
    OPTIMIZE_SCRIPT,
    inputPath,
    "-o",
    outputPath,
    "--no-remesh",
    "--budget",
    "0",
  ];
}

function processFile(inputPath, outputPath, options) {
  const stages = [];
  if (!options.skipOptimize) {
    stages.push({
      label: "optimize",
      suffix: "opt",
      run: (from, to) =>
        run(
          process.execPath,
          optimizeArgsFor(from, to, options),
          "Optimize stage",
        ),
    });
  }
  if (!options.skipVoxelize) {
    stages.push({
      label: "voxelize",
      suffix: "voxel",
      run: (from, to) =>
        run(
          options.python,
          voxelizeArgsFor(from, to, options),
          "Voxelize stage",
        ),
    });
  }
  // Compression only earns its place when the voxel stage produced fresh,
  // uncompressed geometry; the optimizer already compresses its own output.
  if (!options.skipCompress && !options.skipVoxelize) {
    stages.push({
      label: "compress",
      suffix: "packed",
      run: (from, to) =>
        run(process.execPath, compressArgsFor(from, to), "Compress stage"),
    });
  }

  if (!stages.length)
    throw new Error("Every stage was skipped; nothing to do.");

  const intermediateDir =
    stages.length > 1
      ? options.keepIntermediate
        ? path.dirname(outputPath)
        : fs.mkdtempSync(path.join(os.tmpdir(), "glb-pipeline-"))
      : null;
  if (intermediateDir) fs.mkdirSync(intermediateDir, { recursive: true });

  const stem = path.basename(inputPath, path.extname(inputPath));

  try {
    let current = inputPath;
    stages.forEach((stage, index) => {
      const last = index === stages.length - 1;
      const target = last
        ? outputPath
        : path.join(intermediateDir, `${stem}.${stage.suffix}.glb`);
      console.log(
        `\n[${index + 1}/${stages.length}] ${stage.label.padEnd(8)} ` +
          `${path.basename(current)} -> ${target}`,
      );
      fs.mkdirSync(path.dirname(target), { recursive: true });
      stage.run(current, target);
      current = target;
    });
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
    if (path.extname(inputPath).toLowerCase() !== ".glb") {
      console.error(`Input must be a .glb file: ${inputPath}`);
      return 1;
    }
    const outputPath = outputPathFor(inputPath, options);
    if (outputPath === inputPath) {
      console.error(
        `Output must differ from input to avoid overwriting the source: ${inputPath}`,
      );
      return 1;
    }
    jobs.push({ inputPath, outputPath });
  }

  if (options.dryRun) {
    for (const { inputPath, outputPath } of jobs) {
      console.log(`${inputPath} -> ${outputPath}`);
    }
    const plan = [
      options.skipOptimize ? null : "optimize",
      options.skipVoxelize ? null : "voxelize",
      options.skipCompress || options.skipVoxelize ? null : "compress",
    ].filter(Boolean);
    console.log(
      `stages=${plan.join(" -> ")} depth=${options.depth} budget=${options.budget} ` +
        `color=${options.perFaceColor ? "face" : "voxel"}`,
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
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main();
}
