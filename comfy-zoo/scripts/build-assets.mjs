#!/usr/bin/env node
// Idempotent asset pipeline orchestrator for Comfy Zoo.
//
// Pipeline stages (each skips its outputs when already up to date with
// their inputs -- see lib/exec.mjs#isStale):
//   1. FBX -> intermediate glTF (dinos, buildings, nature props) via FBX2glTF
//   2. Texture re-attachment for FBX-converted nature props (see
//      lib/nature-textures.mjs for why this is needed)
//   3. gltf-transform `optimize` (meshopt + WebP) -> public/assets/models/**
//   4. Audio copy, icon copy/rename, font subsetting
//   5. manifest.json generation
//
// Run with `npm run assets`.
import fs from 'node:fs';
import path from 'node:path';
import { PACKS, OUT, PUBLIC_ASSETS, CACHE_DIR } from './lib/paths.mjs';
import { ensureDir, isStale, selfSources, runFbx2Gltf, runOptimize } from './lib/exec.mjs';
import { getIO } from './lib/gltf-io.mjs';
import { attachNatureTextures } from './lib/nature-textures.mjs';
import { subsetToWoff2 } from './lib/fonts.mjs';
import { writeManifest } from './lib/manifest.mjs';
import { ICON_NAME_BY_SVG, CURSOR_NAME_BY_SVG } from './lib/icon-map.mjs';

const CACHE_FBX = path.join(CACHE_DIR, 'fbx');
const CACHE_NATURE = path.join(CACHE_DIR, 'nature-textured');

let converted = 0;
let skipped = 0;
let failed = [];

function log(msg) {
  console.log(msg);
}

// ---------------------------------------------------------------------------
// Model inventories
// ---------------------------------------------------------------------------

const DINOS = ['Apatosaurus', 'Parasaurolophus', 'Stegosaurus', 'Trex', 'Triceratops', 'Velociraptor'];

const BUILDINGS = [
  'Barn', 'BigBarn', 'ChickenCoop', 'Fence', 'Fence2', 'OpenBarn', 'Silo',
  'Silo_House', 'SmallBarn', 'TowerWindmill', 'WaterTower', 'Well', 'Windmill',
];

function listNatureFbxNames() {
  return fs.readdirSync(PACKS.natureFbx)
    .filter((f) => f.endsWith('.fbx'))
    .map((f) => f.replace(/\.fbx$/, ''))
    .filter((n) => /^(PineTree_[1-5]|NormalTree_[1-5]|PalmTree_[1-5]|Rock_[1-5]|Plant_[12]|Petals_[1-4])$/.test(n))
    .sort();
}

function listAnimalNames() {
  return fs.readdirSync(PACKS.animalsGltf)
    .filter((f) => f.endsWith('.gltf'))
    .map((f) => f.replace(/\.gltf$/, ''))
    .sort();
}

function listNatureGltfNames() {
  return fs.readdirSync(PACKS.natureGltf)
    .filter((f) => f.endsWith('.gltf'))
    .map((f) => f.replace(/\.gltf$/, ''))
    .filter((n) => /^(BirchTree_|MapleTree_|DeadTree_|Grass_|Bush)/.test(n) || /_Clump$/.test(n))
    .sort();
}

// ---------------------------------------------------------------------------
// gltf-transform optimize flag sets
// ---------------------------------------------------------------------------

function optimizeArgs({ animated, textureSize }) {
  const common = ['--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(textureSize)];
  if (animated) {
    // Rigged/skinned models: never simplify, flatten, or join -- that would
    // silently break skin weights / animation targets.
    return [...common, '--simplify', 'false', '--flatten', 'false', '--join', 'false'];
  }
  // Static props: join/flatten are safe and reduce draw calls; keep
  // simplify off so silhouettes stay crisp at close camera distance.
  return [...common, '--simplify', 'false'];
}

// ---------------------------------------------------------------------------
// Stage: plain FBX -> glTF -> optimize (buildings, dinos -- no textures)
// ---------------------------------------------------------------------------

function buildFbxDirect(name, srcFbx, outGlb, { animated, textureSize }) {
  const inputs = selfSources(srcFbx);
  if (!isStale(outGlb, inputs)) {
    skipped++;
    return;
  }
  try {
    const cacheGltf = path.join(CACHE_FBX, path.basename(path.dirname(outGlb)), name, `${name}.gltf`);
    if (isStale(cacheGltf, [srcFbx])) {
      runFbx2Gltf(srcFbx, cacheGltf);
    }
    runOptimize(cacheGltf, outGlb, optimizeArgs({ animated, textureSize }));
    converted++;
    log(`  ok   ${path.relative(PUBLIC_ASSETS, outGlb)}`);
  } catch (err) {
    failed.push({ name, outGlb, error: String(err.message || err) });
    log(`  FAIL ${name}: ${err.message || err}`);
  }
}

// ---------------------------------------------------------------------------
// Stage: FBX -> glTF -> attach textures -> optimize (nature props)
// ---------------------------------------------------------------------------

async function buildFbxNature(name, srcFbx, outGlb) {
  const inputs = selfSources(srcFbx);
  if (!isStale(outGlb, inputs)) {
    skipped++;
    return;
  }
  try {
    const cacheGltf = path.join(CACHE_FBX, 'nature', name, `${name}.gltf`);
    if (isStale(cacheGltf, [srcFbx])) {
      runFbx2Gltf(srcFbx, cacheGltf);
    }

    const texturedGlb = path.join(CACHE_NATURE, `${name}.glb`);
    if (isStale(texturedGlb, [cacheGltf, srcFbx])) {
      const io = await getIO();
      const document = await io.read(cacheGltf);
      const touched = attachNatureTextures(document, PACKS.natureTextures);
      ensureDir(CACHE_NATURE);
      await io.write(texturedGlb, document);
      if (touched.length === 0) {
        log(`  warn ${name}: no textures matched (materials left flat-shaded)`);
      }
    }

    runOptimize(texturedGlb, outGlb, optimizeArgs({ animated: false, textureSize: 512 }));
    converted++;
    log(`  ok   ${path.relative(PUBLIC_ASSETS, outGlb)}`);
  } catch (err) {
    failed.push({ name, outGlb, error: String(err.message || err) });
    log(`  FAIL ${name}: ${err.message || err}`);
  }
}

// ---------------------------------------------------------------------------
// Stage: compress-only (already glTF)
// ---------------------------------------------------------------------------

function buildCompressOnly(name, srcGltf, outGlb, { animated, textureSize }) {
  const inputs = selfSources(srcGltf);
  if (!isStale(outGlb, inputs)) {
    skipped++;
    return;
  }
  try {
    runOptimize(srcGltf, outGlb, optimizeArgs({ animated, textureSize }));
    converted++;
    log(`  ok   ${path.relative(PUBLIC_ASSETS, outGlb)}`);
  } catch (err) {
    failed.push({ name, outGlb, error: String(err.message || err) });
    log(`  FAIL ${name}: ${err.message || err}`);
  }
}

// ---------------------------------------------------------------------------
// Stage: foliage alpha-cutout post-pass
// The nature packs export leaf/flower cards as alphaMode BLEND, which renders
// as unsorted dark artifacts in three.js (double-sided transparent planes
// can't depth-sort). Cutout (MASK) is the intended stylized look and
// depth-writes correctly. Idempotent: rewrites a file only when it still has
// a BLEND material.
// ---------------------------------------------------------------------------

async function fixFoliageAlpha() {
  const io = await getIO();
  for (const f of fs.readdirSync(OUT.modelsNature).filter((n) => n.endsWith('.glb'))) {
    const p = path.join(OUT.modelsNature, f);
    const document = await io.read(p);
    let changed = false;
    for (const mat of document.getRoot().listMaterials()) {
      if (mat.getAlphaMode() === 'BLEND') {
        mat.setAlphaMode('MASK');
        mat.setAlphaCutoff(0.5);
        changed = true;
      }
    }
    if (changed) {
      await io.write(p, document);
      log(`  mask ${f}`);
    } else {
      skipped++;
    }
  }
}

// ---------------------------------------------------------------------------
// Stage: audio
// ---------------------------------------------------------------------------

function buildAudio() {
  ensureDir(OUT.audioUi);
  const files = fs.readdirSync(PACKS.soundOgg).filter((f) => f.endsWith('.ogg'));
  let copied = 0;
  for (const f of files) {
    const src = path.join(PACKS.soundOgg, f);
    const dst = path.join(OUT.audioUi, f);
    if (isStale(dst, [src])) {
      fs.copyFileSync(src, dst);
      copied++;
    } else {
      skipped++;
    }
  }
  log(`audio: ${files.length} OGGs (${copied} copied, ${files.length - copied} up to date)`);
  return files.length;
}

// ---------------------------------------------------------------------------
// Stage: icons
// ---------------------------------------------------------------------------

function buildIcons() {
  ensureDir(OUT.icons);
  ensureDir(OUT.iconsCursor);
  let copied = 0;
  let count = 0;
  for (const [svgFile, name] of Object.entries(ICON_NAME_BY_SVG)) {
    const src = path.join(PACKS.iconNoBg, svgFile);
    const dst = path.join(OUT.icons, `${name}.svg`);
    count++;
    if (!fs.existsSync(src)) {
      failed.push({ name, outGlb: dst, error: `missing source icon ${src}` });
      continue;
    }
    if (isStale(dst, [src])) {
      fs.copyFileSync(src, dst);
      copied++;
    } else {
      skipped++;
    }
  }
  for (const [svgFile, name] of Object.entries(CURSOR_NAME_BY_SVG)) {
    const src = path.join(PACKS.iconCursor, svgFile);
    const dst = path.join(OUT.iconsCursor, `${name}.svg`);
    count++;
    if (!fs.existsSync(src)) {
      failed.push({ name, outGlb: dst, error: `missing source cursor icon ${src}` });
      continue;
    }
    if (isStale(dst, [src])) {
      fs.copyFileSync(src, dst);
      copied++;
    } else {
      skipped++;
    }
  }
  log(`icons: ${count} SVGs (${copied} copied, ${count - copied} up to date)`);
}

// ---------------------------------------------------------------------------
// Stage: fonts
// ---------------------------------------------------------------------------

async function buildFonts() {
  ensureDir(OUT.fonts);
  const jobs = [
    [PACKS.fontLilitaOne, path.join(OUT.fonts, 'LilitaOne.woff2')],
    [PACKS.fontYuyu, path.join(OUT.fonts, 'Yuyu.woff2')],
  ];
  for (const [src, dst] of jobs) {
    if (isStale(dst, selfSources(src))) {
      const bytes = await subsetToWoff2(src, dst);
      log(`  ok   ${path.relative(PUBLIC_ASSETS, dst)} (${(bytes / 1024).toFixed(1)} KB)`);
      converted++;
    } else {
      skipped++;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  ensureDir(PUBLIC_ASSETS);
  ensureDir(OUT.modelsDinos);
  ensureDir(OUT.modelsBuildings);
  ensureDir(OUT.modelsNature);
  ensureDir(OUT.modelsAnimals);

  log('== dinos (FBX, rigged+animated) ==');
  for (const name of DINOS) {
    buildFbxDirect(name, path.join(PACKS.dinosFbx, `${name}.fbx`), path.join(OUT.modelsDinos, `${name}.glb`), {
      animated: true,
      textureSize: 1024,
    });
  }

  log('== buildings (FBX, static) ==');
  for (const name of BUILDINGS) {
    buildFbxDirect(name, path.join(PACKS.buildingsFbx, `${name}.fbx`), path.join(OUT.modelsBuildings, `${name}.glb`), {
      animated: false,
      textureSize: 512,
    });
  }

  log('== nature props (FBX, static, textures re-attached) ==');
  for (const name of listNatureFbxNames()) {
    await buildFbxNature(name, path.join(PACKS.natureFbx, `${name}.fbx`), path.join(OUT.modelsNature, `${name}.glb`));
  }

  log('== animals (glTF, rigged+animated, compress-only) ==');
  for (const name of listAnimalNames()) {
    buildCompressOnly(name, path.join(PACKS.animalsGltf, `${name}.gltf`), path.join(OUT.modelsAnimals, `${name}.glb`), {
      animated: true,
      textureSize: 1024,
    });
  }

  log('== nature (glTF, static, compress-only) ==');
  for (const name of listNatureGltfNames()) {
    buildCompressOnly(name, path.join(PACKS.natureGltf, `${name}.gltf`), path.join(OUT.modelsNature, `${name}.glb`), {
      animated: false,
      textureSize: 512,
    });
  }

  log('== foliage alpha cutout ==');
  await fixFoliageAlpha();

  log('== audio ==');
  buildAudio();

  log('== icons ==');
  buildIcons();

  log('== fonts ==');
  await buildFonts();

  log('== manifest ==');
  const { manifest, missingBoot, missingDinos } = writeManifest();
  const totalBytes = Object.values(manifest.files).reduce((sum, f) => sum + f.bytes, 0);
  log(`manifest.json: ${Object.keys(manifest.files).length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MB total`);
  if (missingBoot.length) log(`  warn boot phase missing: ${missingBoot.join(', ')}`);
  if (missingDinos.length) log(`  warn dinos phase missing: ${missingDinos.join(', ')}`);

  log('');
  log(`done: ${converted} built, ${skipped} up to date, ${failed.length} failed`);
  if (failed.length) {
    for (const f of failed) log(`  FAIL ${f.name}: ${f.error}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
