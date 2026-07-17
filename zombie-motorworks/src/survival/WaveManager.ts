import type { ZombieSystem } from './zombies/ZombieSystem.ts';

const HORDE_SIZE_MIN = 3;
const HORDE_SIZE_MAX = 8;
const HORDE_INTERVAL_SECONDS = 3;
const HORDE_RETRY_SECONDS = 0.5;

export interface WaveManagerCallbacks {
  onRemainingChanged(remaining: number): void;
  onWaveComplete(wave: number, reward: number): void;
}

export function zombieCountForWave(wave: number): number {
  return 8 + wave * 3;
}

export function maxActiveZombiesForWave(wave: number): number {
  return Math.min(8 + wave, 30);
}

export function healthMultiplierForWave(wave: number): number {
  return 1 + (wave - 1) * 0.12;
}

export function speedMultiplierForWave(wave: number): number {
  return 1 + Math.min((wave - 1) * 0.025, 0.5);
}

export function waveRewardForWave(wave: number): number {
  return 100 + wave * 25;
}

function hordeSizeForWave(wave: number): number {
  const max = Math.min(
    HORDE_SIZE_MIN + 1 + Math.floor(wave / 2),
    HORDE_SIZE_MAX,
  );
  return (
    HORDE_SIZE_MIN + Math.floor(Math.random() * (max - HORDE_SIZE_MIN + 1))
  );
}

/** Fixed-step endless-wave director with direct callbacks and no event bus. */
export class WaveManager {
  private assignedCount = 0;
  private spawnedCount = 0;
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
    this.spawnedCount = 0;
    this.killedCount = 0;
    this.spawnTimer = 0;
    this.waveDone = false;
    this.lastEmittedRemaining = -1;

    this.zombies.setWaveMultipliers(
      healthMultiplierForWave(this.waveNumber),
      speedMultiplierForWave(this.waveNumber),
    );
    this.emitRemaining();
  }

  fixedUpdate(dt: number): void {
    if (this.waveDone) return;

    if (this.spawnedCount < this.assignedCount) {
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

  /**
   * Marks pending assignments as debug kills before SurvivalMode kills every
   * active zombie. Returns the virtual-kill count so run rewards stay faithful.
   */
  prepareDebugKillAll(): number {
    if (this.waveDone) return 0;
    const unspawned = Math.max(0, this.assignedCount - this.spawnedCount);
    this.spawnedCount = this.assignedCount;
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
    this.spawnedCount = 0;
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
      hordeSizeForWave(this.waveNumber),
      this.assignedCount - this.spawnedCount,
      headroom,
    );
    const spawned =
      wanted > 0
        ? Math.min(wanted, Math.max(0, this.zombies.trySpawnHorde(wanted)))
        : 0;

    this.spawnedCount += spawned;
    this.spawnTimer =
      wanted > 0 && spawned === wanted
        ? HORDE_INTERVAL_SECONDS
        : HORDE_RETRY_SECONDS;
  }

  private emitRemaining(): void {
    const remaining = this.remainingCount;
    if (remaining === this.lastEmittedRemaining) return;
    this.lastEmittedRemaining = remaining;
    this.callbacks.onRemainingChanged(remaining);
  }

  private checkWaveComplete(): void {
    if (this.waveDone || this.spawnedCount < this.assignedCount) return;
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
