import {
  NEUTRAL_ENVIRONMENT,
  type BiomeDefinition,
  type BiomeLayout,
} from '../../../core/biomes.ts';

interface DesertLayout extends BiomeLayout {
  readonly roadX: number;
  readonly sideRoadZ: number;
  readonly roadHalfWidth: number;
}

const layout: DesertLayout = {
  halfSize: 52.5,
  spawnPointCount: 20,
  groundUntextured: true,
  terrainRoughness: 0.5,
  baseSurface: 'sand',
  roadSurface: 'hardpan',
  roadRule: 'cross',
  roadX: -6,
  sideRoadZ: 8,
  roadHalfWidth: 1.7,
  assetRoot: 'assets',
  groundAsset: 'graveyard/SM-0-Ground',
  patches: [{ surface: 'hardpan', count: [5, 9], radius: [6, 14] }],
  scatters: [
    {
      table: [
        {
          asset: 'nature/PalmTree_2',
          weight: 1,
          scale: [0.9, 1.4],
          tint: {
            PalmTree_Trunk: 0x8a6f4a,
            PalmTree_Leaves: 0x6f8f45,
          },
          collider: 'cylinder',
          colliderSize: [0.35, 3.4, 0.35],
        },
        {
          asset: 'nature/PalmTree_3',
          weight: 1,
          scale: [0.9, 1.4],
          tint: {
            PalmTree_Trunk: 0x8a6f4a,
            PalmTree_Leaves: 0x6f8f45,
          },
          collider: 'cylinder',
          colliderSize: [0.35, 3.4, 0.35],
        },
        {
          asset: 'nature/PalmTree_5',
          weight: 1,
          scale: [0.9, 1.4],
          tint: {
            PalmTree_Trunk: 0x8a6f4a,
            PalmTree_Leaves: 0x6f8f45,
          },
          collider: 'cylinder',
          colliderSize: [0.35, 3.4, 0.35],
        },
      ],
      count: [12, 20],
      minSpacing: 5,
      keepClearRadius: 12,
    },
    {
      table: [
        {
          asset: 'nature/Rock_1',
          weight: 1,
          scale: [0.6, 1.8],
          tint: { Rock: 0xb9975f },
          collider: 'box',
          colliderSize: [0.7, 0.6, 0.7],
        },
        {
          asset: 'nature/Rock_2',
          weight: 1,
          scale: [0.6, 1.8],
          tint: { Rock: 0xb9975f },
          collider: 'box',
          colliderSize: [0.7, 0.6, 0.7],
        },
        {
          asset: 'nature/Rock_4',
          weight: 1,
          scale: [0.6, 1.8],
          tint: { Rock: 0xb9975f },
          collider: 'box',
          colliderSize: [0.7, 0.6, 0.7],
        },
      ],
      count: [22, 34],
      minSpacing: 3,
      keepClearRadius: 10,
    },
  ],
  perimeterProp: {
    asset: 'graveyard/SM-8-Pillar',
    weight: 1,
    tint: 0xa88b60,
  },
};

export const DESERT: BiomeDefinition = {
  id: 'desert',
  name: 'Desert',
  blurb: 'Deep sand slows heavy cars while the heat cuts power and burns fuel.',
  layout,
  look: {
    background: 0x140f18,
    fogColor: 0x241a20,
    fogDensity: 0.01,
    hemiSky: 0x9a86b5,
    hemiGround: 0x4a3a2a,
    hemiIntensity: 1.15,
    keyColor: 0xffd9a8,
    keyIntensity: 2.6,
    focusColor: 0xffd6a0,
    focusIntensity: 58,
    groundTint: 0xc4a575,
    roadTint: 0x7d6a52,
  },
  drive: {
    ...NEUTRAL_ENVIRONMENT,
    engineOutputMul: 0.9,
    fuelBurnMul: 1.3,
    stabilityAssistMul: 0.85,
    topSpeedMul: 0.92,
  },
  hazard: {
    kind: 'sandstorm',
    startWave: 3,
    fullWave: 10,
    maxFogDensity: 0.035,
    maxGripLoss: 0.15,
    maxDragMul: 1.6,
  },
};
