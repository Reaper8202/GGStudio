import type { ZombieSystem } from './zombies/ZombieSystem.ts';
import type { ZombieKind } from './zombies/Zombie.ts';
import { bossForWave, isBossWave } from './zombies/bossConfig.ts';
import { devTuning } from './devtuning/DevTuning.ts';
import type { CompositionCurve } from './devtuning/DevTuning.ts';

const HORDE_RETRY_SECONDS = 0.5;
/** Sentinel: while horde interval sits at this shipped default, keep the
 * per-wave tiering below; any other value is treated as a flat dev override. */
const DEFAULT_HORDE_INTERVAL = 1.45;

export interface WaveManagerCallbacks {
  onRemainingChanged(remaining: number): void;
  onWaveComplete(wave: number, reward: number): void;
}

export interface WaveComposition {
  walker: number;
  gunslinger: number;
  necromancer: number;
  thrower: number;
  worker: number;
  'phone-addict': number;
  kamikaze: number;
  behemoth: number;
  zamboni: number;
  boss: number;
}

/** Resolve one kind's count from its composition curve, honouring a dev pin. */
function countFromCurve(
  curve: CompositionCurve,
  override: number | null,
  safeWave: number,
): number {
  if (override !== null) return Math.max(0, Math.floor(override));
  if (safeWave < curve.startWave) return 0;
  const steps = Math.floor((safeWave - curve.startWave) / Math.max(1, curve.every));
  return Math.min(curve.base + curve.perStep * steps, curve.cap);
}

/**
 * Extra walkers layered onto waves 1-2 only, on top of the normal curve.
 * Every kill pays out, so this is really an early-money bump: with no
 * specialists in play yet (gunslinger/thrower don't start until wave 3),
 * more walkers just means more kill reward banked before the roster gets
 * complicated. Wave 2 gets the bigger add — by then the player has already
 * banked wave 1's clear reward and can put it toward more parts, so the
 * horde can absorb more bodies without touching the growth curve for every
 * wave after it.
 */
function earlyWalkerBonus(safeWave: number): number {
  if (safeWave === 1) return 5;
  if (safeWave === 2) return 10;
  return 0;
}

/**
 * Normals remain the overwhelming majority while specialists unlock slowly.
 * Every fifth wave replaces the horde entirely with a single boss, so the
 * encounter reads as a duel rather than a horde wave with an extra enemy. The
 * boss short-circuits ahead of the curves deliberately: a boss wave is a fixed
 * encounter, not a tunable composition, so the dev tuner's per-kind counts and
 * pins do not apply to it.
 */
export function zombieCompositionForWave(wave: number): WaveComposition {
  const safeWave = safeWaveNumber(wave);
  if (isBossWave(safeWave)) {
    return {
      walker: 0,
      gunslinger: 0,
      necromancer: 0,
      thrower: 0,
      worker: 0,
      'phone-addict': 0,
      kamikaze: 0,
      behemoth: 0,
      boss: 1,
    };
  }
  const { composition } = devTuning.wave;
  const { types } = devTuning;
  return {
    walker:
      countFromCurve(composition.walker, types.walker.countOverride, safeWave) +
      (types.walker.countOverride === null ? earlyWalkerBonus(safeWave) : 0),
    gunslinger: countFromCurve(
      composition.gunslinger,
      types.gunslinger.countOverride,
      safeWave,
    ),
    necromancer: countFromCurve(
      composition.necromancer,
      types.necromancer.countOverride,
      safeWave,
    ),
    thrower: countFromCurve(
      composition.thrower,
      types.thrower.countOverride,
      safeWave,
    ),
    worker: countFromCurve(
      composition.worker,
      types.worker.countOverride,
      safeWave,
    ),
    'phone-addict': countFromCurve(
      composition['phone-addict'],
      types['phone-addict'].countOverride,
      safeWave,
    ),
    kamikaze: countFromCurve(
      composition.kamikaze,
      types.kamikaze.countOverride,
      safeWave,
    ),
    behemoth: countFromCurve(
      composition.behemoth,
      types.behemoth.countOverride,
      safeWave,
    ),
    zamboni: countFromCurve(
      composition.zamboni,
      types.zamboni.countOverride,
      safeWave,
    ),
    boss: 0,
  };
}

export function zombieCountForWave(wave: number): number {
  return Object.values(zombieCompositionForWave(wave)).reduce(
    (total, count) => total + count,
    0,
  );
}

export function maxActiveZombiesForWave(wave: number): number {
  const safeWave = safeWaveNumber(wave);
  const { maxActiveBase, maxActivePerWave, maxActiveCap } = devTuning.wave;
  return Math.min(maxActiveBase + safeWave * maxActivePerWave, maxActiveCap);
}

export function healthMultiplierForWave(wave: number): number {
  const safeWave = safeWaveNumber(wave);
  const { perWave, cap } = devTuning.wave.health;
  return Math.min(1 + perWave * (safeWave - 1), cap);
}

export function speedMultiplierForWave(wave: number): number {
  const safeWave = safeWaveNumber(wave);
  const { perWave, cap } = devTuning.wave.speed;
  return Math.min(1 + perWave * (safeWave - 1), cap);
}

export function attackDamageMultiplierForWave(wave: number): number {
  const safeWave = safeWaveNumber(wave);
  const { perWave, cap } = devTuning.wave.damage;
  return Math.min(1 + perWave * (safeWave - 1), cap);
}

export function waveRewardForWave(wave: number): number {
  return 40 + wave * 10;
}

export function hordeIntervalForWave(wave: number): number {
  const safeWave = safeWaveNumber(wave);
  const tuned = devTuning.wave.hordeInterval;
  // A dev-set interval overrides the tiering; the shipped default keeps it.
  if (Math.abs(tuned - DEFAULT_HORDE_INTERVAL) > 1e-6) return Math.max(0.1, tuned);
  // Later waves spawn more often so pressure comes from tempo instead of health.
  if (safeWave >= 13) return 1.05;
  if (safeWave >= 6) return 1.25;
  return 1.45;
}

function safeWaveNumber(wave: number): number {
  return Math.max(1, Math.floor(Number.isFinite(wave) ? wave : 1));
}

function hordeSizeForWave(): number {
  const min = Math.max(1, Math.floor(devTuning.wave.hordeSizeMin));
  const max = Math.max(min, Math.floor(devTuning.wave.hordeSizeMax));
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function spawnOrderForWave(wave: number): ZombieKind[] {
  const composition = zombieCompositionForWave(wave);
  // Bosses head the queue rather than joining the specialist interleave, so the
  // health bar is up from the start of the wave whatever else is scheduled.
  const bosses: ZombieKind[] = Array(composition.boss).fill('boss');
  const specials: ZombieKind[] = [];
  for (const kind of [
    'gunslinger',
    'necromancer',
    'thrower',
    'worker',
    'phone-addict',
    'kamikaze',
    'behemoth',
    'zamboni',
  ] as const) {
    for (let i = 0; i < composition[kind]; i++) specials.push(kind);
  }
  if (specials.length === 0) {
    return [...bosses, ...Array<ZombieKind>(composition.walker).fill('walker')];
  }

  const order: ZombieKind[] = [...bosses];
  let walkersLeft = composition.walker;
  for (let i = 0; i < specials.length; i++) {
    const groupsLeft = specials.length - i + 1;
    const walkersNow = Math.ceil(walkersLeft / groupsLeft);
    for (let j = 0; j < walkersNow; j++) order.push('walker');
    walkersLeft -= walkersNow;
    order.push(specials[i]);
  }
  for (let i = 0; i < walkersLeft; i++) order.push('walker');
  return order;
}

/** Fixed-step endless-wave director with direct callbacks and no event bus. */
export class WaveManager {
  private assignedCount = 0;
  private spawnQueueIndex = 0;
  private spawnOrder: ZombieKind[] = [];
  private killedCount = 0;
  private spawnTimer = 0;
  private waveNumber = 0;
  private waveDone = true;
  private lastEmittedRemaining = -1;
  private spawnPaused = false;

  constructor(
    private readonly zombies: ZombieSystem,
    private readonly callbacks: WaveManagerCallbacks,
  ) {}

  get currentWave(): number {
    return this.waveNumber;
  }

  get remainingCount(): number {
    return Math.max(0, this.assignedCount - this.killedCount);
  }

  get totalCount(): number {
    return this.assignedCount;
  }

  get isWaveActive(): boolean {
    return !this.waveDone;
  }

  startWave(wave: number): void {
    this.waveNumber = Math.max(1, Math.floor(wave));
    this.assignedCount = zombieCountForWave(this.waveNumber);
    this.spawnQueueIndex = 0;
    this.spawnOrder = spawnOrderForWave(this.waveNumber);
    this.killedCount = 0;
    this.spawnTimer = 0;
    this.waveDone = false;
    this.lastEmittedRemaining = -1;

    this.zombies.setWaveMultipliers(
      healthMultiplierForWave(this.waveNumber),
      speedMultiplierForWave(this.waveNumber),
      attackDamageMultiplierForWave(this.waveNumber),
    );
    this.zombies.setBossDefinition(bossForWave(this.waveNumber));
    this.emitRemaining();
  }

  /** Dev-tuner "freeze spawns": pauses new hordes; living zombies persist. */
  setSpawnPaused(paused: boolean): void {
    this.spawnPaused = paused;
  }

  fixedUpdate(dt: number): void {
    if (this.waveDone) return;

    if (!this.spawnPaused && this.spawnQueueIndex < this.spawnOrder.length) {
      this.spawnTimer -= Math.max(0, dt);
      if (this.spawnTimer <= 0) this.trySpawnHorde();
    }

    this.checkWaveComplete();
  }

  recordZombieKilled(): void {
    if (this.waveDone) return;
    this.killedCount = Math.min(this.assignedCount, this.killedCount + 1);
    this.emitRemaining();
    this.checkWaveComplete();
  }

  /** Add cheat-spawned zombies to the live wave so kills/completion stay exact. */
  spawnBonusHorde(kinds: readonly ZombieKind[]): number {
    if (this.waveDone || kinds.length === 0) return 0;
    const spawned = Math.min(
      kinds.length,
      Math.max(0, this.zombies.trySpawnHorde(kinds)),
    );
    this.countBonusSpawns(spawned);
    return spawned;
  }

  /**
   * Take ownership of bodies that entered the arena without being assigned by
   * this director — a necromancer's raise, a cheat horde. They have to be
   * counted, or the wave completes with them still walking around.
   */
  countBonusSpawns(spawned: number): void {
    if (this.waveDone || spawned <= 0) return;
    this.assignedCount += spawned;
    this.emitRemaining();
  }

  /**
   * Marks pending assignments as debug kills before SurvivalMode kills every
   * active zombie. Returns the virtual-kill count so run rewards stay faithful.
   */
  prepareDebugKillAll(): number {
    if (this.waveDone) return 0;
    const unspawned = Math.max(
      0,
      this.spawnOrder.length - this.spawnQueueIndex,
    );
    this.spawnQueueIndex = this.spawnOrder.length;
    this.killedCount = Math.min(
      this.assignedCount,
      this.killedCount + unspawned,
    );
    this.emitRemaining();
    this.checkWaveComplete();
    return unspawned;
  }

  reset(): void {
    this.assignedCount = 0;
    this.spawnQueueIndex = 0;
    this.spawnOrder = [];
    this.killedCount = 0;
    this.spawnTimer = 0;
    this.waveNumber = 0;
    this.waveDone = true;
    this.lastEmittedRemaining = -1;
  }

  private trySpawnHorde(): void {
    const headroom = Math.max(
      0,
      maxActiveZombiesForWave(this.waveNumber) - this.zombies.getActiveCount(),
    );
    const wanted = Math.min(
      hordeSizeForWave(),
      this.spawnOrder.length - this.spawnQueueIndex,
      headroom,
    );
    const spawned =
      wanted > 0
        ? Math.min(
            wanted,
            Math.max(
              0,
              this.zombies.trySpawnHorde(
                this.spawnOrder.slice(
                  this.spawnQueueIndex,
                  this.spawnQueueIndex + wanted,
                ),
              ),
            ),
          )
        : 0;

    this.spawnQueueIndex += spawned;
    this.spawnTimer =
      wanted > 0 && spawned === wanted
        ? hordeIntervalForWave(this.waveNumber)
        : HORDE_RETRY_SECONDS;
  }

  private emitRemaining(): void {
    const remaining = this.remainingCount;
    if (remaining === this.lastEmittedRemaining) return;
    this.lastEmittedRemaining = remaining;
    this.callbacks.onRemainingChanged(remaining);
  }

  private checkWaveComplete(): void {
    if (this.waveDone || this.spawnQueueIndex < this.spawnOrder.length) return;
    if (this.zombies.getActiveCount() > 0) return;

    // ZombieSystem normally records every kill synchronously. This clamp also
    // makes debug despawns deterministic if they suppress individual events.
    this.killedCount = this.assignedCount;
    this.emitRemaining();
    this.waveDone = true;
    this.callbacks.onWaveComplete(
      this.waveNumber,
      waveRewardForWave(this.waveNumber),
    );
  }
}
