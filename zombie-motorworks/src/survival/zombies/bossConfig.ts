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

export type BossId = 'hammer-brute';

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
  readonly attack: BossSlamAttack;
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
};

/**
 * Boss order by boss-wave index. Push a new id here to put a boss into
 * rotation; the list cycles once every boss has been seen.
 */
const BOSS_ROTATION: readonly BossId[] = ['hammer-brute'];

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
