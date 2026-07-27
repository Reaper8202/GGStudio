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
  groundUntextured: true,
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
            PineTree_Leaves: 0x9fc0c4,
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
            PineTree_Leaves: 0x9fc0c4,
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
          tint: { Rock: 0xdce9f5 },
          collider: 'box',
          colliderSize: [0.7, 0.6, 0.7],
        },
        {
          asset: 'nature/Rock_2',
          weight: 1,
          scale: [0.7, 1.6],
          tint: { Rock: 0xdce9f5 },
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
    // Still a moonlit night, but snow has roughly 0.8 albedo: it is the
    // brightest surface in the game and bounces light back up. Lit at the
    // graveyard's levels it reads as dark slate rather than snow, so the
    // ambient fill and the sky half of the hemisphere are pushed well up and
    // the horizon fog is lifted to a snowy haze instead of near-black.
    background: 0x243d55,
    fogColor: 0x2c4a66,
    fogDensity: 0.014,
    hemiSky: 0xcfe4ff,
    hemiGround: 0x6d8199,
    hemiIntensity: 2.9,
    keyColor: 0xe4f0ff,
    keyIntensity: 3.6,
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
