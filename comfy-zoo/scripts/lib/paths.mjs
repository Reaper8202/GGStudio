// Central path constants for the asset pipeline.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const SCRIPTS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ROOT = path.dirname(SCRIPTS_DIR);
export const PUBLIC_ASSETS = path.join(ROOT, 'public', 'assets');
export const CACHE_DIR = path.join(SCRIPTS_DIR, '.cache');

// The source asset packs live in a sibling directory to the project root:
//   .../GGStudio/comfy-zoo   (this project, ROOT)
//   .../GGStudio/Shared      (source packs)
export const SHARED = path.join(path.dirname(ROOT), 'Shared');

export const PACKS = {
  dinosFbx: path.join(SHARED, 'Dinosaur Animated Pack - Dec 2018', 'FBX'),
  buildingsFbx: path.join(SHARED, 'Farm Buildings - Sept 2018', 'FBX'),
  natureFbx: path.join(SHARED, 'Ultimate Stylized Nature - May 2022', 'FBX'),
  natureGltf: path.join(SHARED, 'Ultimate Stylized Nature - May 2022', 'glTF'),
  natureTextures: path.join(SHARED, 'Ultimate Stylized Nature - May 2022', 'Textures'),
  animalsGltf: path.join(SHARED, 'Ultimate Animated Animals - July 2021', 'glTF'),
  soundOgg: path.join(SHARED, 'Sound', 'OGG'),
  iconNoBg: path.join(SHARED, 'Icon', 'SVG', 'No Background'),
  iconCursor: path.join(SHARED, 'Icon', 'SVG', 'CursorIcons'),
  fontLilitaOne: path.join(SHARED, 'Fonts', 'Lillita_One', 'LilitaOne-Regular.ttf'),
  fontYuyu: path.join(SHARED, 'Fonts', 'Yuyu', 'Yuyu-Regular.ttf'),
};

export const OUT = {
  modelsDinos: path.join(PUBLIC_ASSETS, 'models', 'dinos'),
  modelsBuildings: path.join(PUBLIC_ASSETS, 'models', 'buildings'),
  modelsNature: path.join(PUBLIC_ASSETS, 'models', 'nature'),
  modelsAnimals: path.join(PUBLIC_ASSETS, 'models', 'animals'),
  audioUi: path.join(PUBLIC_ASSETS, 'audio', 'ui'),
  icons: path.join(PUBLIC_ASSETS, 'icons'),
  iconsCursor: path.join(PUBLIC_ASSETS, 'icons', 'cursor'),
  fonts: path.join(PUBLIC_ASSETS, 'fonts'),
};
