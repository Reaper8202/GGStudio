/** Per-surface friction parameters. Extensible (snow, ice, metal...). */

export type SurfaceKind = 'asphalt' | 'dirt' | 'mud' | 'rubble';

export interface SurfaceParams {
  muLong: number;
  muLat: number;
  rollingResistance: number;
}

export const SURFACES: Record<SurfaceKind, SurfaceParams> = {
  asphalt: { muLong: 1.0, muLat: 1.0, rollingResistance: 0.015 },
  dirt: { muLong: 0.72, muLat: 0.68, rollingResistance: 0.035 },
  mud: { muLong: 0.4, muLat: 0.35, rollingResistance: 0.09 },
  rubble: { muLong: 0.6, muLat: 0.55, rollingResistance: 0.06 },
};
