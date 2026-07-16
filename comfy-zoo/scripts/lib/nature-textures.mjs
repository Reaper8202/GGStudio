// FBX2glTF drops texture links entirely (the source FBX files for the
// "Ultimate Stylized Nature" pack reference materials by name only, with no
// embedded/relative texture paths -- verified by scanning the FBX binaries).
// The pack's own glTF export uses a fixed convention instead: a material
// named "<X>" gets its base color from "<X>.png"/".jpg" in the pack's
// Textures/ folder, plus "<X>_Normal.png" as a normal map when present
// (e.g. BirchTree_Bark -> BirchTree_Bark.jpg + BirchTree_Bark_Normal.png).
// This module re-applies that same convention to the FBX-converted trees/
// rock/plant/petals so they end up textured identically to their glTF
// siblings (Birch/Maple/DeadTree/Bush/Grass/Flower) that already ship with
// textures wired up in the source files.
import fs from 'node:fs';
import path from 'node:path';

// One name in the pack breaks the "<material>.png" convention: the "Rock"
// material's texture file is plural ("Rocks.png"). Verified against
// OBJ/Rock_1.mtl (material `Rock`) and Textures/Rocks.png being the only
// rock-related image in the pack.
const TEXTURE_NAME_OVERRIDES = {
  Rock: 'Rocks',
};

// Foliage/petal materials use alpha-blended cutout textures in the source
// pack (BirchTree_Leaves, MapleTree_Leaves, Bush_Flowers, Flower_*, etc. are
// all alphaMode BLEND in the shipped glTF files); everything else (bark,
// trunk, rock) is opaque.
function isFoliageMaterial(name) {
  return /leaves|flowers?|petals?/i.test(name);
}

function findTextureFile(texturesDir, materialName) {
  const base = TEXTURE_NAME_OVERRIDES[materialName] ?? materialName;
  for (const ext of ['.png', '.jpg', '.jpeg']) {
    const p = path.join(texturesDir, base + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findNormalFile(texturesDir, materialName) {
  const base = TEXTURE_NAME_OVERRIDES[materialName] ?? materialName;
  const p = path.join(texturesDir, `${base}_Normal.png`);
  return fs.existsSync(p) ? p : null;
}

const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/**
 * Mutates `document` (a @gltf-transform/core Document) in place: for every
 * material with no base color texture, looks up a same-named file in
 * `texturesDir` and wires it up (plus normal map + alpha-blend flag for
 * foliage). Returns the list of material names that were textured, for
 * logging/debugging.
 */
export function attachNatureTextures(document, texturesDir) {
  const touched = [];
  for (const material of document.getRoot().listMaterials()) {
    if (material.getBaseColorTexture()) continue; // already textured (shouldn't happen for FBX imports)
    const name = material.getName();
    const colorFile = findTextureFile(texturesDir, name);
    if (!colorFile) continue;

    const colorExt = path.extname(colorFile).toLowerCase();
    const colorTex = document
      .createTexture(name)
      .setImage(fs.readFileSync(colorFile))
      .setMimeType(MIME_BY_EXT[colorExt]);
    material.setBaseColorTexture(colorTex);

    const normalFile = findNormalFile(texturesDir, name);
    if (normalFile) {
      const normalTex = document
        .createTexture(`${name}_Normal`)
        .setImage(fs.readFileSync(normalFile))
        .setMimeType('image/png');
      material.setNormalTexture(normalTex);
    }

    material.setDoubleSided(true);
    if (isFoliageMaterial(name)) {
      material.setAlphaMode('BLEND');
    }

    touched.push(name);
  }
  return touched;
}
