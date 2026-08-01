/**
 * Scaling for the signature attack a Build's block carries.
 *
 * Two shapes share this file. The Pyre Core and the Fallout Silo are blasts:
 * the player picks a spot and everything near it takes damage falling off to
 * the rim. The Storm Rod is a chain that fires itself — it picks the body
 * nearest the cursor and arcs from it to its neighbours — so `radiusM` there
 * means "how far from the cursor to look for the first body", not an area.
 *
 * All three are deliberately front-loaded and none of them scale with anything
 * the player picks up, so as the horde thickens through waves 4 and 5 an
 * un-upgraded signature stops carrying a fight on its own and becomes a
 * supplement to the guns rather than a replacement for them. Every level bought
 * pulls it back on three axes at once: more damage, more reach around the
 * impact, and a shorter wait.
 *
 * Pure data and arithmetic; no engine or DOM imports (see AGENTS.md).
 */

import type { SignatureDefinition } from './types.ts';

/** Resolved signature stats after applying the placed block's upgrade level. */
export interface SignatureStats {
  /** Damage at the centre of the blast, falling off linearly to the rim. */
  damage: number;
  /** Blast radius in metres. */
  radiusM: number;
  /** Seconds between shots. */
  cooldownSeconds: number;
  /** Metres from the rig the strike may be placed. */
  rangeM: number;
  /** Metres per second the payload travels; 0 lands it immediately. */
  travelSpeedMps: number;
  /** Fixed seconds between firing and detonation, on top of travel time. */
  delaySeconds: number;
  /** Seconds of burn left on caught zombies; 0 for none. */
  burnSeconds: number;
  /** Seconds of shock left on caught zombies; 0 for none. */
  shockSeconds: number;
  /** True when the weapon fires itself off cooldown, without a click. */
  autoFire: boolean;
  /** Bodies one shot hits, the first plus its jumps; 1 for a plain blast. */
  chainTargets: number;
  /** How far the arc may jump body-to-body, metres; 0 for a plain blast. */
  chainRangeM: number;
  /** Share of the damage carried into each jump. */
  chainFalloff: number;
}

/** Share of base damage added per upgrade level beyond the first. */
const DAMAGE_PER_LEVEL = 0.25;
/** Share of the base radius added per upgrade level beyond the first. */
const RADIUS_PER_LEVEL = 0.08;
/**
 * Cooldown removed per upgrade level beyond the first, as a share of the base.
 * Five levels take a signature to 60% of its starting wait, which is enough to
 * be felt without letting the endgame become one button.
 */
const COOLDOWN_PER_LEVEL = 0.08;
/**
 * The nuke's fall time is what the player pays for its blast, so it shortens
 * far more slowly than the cooldown does — a strike that landed instantly would
 * stop being a weapon you have to lead the horde with.
 */
const DELAY_PER_LEVEL = 0.04;

/** Upgrade levels past the first, floored at 0 so level 0 reads as level 1. */
function upgradeSteps(level: number): number {
  return Math.max(0, Math.floor(level) - 1);
}

/**
 * Resolve a signature at a placed block's upgrade level. Level 1 returns the
 * catalog numbers unchanged; every level after that adds
 * {@link DAMAGE_PER_LEVEL} of damage and {@link RADIUS_PER_LEVEL} of radius
 * while taking {@link COOLDOWN_PER_LEVEL} off the wait. Reach, travel speed and
 * the status durations are fixed — upgrades make the strike hit harder and come
 * round sooner, never change where it can be put or how it reads on landing.
 */
export function effectiveSignature(
  def: SignatureDefinition,
  level = 1,
): SignatureStats {
  const steps = upgradeSteps(level);
  return {
    damage: def.baseDamage * (1 + DAMAGE_PER_LEVEL * steps),
    radiusM: def.baseRadiusM * (1 + RADIUS_PER_LEVEL * steps),
    // Floored well clear of zero: even a fully upgraded signature keeps a
    // cadence the player can read, so the reticle's fill still means something.
    cooldownSeconds: Math.max(
      0.4,
      def.cooldownSeconds * (1 - COOLDOWN_PER_LEVEL * steps),
    ),
    rangeM: def.rangeM,
    travelSpeedMps: def.travelSpeedMps ?? 0,
    delaySeconds: Math.max(
      0,
      (def.delaySeconds ?? 0) * (1 - DELAY_PER_LEVEL * steps),
    ),
    burnSeconds: def.burnSeconds ?? 0,
    shockSeconds: def.shockSeconds ?? 0,
    autoFire: def.autoFire === true,
    // A weapon with no chain data hits exactly one thing: itself, at the
    // impact point. The blast kinds resolve through `radiusM` instead.
    chainTargets: Math.max(1, Math.floor(def.chainTargets ?? 1)),
    chainRangeM: def.chainRangeM ?? 0,
    chainFalloff: def.chainFalloff ?? 1,
  };
}

/** Presentation for one kind of signature: how it reads in the garage. */
export interface SignatureKindMeta {
  /** Short name, shown on the block's inspector card and the build picker. */
  label: string;
  /** Single glyph, in the style of the ability bar's icons. */
  glyph: string;
  /** One line on what a press does. */
  blurb: string;
}

export const SIGNATURE_KIND_META: Record<
  SignatureDefinition['kind'],
  SignatureKindMeta
> = {
  lightning: {
    label: 'Chain Lightning',
    glyph: '⚡',
    blurb:
      'Point at the horde and the mast does the rest — a bolt onto the ' +
      'nearest body, arcing from it to its neighbours, twice a second.',
  },
  fireball: {
    label: 'Fireball',
    glyph: '✷',
    blurb:
      'Click to lob a bolus of fire onto a spot. It bursts wide and leaves ' +
      'everything it catches burning.',
  },
  nuke: {
    label: 'Nuke Launcher',
    glyph: '☢',
    blurb:
      'Click to call a shell down on a spot. It takes seconds to fall and ' +
      'the marked ring warns everyone — including the horde walking out of it.',
  },
};

/**
 * How the strike's numbers read on a garage card, at the block's current level.
 * One line, so it fits the inspector next to the ability's own detail line.
 */
export function signatureDetail(stats: SignatureStats): string {
  const damage = Math.round(stats.damage);
  const cooldown = stats.cooldownSeconds.toFixed(1);
  if (stats.chainTargets > 1) {
    return `${damage} dmg, chains to ${stats.chainTargets} — every ${cooldown}s`;
  }
  const radius = stats.radiusM.toFixed(1);
  const fall =
    stats.delaySeconds > 0 ? `, ${stats.delaySeconds.toFixed(1)}s fall` : '';
  return `${damage} dmg, ${radius}m blast${fall} — every ${cooldown}s`;
}
