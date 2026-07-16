// Small process/fs helpers shared by the asset pipeline scripts.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SCRIPTS_DIR } from './paths.mjs';

export const FBX2GLTF_BIN = path.join(ROOT, 'node_modules', 'fbx2gltf', 'bin', 'Darwin', 'FBX2glTF');
export const GLTF_TRANSFORM_BIN = path.join(ROOT, 'node_modules', '.bin', 'gltf-transform');

/** Ensure a directory exists. */
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** mtime in ms, or -Infinity if the path does not exist. */
export function mtimeOf(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return -Infinity;
  }
}

/** Newest mtime among a list of paths (files or dirs); missing paths are ignored. */
export function newestMtime(paths) {
  let max = -Infinity;
  for (const p of paths) {
    const m = mtimeOf(p);
    if (m > max) max = m;
  }
  return max;
}

/**
 * True if `output` is missing, or older than any of `inputs`.
 * This is the idempotency check used throughout build-assets.mjs: every
 * build step is skipped if its inputs (source assets + the pipeline scripts
 * that process them) haven't changed since the output was last produced.
 */
export function isStale(output, inputs) {
  const outTime = mtimeOf(output);
  if (outTime === -Infinity) return true;
  return newestMtime(inputs) > outTime;
}

/** The pipeline's own source files, included as inputs so edits bust the cache. */
export function selfSources(...extra) {
  return [
    path.join(SCRIPTS_DIR, 'build-assets.mjs'),
    path.join(SCRIPTS_DIR, 'lib'),
    ...extra,
  ];
}

export function run(bin, args, opts = {}) {
  return execFileSync(bin, args, { stdio: 'pipe', encoding: 'utf8', ...opts });
}

export function runFbx2Gltf(inputFbx, outputGltf) {
  ensureDir(path.dirname(outputGltf));
  return run(FBX2GLTF_BIN, ['--input', inputFbx, '--output', outputGltf]);
}

/**
 * Run `gltf-transform optimize` as a subprocess. `extraArgs` is an array of
 * CLI flags (strings), e.g. ['--simplify', 'false', '--join', 'false'].
 */
export function runOptimize(inputPath, outputPath, extraArgs) {
  ensureDir(path.dirname(outputPath));
  return run(GLTF_TRANSFORM_BIN, ['optimize', inputPath, outputPath, ...extraArgs]);
}
