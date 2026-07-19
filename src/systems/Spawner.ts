import { GameConfig } from '../config/GameConfig';
import type { DifficultyDirector } from './DifficultyDirector';
import type { Rng } from './Rng';

export type ObstacleKind = 'low' | 'high' | 'block' | 'platform';
export type Cell = ObstacleKind | 'none';

/** The game shell provides entity lifecycle; the spawner only decides what/when. */
export interface SpawnSink {
  spawnObstacle(lane: number, kind: ObstacleKind, z: number): void;
  spawnCoin(lane: number, z: number, elevated: boolean): void;
}

/** Spawn depth: far ahead of the player (player stands at z = 0, world moves +z). */
const SPAWN_Z = -85;
const COIN_SPACING = 2.2;

/**
 * Wave-based generator with a solvability guarantee.
 *
 * Obstacles spawn as a "wave": one cell per lane. Between waves the player
 * can make a bounded number of lane switches (gap time / switch time). We
 * track the set of lanes the player could be alive in (`feasible`) and only
 * emit waves that keep that set non-empty — low/high cells are survivable
 * in-lane (jump/slide), only `block` forces a lane change. Hence no
 * unavoidable sequence can ever be generated.
 */
export class Spawner {
  private timerMs: number;
  private waveIndex = 0;
  private feasible: boolean[] = new Array<boolean>(GameConfig.lanes).fill(true);
  private lastGapMs: number;
  private coinDrought = 0;

  constructor(
    private readonly rng: Rng,
    private readonly difficulty: DifficultyDirector,
    private readonly sink: SpawnSink,
    /** Optional deterministic spawn log (used by acceptance tests). */
    private readonly log?: (entry: string) => void,
  ) {
    // Give the player a moment before the (trivial) first wave.
    this.timerMs = 1800;
    this.lastGapMs = GameConfig.spawn.baseGapMs;
  }

  update(deltaMs: number, meters: number): void {
    this.timerMs -= deltaMs;
    if (this.timerMs > 0) return;

    const gap = this.difficulty.gapMsAt(meters);
    // ±12% jitter, still deterministic (seeded rng)
    this.timerMs += gap * (0.88 + 0.24 * this.rng.next());
    this.spawnWave(meters);
    this.lastGapMs = gap;
  }

  /**
   * After a revive the board ahead is cleared — any lane is survivable, and
   * the next wave is pushed back so the player re-orients.
   */
  reviveGrace(): void {
    this.feasible.fill(true);
    this.timerMs = Math.max(this.timerMs, 1200);
  }

  private spawnWave(meters: number): void {
    const wave =
      this.waveIndex === 0 ? this.firstWave() : this.generateSolvableWave();
    this.waveIndex++;

    for (let lane = 0; lane < wave.length; lane++) {
      const cell = wave[lane];
      if (cell !== 'none') this.sink.spawnObstacle(lane, cell, SPAWN_Z);
    }
    this.log?.(`wave ${this.waveIndex} @${meters.toFixed(0)}m ${wave.join(',')}`);

    // Platforms always carry a top-side coin trail (at most one per wave —
    // see randomWave), regardless of the pity-ruled coin drought below.
    const platformLane = wave.indexOf('platform');
    if (platformLane >= 0) this.spawnPlatformCoins(platformLane);

    this.maybeSpawnCoins(wave);
  }

  /**
   * Four coins along the top of a platform spawned at lane `lane`. The
   * platform's own spawnObstacle z (SPAWN_Z) is its CENTER (see
   * PlatformObstacle), so the footprint spans
   * [SPAWN_Z - length/2, SPAWN_Z + length/2]. Coins sit `margin` in from
   * each end and are evenly spaced across the remaining span.
   */
  private spawnPlatformCoins(lane: number): void {
    const length = GameConfig.platform.length;
    const margin = 1.2;
    const start = SPAWN_Z - length / 2 + margin;
    const end = SPAWN_Z + length / 2 - margin;
    const step = (end - start) / 3; // 4 coins → 3 gaps
    for (let i = 0; i < 4; i++) {
      this.sink.spawnCoin(lane, start + step * i, true);
    }
    this.log?.(`coins top lane ${lane}`);
  }

  /** Onboarding rule: first obstacle is trivially avoidable. */
  private firstWave(): Cell[] {
    const wave: Cell[] = new Array<Cell>(GameConfig.lanes).fill('none');
    wave[this.rng.chance(0.5) ? 0 : GameConfig.lanes - 1] = 'low';
    this.feasible.fill(true); // survivable everywhere (low is jumpable in-lane)
    return wave;
  }

  /** Lane switches the player can fit into the gap before this wave. */
  private switchBudget(): number {
    const perSwitch = GameConfig.laneSwitchMs + GameConfig.laneSwitchBufferMs;
    return Math.max(1, Math.min(2, Math.floor(this.lastGapMs / perSwitch)));
  }

  private generateSolvableWave(): Cell[] {
    const n = this.switchBudget();
    for (let attempt = 0; attempt < 8; attempt++) {
      const wave = this.randomWave();
      const next = this.feasibleAfter(wave, n);
      if (next.some(Boolean)) {
        this.feasible = next;
        return wave;
      }
    }
    // Fallback: clear a cell the player can definitely reach.
    const wave = this.randomWave();
    const from = this.feasible.findIndex(Boolean);
    const reachTarget = from < 0 ? 1 : from;
    wave[reachTarget] = 'none';
    this.feasible = this.feasibleAfter(wave, n);
    return wave;
  }

  private randomWave(): Cell[] {
    const d = this.difficulty01();
    const wave: Cell[] = [];
    let sawPlatform = false;
    for (let lane = 0; lane < GameConfig.lanes; lane++) {
      let cell = this.randomCell(d);
      // At most one platform per wave — demote any extra to 'none' (still
      // trivially survivable, so this can only help feasibleAfter, never
      // hurt it).
      if (cell === 'platform') {
        if (sawPlatform) cell = 'none';
        sawPlatform = true;
      }
      wave.push(cell);
    }
    return wave;
  }

  private difficulty01(): number {
    // Derived from gap shrinkage so it needs no extra plumbing.
    const span = GameConfig.spawn.baseGapMs - GameConfig.spawn.minGapMs;
    return span <= 0 ? 1 : 1 - (this.lastGapMs - GameConfig.spawn.minGapMs) / span;
  }

  private randomCell(d: number): Cell {
    // Weights shift from mostly-empty toward dense/blocky with difficulty.
    const wNone = 0.55 - 0.3 * d;
    const wLow = 0.2 + 0.05 * d;
    const wHigh = 0.15 + 0.05 * d;
    // Platforms only start appearing once the run has some pace to it.
    const wPlatform = d < 0.15 ? 0 : 0.12;
    // remainder: block
    const r = this.rng.next();
    if (r < wNone) return 'none';
    if (r < wNone + wLow) return 'low';
    if (r < wNone + wLow + wHigh) return 'high';
    if (r < wNone + wLow + wHigh + wPlatform) return 'platform';
    return 'block';
  }

  /**
   * Lanes the player could be alive in after this wave. 'platform' is
   * survivable in-lane just like 'low' (jump onto it) — only 'block' forces
   * a lane change, so it's the only kind excluded here.
   */
  private feasibleAfter(wave: Cell[], switches: number): boolean[] {
    const next = new Array<boolean>(GameConfig.lanes).fill(false);
    for (let m = 0; m < GameConfig.lanes; m++) {
      if (wave[m] === 'block') continue;
      for (let f = 0; f < GameConfig.lanes; f++) {
        if (this.feasible[f] && Math.abs(m - f) <= switches) {
          next[m] = true;
          break;
        }
      }
    }
    return next;
  }

  private maybeSpawnCoins(wave: Cell[]): void {
    // Pity rule: never more than 2 coinless waves in a row, so an unlucky
    // seed can't produce a joyless stretch. Still fully deterministic.
    if (!this.rng.chance(GameConfig.spawn.coinChance) && this.coinDrought < 2) {
      this.coinDrought++;
      return;
    }
    this.coinDrought = 0;

    // Prefer a lane with a low barrier (arc over the jump), else any
    // survivable lane, else any non-block lane.
    const lowLanes: number[] = [];
    const safeLanes: number[] = [];
    for (let lane = 0; lane < wave.length; lane++) {
      if (wave[lane] === 'low') lowLanes.push(lane);
      // Platform lanes already get their own top-side coin trail above;
      // skip them here so a ground-level trailing row never spawns inside
      // the platform's footprint.
      if (wave[lane] !== 'block' && wave[lane] !== 'platform' && this.feasible[lane]) {
        safeLanes.push(lane);
      }
    }

    if (lowLanes.length > 0 && this.rng.chance(0.6)) {
      // Arc over the jump: coins straddle the barrier (kept off-screen at
      // spawn time so they never pop in).
      const lane = this.rng.pick(lowLanes);
      for (let i = -2; i <= 2; i++) {
        this.sink.spawnCoin(lane, SPAWN_Z - 3 + i * COIN_SPACING, Math.abs(i) <= 1);
      }
      this.log?.(`coins arc lane ${lane}`);
    } else if (safeLanes.length > 0) {
      // Trailing row in a safe lane, arriving after the wave.
      const lane = this.rng.pick(safeLanes);
      const count = 3 + this.rng.int(3);
      for (let i = 1; i <= count; i++) {
        this.sink.spawnCoin(lane, SPAWN_Z - 4 - i * COIN_SPACING, false);
      }
      this.log?.(`coins row lane ${lane} n=${count}`);
    }
  }
}
