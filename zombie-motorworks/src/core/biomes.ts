import type { SurfaceKind } from './surfaces.ts';

export type BiomeId = 'graveyard' | 'snowfield' | 'desert';

/**
 * Multipliers a biome applies on top of the per-surface tire model. Every field
 * is 1 in NEUTRAL_ENVIRONMENT, so an absent biome changes nothing.
 */
export interface EnvironmentModifiers {
  gripLongMul: number;
  gripLatMul: number;
  rollingResistanceMul: number;
  dragMul: number;
  engineOutputMul: number;
  fuelBurnMul: number;
  /** Scales the anti-sideslip assist. Below 1 lets the vehicle actually slide. */
  stabilityAssistMul: number;
  topSpeedMul: number;
}

export const NEUTRAL_ENVIRONMENT: EnvironmentModifiers = {
  gripLongMul: 1,
  gripLatMul: 1,
  rollingResistanceMul: 1,
  dragMul: 1,
  engineOutputMul: 1,
  fuelBurnMul: 1,
  stabilityAssistMul: 1,
  topSpeedMul: 1,
};

/** Component-wise multiply, used to fold a hazard into a biome's base modifiers. */
export function combineEnvironments(
  a: EnvironmentModifiers,
  b: EnvironmentModifiers,
): EnvironmentModifiers {
  return {
    gripLongMul: a.gripLongMul * b.gripLongMul,
    gripLatMul: a.gripLatMul * b.gripLatMul,
    rollingResistanceMul:
      a.rollingResistanceMul * b.rollingResistanceMul,
    dragMul: a.dragMul * b.dragMul,
    engineOutputMul: a.engineOutputMul * b.engineOutputMul,
    fuelBurnMul: a.fuelBurnMul * b.fuelBurnMul,
    stabilityAssistMul: a.stabilityAssistMul * b.stabilityAssistMul,
    topSpeedMul: a.topSpeedMul * b.topSpeedMul,
  };
}

export interface PropEntry {
  /** Path relative to the recipe's assetRoot, e.g. 'SM-3-Tomb1' or 'props/Trash.fbx'. */
  asset: string;
  weight: number;
  scale?: readonly [number, number];
  scaleY?: readonly [number, number];
  collider?: 'none' | 'box' | 'cylinder';
  /** Half-extents for 'box', or [radius, height] for 'cylinder'. */
  colliderSize?: readonly [number, number, number];
  tint?: number;
}

export interface PropScatter {
  table: readonly PropEntry[];
  /** Inclusive [min, max] instance count for this scatter pass. */
  count: readonly [number, number];
  minSpacing: number;
  /** Radius around the world origin kept clear so the player spawns safe. */
  keepClearRadius: number;
}

export interface SurfacePatchSpec {
  surface: SurfaceKind;
  count: readonly [number, number];
  radius: readonly [number, number];
}

export interface BiomeLayout {
  halfSize: number;
  baseSurface: SurfaceKind;
  roadSurface: SurfaceKind;
  roadRule: 'cross' | 'loop' | 'none';
  patches: readonly SurfacePatchSpec[];
  assetRoot: string;
  groundAsset: string;
  scatters: readonly PropScatter[];
  perimeterProp?: PropEntry;
  /** 0 = dead flat cosmetic ground, 1 = maximum per-tile height jitter. */
  terrainRoughness: number;
  spawnPointCount: number;
}

export interface BiomeLook {
  background: number;
  fogColor: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  keyColor: number;
  keyIntensity: number;
  focusColor: number;
  focusIntensity: number;
  groundTint: number;
  roadTint: number;
}

export interface BiomeHazardSpec {
  kind: 'none' | 'blizzard' | 'sandstorm';
  /** Hazard intensity is 0 at or below this wave. */
  startWave: number;
  /** Hazard intensity reaches 1 at this wave and is clamped after. */
  fullWave: number;
  maxFogDensity: number;
  /** Fraction of grip removed at full intensity, 0..1. */
  maxGripLoss: number;
  maxDragMul: number;
}

export interface BiomeDefinition {
  id: BiomeId;
  name: string;
  blurb: string;
  layout: BiomeLayout;
  look: BiomeLook;
  drive: EnvironmentModifiers;
  hazard: BiomeHazardSpec;
}

/** 0 at and below startWave, 1 at and above fullWave, smooth in between. */
export function hazardIntensity(spec: BiomeHazardSpec, wave: number): number {
  if (spec.fullWave <= spec.startWave) {
    return wave < spec.startWave ? 0 : 1;
  }
  if (wave <= spec.startWave) return 0;
  if (wave >= spec.fullWave) return 1;

  const t = (wave - spec.startWave) / (spec.fullWave - spec.startWave);
  return t * t * (3 - 2 * t);
}

/** The environment multipliers a hazard contributes at a given intensity. */
export function hazardEnvironment(
  spec: BiomeHazardSpec,
  intensity: number,
): EnvironmentModifiers {
  if (spec.kind === 'none') return NEUTRAL_ENVIRONMENT;

  const t = Math.min(1, Math.max(0, intensity));
  const gripMul = 1 - spec.maxGripLoss * t;
  return {
    ...NEUTRAL_ENVIRONMENT,
    gripLongMul: gripMul,
    gripLatMul: gripMul,
    dragMul: 1 + (spec.maxDragMul - 1) * t,
  };
}
