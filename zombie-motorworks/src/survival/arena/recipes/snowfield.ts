import {
  NEUTRAL_ENVIRONMENT,
  type BiomeDefinition,
  type BiomeLayout,
} from '../../../core/biomes.ts';

interface SnowfieldLayout extends BiomeLayout {
  readonly roadX: number;
  readonly sideRoadZ: number;
  readonly roadHalfWidth: number;
}

const layout: SnowfieldLayout = {
  halfSize: 52.5,
  spawnPointCount: 20,
  terrainRoughness: 0.35,
  baseSurface: 'snow',
  roadSurface: 'hardpan',
  roadRule: 'cross',
  roadX: -6,
  sideRoadZ: 8,
  roadHalfWidth: 1.7,
  assetRoot: 'assets',
  groundAsset: 'graveyard/SM-0-Ground',
  patches: [{ surface: 'ice', count: [4, 7], radius: [5, 11] }],
  scatters: [
    {
      table: [
        {
          asset: 'nature/PineTree_3',
          weight: 1,
          scale: [0.9, 1.5],
          tint: {
            PineTree_Bark: 0x4a3b30,
            PineTree_Leaves: 0xdfeaf6,
          },
          collider: 'cylinder',
          colliderSize: [0.5, 3.2, 0.5],
        },
        {
          asset: 'nature/PineTree_5',
          weight: 1.4,
          scale: [0.9, 1.5],
          tint: {
            PineTree_Bark: 0x4a3b30,
            PineTree_Leaves: 0xdfeaf6,
          },
          collider: 'cylinder',
          colliderSize: [0.5, 3.2, 0.5],
        },
      ],
      count: [26, 40],
      minSpacing: 4,
      keepClearRadius: 12,
    },
    {
      table: [
        {
          asset: 'nature/Rock_1',
          weight: 1,
          scale: [0.7, 1.6],
          tint: { Rock: 0xc8d6e4 },
          collider: 'box',
          colliderSize: [0.7, 0.6, 0.7],
        },
        {
          asset: 'nature/Rock_2',
          weight: 1,
          scale: [0.7, 1.6],
          tint: { Rock: 0xc8d6e4 },
          collider: 'box',
          colliderSize: [0.7, 0.6, 0.7],
        },
      ],
      count: [14, 22],
      minSpacing: 3,
      keepClearRadius: 10,
    },
  ],
  perimeterProp: {
    asset: 'graveyard/SM-7-Fence',
    weight: 1,
    tint: 0x9fb3c6,
  },
};

export const SNOWFIELD: BiomeDefinition = {
  id: 'snowfield',
  name: 'Snowfield',
  blurb: 'Snow and ice make the car drift and reduce its top speed.',
  layout,
  look: {
    background: 0x0d1a2b,
    fogColor: 0x12263d,
    fogDensity: 0.016,
    hemiSky: 0x8fb4e8,
    hemiGround: 0x3d4c66,
    hemiIntensity: 1.35,
    keyColor: 0xcfe4ff,
    keyIntensity: 3.1,
    focusColor: 0xffd6a0,
    focusIntensity: 58,
    groundTint: 0xdce8f7,
    roadTint: 0x5a6a7a,
  },
  drive: {
    ...NEUTRAL_ENVIRONMENT,
    stabilityAssistMul: 0.45,
    topSpeedMul: 0.95,
  },
  hazard: {
    kind: 'blizzard',
    startWave: 3,
    fullWave: 9,
    maxFogDensity: 0.05,
    maxGripLoss: 0.25,
    maxDragMul: 1.15,
  },
};
