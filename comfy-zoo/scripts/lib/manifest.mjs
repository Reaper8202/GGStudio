// Builds public/assets/manifest.json per CONTRACTS.md's shape:
//   { "phases": { "boot": [...], "main": [...], "dinos": [...] },
//     "files": { "<relative/path>": { "bytes": N }, ... } }
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_ASSETS } from './paths.mjs';

// Fixed boot-phase asset list (task spec): the minimal starter-meadow bundle
// -- one animal, four buildings, a hand-picked nature subset, both fonts,
// and the three OGGs needed for the very first interaction (start button +
// menu confirm + positive feedback). Everything else streams in via "main".
const BOOT_MODELS = [
  'models/animals/Cow.glb',
  'models/buildings/SmallBarn.glb',
  'models/buildings/Fence.glb',
  'models/buildings/Fence2.glb',
  'models/buildings/Well.glb',
  'models/nature/BirchTree_1.glb',
  'models/nature/BirchTree_2.glb',
  'models/nature/MapleTree_1.glb',
  'models/nature/MapleTree_2.glb',
  'models/nature/Grass_Small.glb',
  'models/nature/Grass_Large.glb',
  'models/nature/Grass_Large_Extruded.glb',
  'models/nature/Bush.glb',
  'models/nature/Bush_Flowers.glb',
  'models/nature/Flower_1_Clump.glb',
  'models/nature/Flower_2_Clump.glb',
  'models/nature/Plant_1.glb',
  'models/nature/Rock_1.glb',
  'models/nature/Rock_2.glb',
];
const BOOT_FONTS = ['fonts/LilitaOne.woff2', 'fonts/Yuyu.woff2'];
const BOOT_AUDIO = [
  'audio/ui/UI SFX_EXTRA_Start Button.ogg',
  'audio/ui/UI SFX_MENU_Confirm.ogg',
  'audio/ui/UI SFX_FEEDBACK_Positive.ogg',
];

const DINO_NAMES = ['Apatosaurus', 'Parasaurolophus', 'Stegosaurus', 'Trex', 'Triceratops', 'Velociraptor'];

function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walk(abs, rel, out);
    } else if (entry.isFile() && entry.name !== 'manifest.json') {
      out.push(rel);
    }
  }
}

export function buildManifest() {
  const allFiles = [];
  walk(PUBLIC_ASSETS, '', allFiles);
  allFiles.sort();

  const existing = new Set(allFiles);
  const boot = [...BOOT_MODELS, ...BOOT_FONTS, ...BOOT_AUDIO].filter((p) => existing.has(p));
  const missingBoot = [...BOOT_MODELS, ...BOOT_FONTS, ...BOOT_AUDIO].filter((p) => !existing.has(p));

  const dinos = DINO_NAMES.map((n) => `models/dinos/${n}.glb`).filter((p) => existing.has(p));
  const missingDinos = DINO_NAMES.map((n) => `models/dinos/${n}.glb`).filter((p) => !existing.has(p));

  const bootSet = new Set(boot);
  const dinoSet = new Set(dinos);
  const main = allFiles.filter((p) => !bootSet.has(p) && !dinoSet.has(p));

  const files = {};
  for (const rel of allFiles) {
    files[rel] = { bytes: fs.statSync(path.join(PUBLIC_ASSETS, rel)).size };
  }

  const manifest = { phases: { boot, main, dinos }, files };
  return { manifest, missingBoot, missingDinos };
}

export function writeManifest() {
  const { manifest, missingBoot, missingDinos } = buildManifest();
  fs.writeFileSync(path.join(PUBLIC_ASSETS, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, missingBoot, missingDinos };
}
