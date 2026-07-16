#!/usr/bin/env node
// Opens every shipped .glb with @gltf-transform/core NodeIO (meshopt decoder
// registered) and asserts:
//   - it has >= 1 mesh
//   - every animal/dino model has >= 1 animation clip
// Prints a table (file -> KB -> #clips -> clip names) and totals.
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_ASSETS, OUT } from './lib/paths.mjs';
import { getIO } from './lib/gltf-io.mjs';

function listGlb(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.glb')).sort();
}

async function main() {
  const io = await getIO();

  const categories = [
    { dir: OUT.modelsAnimals, requireAnim: true },
    { dir: OUT.modelsDinos, requireAnim: true },
    { dir: OUT.modelsBuildings, requireAnim: false },
    { dir: OUT.modelsNature, requireAnim: false },
  ];

  const rows = [];
  const errors = [];
  let grandTotal = 0;

  for (const { dir, requireAnim } of categories) {
    for (const file of listGlb(dir)) {
      const full = path.join(dir, file);
      const bytes = fs.statSync(full).size;
      grandTotal += bytes;

      let document;
      try {
        document = await io.read(full);
      } catch (err) {
        errors.push(`${path.relative(PUBLIC_ASSETS, full)}: failed to open (${err.message || err})`);
        continue;
      }

      const meshes = document.getRoot().listMeshes();
      const animations = document.getRoot().listAnimations();
      const clipNames = animations.map((a) => a.getName() || '(unnamed)');

      if (meshes.length === 0) {
        errors.push(`${path.relative(PUBLIC_ASSETS, full)}: has 0 meshes`);
      }
      if (requireAnim && animations.length === 0) {
        errors.push(`${path.relative(PUBLIC_ASSETS, full)}: has 0 animation clips (required)`);
      }

      rows.push({
        file: path.relative(PUBLIC_ASSETS, full),
        kb: (bytes / 1024).toFixed(1),
        meshes: meshes.length,
        clips: animations.length,
        clipNames: clipNames.join(', '),
      });
    }
  }

  // Non-model assets, counted toward the total but not individually validated.
  for (const sub of ['audio', 'icons', 'fonts']) {
    const dir = path.join(PUBLIC_ASSETS, sub);
    if (!fs.existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else grandTotal += fs.statSync(full).size;
      }
    }
  }

  const manifestPath = path.join(PUBLIC_ASSETS, 'manifest.json');
  if (fs.existsSync(manifestPath)) grandTotal += fs.statSync(manifestPath).size;

  // --- print table ---
  const headers = ['file', 'KB', 'meshes', 'clips', 'clip names'];
  const widths = [
    Math.max(headers[0].length, ...rows.map((r) => r.file.length)),
    Math.max(headers[1].length, ...rows.map((r) => r.kb.length)),
    Math.max(headers[2].length, ...rows.map((r) => String(r.meshes).length)),
    Math.max(headers[3].length, ...rows.map((r) => String(r.clips).length)),
  ];
  const pad = (s, w) => String(s).padEnd(w);
  console.log(
    `${pad(headers[0], widths[0])}  ${pad(headers[1], widths[1])}  ${pad(headers[2], widths[2])}  ${pad(headers[3], widths[3])}  ${headers[4]}`
  );
  for (const r of rows) {
    console.log(
      `${pad(r.file, widths[0])}  ${pad(r.kb, widths[1])}  ${pad(r.meshes, widths[2])}  ${pad(r.clips, widths[3])}  ${r.clipNames}`
    );
  }

  console.log('');
  console.log(`validated ${rows.length} model files`);
  console.log(`grand total (public/assets): ${(grandTotal / 1024 / 1024).toFixed(2)} MB`);

  if (errors.length) {
    console.log('');
    console.log(`FAILED (${errors.length}):`);
    for (const e of errors) console.log(`  - ${e}`);
    process.exitCode = 1;
  } else {
    console.log('');
    console.log('OK: all models have >=1 mesh; all animals/dinos have >=1 animation clip.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
