/**
 * Boss registry. Two different things both count as "a boss" here:
 *
 * - A **classic** boss is a pooled `Zombie` of kind `'boss'` driven entirely by
 *   one of the `BOSS_DEFINITIONS` below — its own attack, its own hitbox, its
 *   own placeholder or primitive body. Adding one means adding a definition and
 *   pushing its id into `BOSS_ROTATION`, no new class and no new branch, unless
 *   the boss needs an attack kind that does not exist yet.
 * - An **elite** boss is just an ordinary zombie kind (a real Behemoth, with
 *   its real model, animation, attack, and VFX) spawned with boosted health and
 *   reward and tagged as the wave's boss for the HUD. It exists so a boss can
 *   reuse a kind's already-built behaviour wholesale instead of re-implementing
 *   a look-alike inside the classic system.
 *
 * `bossForWave` returns a `BossEncounter` that tells the wave director and the
 * pool which of the two a given boss wave is.
 *
 * Wave scaling multipliers are never imported here; `Zombie.spawn` receives them
 * from `WaveManager` and applies them to these base values. That keeps this
 * module free of the `WaveManager -> bossConfig` import cycle.
 */

export type BossId = 'acid-alchemist';

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
 * for `puddleDurationSeconds`. A puddle does no damage at all; it is a
 * movement hazard, killing wheel grip and actively dragging the vehicle's
 * speed down for as long as it is inside one. Driving out restores handling
 * immediately; the puddle itself never chases.
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
  /**
   * Legacy poison rate. Puddles no longer damage anything — the boss's gas
   * trail is its damage-over-time source — so this only survives as tuning
   * history for how hard a puddle used to bite.
   */
  readonly poisonDamagePerSecond: number;
}

/**
 * A boss's one attack. Adding an arm here is the only reason a new boss needs
 * more than a `BOSS_DEFINITIONS` entry; `Zombie` dispatches on `kind` at the
 * moment the wind-up completes.
 */
export type BossAttack = BossSlamAttack | BossVialAttack;

/**
 * Names a family of pose curves a boss's rig can be driven by. One per rigged
 * boss model, since the curves are authored against that model's proportions —
 * `glb-rigger` gives every rig the same thirteen bone names, but not the same
 * bind pose, and the Alchemist's is a T-pose where the others hang their arms.
 */
export type BossPoseSet = 'alchemist';

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
   * `'model'` sizes and tints `assetName`'s model to this boss, same as every
   * ordinary zombie. `'capsule'` never shows a model at all — the body stays
   * the primitive capsule every zombie renders as before its model loads,
   * tinted to `tint` — for a boss deliberately built from no art asset. Every
   * boss pool slot still preloads `DEFAULT_BOSS_ASSET` at construction, since
   * the slot is created before the wave picks which boss fills it;
   * `Zombie.applyBossBody` swaps in the right model on spawn when `assetName`
   * differs from what is already loaded.
   */
  readonly bodyVisual: 'model' | 'capsule';
  /** Model file under `public/assets/zombies` this boss shows when `bodyVisual` is `'model'`. */
  readonly assetName: string;
  /**
   * Which set of pose curves drives this boss's rig, resolved to actual
   * functions by `BOSS_RIG_CLIPS` in `Zombie.ts`. Named here rather than keyed
   * off the boss id over there so that adding a boss stays a matter of adding
   * one entry to this file.
   *
   * Omit for a boss whose `assetName` is unrigged — it simply renders
   * unanimated. Do NOT omit it for a rigged model: the bones would sit at their
   * bind rotations, which for a model authored in a T-pose (the Alchemist)
   * means it stands there with both arms straight out.
   */
  readonly poseSet?: BossPoseSet;
  readonly tint: number;
}

/** A boss is summoned on every wave that is a multiple of this. */
export const BOSS_WAVE_INTERVAL = 5;

/**
 * Model warmed into the boss pool slots at construction, before any
 * `BossDefinition` is known. Whichever classic boss actually spawns into a slot
 * swaps this out for its own `assetName`, which today always differs — the
 * Alchemist has a real rigged asset — so this only decides what is preloaded,
 * never what is seen. An elite boss (see `EliteBossSpec`) is a real zombie kind
 * with its own model instead, so it never touches this.
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
  'acid-alchemist': {
    id: 'acid-alchemist',
    name: 'The Alchemist',
    warning:
      'BOSS WAVE — The Alchemist. It kites and lobs acid vials: stay out of the puddles they leave behind.',
    // ~3,781 HP at wave 10 after the 1.54x health multiplier, against the ~4,730
    // effective HP of the wave-9 horde it replaces. Deliberately a shade under a
    // full horde: the retreat means every point of its health takes longer to
    // reach than a melee boss's does.
    // Raised from 2,300 when the zamboni joined the wave-9 horde composition —
    // the boss has to track the wave it stands in for, or it reads as a speed
    // bump on the way to wave 11.
    baseHealth: 2455,
    // 1.98 m/s base — quicker than the elite Behemoth's 0.6x because it spends
    // its time backing away, but still far short of a walker, so ramming it
    // down always works.
    speedMultiplier: 0.62,
    reward: 280,
    attack: {
      kind: 'vial',
      // Well past the thrower's 13 m. A vial's arc caps out around 22 m (3 s
      // max flight at 7.5 m/s), so this is about as far as it can throw and
      // still land on you — beyond it the vials would fall short.
      rangeM: 22,
      // Inside 8 m it breaks off; it will not fight at knife range.
      disengageRangeM: 8,
      retreatRangeM: 15,
      // A hair longer than the needle boss's 0.45 s snap-shot: the vial is
      // visibly hefted overhead before it flies, reading as a heavier throw.
      windupSeconds: 0.55,
      // Direct splash if the vial itself clips a part in flight. Deliberately
      // small — under half a walker's 10.5 — because the puddle it leaves is
      // this boss's real damage, not the impact.
      damage: 9,
      // Faster than the 3.2 s this used to be. Puddles now last 30 s, so at
      // this cadence several are always overlapping and the arena genuinely
      // starts closing in — which is the fight this boss is supposed to be.
      // Still slow enough to read each throw as a wind-up.
      intervalSeconds: 1.2,
      // Full-gravity lob (see VIAL_GRAVITY_SCALE) rather than the needle's
      // flattened arc — a hand-tossed vial should read as thrown, not fired.
      // Still under the thrower's 9 m/s: a heavier glass vial flies slower.
      projectileSpeedMps: 7.5,
      enragedVialCount: 3,
      // Wider than the needle boss's 16°: the enraged payoff here is coating
      // more ground in puddles, not landing more concentrated impact damage.
      enragedSpreadDeg: 30,
      phaseTwoHealthFraction: 0.5,
      // Roughly the elite Behemoth's own 3.4 m smash radius: this hazard keeps
      // punishing after the telegraph ends, so it earns a comparable footprint
      // in exchange for outlasting the instant the slam resolves in.
      puddleRadiusM: 3.2,
      // Long enough (half a minute) that the ground genuinely fills in behind
      // a sustained barrage rather than clearing itself before the next one
      // lands — the puddle, not the throw, is meant to be the thing you're
      // managing. Between ACID_PUDDLE_GRIP_MULTIPLIER and
      // ACID_PUDDLE_DRAG_PER_SECOND, a field of these turns the arena into
      // ground you have to route around instead of ground that hurts.
      puddleDurationSeconds: 30,
      // Unused: puddles deal no damage now. Kept so the tuning that follows a
      // vial (radius, duration) still reads as one block.
      poisonDamagePerSecond: 10,
    },
    // Gaunt and lightweight for a boss, so a ram shifts it more and hurts it more.
    knockbackResistance: 0.18,
    impactDamageCap: 55,
    // Tall and narrow: a 4 m capsule only 0.9 m across. The 5.5 m this used to
    // be was sized for a featureless capsule, where height was the only cue
    // that it was a boss at all; with the real model on it that reads as a
    // giant. 4 m clears the Behemoth's 2.7 m by enough to be obviously the
    // boss without towering over the arena.
    colliderRadiusM: 0.45,
    colliderHalfHeightM: 1.55,
    // Matches the capsule's full height, 2 * (halfHeight + radius).
    visualHeightM: 4,
    // No width squash any more. It existed to keep the placeholder capsule from
    // reading as a fat green pill; the real model is already gaunt, and
    // applyBossVisualSizing applies this to the model too, so anything but 1
    // would distort it. The pre-load fallback capsule is briefly rounder for it.
    bodyVisual: 'model',
    // The rigged Green Alchemist (glb-rigger/green-alchemist.rig.json). Its
    // bind pose is a T, so unlike every other model here it looks wrong until
    // a pose is applied — see BOSS_RIG_CLIPS in Zombie.ts, which is what makes
    // sure a boss with a rigged model actually gets one.
    assetName: 'green-alchemist.rigged.glb',
    poseSet: 'alchemist',
    // Left near-white so the model's own sickly green paint shows through
    // undistorted, the same reason The Behemoth does not tint either.
    tint: 0xffffff,
  },
};

/**
 * An elite boss is an ordinary zombie kind — its real model, animation,
 * attack, and VFX, completely unmodified — spawned with boosted stats and
 * tagged as the wave's boss. `Zombie` never branches on this; the kind's own
 * existing behaviour runs as-is, `healthMultiplier` and `reward` are the only
 * numbers the boss system adds on top.
 */
export interface EliteBossSpec {
  /** The pool kind actually spawned; every part of it behaves exactly as usual. */
  readonly kind: 'behemoth';
  readonly id: string;
  readonly name: string;
  /** Countdown/victory banner copy for the wave this boss appears on. */
  readonly warning: string;
  /** Stacks on top of the kind's own health multiplier, so a boss-tier one is tougher than an ordinary one. */
  readonly healthMultiplier: number;
  /** Overrides the kind's own flat reward for this one kill. */
  readonly reward: number;
}

export const ELITE_BOSSES: Record<'behemoth', EliteBossSpec> = {
  behemoth: {
    kind: 'behemoth',
    id: 'behemoth-elite',
    name: 'The Behemoth',
    warning:
      'BOSS WAVE — The Behemoth. Slow but brutal: stay out of the smash ring.',
    // See `unit/boss-balance.test.ts` for the exact resulting HP at wave 5;
    // this stacks on BEHEMOTH_HEALTH_MULTIPLIER, which already applies first.
    healthMultiplier: 4,
    reward: 150,
  },
};

/**
 * What a boss wave summons: either a classic pooled `'boss'` driven by a
 * `BossDefinition`, or an elite — an ordinary kind spawned with boosted stats.
 * `bossForWave` is the only place that produces one of these; everything else
 * (the wave director, the pool, the HUD) branches on `style` rather than
 * re-deriving which boss is which from the wave number.
 */
export type BossEncounter =
  | { readonly style: 'classic'; readonly definition: BossDefinition }
  | { readonly style: 'elite'; readonly elite: EliteBossSpec };

/**
 * Boss order by boss-wave index. Push a new entry here to put a boss into
 * rotation; the list cycles once every boss has been seen.
 */
const BOSS_ROTATION: readonly BossEncounter[] = [
  { style: 'elite', elite: ELITE_BOSSES.behemoth },
  { style: 'classic', definition: BOSS_DEFINITIONS['acid-alchemist'] },
];

function safeWaveNumber(wave: number): number {
  return Math.max(1, Math.floor(Number.isFinite(wave) ? wave : 1));
}

/** True on every wave that summons a boss. */
export function isBossWave(wave: number): boolean {
  return safeWaveNumber(wave) % BOSS_WAVE_INTERVAL === 0;
}

/** The boss for `wave`, or null when the wave is an ordinary horde wave. */
export function bossForWave(wave: number): BossEncounter | null {
  const safeWave = safeWaveNumber(wave);
  if (safeWave % BOSS_WAVE_INTERVAL !== 0) return null;
  const bossIndex = safeWave / BOSS_WAVE_INTERVAL - 1;
  return BOSS_ROTATION[bossIndex % BOSS_ROTATION.length];
}

/** The player-facing name for a boss encounter, regardless of which style it is. */
export function bossEncounterName(boss: BossEncounter): string {
  return boss.style === 'classic' ? boss.definition.name : boss.elite.name;
}

/** The countdown/victory banner copy for a boss encounter. */
export function bossEncounterWarning(boss: BossEncounter): string {
  return boss.style === 'classic' ? boss.definition.warning : boss.elite.warning;
}
