import { describe, expect, it, vi } from 'vitest';
import {
  SurvivalMode,
  type SurvivalCallbacks,
  type SurvivalPhase,
} from '../src/survival/SurvivalMode.ts';
import { BASE_ZOMBIE_STATS } from '../src/survival/zombies/zombieConfig.ts';

interface PendingRewardsHarness {
  disposed: boolean;
  phase: SurvivalPhase;
  kills: number;
  phoneAddictKills: number;
  currentWave: number;
  debugProgressionSuppressed: boolean;
  pendingWaveKillReward: number;
  pendingWaveReward: number;
  waveMoneyEarned: number;
  pendingTransition: null;
  pointerFiring: boolean;
  keys: Set<string>;
  callbacks: SurvivalCallbacks;
  waves: {
    recordZombieKilled(): void;
    prepareDebugKillAll(): number;
    fixedUpdate(dt: number): void;
  };
  zombies: {
    clearLandmines(): void;
    forceKillAll(): void;
  };
  vehicle: {
    isDestroyed(): boolean;
    partHpSnapshot(): Record<string, number>;
    finishStep(): never[];
  };
  countdownOverlay: { style: { display: string } };
  stuckPrompt: { classList: { remove(...tokens: string[]): void } };
  stopVehicleMotion(): void;
  showVictory(): void;
  queueGameOver(pendingMoneyDiscarded?: number): void;
  attachNewIslands(islands: never[]): void;
  syncView(dt: number): void;
  renderer: { render(scene: object, camera: object): void };
  scene: object;
  camera: object;
  flushPendingTransition(): void;
  handleZombieKilled(reward: number, kind: 'walker' | 'phone-addict'): void;
  onWaveComplete(wave: number, reward: number): void;
  queueCompletedStepTransition(): void;
  onResetWave(): void;
  onSaveAndQuit(): void;
  debugKillAllZombies(): void;
}

function createHarness(options: { destroyed?: boolean } = {}): {
  mode: PendingRewardsHarness;
  profile: { money: number };
  rewardCalls: number[];
  discardedCalls: number[];
  resetCalls: number[];
  saveCalls: number[];
} {
  const profile = { money: 100 };
  const rewardCalls: number[] = [];
  const discardedCalls: number[] = [];
  const resetCalls: number[] = [];
  const saveCalls: number[] = [];
  const callbacks = {
    profileMoney: () => profile.money,
    runEarnings: () => profile.money - 100,
    onReward: (amount: number) => {
      rewardCalls.push(amount);
      profile.money += amount;
      return amount;
    },
    onExit: vi.fn(),
    onWaveAdvance: vi.fn(),
    onBuildPhase: vi.fn(),
    onGameOver: vi.fn(),
    onResetWave: (run: { wave: number }) => resetCalls.push(run.wave),
    onCheatInfiniteMoney: vi.fn(),
    onPhoneAddictKilled: vi.fn(),
    onWaveCleared: vi.fn(),
    onSaveAndQuit: (snapshot: { wave: number }) =>
      saveCalls.push(snapshot.wave),
  } satisfies SurvivalCallbacks;
  const mode = Object.create(
    SurvivalMode.prototype,
  ) as unknown as PendingRewardsHarness;
  Object.assign(mode, {
    disposed: false,
    phase: 'active' satisfies SurvivalPhase,
    kills: 0,
    phoneAddictKills: 0,
    currentWave: 1,
    debugProgressionSuppressed: false,
    pendingWaveKillReward: 0,
    pendingWaveReward: 0,
    waveMoneyEarned: 0,
    pendingTransition: null,
    pointerFiring: false,
    keys: new Set<string>(),
    callbacks,
    waves: {
      recordZombieKilled: vi.fn(),
      prepareDebugKillAll: () => 0,
      fixedUpdate: vi.fn(),
    },
    zombies: { clearLandmines: vi.fn(), forceKillAll: vi.fn() },
    vehicle: {
      isDestroyed: () => options.destroyed ?? false,
      partHpSnapshot: () => ({ chassis: 75 }),
      finishStep: () => [],
    },
    countdownOverlay: { style: { display: '' } },
    stuckPrompt: { classList: { remove: vi.fn() } },
    stopVehicleMotion: vi.fn(),
    showVictory: vi.fn(),
    attachNewIslands: vi.fn(),
    syncView: vi.fn(),
    renderer: { render: vi.fn() },
    scene: {},
    camera: {},
    flushPendingTransition: vi.fn(),
    queueGameOver(pendingMoneyDiscarded = 0) {
      discardedCalls.push(pendingMoneyDiscarded);
      mode.phase = 'gameOver';
    },
  });
  return {
    mode,
    profile,
    rewardCalls,
    discardedCalls,
    resetCalls,
    saveCalls,
  };
}

describe('pending survival wave rewards', () => {
  it('keeps kill rewards pending, then banks kills plus clear bonus once', () => {
    const { mode, profile, rewardCalls } = createHarness();

    mode.handleZombieKilled(7, 'walker');
    mode.handleZombieKilled(11, 'walker');
    mode.handleZombieKilled(13, 'walker');

    expect(profile.money).toBe(100);
    expect(rewardCalls).toEqual([]);
    expect(mode.pendingWaveKillReward).toBe(31);

    mode.onWaveComplete(1, 50);
    expect(profile.money).toBe(100);

    mode.queueCompletedStepTransition();
    mode.queueCompletedStepTransition();

    expect(rewardCalls).toEqual([81]);
    expect(profile.money).toBe(181);
    expect(mode.waveMoneyEarned).toBe(81);
    expect(mode.pendingWaveKillReward).toBe(0);
    expect(mode.pendingWaveReward).toBe(0);
  });

  it('discards current-wave kill rewards when the vehicle is destroyed', () => {
    const { mode, profile, rewardCalls, discardedCalls } = createHarness({
      destroyed: true,
    });
    mode.handleZombieKilled(9, 'walker');
    mode.handleZombieKilled(12, 'walker');

    mode.queueCompletedStepTransition();

    expect(mode.phase).toBe('gameOver');
    expect(profile.money).toBe(100);
    expect(rewardCalls).toEqual([]);
    expect(discardedCalls).toEqual([21]);
    expect(mode.pendingWaveKillReward).toBe(0);
    expect(mode.pendingWaveReward).toBe(0);
  });

  it('discards kills and clear bonus when destruction lands on the completing step', () => {
    const { mode, profile, rewardCalls, discardedCalls } = createHarness({
      destroyed: true,
    });
    mode.handleZombieKilled(23, 'walker');
    mode.onWaveComplete(1, 50);

    mode.queueCompletedStepTransition();

    expect(mode.phase).toBe('gameOver');
    expect(profile.money).toBe(100);
    expect(rewardCalls).toEqual([]);
    expect(discardedCalls).toEqual([73]);
    expect(mode.pendingWaveKillReward).toBe(0);
    expect(mode.pendingWaveReward).toBe(0);
  });

  it('discards both pending buckets on reset without banking them', () => {
    const { mode, profile, rewardCalls, resetCalls } = createHarness();
    mode.handleZombieKilled(17, 'walker');
    mode.onWaveComplete(1, 50);

    mode.onResetWave();

    expect(resetCalls).toEqual([1]);
    expect(profile.money).toBe(100);
    expect(rewardCalls).toEqual([]);
    expect(mode.pendingWaveKillReward).toBe(0);
    expect(mode.pendingWaveReward).toBe(0);
  });

  it('discards both pending buckets on save and quit without banking them', () => {
    const { mode, profile, rewardCalls, saveCalls } = createHarness();
    mode.handleZombieKilled(19, 'walker');
    mode.onWaveComplete(1, 50);

    mode.onSaveAndQuit();

    expect(saveCalls).toEqual([1]);
    expect(profile.money).toBe(100);
    expect(rewardCalls).toEqual([]);
    expect(mode.pendingWaveKillReward).toBe(0);
    expect(mode.pendingWaveReward).toBe(0);
  });

  it('banks force-completed debug kills through the same pending total', () => {
    const { mode, profile, rewardCalls } = createHarness();
    mode.waves.prepareDebugKillAll = () => 2;
    mode.zombies.forceKillAll = () => {
      mode.handleZombieKilled(7, 'walker');
      mode.handleZombieKilled(11, 'walker');
    };
    mode.waves.fixedUpdate = () => mode.onWaveComplete(1, 50);

    mode.debugKillAllZombies();

    const expected = 2 * BASE_ZOMBIE_STATS.reward + 7 + 11 + 50;
    expect(rewardCalls).toEqual([expected]);
    expect(profile.money).toBe(100 + expected);
    expect(mode.waveMoneyEarned).toBe(expected);
    expect(mode.pendingWaveKillReward).toBe(0);
    expect(mode.pendingWaveReward).toBe(0);
  });
});
