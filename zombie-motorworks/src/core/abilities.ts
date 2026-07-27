import type { AbilityDefinition } from './types.ts';

/** Resolved freeze stats after applying a placed part's upgrade level. */
export interface FreezeStats {
  /** Number of zombies frozen by one activation. */
  targets: number;
  /** Freeze duration in seconds. */
  durationSeconds: number;
  /** Seconds between activations. */
  cooldownSeconds: number;
  /** Metres from the vehicle within which zombies can be caught. */
  rangeM: number;
}

/** Resolved shield stats after applying a placed part's upgrade level. */
export interface ShieldStats {
  /** Seconds the vehicle stays invulnerable per activation. */
  durationSeconds: number;
  /** Seconds between activations. */
  cooldownSeconds: number;
}

/** Resolved pulse stats after applying a placed part's upgrade level. */
export interface PulseStats {
  /** Damage at the centre of the ring, falling off to nothing at the rim. */
  damage: number;
  /** Metres the ring reaches. */
  radiusM: number;
  /** Seconds between activations. */
  cooldownSeconds: number;
}

/** Resolved overdrive stats after applying a placed part's upgrade level. */
export interface OverdriveStats {
  /** Seconds the torque surge lasts. */
  durationSeconds: number;
  /** Multiplier applied to drive torque while it runs. */
  torqueMultiplier: number;
  /** Multiplier applied to the vehicle's top-speed ceiling while it runs. */
  topSpeedMultiplier: number;
  /** Thrust in m/s^2 pushed through the chassis, throttle or no throttle. */
  thrustAccel: number;
  /** Seconds between activations. */
  cooldownSeconds: number;
}

/** Resolved phase stats after applying a placed part's upgrade level. */
export interface PhaseStats {
  /** Metres the blink covers along the rig's heading. */
  distanceM: number;
  /** Seconds between activations. */
  cooldownSeconds: number;
}

/** Resolved hellfire stats after applying a placed part's upgrade level. */
export interface HellfireStats {
  /** Seconds the nozzle stays overcharged. */
  durationSeconds: number;
  /** Multiplier on the host weapon's per-ray damage while it runs. */
  damageMultiplier: number;
  /** Multiplier on the host weapon's reach while it runs. */
  rangeMultiplier: number;
  /** Multiplier on the host weapon's spray cone while it runs. */
  coneMultiplier: number;
  /** Seconds between activations. */
  cooldownSeconds: number;
}

/**
 * Scales a freeze ability by the placed part's upgrade level. Each level beyond
 * the first adds one target and one second of freeze; cooldown and range are
 * fixed. Level 1 → 3 targets / 4s, level 5 → 7 targets / 8s (with the default
 * ice-cannon payload).
 */
export function effectiveFreeze(
  def: AbilityDefinition,
  level = 1,
): FreezeStats {
  const steps = upgradeSteps(level);
  return {
    targets: (def.baseTargets ?? 0) + steps,
    durationSeconds: def.baseDurationSeconds + steps,
    cooldownSeconds: def.cooldownSeconds,
    rangeM: def.rangeM ?? 0,
  };
}

/**
 * Scales a shield ability by the placed part's upgrade level. Each level beyond
 * the first adds one second of invulnerability; the cooldown is fixed. Level 1
 * → 4s / 25s cooldown, level 5 → 8s / 25s (with the default shield payload).
 */
export function effectiveShield(
  def: AbilityDefinition,
  level = 1,
): ShieldStats {
  const steps = upgradeSteps(level);
  return {
    durationSeconds: def.baseDurationSeconds + steps,
    cooldownSeconds: def.cooldownSeconds,
  };
}

/**
 * Scales a pulse ability by the placed part's upgrade level. Each level beyond
 * the first adds a quarter of the base damage and half a metre of reach;
 * the cooldown is fixed. Level 1 → 60 dmg / 9m, level 5 → 120 dmg / 11m (with
 * the default pulse-emitter payload).
 */
export function effectivePulse(def: AbilityDefinition, level = 1): PulseStats {
  const steps = upgradeSteps(level);
  const base = def.baseDamage ?? 0;
  return {
    damage: base + base * 0.25 * steps,
    radiusM: (def.rangeM ?? 0) + 0.5 * steps,
    cooldownSeconds: def.cooldownSeconds,
  };
}

/**
 * Scales an overdrive ability by the placed part's upgrade level. Each level
 * beyond the first adds a second of surge, four tenths of drive torque, a
 * further twentieth of speed ceiling, and 2 m/s^2 of thrust; the cooldown is
 * fixed. Level 1 → 5s at ×3.2 torque / ×1.35 speed / 16 m/s^2, level 5 → 9s
 * at ×4.8 / ×1.55 / 24 m/s^2 (with the default nitro-injector payload).
 */
export function effectiveOverdrive(
  def: AbilityDefinition,
  level = 1,
): OverdriveStats {
  const steps = upgradeSteps(level);
  return {
    durationSeconds: def.baseDurationSeconds + steps,
    torqueMultiplier: (def.baseTorqueMultiplier ?? 1) + 0.4 * steps,
    topSpeedMultiplier: (def.baseTopSpeedMultiplier ?? 1) + 0.05 * steps,
    thrustAccel: (def.baseThrustAccel ?? 0) + 2 * steps,
    cooldownSeconds: def.cooldownSeconds,
  };
}

/**
 * Scales a hellfire ability by the placed part's upgrade level. Each level
 * beyond the first adds half a second of overcharge and a fifth of extra
 * damage; reach, cone, and cooldown are fixed. Level 1 → 6s at ×2.4, level 5 →
 * 8s at ×3.2 (with the default flamethrower payload).
 */
export function effectiveHellfire(
  def: AbilityDefinition,
  level = 1,
): HellfireStats {
  const steps = upgradeSteps(level);
  return {
    durationSeconds: def.baseDurationSeconds + 0.5 * steps,
    damageMultiplier: (def.baseDamageMultiplier ?? 1) + 0.2 * steps,
    rangeMultiplier: def.rangeMultiplier ?? 1,
    coneMultiplier: def.coneMultiplier ?? 1,
    cooldownSeconds: def.cooldownSeconds,
  };
}

/**
 * Scales a phase ability by the placed part's upgrade level. Each level beyond
 * the first adds a metre of blink; the cooldown is fixed, because reach is the
 * only thing that can grow without turning a repositioning tool into a way to
 * cross the arena on demand. Level 1 → 10m, level 5 → 14m (with the default
 * phase-drive payload).
 */
export function effectivePhase(def: AbilityDefinition, level = 1): PhaseStats {
  return {
    distanceM: (def.rangeM ?? 0) + upgradeSteps(level),
    cooldownSeconds: def.cooldownSeconds,
  };
}

/** Axis-aligned world footprint a phase blink may not leave. */
export interface PhaseBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Where a phase blink lands, and how far it actually travelled. */
export interface PhaseDestination {
  x: number;
  z: number;
  /** Metres covered — short of the requested distance when the wall stopped it. */
  distanceM: number;
}

/**
 * Resolve a blink from `from` along `forward` for `distanceM`, stopped by the
 * arena wall and nothing else. The wall is the one thing a phase cannot pass
 * through: the trip is clipped to the last point inside the bounds, inset by
 * `marginM` so the rig lands clear of the fence rather than half inside it.
 *
 * The clip is along the ray rather than per axis, so a blink aimed into a
 * corner stops short instead of sliding sideways along the wall.
 */
export function phaseDestination(
  from: { x: number; z: number },
  forward: { x: number; z: number },
  distanceM: number,
  bounds: PhaseBounds,
  marginM = 0,
): PhaseDestination {
  const length = Math.hypot(forward.x, forward.z);
  if (length < 1e-6 || distanceM <= 0) {
    return { x: from.x, z: from.z, distanceM: 0 };
  }
  const dirX = forward.x / length;
  const dirZ = forward.z / length;

  // An arena narrower than two margins has no legal strip left; aim at its
  // centre line instead of inverting the slab and clipping everything to zero.
  const [minX, maxX] = insetSpan(bounds.minX, bounds.maxX, marginM);
  const [minZ, maxZ] = insetSpan(bounds.minZ, bounds.maxZ, marginM);

  let travel = distanceM;
  travel = Math.min(travel, slabLimit(from.x, dirX, minX, maxX));
  travel = Math.min(travel, slabLimit(from.z, dirZ, minZ, maxZ));
  travel = Math.max(0, travel);
  return {
    x: from.x + dirX * travel,
    z: from.z + dirZ * travel,
    distanceM: travel,
  };
}

/** Pull a span in by `margin` on both sides, collapsing to its centre if it runs out. */
function insetSpan(min: number, max: number, margin: number): [number, number] {
  if (max - min <= margin * 2) {
    const centre = (min + max) / 2;
    return [centre, centre];
  }
  return [min + margin, max - margin];
}

/** How far a ray may travel along one axis before it leaves [min, max]. */
function slabLimit(
  origin: number,
  dir: number,
  min: number,
  max: number,
): number {
  if (Math.abs(dir) < 1e-6) return Number.POSITIVE_INFINITY;
  // Starting outside the slab gives a negative limit, which the caller floors
  // at zero — a rig somehow already past the fence cannot phase further out.
  return dir > 0 ? (max - origin) / dir : (min - origin) / dir;
}

/** Upgrade levels past the first, floored at 0 so level 0 reads as level 1. */
function upgradeSteps(level: number): number {
  return Math.max(0, Math.floor(level) - 1);
}

/** Keys that fire the ability bar's slots, left to right. */
export const ABILITY_SLOT_KEYS = ['q', 'e', 'r'] as const;

/** How many abilities the bar can hold at once. */
export const MAX_ABILITY_SLOTS = ABILITY_SLOT_KEYS.length;

/** Presentation for one kind of ability: how its box reads in the HUD. */
export interface AbilityKindMeta {
  /** Short label on the HUD box and in the garage. */
  label: string;
  /** Single glyph drawn in the HUD box. */
  glyph: string;
  /** One-line explanation, used as the box tooltip. */
  blurb: string;
}

export const ABILITY_KIND_META: Record<
  AbilityDefinition['kind'],
  AbilityKindMeta
> = {
  shield: {
    label: 'Shield',
    glyph: '◈',
    blurb: 'Raise a blue bubble that makes the whole vehicle invulnerable.',
  },
  freeze: {
    label: 'Cryo Nova',
    glyph: '❄',
    blurb: 'Flash-freeze the nearest zombies solid where they stand.',
  },
  pulse: {
    label: 'Shockwave',
    glyph: '✺',
    blurb:
      'Slam out a ring of force that damages every zombie around the rig ' +
      'and throws the survivors clear.',
  },
  overdrive: {
    label: 'Overdrive',
    glyph: '⏵',
    blurb: 'Flood the drivetrain with torque for a burst of ramming speed.',
  },
  phase: {
    label: 'Phase',
    glyph: '⇥',
    blurb:
      'Blink a short way straight ahead, straight through zombies, wrecks and ' +
      'walls, leaving a trail of after-images behind.',
  },
  hellfire: {
    label: 'Hellfire',
    glyph: '♨',
    blurb:
      'Hold the nozzle wide open: a hotter, longer, wider sheet of flame that ' +
      'never pauses between bursts.',
  },
};

/**
 * `PartConfig.abilitySlot` value meaning "the player took this one out of the
 * bar": it keeps its slot free rather than drifting back in on the next
 * auto-fill.
 */
export const BENCHED_ABILITY_SLOT = -1;

/** One placed ability part offered to the loadout resolver. */
export interface AbilityCandidate {
  /** Placed part id, stable across a run — the key cooldowns are tracked by. */
  partId: string;
  /** Part name, shown next to the ability in the garage. */
  partName: string;
  ability: AbilityDefinition;
  /** Upgrade level of the placed part. */
  level: number;
  /** Player flagged this one in the garage (PartConfig.activeAbility). */
  preferred: boolean;
  /**
   * Box the player dropped this ability into in the garage: 0..2 for a slot,
   * {@link BENCHED_ABILITY_SLOT} for benched, undefined for "wherever it
   * fits". From `PartConfig.abilitySlot`.
   */
  slot?: number;
}

/** One filled slot of the ability bar. */
export interface AbilitySlotAssignment extends AbilityCandidate {
  /** 0-based slot index. */
  slot: number;
  /** Key that fires it: slot 0 → Q, 1 → E, 2 → R. */
  key: string;
}

/**
 * Pick which ability parts occupy the bar's three slots, in three passes:
 *
 * 1. Boxes the player filled by hand in the garage (`slot`) are honoured
 *    first — the panel there is the same three boxes as the HUD bar.
 * 2. Parts flagged with the older `activeAbility` tick take the lowest free
 *    boxes, so blueprints saved before the panel existed still load right.
 * 3. Anything neither placed nor benched drops into whatever is still free,
 *    in build order — so a rig nobody has fiddled with just works.
 *
 * Candidates must already be filtered to parts that are actually on the
 * vehicle and working — an ability the rig no longer carries has no slot.
 */
export function resolveAbilityLoadout(
  candidates: readonly AbilityCandidate[],
): AbilitySlotAssignment[] {
  const slots: (AbilityCandidate | null)[] = Array.from(
    { length: MAX_ABILITY_SLOTS },
    () => null,
  );
  const placed = new Set<string>();

  for (const candidate of candidates) {
    const slot = candidate.slot;
    if (slot === undefined || !Number.isInteger(slot)) continue;
    if (slot === BENCHED_ABILITY_SLOT) {
      // Benched by hand: claims nothing, and never auto-fills back in.
      placed.add(candidate.partId);
      continue;
    }
    if (slot < 0 || slot >= MAX_ABILITY_SLOTS) continue;
    if (slots[slot] !== null) continue; // First claim on a box wins.
    slots[slot] = candidate;
    placed.add(candidate.partId);
  }

  const fill = (pool: readonly AbilityCandidate[]): void => {
    for (const candidate of pool) {
      if (placed.has(candidate.partId)) continue;
      const free = slots.indexOf(null);
      if (free === -1) return;
      slots[free] = candidate;
      placed.add(candidate.partId);
    }
  };
  fill(candidates.filter((candidate) => candidate.preferred));
  fill(candidates);

  const assignments: AbilitySlotAssignment[] = [];
  for (let slot = 0; slot < slots.length; slot++) {
    const candidate = slots[slot];
    if (candidate === null) continue;
    assignments.push({ ...candidate, slot, key: ABILITY_SLOT_KEYS[slot] });
  }
  return assignments;
}
