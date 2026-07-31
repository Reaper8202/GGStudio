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

export type BossId = 'hammer-brute' | 'acid-alchemist';

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
 * Ranged acid-vial barrage. The boss holds at `rangeM` and lobs a vial on a
 * ballistic arc, so the shot is dodgeable by driving — the same standoff and
 * kite pattern the needle attack this replaced used. Unlike the slam it never
 * closes: if the vehicle gets inside `disengageRangeM` the boss backs away until
 * it is past `retreatRangeM` and only then resumes throwing, reusing the
 * worker's retreat pattern. Its speed multiplier is still below 1, so a rig can
 * always run it down — the retreat is repositioning pressure, not an escape.
 *
 * A vial that actually strikes the vehicle in flight deals `damage` on the
 * spot, but that is the minor payload: wherever a vial ends up — vehicle or
 * bare ground — it bursts into a puddle of radius `puddleRadiusM` that lingers
 * for `puddleDurationSeconds` and ticks `poisonDamagePerSecond` into every part
 * still standing in it. Driving out stops the tick immediately; the puddle
 * itself never chases.
 *
 * Below `phaseTwoHealthFraction` of its spawn health each throw becomes
 * `enragedVialCount` vials fanned across `enragedSpreadDeg`, centred on the
 * vehicle, at the same interval — more puddles blanketing the ground rather
 * than more direct impact damage.
 */
export interface BossVialAttack {
  readonly kind: 'vial';
  /** Metres from the nearest vehicle part at which the boss stops and throws. */
  readonly rangeM: number;
  /** Closer than this, the boss breaks off and backs away. Must be < rangeM. */
  readonly disengageRangeM: number;
  /** It retreats until the nearest part is past this. Between disengage and range. */
  readonly retreatRangeM: number;
  /** Telegraph length; the vial is raised for this long before the throw. */
  readonly windupSeconds: number;
  /** Direct splash damage if the vial itself connects with a part in flight. */
  readonly damage: number;
  /** Seconds between throws. */
  readonly intervalSeconds: number;
  /**
   * Horizontal travel speed in m/s, same full-gravity lob the thrower's box
   * uses (see `VIAL_GRAVITY_SCALE`) rather than the flattened needle arc it
   * replaced — a hand-tossed vial should read as thrown, not fired.
   */
  readonly projectileSpeedMps: number;
  /** Vials per throw once enraged. One vial before that. */
  readonly enragedVialCount: number;
  /** Total fan width in degrees for an enraged barrage. */
  readonly enragedSpreadDeg: number;
  /** Spawn-health fraction at or below which the throw becomes a barrage. */
  readonly phaseTwoHealthFraction: number;
  /** Radius of the acid puddle a vial leaves behind wherever it lands. */
  readonly puddleRadiusM: number;
  /** Seconds a puddle persists before it evaporates. */
  readonly puddleDurationSeconds: number;
  /** Poison damage/second applied to every part standing inside a puddle. */
  readonly poisonDamagePerSecond: number;
}

/**
 * A boss's one attack. Adding an arm here is the only reason a new boss needs
 * more than a `BOSS_DEFINITIONS` entry; `Zombie` dispatches on `kind` at the
 * moment the wind-up completes.
 */
export type BossAttack = BossSlamAttack | BossVialAttack;

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
  /**
   * `'model'` sizes and tints the shared voxel placeholder to this boss, same as
   * every ordinary zombie. `'capsule'` never shows that model at all — the body
   * stays the primitive capsule every zombie renders as before its model loads,
   * tinted to `tint` — for a boss deliberately built from no art asset. Both
   * still preload the same `DEFAULT_BOSS_ASSET`, since the two boss pool slots
   * are shared and do not know in advance which definition will next occupy
   * them; a capsule boss just leaves it loaded and hidden.
   */
  readonly bodyVisual: 'model' | 'capsule';
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
 * Placeholder held-vial geometry for the vial boss, in pre-`visualScale` metres —
 * a capsule (the same primitive shape the thrown projectile uses, see
 * `VIAL_CAPSULE_RADIUS`/`VIAL_CAPSULE_LENGTH` in zombieConfig.ts) on a shoulder
 * pivot, built like the hammer, but it levels out toward the target during the
 * wind-up instead of swinging down — a raised throwing arm, not a mounted spike.
 */
export const BOSS_VIAL_PROP = { radius: 0.08, length: 0.35 } as const;
/** Glassy, glowing acid green — the vial itself, not just the puddle it leaves. */
export const BOSS_VIAL_PROP_COLOR = 0x74ff3a;
/** Radians the vial is raised at rest, levelling to 0 as the throw releases. */
export const BOSS_VIAL_RAISED_ANGLE = -1.35;

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
    bodyVisual: 'model',
    // Placeholder: an ordinary walker model, scaled up and darkened. Swap this
    // for a dedicated boss asset when one exists; nothing else needs to change.
    assetName: 'Zed_5',
    tint: 0x2f3a2b,
  },
  'acid-alchemist': {
    id: 'acid-alchemist',
    name: 'The Alchemist',
    warning:
      'BOSS WAVE — The Alchemist. It kites and lobs acid vials: stay out of the puddles they leave behind.',
    // ~3,781 HP at wave 10 after the 1.54x health multiplier, against the ~4,730
    // effective HP of the wave-9 horde it replaces. Deliberately a shade under a
    // full horde: the retreat means every point of its health takes longer to
    // reach than a brute's does. The 0.80 ratio is The Sledge's (1,116 against
    // wave 4's 1,416), so both bosses sit the same distance under their wave.
    // Raised from 2,300 when the zamboni joined the wave-9 horde composition —
    // the boss has to track the wave it stands in for, or it reads as a speed
    // bump on the way to wave 11.
    baseHealth: 2455,
    // 1.98 m/s base — quicker than The Sledge because it spends its time backing
    // away, but still far short of a walker, so ramming it down always works.
    speedMultiplier: 0.62,
    reward: 280,
    attack: {
      kind: 'vial',
      // Holds a metre past the thrower's 13 m, so the rig is already used to that
      // being the range where things start shooting.
      rangeM: 14,
      // Inside 8 m it breaks off; it will not fight at knife range.
      disengageRangeM: 8,
      retreatRangeM: 13,
      // A hair longer than the needle boss's 0.45 s snap-shot: the vial is
      // visibly hefted overhead before it flies, reading as a heavier throw.
      windupSeconds: 0.55,
      // Direct splash if the vial itself clips a part in flight. Deliberately
      // small — under half a walker's 10.5 — because the puddle it leaves is
      // this boss's real damage, not the impact.
      damage: 9,
      // Slightly slower than the needle boss's 2.6 s cadence: puddles linger
      // after the throw, so pressure builds from ground denial over time
      // rather than needing a fast rate of direct hits.
      intervalSeconds: 3.2,
      // Full-gravity lob (see VIAL_GRAVITY_SCALE) rather than the needle's
      // flattened arc — a hand-tossed vial should read as thrown, not fired.
      // Still under the thrower's 9 m/s: a heavier glass vial flies slower.
      projectileSpeedMps: 7.5,
      enragedVialCount: 3,
      // Wider than the needle boss's 16°: the enraged payoff here is coating
      // more ground in puddles, not landing more concentrated impact damage.
      enragedSpreadDeg: 30,
      phaseTwoHealthFraction: 0.5,
      // A metre smaller than The Sledge's 4.5 m slam circle: this hazard keeps
      // punishing after the telegraph ends, so it earns a tighter footprint in
      // exchange for outlasting the instant the slam resolves in.
      puddleRadiusM: 3.2,
      // Long enough that ignoring it is a real mistake, short enough (under two
      // throw intervals) that the field never carpets itself in acid.
      puddleDurationSeconds: 5,
      // 10 * puddleDurationSeconds(5) = 50 total if a rig sat in one puddle for
      // its whole life — in the same band as The Sledge's 55-per-swing direct
      // hit, which is the right comparison: standing still in one is exactly as
      // much a player mistake as tanking a hammer.
      poisonDamagePerSecond: 10,
    },
    // Skinnier than the brute, so a ram shifts it more and hurts it more.
    knockbackResistance: 0.18,
    impactDamageCap: 55,
    // Tall and narrow: a 5.5 m capsule only 0.9 m across.
    colliderRadiusM: 0.45,
    colliderHalfHeightM: 2.3,
    // Matches the capsule's full height, 2 * (halfHeight + radius).
    visualHeightM: 5.5,
    // The squash still applies to the fallback capsule body itself (see
    // applyBossVisualSizing), so the alchemist keeps the same gaunt silhouette
    // the needle boss had rather than reading as a fat green pill.
    visualWidthScale: 0.55,
    bodyVisual: 'capsule',
    // No voxel placeholder: primitive geometry only, by design — a capsule body,
    // capsule vials, and a flat ground disc for the puddle. assetName is unused
    // for rendering when bodyVisual is 'capsule', but kept non-empty since the
    // shared boss pool slot still preloads DEFAULT_BOSS_ASSET underneath it.
    assetName: 'capsule-primitive',
    // Sickly acid green, matching the vial and puddle colour so the whole boss
    // reads as one toxic identity.
    tint: 0x6fbf3f,
  },
};

/**
 * Boss order by boss-wave index. Push a new id here to put a boss into
 * rotation; the list cycles once every boss has been seen.
 */
const BOSS_ROTATION: readonly BossId[] = ['hammer-brute', 'acid-alchemist'];

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
