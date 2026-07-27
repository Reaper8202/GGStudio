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

/** A single colour applied to every material, or per-material-name overrides. */
export type Tint = number | Readonly<Record<string, number>>;

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
  tint?: Tint;
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

/** One deliberately authored placement. Copied through generation untouched. */
export interface FixturePlacement {
  asset: string;
  x: number;
  z: number;
  y?: number;
  rotation?: number;
  scale?: number;
  scaleY?: number;
  castShadow?: boolean;
  tint?: Tint;
  emissive?: number;
  collider?: 'none' | 'box' | 'cylinder';
  /** Half-extents for 'box', [radius, height] for 'cylinder'. */
  colliderSize?: readonly [number, number, number];
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
  /**
   * Drop the ground tile's texture and show `look.groundTint` as a flat
   * colour. The shared ground mesh ships the graveyard's dark dirt texture,
   * and a tint multiplies against it, so tinting alone can only ever darken —
   * snow can never be made white. Biomes that recolour the ground set this.
   */
  groundUntextured?: boolean;
  /** 0 = dead flat cosmetic ground, 1 = maximum per-tile height jitter. */
  terrainRoughness: number;
  spawnPointCount: number;
  fixtures?: readonly FixturePlacement[];
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
  // A biome with no hazard is never intense, whatever its wave range says.
  // Recipes without weather leave startWave/fullWave at a degenerate 1/1, which
  // would otherwise read as fully ramped from wave one and light up any caller
  // that drives fog or particles from intensity alone.
  if (spec.kind === 'none') return 0;
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
