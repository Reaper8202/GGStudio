import type { ZombieSystem } from './zombies/ZombieSystem.ts';
import type { ZombieKind } from './zombies/Zombie.ts';

const HORDE_SIZE_MIN = 8;
const HORDE_SIZE_MAX = 14;
const HORDE_RETRY_SECONDS = 0.5;

export interface WaveManagerCallbacks {
  onRemainingChanged(remaining: number): void;
  onWaveComplete(wave: number, reward: number): void;
}

export interface WaveComposition {
  walker: number;
  thrower: number;
  worker: number;
  'phone-addict': number;
}

/** Normals remain the overwhelming majority while specialists unlock slowly. */
export function zombieCompositionForWave(wave: number): WaveComposition {
  const safeWave = safeWaveNumber(wave);
  return {
    walker: Math.min(10 + safeWave * 3, 70),
    thrower:
      safeWave >= 4 ? Math.min(2 + Math.floor((safeWave - 4) / 2), 10) : 0,
    worker: safeWave >= 7 ? Math.min(1 + Math.floor((safeWave - 7) / 3), 6) : 0,
    'phone-addict':
      safeWave >= 10 ? Math.min(1 + Math.floor((safeWave - 10) / 4), 6) : 0,
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
  return Math.min(24 + safeWave * 2, 48);
}

export function healthMultiplierForWave(wave: number): number {
  const safeWave = safeWaveNumber(wave);
  return Math.min(1 + 0.1 * (safeWave - 1), 2.8);
}

export function speedMultiplierForWave(wave: number): number {
  const safeWave = safeWaveNumber(wave);
  return Math.min(1 + 0.025 * (safeWave - 1), 1.45);
}

export function attackDamageMultiplierForWave(wave: number): number {
  const safeWave = safeWaveNumber(wave);
  return Math.min(1 + 0.06 * (safeWave - 1), 2);
}

export function waveRewardForWave(wave: number): number {
  return 40 + wave * 10;
}

export function hordeIntervalForWave(wave: number): number {
  const safeWave = safeWaveNumber(wave);
  // Later waves spawn more often so pressure comes from tempo instead of health.
  if (safeWave >= 13) return 1.05;
  if (safeWave >= 6) return 1.25;
  return 1.45;
}

function safeWaveNumber(wave: number): number {
  return Math.max(1, Math.floor(Number.isFinite(wave) ? wave : 1));
}

function hordeSizeForWave(): number {
  return (
    HORDE_SIZE_MIN +
    Math.floor(Math.random() * (HORDE_SIZE_MAX - HORDE_SIZE_MIN + 1))
  );
}

function spawnOrderForWave(wave: number): ZombieKind[] {
  const composition = zombieCompositionForWave(wave);
  const specials: ZombieKind[] = [];
  for (const kind of ['thrower', 'worker', 'phone-addict'] as const) {
    for (let i = 0; i < composition[kind]; i++) specials.push(kind);
  }
  if (specials.length === 0) return Array(composition.walker).fill('walker');

  const order: ZombieKind[] = [];
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
    this.emitRemaining();
  }

  fixedUpdate(dt: number): void {
    if (this.waveDone) return;

    if (this.spawnQueueIndex < this.spawnOrder.length) {
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
    this.assignedCount += spawned;
    this.emitRemaining();
    return spawned;
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
