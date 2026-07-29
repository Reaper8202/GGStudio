/**
 * Boss registry. A boss is a pooled `Zombie` of kind `'boss'` driven entirely by
 * one of these definitions, so adding a boss means adding a `BOSS_DEFINITIONS`
 * entry and pushing its id into `BOSS_ROTATION` — no new class and no new
 * branch, unless the boss needs an attack kind that does not exist yet.
 *
 * Wave scaling multipliers are never imported here; `Zombie.spawn` receives them
 * from `WaveManager` and applies them to these base values. That keeps this
 * module free of the `WaveManager -> bossConfig` import cycle.
 */

export type BossId = 'hammer-brute' | 'needle-spire';

/**
 * Wind-up melee. The boss plants itself inside `rangeM`, telegraphs for
 * `windupSeconds` with an expanding ground ring, then damages every vehicle
 * part within `radiusM` of itself. Damage resolves at impact, not at wind-up
 * start, so driving clear during the telegraph dodges the swing entirely.
 *
 * `radiusM` must exceed `rangeM`: the boss stops as soon as the nearest part is
 * within `rangeM`, so a slam circle smaller than that would always fall short
 * of the part that triggered the swing.
 */
export interface BossSlamAttack {
  readonly kind: 'slam';
  /** Metres from the nearest vehicle part at which the boss stops and swings. */
  readonly rangeM: number;
  /** Radius of the ground slam around the boss. Must be larger than `rangeM`. */
  readonly radiusM: number;
  /** Telegraph length; the ring plays for this long before impact. */
  readonly windupSeconds: number;
  /** Damage to every vehicle part inside `radiusM`, before wave scaling. */
  readonly damage: number;
  /** Seconds between swings. */
  readonly intervalSeconds: number;
}

/**
 * Ranged needle volley. The boss holds at `rangeM` and fires needles on a
 * ballistic arc, so the shot is dodgeable by driving. Unlike the slam it never
 * closes: if the vehicle gets inside `disengageRangeM` the boss backs away until
 * it is past `retreatRangeM` and only then resumes firing, reusing the worker's
 * retreat pattern. Its speed multiplier is still below 1, so a rig can always
 * run it down — the retreat is repositioning pressure, not an escape.
 *
 * Below `phaseTwoHealthFraction` of its spawn health each volley becomes
 * `enragedNeedleCount` needles fanned across `enragedSpreadDeg`, centred on the
 * vehicle, at the same interval and the same damage per needle.
 */
export interface BossNeedleAttack {
  readonly kind: 'needle';
  /** Metres from the nearest vehicle part at which the boss stops and fires. */
  readonly rangeM: number;
  /** Closer than this, the boss breaks off and backs away. Must be < rangeM. */
  readonly disengageRangeM: number;
  /** It retreats until the nearest part is past this. Between disengage and range. */
  readonly retreatRangeM: number;
  /** Telegraph length; the needle is raised for this long before the shot. */
  readonly windupSeconds: number;
  /** Damage per needle that connects, before wave scaling. */
  readonly damage: number;
  /** Seconds between volleys. */
  readonly intervalSeconds: number;
  /**
   * Horizontal travel speed in m/s. Deliberately below the thrower's
   * `PROJECTILE_HORIZONTAL_SPEED`: a needle is the slower, more readable shot.
   */
  readonly projectileSpeedMps: number;
  /** Needles per volley once enraged. One needle before that. */
  readonly enragedNeedleCount: number;
  /** Total fan width in degrees for an enraged volley. */
  readonly enragedSpreadDeg: number;
  /** Spawn-health fraction at or below which the volley becomes a spray. */
  readonly phaseTwoHealthFraction: number;
}

/**
 * A boss's one attack. Adding an arm here is the only reason a new boss needs
 * more than a `BOSS_DEFINITIONS` entry; `Zombie` dispatches on `kind` at the
 * moment the wind-up completes.
 */
export type BossAttack = BossSlamAttack | BossNeedleAttack;

export interface BossDefinition {
  readonly id: BossId;
  readonly name: string;
  /** Countdown/victory banner copy for the wave this boss appears on. */
  readonly warning: string;
  /** Wave-one health; scaled by the wave health multiplier at spawn. */
  readonly baseHealth: number;
  /** Multiplier over `BASE_ZOMBIE_STATS.speed`. Bosses are slower than walkers. */
  readonly speedMultiplier: number;
  readonly reward: number;
  readonly attack: BossAttack;
  /** 0 = immovable, 1 = shoved like a walker. Applies to rams and the Thumper. */
  readonly knockbackResistance: number;
  /** Hard cap on one ram hit, so an 80 km/h ram cannot one-shot a boss. */
  readonly impactDamageCap: number;
  readonly colliderRadiusM: number;
  readonly colliderHalfHeightM: number;
  /**
   * Rendered height in world metres. A boss sizes its model by bounds to this,
   * the way the thrower and worker do, rather than inheriting the walker's
   * baked visual scale — that keeps its feet on the ground at any size.
   */
  readonly visualHeightM: number;
  /**
   * Horizontal squash applied on top of the height fit; 1 (the default) keeps the
   * model's own proportions. Below 1 it reads as gaunt and stretched, which is how
   * a lanky boss is built out of the same stocky walker mesh.
   */
  readonly visualWidthScale?: number;
  /** Placeholder model under `public/assets/zombies` until a boss asset exists. */
  readonly assetName: string;
  readonly tint: number;
}

/** A boss is summoned on every wave that is a multiple of this. */
export const BOSS_WAVE_INTERVAL = 5;

/**
 * Model warmed into the boss pool slots at construction. Every boss shares one
 * placeholder today; a boss whose `assetName` differs re-sizes and re-tints on
 * spawn, so this only decides which model is preloaded.
 */
export const DEFAULT_BOSS_ASSET = 'Zed_5';

/** Ground-ring telegraph shown while a boss winds up its slam. */
export const BOSS_RING_OPACITY = 0.9;
export const BOSS_RING_COLOR = 0xff5722;
/** The ring starts this fraction of the slam radius and grows to full. */
export const BOSS_RING_MIN_FRACTION = 0.25;

/** Placeholder hammer geometry, in pre-`visualScale` metres. */
export const BOSS_HAMMER_SHAFT = { radius: 0.055, length: 1.15 } as const;
export const BOSS_HAMMER_HEAD = { width: 0.5, height: 0.34, depth: 0.34 } as const;
export const BOSS_HAMMER_COLOR = 0x6b6f76;
export const BOSS_HAMMER_SHAFT_COLOR = 0x4a3a28;
/** Radians the hammer is raised at full wind-up, swinging down to 0 on impact. */
export const BOSS_HAMMER_RAISED_ANGLE = -2.1;

/**
 * Placeholder needle-arm geometry for a needle boss, in pre-`visualScale` metres.
 * Built like the hammer — a prop on a shoulder pivot — but it levels out toward
 * the target during the wind-up instead of swinging down.
 */
export const BOSS_NEEDLE_ARM = { radius: 0.045, length: 1.5 } as const;
export const BOSS_NEEDLE_ARM_COLOR = 0xc9d6c0;
/** Radians the needle is raised at rest, levelling to 0 as the shot releases. */
export const BOSS_NEEDLE_RAISED_ANGLE = -1.35;

export const BOSS_DEFINITIONS: Record<BossId, BossDefinition> = {
  'hammer-brute': {
    id: 'hammer-brute',
    name: 'The Sledge',
    warning:
      'BOSS WAVE — The Sledge. Slow but brutal: stay out of the hammer ring.',
    // ~1,116 HP at wave 5 after the 1.24x health multiplier, close to the
    // effective total HP of the wave-4 horde it replaces.
    baseHealth: 900,
    // 1.76 m/s base — slower than a worker (0.85x), still closes the 18 m
    // minimum spawn gap in roughly nine seconds.
    speedMultiplier: 0.55,
    reward: 150,
    attack: {
      kind: 'slam',
      // Stops close, then slams a circle a metre wider than it walked in to, so
      // the telegraphed ring genuinely covers the rig and driving out of it is a
      // real dodge rather than a formality.
      rangeM: 3.5,
      radiusM: 4.5,
      windupSeconds: 1.1,
      // Over five times a walker's 10.5, enough to cripple a part per swing.
      damage: 55,
      intervalSeconds: 3,
    },
    knockbackResistance: 0.12,
    // Roughly twenty-five rams to kill: ramming is chip damage, not the answer.
    impactDamageCap: 45,
    colliderRadiusM: 1,
    colliderHalfHeightM: 1.1,
    // Matches the capsule's full height, 2 * (halfHeight + radius).
    visualHeightM: 4.2,
    // Placeholder: an ordinary walker model, scaled up and darkened. Swap this
    // for a dedicated boss asset when one exists; nothing else needs to change.
    assetName: 'Zed_5',
    tint: 0x2f3a2b,
  },
  'needle-spire': {
    id: 'needle-spire',
    name: 'The Spire',
    warning:
      'BOSS WAVE — The Spire. It kites and shoots needles: close the distance and it bleeds.',
    // ~3,080 HP at wave 10 after the 1.54x health multiplier, against the ~3,333
    // effective HP of the wave-9 horde it replaces. Deliberately a shade under a
    // full horde: the retreat means every point of its health takes longer to
    // reach than a brute's does.
    baseHealth: 2000,
    // 1.98 m/s base — quicker than The Sledge because it spends its time backing
    // away, but still far short of a walker, so ramming it down always works.
    speedMultiplier: 0.62,
    reward: 280,
    attack: {
      kind: 'needle',
      // Holds a metre past the thrower's 13 m, so the rig is already used to that
      // being the range where things start shooting.
      rangeM: 14,
      // Inside 8 m it breaks off; it will not fight at knife range.
      disengageRangeM: 8,
      retreatRangeM: 13,
      // Short tell: enough to read "it is about to shoot" without the long
      // commitment a ground slam needs.
      windupSeconds: 0.45,
      // Per needle. Under half health three of these land at once, so a volley
      // hits for 66 before wave scaling — a slam's worth, spread across parts.
      damage: 22,
      intervalSeconds: 2.6,
      // Slower than the thrower's 9 m/s lob, so a needle is the most dodgeable
      // projectile in the game and crossing its field is a real option.
      projectileSpeedMps: 7,
      enragedNeedleCount: 3,
      enragedSpreadDeg: 16,
      phaseTwoHealthFraction: 0.5,
    },
    // Skinnier than the brute, so a ram shifts it more and hurts it more.
    knockbackResistance: 0.18,
    impactDamageCap: 55,
    // Tall and narrow: a 5.5 m capsule only 0.9 m across.
    colliderRadiusM: 0.45,
    colliderHalfHeightM: 2.3,
    // Matches the capsule's full height, 2 * (halfHeight + radius).
    visualHeightM: 5.5,
    // The walker mesh stretched to a gaunt silhouette; without this it would just
    // read as a second, taller brute.
    visualWidthScale: 0.55,
    // Placeholder: the same walker model as The Sledge, drawn tall, thin, and
    // sickly pale. Swap for a dedicated asset when one exists.
    assetName: 'Zed_5',
    tint: 0xb9c6a8,
  },
};

/**
 * Boss order by boss-wave index. Push a new id here to put a boss into
 * rotation; the list cycles once every boss has been seen.
 */
const BOSS_ROTATION: readonly BossId[] = ['hammer-brute', 'needle-spire'];

function safeWaveNumber(wave: number): number {
  return Math.max(1, Math.floor(Number.isFinite(wave) ? wave : 1));
}

/** True on every wave that summons a boss. */
export function isBossWave(wave: number): boolean {
  return safeWaveNumber(wave) % BOSS_WAVE_INTERVAL === 0;
}

/** The boss for `wave`, or null when the wave is an ordinary horde wave. */
export function bossForWave(wave: number): BossDefinition | null {
  const safeWave = safeWaveNumber(wave);
  if (safeWave % BOSS_WAVE_INTERVAL !== 0) return null;
  const bossIndex = safeWave / BOSS_WAVE_INTERVAL - 1;
  return BOSS_DEFINITIONS[BOSS_ROTATION[bossIndex % BOSS_ROTATION.length]];
}
