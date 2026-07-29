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

/** Resolved zap-blast stats after applying a placed part's upgrade level. */
export interface ZapStats {
  /** Damage dealt to every zombie caught in the blast. */
  damage: number;
  /** Seconds between activations. */
  cooldownSeconds: number;
}

/** Damage added to the zap blast per upgrade level beyond the first. */
const ZAP_DAMAGE_PER_LEVEL = 25;

/**
 * Scales a zap ability by the placed part's upgrade level. Each level beyond the
 * first adds {@link ZAP_DAMAGE_PER_LEVEL} blast damage; the cooldown is fixed.
 * Level 1 → 90 dmg, level 5 → 190 (with the default tesla-coil payload).
 */
export function effectiveZap(def: AbilityDefinition, level = 1): ZapStats {
  const steps = upgradeSteps(level);
  return {
    damage: (def.baseDamage ?? 0) + steps * ZAP_DAMAGE_PER_LEVEL,
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

/** Resolved mind-control stats after applying a placed part's upgrade level. */
export interface CharmStats {
  /** Number of zombies turned to your side by one activation. */
  targets: number;
  /** Seconds the charmed zombies fight for you before reverting to hostile. */
  durationSeconds: number;
  /** Seconds between activations. */
  cooldownSeconds: number;
  /** Metres from the vehicle within which zombies can be charmed. */
  rangeM: number;
}

/** Charm duration added per upgrade level beyond the first. */
const CHARM_SECONDS_PER_LEVEL = 2;

/**
 * Scales a charm ability by the placed part's upgrade level. The number of
 * zombies charmed stays fixed (the headline "up to N"); each level beyond the
 * first extends how long they fight for you by {@link CHARM_SECONDS_PER_LEVEL}.
 * Level 1 → 12s, level 5 → 20s (with the default mind-control payload).
 */
export function effectiveCharm(def: AbilityDefinition, level = 1): CharmStats {
  const steps = upgradeSteps(level);
  return {
    targets: def.baseTargets ?? 0,
    durationSeconds: def.baseDurationSeconds + steps * CHARM_SECONDS_PER_LEVEL,
    cooldownSeconds: def.cooldownSeconds,
    rangeM: def.rangeM ?? 0,
  };
}

/** Resolved big-rocket blast stats after applying a placed part's level. */
export interface RocketStats {
  /** Damage dealt to every zombie caught in the blast. */
  damage: number;
  /** Blast radius in metres. */
  radiusM: number;
  /** Seconds between activations. */
  cooldownSeconds: number;
}

/** Damage added to the rocket blast per upgrade level beyond the first. */
const ROCKET_DAMAGE_PER_LEVEL = 45;

/**
 * Scales a rocket ability by the placed part's upgrade level. Each level beyond
 * the first adds {@link ROCKET_DAMAGE_PER_LEVEL} blast damage; the radius and
 * cooldown are fixed. Level 1 → 170 dmg, level 5 → 350 (with the default
 * missile-launcher payload).
 */
export function effectiveRocket(def: AbilityDefinition, level = 1): RocketStats {
  const steps = upgradeSteps(level);
  return {
    damage: (def.baseDamage ?? 0) + steps * ROCKET_DAMAGE_PER_LEVEL,
    radiusM: def.rangeM ?? 0,
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

/** Resolved nitro speed-boost stats after applying a placed part's level. */
export interface NitroStats {
  /** Multiplier applied to drive force and the speed cap while boosting. */
  speedMultiplier: number;
  /** Seconds the boost lasts (capped so it never overstays its welcome). */
  durationSeconds: number;
  /** Seconds between activations. */
  cooldownSeconds: number;
}

/** Fixed 100% speed increase (2x) for the duration of the boost. */
const NITRO_SPEED_MULTIPLIER = 2;
/** Boost seconds added per upgrade level beyond the first. */
const NITRO_SECONDS_PER_LEVEL = 0.5;
/** Hard cap on boost duration — the design keeps it to no more than this. */
const NITRO_MAX_DURATION_SECONDS = 7;

/**
 * Scales a nitro ability by the placed part's upgrade level. The speed increase
 * stays a flat +100% (2x); each level beyond the first extends the boost by
 * {@link NITRO_SECONDS_PER_LEVEL}, clamped to {@link NITRO_MAX_DURATION_SECONDS}.
 * Level 1 → 5s, level 5 → 7s (with the default nitro-booster payload).
 */
export function effectiveNitro(def: AbilityDefinition, level = 1): NitroStats {
  const steps = upgradeSteps(level);
  return {
    speedMultiplier: NITRO_SPEED_MULTIPLIER,
    durationSeconds: Math.min(
      NITRO_MAX_DURATION_SECONDS,
      def.baseDurationSeconds + steps * NITRO_SECONDS_PER_LEVEL,
    ),
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

/** Resolved Thumper shockwave stats after applying a placed part's level. */
export interface ThumpStats {
  /** Speed, m/s, every caught zombie is flung radially outward at. */
  knockbackSpeed: number;
  /** Radius in metres of the knockback circle around the vehicle. */
  radiusM: number;
  /** Seconds between activations. */
  cooldownSeconds: number;
}

/** Knockback speed (m/s) added per upgrade level beyond the first. */
const THUMP_KNOCKBACK_PER_LEVEL = 3;

/**
 * Scales a thump ability by the placed part's upgrade level. The radius stays a
 * fixed, moderate circle; each level beyond the first adds
 * {@link THUMP_KNOCKBACK_PER_LEVEL} m/s of knockback speed, so higher levels
 * fling zombies harder. Level 1 → 14 m/s, level 5 → 26 (with the default
 * thumper payload).
 */
export function effectiveThump(def: AbilityDefinition, level = 1): ThumpStats {
  const steps = upgradeSteps(level);
  return {
    knockbackSpeed: (def.baseDamage ?? 0) + steps * THUMP_KNOCKBACK_PER_LEVEL,
    radiusM: def.rangeM ?? 0,
    cooldownSeconds: def.cooldownSeconds,
  };
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
  hellfire: {
    label: 'Hellfire',
    glyph: '♨',
    blurb:
      'Hold the nozzle wide open: a hotter, longer, wider sheet of flame that ' +
      'never pauses between bursts.',
  },
  zap: {
    label: 'Tesla Blast',
    glyph: '⚡',
    blurb: 'Detonate a lightning blast that shocks every zombie in range.',
  },
  charm: {
    label: 'Mind Control',
    glyph: '☯',
    blurb:
      'Turn the nearest zombies to your side — they fight for you until the ' +
      'hold wears off.',
  },
  rocket: {
    label: 'Rocket',
    glyph: '➤',
    blurb: 'Launch a heavy rocket that detonates on the thickest of the horde.',
  },
  nitro: {
    label: 'Nitro',
    glyph: '⏩',
    blurb: 'Dump the bottle for a short burst of double speed.',
  },
  thump: {
    label: 'Thump',
    glyph: '◎',
    blurb: 'Slam a shockwave outward that knocks every nearby zombie back.',
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
