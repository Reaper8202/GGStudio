import type { BiomeDefinition, BiomeId } from '../../../core/biomes.ts';
import { DESERT } from './desert.ts';
import { GRAVEYARD } from './graveyard.ts';
import { SNOWFIELD } from './snowfield.ts';

export const BIOMES: Record<BiomeId, BiomeDefinition> = {
  graveyard: GRAVEYARD,
  snowfield: SNOWFIELD,
  desert: DESERT,
};

export const DEFAULT_BIOME_ID: BiomeId = 'graveyard';

export function getBiome(id: BiomeId): BiomeDefinition {
  return BIOMES[id] ?? GRAVEYARD;
}
