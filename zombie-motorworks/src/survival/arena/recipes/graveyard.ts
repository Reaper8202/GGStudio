import {
  NEUTRAL_ENVIRONMENT,
  type BiomeDefinition,
  type BiomeLayout,
  type FixturePlacement,
} from '../../../core/biomes.ts';

const FIRE_FIXTURE_ASSET = '@arena/fire';
const GHOST_LIGHT_FIXTURE_ASSET = '@arena/ghost-light';
const LANTERN_FIXTURE_ASSET = '@arena/lantern';

const HALF_SIZE = 52.5;
const ROAD_X = -6;
const SIDE_ROAD_Z = 8;
const ROAD_HALF_WIDTH = 1.7;

function fenceRun(
  x: number,
  z: number,
  dx: number,
  dz: number,
  count: number,
  rotation: number,
): FixturePlacement[] {
  return Array.from({ length: count }, (_, index) => ({
    asset: 'SM-7-Fence',
    x: x + dx * index,
    z: z + dz * index,
    rotation,
    scale: 0.85,
  }));
}

// Wall colliders are built by ArenaBuilder from layout.halfSize for every
// biome, so they are no longer authored here. This list is now just the
// visible fence ring.
const perimeter: FixturePlacement[] = [];

const fenceEdge = HALF_SIZE - 0.55;
const fenceSpan = HALF_SIZE - 1.5;
for (let p = -fenceSpan; p <= fenceSpan; p += 2) {
  perimeter.push(
    { asset: 'SM-7-Fence', x: p, z: -fenceEdge, scale: 0.92 },
    {
      asset: 'SM-7-Fence',
      x: p,
      z: fenceEdge,
      scale: 0.92,
      rotation: Math.PI,
    },
    {
      asset: 'SM-7-Fence',
      x: -fenceEdge,
      z: p,
      scale: 0.92,
      rotation: Math.PI / 2,
    },
    {
      asset: 'SM-7-Fence',
      x: fenceEdge,
      z: p,
      scale: 0.92,
      rotation: -Math.PI / 2,
    },
  );
}

const gate: readonly FixturePlacement[] = [
  {
    asset: 'SM-8-Pillar',
    x: ROAD_X - 4.2,
    z: -30.5,
    rotation: Math.PI / 2,
    scale: 1.3,
    collider: 'box',
    colliderSize: [0.65, 1.6, 0.65],
  },
  {
    asset: 'SM-8-Pillar',
    x: ROAD_X + 4.2,
    z: -30.5,
    rotation: -Math.PI / 2,
    scale: 1.3,
    collider: 'box',
    colliderSize: [0.65, 1.6, 0.65],
  },
];

const burialPlot: readonly FixturePlacement[] = [
  ...fenceRun(-27.6, -28, 1.8, 0, 9, 0),
  ...fenceRun(-28.5, -26.2, 0, 1.8, 7, Math.PI / 2),
  ...fenceRun(-11.5, -26.2, 0, 1.8, 4, -Math.PI / 2),
  ...fenceRun(-27.6, -14.2, 1.8, 0, 3, Math.PI),
  ...fenceRun(-17.4, -14.2, 1.8, 0, 3, Math.PI),
  { asset: 'SM-8-Pillar', x: -23.1, z: -14.3, scale: 1.1 },
  {
    asset: 'SM-8-Pillar',
    x: -18.3,
    z: -14.3,
    scale: 1.1,
    rotation: Math.PI,
  },
  { asset: 'SM-3-Tomb1', x: -26.3, z: -25.6, rotation: 0.08 },
  { asset: 'SM-4-Tomb2', x: -23.8, z: -25.1, rotation: -0.1, scale: 0.9 },
  { asset: 'SM-5-Tomb3', x: -21.2, z: -25.7, rotation: 0.15, scale: 0.95 },
  { asset: 'SM-3-Tomb1', x: -18.4, z: -25.2, rotation: -0.06, scale: 0.88 },
  { asset: 'SM-4-Tomb2', x: -15.9, z: -25.8, rotation: 0.2 },
  { asset: 'SM-3-Tomb1', x: -13.6, z: -25.3, rotation: -0.14, scale: 0.94 },
  { asset: 'SM-5-Tomb3', x: -25.4, z: -21.9, rotation: -0.12, scale: 1.05 },
  { asset: 'SM-3-Tomb1', x: -22.6, z: -21.4, rotation: 0.1, scale: 0.92 },
  { asset: 'SM-4-Tomb2', x: -19.8, z: -22, rotation: 0.05, scale: 0.85 },
  { asset: 'SM-3-Tomb1', x: -16.8, z: -21.5, rotation: -0.18 },
  { asset: 'SM-5-Tomb3', x: -14.2, z: -22.1, rotation: 0.12, scale: 0.9 },
  { asset: 'SM-4-Tomb2', x: -26.6, z: -18.1, rotation: 0.16, scale: 0.95 },
  { asset: 'SM-3-Tomb1', x: -23.4, z: -17.6, rotation: -0.08, scale: 1.02 },
  { asset: 'SM-5-Tomb3', x: -20.4, z: -18.3, rotation: 0.06, scale: 0.88 },
  { asset: 'SM-4-Tomb2', x: -17.2, z: -17.7, rotation: -0.2, scale: 0.92 },
  { asset: 'SM-3-Tomb1', x: -14.6, z: -18.2, rotation: 0.1, scale: 0.9 },
  {
    asset: 'SM-6-Raven',
    x: -26.3,
    y: 1.95,
    z: -25.6,
    rotation: 0.6,
    scale: 0.72,
  },
];

const caretakerCorner: readonly FixturePlacement[] = [
  {
    asset: 'SM-11-Igor_wSpade',
    x: 17,
    z: -19.5,
    rotation: 2.4,
    scale: 0.95,
  },
  {
    asset: 'SM-10-Spade',
    x: 15.6,
    z: -17.8,
    rotation: 0.6,
    scale: 0.9,
  },
  { asset: 'SM-4-Tomb2', x: 14.8, z: -21.6, rotation: 0.35 },
  { asset: 'SM-4-Tomb2', x: 17.2, z: -22.8, rotation: -0.2, scale: 0.95 },
  { asset: 'SM-4-Tomb2', x: 19.6, z: -21.9, rotation: 0.15, scale: 1.05 },
  { asset: 'props/Bonefire.fbx', x: 19.8, z: -16.4, rotation: 0.9 },
  { asset: FIRE_FIXTURE_ASSET, x: 19.8, y: 0.9, z: -16.4 },
  { asset: 'props/Trash.fbx', x: 22.4, z: -17.8, rotation: 0.7, scale: 0.9 },
  {
    asset: 'props/AttachedBoxes.fbx',
    x: 23.6,
    z: -15.6,
    rotation: -0.4,
    scale: 0.9,
  },
  {
    asset: 'props/AmmoBox_5.fbx',
    x: 22.2,
    z: -14.4,
    rotation: 1.2,
    scale: 0.8,
  },
  { asset: 'SM-5-Tomb3', x: 27, z: -24, rotation: 0.1, scale: 1.15 },
  { asset: 'SM-3-Tomb1', x: 24, z: -27.5, rotation: -0.12, scale: 0.95 },
  {
    asset: 'SM-6-Raven',
    x: 24,
    y: 1.85,
    z: -27.5,
    rotation: -2.1,
    scale: 0.72,
  },
];

const ancientTree: readonly FixturePlacement[] = [
  {
    asset: 'SM-1-Tree',
    x: -21,
    z: 20,
    scale: 1.55,
    rotation: 0.9,
    collider: 'cylinder',
    colliderSize: [0.58 * 1.55, 2.1 * 1.55, 0],
  },
  {
    asset: 'SM-2-Ghost',
    x: -15.5,
    y: 1.7,
    z: 16.5,
    rotation: 0.5,
    scale: 1.3,
    emissive: 0x2f8f84,
    castShadow: false,
  },
  { asset: GHOST_LIGHT_FIXTURE_ASSET, x: -15.5, y: 3, z: 16.5 },
  { asset: 'SM-4-Tomb2', x: -27.5, z: 15, rotation: 0.4, scale: 0.95 },
  { asset: 'SM-5-Tomb3', x: -27, z: 23, rotation: 0.15 },
  { asset: 'SM-3-Tomb1', x: -25.5, z: 27, rotation: -0.3, scale: 1.05 },
  { asset: 'SM-5-Tomb3', x: -18, z: 27.5, rotation: 0.25, scale: 0.9 },
  { asset: 'SM-3-Tomb1', x: -13.5, z: 23.5, rotation: 2.9, scale: 0.85 },
  { asset: 'SM-4-Tomb2', x: -14, z: 13.5, rotation: -0.5, scale: 0.9 },
  {
    asset: 'SM-6-Raven',
    x: -19.8,
    y: 4.6,
    z: 21.2,
    rotation: -1.2,
    scale: 0.72,
  },
];

const checkpointAndMonument: readonly FixturePlacement[] = [
  { asset: 'props/Barricade_03.fbx', x: 4.6, z: 6.8, rotation: 0.35 },
  {
    asset: 'props/Barricade_03.fbx',
    x: 7.4,
    z: 4.4,
    rotation: 1.75,
    scale: 0.92,
  },
  { asset: 'props/BarbedWires.fbx', x: 5.2, z: 10.2, rotation: 0.2 },
  {
    asset: 'props/BarbedWires.fbx',
    x: 9.6,
    z: 5,
    rotation: 1.35,
    scale: 0.9,
  },
  { asset: 'props/Bonefire.fbx', x: 6.6, z: 7.8, rotation: -0.4 },
  {
    asset: 'props/AmmoBox_5.fbx',
    x: 7.8,
    z: 9,
    rotation: 2.2,
    scale: 0.75,
  },
  { asset: 'props/Trash.fbx', x: 10.4, z: 7.6, rotation: -0.8, scale: 0.9 },
  { asset: FIRE_FIXTURE_ASSET, x: 6.6, y: 0.9, z: 7.8 },
  ...[0.3, 1.55, 2.8, 4.05].map((angle) => ({
    asset: 'SM-8-Pillar',
    x: 25 + Math.cos(angle) * 3.4,
    z: 23 + Math.sin(angle) * 3.4,
    rotation: angle + Math.PI,
    scale: 1.45,
  })),
  { asset: 'SM-5-Tomb3', x: 25, z: 23, rotation: 0.65, scale: 1.4 },
  { asset: 'SM-3-Tomb1', x: 15.5, z: 27, rotation: 0.2, scale: 0.9 },
  { asset: 'SM-4-Tomb2', x: 18.5, z: 14.5, rotation: -0.35, scale: 0.95 },
  { asset: 'SM-5-Tomb3', x: 29.5, z: 13.5, rotation: 0.1, scale: 0.85 },
];

const strays: readonly FixturePlacement[] = [
  { asset: 'SM-4-Tomb2', x: -2.9, z: -26.5, rotation: 1.3, scale: 0.8 },
  { asset: 'SM-3-Tomb1', x: -3.2, z: -22, rotation: -0.4, scale: 0.9 },
  { asset: 'props/Trash.fbx', x: -9.9, z: -12, rotation: 2.6, scale: 0.7 },
  { asset: 'SM-5-Tomb3', x: -3.6, z: -8.5, rotation: 0.9, scale: 0.75 },
  { asset: 'SM-4-Tomb2', x: -2.6, z: 20.8, rotation: -1.1 },
  {
    asset: 'props/BarbedWires.fbx',
    x: -2.5,
    z: 29.3,
    rotation: 1.5,
    scale: 0.8,
  },
  {
    asset: 'props/AmmoBox_5.fbx',
    x: -9.5,
    z: -2.7,
    rotation: 0.9,
    scale: 0.7,
  },
  { asset: 'props/Trash.fbx', x: 21.5, z: 5.1, rotation: -1.9, scale: 0.8 },
  { asset: 'SM-3-Tomb1', x: 27.5, z: 11.1, rotation: 1.1, scale: 0.95 },
  { asset: 'SM-4-Tomb2', x: -9.8, z: 4.9, rotation: 1.7, scale: 0.7 },
  { asset: 'SM-3-Tomb1', x: -3.4, z: 11.9, rotation: -1.3, scale: 0.7 },
  { asset: 'SM-3-Tomb1', x: -26, z: -3, rotation: 1.8, scale: 0.8 },
  { asset: 'SM-4-Tomb2', x: -19.5, z: 2.7, rotation: 0.3, scale: 0.9 },
  { asset: 'SM-5-Tomb3', x: 12.5, z: 2.9, rotation: -0.7, scale: 0.9 },
  { asset: 'SM-3-Tomb1', x: 3, z: 19.5, rotation: 0.5, scale: 0.85 },
  { asset: 'SM-3-Tomb1', x: 5, z: -5.2, rotation: -1.3, scale: 0.7 },
  { asset: 'SM-4-Tomb2', x: -9.6, z: -17, rotation: 0.7, scale: 0.85 },
  { asset: 'SM-3-Tomb1', x: -10.2, z: -26.5, y: -0.2, rotation: -0.25 },
  { asset: 'SM-5-Tomb3', x: 9, z: -27, rotation: 0.4, scale: 0.8 },
  { asset: 'SM-4-Tomb2', x: 10.5, z: -13, rotation: -0.6, scale: 0.9 },
  {
    asset: 'SM-3-Tomb1',
    x: 12,
    z: 21.5,
    y: -0.3,
    rotation: 2.2,
    scale: 0.8,
  },
  { asset: 'SM-4-Tomb2', x: 26, z: 29, rotation: 0.9, scale: 0.85 },
  { asset: 'SM-5-Tomb3', x: -8.5, z: 20, rotation: -1.4, scale: 0.95 },
  { asset: 'SM-3-Tomb1', x: -10, z: 29, rotation: 0.15, scale: 0.9 },
  { asset: 'props/Trash.fbx', x: 28.5, z: -8, rotation: 0.5, scale: 0.85 },
  {
    asset: 'props/AttachedBoxes.fbx',
    x: -30.5,
    z: 6.5,
    rotation: 1.9,
    scale: 0.7,
  },
  { asset: 'SM-5-Tomb3', x: -31, z: -8, rotation: 2, scale: 0.9 },
  { asset: 'SM-4-Tomb2', x: 30, z: -19, rotation: -0.9, scale: 0.8 },
  {
    asset: 'SM-6-Raven',
    x: 27.5,
    y: 1.85,
    z: 11.1,
    rotation: 2.6,
    scale: 0.72,
  },
];

const roadSigns: readonly FixturePlacement[] = [
  { asset: 'RoadSign-66', x: -2.8, z: 5.4, rotation: Math.PI / 2, scale: 1.8 },
  { asset: 'RoadSign-66', x: -3.4, z: -27.6, rotation: 0, scale: 1.8 },
  { asset: 'RoadSign-66', x: -8.6, z: 30.2, rotation: 0, scale: 1.8 },
  { asset: 'RoadSign-66', x: 31, z: 10.6, rotation: Math.PI / 2, scale: 1.8 },
];

const lanterns: readonly FixturePlacement[] = [
  { asset: LANTERN_FIXTURE_ASSET, x: -20.7, z: -12.6 },
  { asset: LANTERN_FIXTURE_ASSET, x: -3.3, z: -24 },
  { asset: LANTERN_FIXTURE_ASSET, x: -8.7, z: -12 },
  { asset: LANTERN_FIXTURE_ASSET, x: -3.3, z: 0 },
  { asset: LANTERN_FIXTURE_ASSET, x: -8.7, z: 12 },
  { asset: LANTERN_FIXTURE_ASSET, x: -3.3, z: 24 },
  { asset: LANTERN_FIXTURE_ASSET, x: 2, z: 5.3 },
  { asset: LANTERN_FIXTURE_ASSET, x: 14, z: 10.7 },
  { asset: LANTERN_FIXTURE_ASSET, x: 26, z: 5.3 },
];

const fixtures: readonly FixturePlacement[] = [
  ...perimeter,
  ...gate,
  ...burialPlot,
  ...caretakerCorner,
  ...ancientTree,
  ...checkpointAndMonument,
  ...strays,
  ...roadSigns,
  ...lanterns,
];

interface GraveyardLayout extends BiomeLayout {
  readonly roadX: number;
  readonly sideRoadZ: number;
  readonly roadHalfWidth: number;
}

const layout: GraveyardLayout = {
  halfSize: HALF_SIZE,
  baseSurface: 'asphalt',
  roadSurface: 'asphalt',
  roadRule: 'cross',
  roadX: ROAD_X,
  sideRoadZ: SIDE_ROAD_Z,
  roadHalfWidth: ROAD_HALF_WIDTH,
  patches: [],
  assetRoot: `${import.meta.env.BASE_URL}assets/graveyard`,
  groundAsset: 'SM-0-Ground',
  scatters: [],
  terrainRoughness: 1,
  spawnPointCount: 20,
  fixtures,
};

export const GRAVEYARD: BiomeDefinition = {
  id: 'graveyard',
  name: 'Graveyard',
  blurb: 'Build the last ride out of the graveyard.',
  layout,
  look: {
    background: 0x080b14,
    fogColor: 0x080b14,
    fogDensity: 0.012,
    hemiSky: 0x6c84b5,
    hemiGround: 0x2d243e,
    hemiIntensity: 1.08,
    keyColor: 0x9cbcff,
    keyIntensity: 2.75,
    focusColor: 0xffd6a0,
    focusIntensity: 58,
    groundTint: 0x1f3029,
    roadTint: 0x4a5a4e,
  },
  drive: NEUTRAL_ENVIRONMENT,
  hazard: {
    kind: 'none',
    startWave: 1,
    fullWave: 1,
    maxFogDensity: 0,
    maxGripLoss: 0,
    maxDragMul: 1,
  },
};
