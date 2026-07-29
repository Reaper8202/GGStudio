import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { outputPathFor, parseArgs } from '../optimize.mjs';

test('defaults target a 40k budget with meshopt and webp', () => {
  const options = parseArgs(['model.glb']);
  assert.deepEqual(options.inputs, ['model.glb']);
  assert.equal(options.budget, 40000);
  assert.equal(options.remesh, 'auto');
  assert.equal(options.compress, 'meshopt');
  assert.equal(options.textureFormat, 'webp');
  assert.equal(options.textureSize, 1024);
});

test('--no-remesh is equivalent to --remesh none', () => {
  assert.equal(parseArgs(['m.glb', '--no-remesh']).remesh, 'none');
  assert.equal(parseArgs(['m.glb', '--remesh', 'none']).remesh, 'none');
});

test('numeric flags are parsed as numbers', () => {
  const options = parseArgs(['m.glb', '--budget', '12000', '--planar-angle', '2.5']);
  assert.equal(options.budget, 12000);
  assert.equal(options.planarAngle, 2.5);
});

test('--drop accepts a comma-separated slot list', () => {
  assert.deepEqual(parseArgs(['m.glb', '--drop', 'normal,mr']).drop, ['normal', 'mr']);
});

test('rejects invalid enum values', () => {
  assert.throws(() => parseArgs(['m.glb', '--remesh', 'bogus']), /--remesh must be one of/);
  assert.throws(() => parseArgs(['m.glb', '--compress', 'zip']), /--compress must be one of/);
  assert.throws(() => parseArgs(['m.glb', '--drop', 'diffuse']), /--drop got "diffuse"/);
});

test('rejects non-numeric numeric flags', () => {
  assert.throws(() => parseArgs(['m.glb', '--budget', 'lots']), /--budget expects a number/);
});

test('rejects unknown options and missing inputs', () => {
  assert.throws(() => parseArgs(['m.glb', '--turbo']), /Unknown option: --turbo/);
  assert.throws(() => parseArgs([]), /At least one input GLB is required/);
});

test('rejects a flag used without its value', () => {
  assert.throws(() => parseArgs(['m.glb', '--budget']), /--budget requires a value/);
});

test('--output is rejected for multi-input batches', () => {
  assert.throws(() => parseArgs(['a.glb', 'b.glb', '-o', 'out.glb']), /only works with a single input/);
});

test('outputPathFor defaults to <name>.opt.glb beside the input', () => {
  const result = outputPathFor('/models/hero.glb', { output: null, outputDir: null });
  assert.equal(result, path.join('/models', 'hero.opt.glb'));
});

test('outputPathFor honours --output-dir and --output', () => {
  assert.equal(
    outputPathFor('/models/hero.glb', { output: null, outputDir: '/build' }),
    path.join(path.resolve('/build'), 'hero.opt.glb'),
  );
  assert.equal(
    outputPathFor('/models/hero.glb', { output: '/build/custom.glb', outputDir: null }),
    path.resolve('/build/custom.glb'),
  );
});
