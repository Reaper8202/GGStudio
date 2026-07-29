import { describe, expect, it } from 'vitest';
import {
  createClearedWaveCheckpoint,
  createInitialRunCheckpoint,
  fullPartHp,
  prepareCheckpointForGarageFight,
  recoverRunFromCheckpoint,
  runStateFromCheckpoint,
  savedRunFromCheckpoint,
} from '../src/app/App.ts';
import { BLUEPRINT_SCHEMA_VERSION } from '../src/core/types.ts';
import type { VehicleBlueprint } from '../src/core/types.ts';
import { getEffectiveDef } from '../src/core/upgrades.ts';
import { DEFAULT_BIOME_ID } from '../src/survival/arena/recipes/index.ts';
import {
  createWaveClearPayload,
  SurvivalMode,
} from '../src/survival/SurvivalMode.ts';

function checkpointBlueprint(): VehicleBlueprint {
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    id: 'checkpoint-rig',
    name: 'Checkpoint Rig',
    parts: [
      {
        id: 'core',
        defId: 'chassis-core',
        pos: { x: 0, y: 0, z: 0 },
        orient: 0,
        config: { level: 2 },
      },
      {
        id: 'seat',
        defId: 'frame-box',
        pos: { x: 0, y: 1, z: 0 },
        orient: 0,
        config: {},
      },
      {
        id: 'frame',
        defId: 'frame-box',
        pos: { x: 1, y: 0, z: 0 },
        orient: 0,
        config: {},
      },
    ],
  };
}

describe('run checkpoints', () => {
  it('starts wave 1 with explicit effective full HP for every part', () => {
    const blueprint = checkpointBlueprint();
    const checkpoint = createInitialRunCheckpoint(blueprint, 'snowfield');

    expect(checkpoint).toMatchObject({
      wave: 1,
      kills: 0,
      biomeId: 'snowfield',
      score: 0,
      bankedEarnings: 0,
      partHp: fullPartHp(blueprint),
    });
    expect(checkpoint.partHp.core).toBe(
      getEffectiveDef(blueprint.parts[0]!).health,
    );
  });

  it('commits surviving parts and their exact damaged HP for the next wave', () => {
    const checkpoint = createClearedWaveCheckpoint({
      blueprint: checkpointBlueprint(),
      nextWave: 2,
      survivingPartIds: ['core', 'seat'],
      partHp: { core: 217.5, seat: 61, frame: 0 },
      kills: 9,
      biomeId: 'desert',
      seed: 42,
      score: 0,
      bankedEarnings: 73,
      elapsedSeconds: 120,
    });

    expect(checkpoint).toMatchObject({
      wave: 2,
      partHp: { core: 217.5, seat: 61 },
      kills: 9,
      score: 0,
      bankedEarnings: 73,
    });
    expect(checkpoint.blueprint.parts.map((part) => part.id)).toEqual([
      'core',
      'seat',
    ]);
  });

  it('starts Continue and Garage Fight from equivalent HP without repairs', () => {
    const checkpoint = createClearedWaveCheckpoint({
      blueprint: checkpointBlueprint(),
      nextWave: 4,
      survivingPartIds: ['core', 'seat'],
      partHp: { core: 188, seat: 47 },
      kills: 31,
      biomeId: 'snowfield',
      seed: 314159,
      score: 0,
      bankedEarnings: 240,
      elapsedSeconds: 120,
    });

    const continued = runStateFromCheckpoint(checkpoint);
    const fromGarage = runStateFromCheckpoint(
      prepareCheckpointForGarageFight(checkpoint, checkpoint.blueprint),
    );

    expect(fromGarage).toEqual(continued);
    expect(fromGarage).toMatchObject({
      wave: 4,
      partHp: { core: 188, seat: 47 },
      kills: 31,
    });
  });

  it('recovers the failed-wave checkpoint, keeps cleared losses, heals survivors, and restarts at wave 1', () => {
    const failedWaveStart = createClearedWaveCheckpoint({
      blueprint: checkpointBlueprint(),
      nextWave: 5,
      survivingPartIds: ['core', 'seat'],
      partHp: { core: 155, seat: 39, frame: 0 },
      kills: 54,
      biomeId: 'graveyard',
      seed: 9001,
      score: 0,
      bankedEarnings: 410,
      elapsedSeconds: 120,
    });

    const recovered = recoverRunFromCheckpoint(failedWaveStart);

    expect(recovered.blueprint.parts.map((part) => part.id)).toEqual([
      'core',
      'seat',
    ]);
    expect(recovered.partHp).toEqual(fullPartHp(recovered.blueprint));

    const nextRun = createInitialRunCheckpoint(
      recovered.blueprint,
      DEFAULT_BIOME_ID,
    );
    expect(nextRun.wave).toBe(1);
    expect(nextRun.blueprint.parts.map((part) => part.id)).not.toContain(
      'frame',
    );
    expect(nextRun.partHp).toEqual(recovered.partHp);
  });

  it('saves wave-start checkpoint HP and kills rather than live mid-wave values', () => {
    const checkpoint = createClearedWaveCheckpoint({
      blueprint: checkpointBlueprint(),
      nextWave: 3,
      survivingPartIds: ['core', 'seat'],
      partHp: { core: 201, seat: 72 },
      kills: 18,
      biomeId: 'desert',
      seed: 8675309,
      score: 0,
      bankedEarnings: 165,
      elapsedSeconds: 120,
    });
    const liveMidWave = {
      wave: 3,
      kills: 29,
      partHp: { core: 43, seat: 8 },
    };

    const saved = savedRunFromCheckpoint(checkpoint, 1_800_000_000_000);

    expect(saved).toMatchObject({
      schemaVersion: 5,
      wave: checkpoint.wave,
      kills: checkpoint.kills,
      biomeId: checkpoint.biomeId,
      seed: checkpoint.seed,
      bankedEarnings: checkpoint.bankedEarnings,
      partHp: checkpoint.partHp,
    });
    expect(saved.kills).not.toBe(liveMidWave.kills);
    expect(saved.partHp).not.toEqual(liveMidWave.partHp);
  });

  it('defaults a saved run to resuming in the arena on the checkpoint wave', () => {
    const checkpoint = createInitialRunCheckpoint(
      checkpointBlueprint(),
      'graveyard',
    );

    const saved = savedRunFromCheckpoint(checkpoint, 1_800_000_000_000);

    expect(saved.phase).toBe('wave');
    expect(saved.activeWave).toBe(checkpoint.wave);
  });

  it('records the Garage phase and the wave the HUD was showing', () => {
    // Quitting from the Build Phase: the checkpoint has already advanced to
    // wave 5, but the player last fought wave 4.
    const checkpoint = createClearedWaveCheckpoint({
      blueprint: checkpointBlueprint(),
      nextWave: 5,
      survivingPartIds: ['core', 'seat'],
      partHp: { core: 201, seat: 72 },
      kills: 18,
      biomeId: 'desert',
      seed: 8675309,
      score: 640,
      bankedEarnings: 165,
      elapsedSeconds: 120,
    });

    const saved = savedRunFromCheckpoint(
      checkpoint,
      1_800_000_000_000,
      'build',
      4,
    );

    expect(saved.phase).toBe('build');
    expect(saved.activeWave).toBe(4);
    expect(saved.wave).toBe(5);
  });

  it('passes equivalent survivor HP and cumulative kills through both clear actions', () => {
    const payload = createWaveClearPayload(
      2,
      ['core', 'seat'],
      { core: 175, seat: 44 },
      23,
      940,
      186,
    );

    expect(payload).toEqual({
      clearedRun: { wave: 2, elapsedSeconds: 186 },
      nextRun: { wave: 3, elapsedSeconds: 186 },
      survivingPartIds: ['core', 'seat'],
      partHp: { core: 175, seat: 44 },
      kills: 23,
      score: 940,
    });
  });

  it('offers the next-wave checkpoint immediately after clear rewards are banked', () => {
    let bankedEarnings = 20;
    const checkpointCalls: unknown[][] = [];
    const mode = Object.create(SurvivalMode.prototype) as unknown as {
      queueCompletedStepTransition(): void;
    };
    Object.assign(mode, {
      phase: 'cleared',
      pendingWaveKillReward: 7,
      pendingWaveReward: 13,
      pendingTransition: null,
      waveMoneyEarned: 0,
      lastHudPending: -1,
      currentWave: 2,
      kills: 23,
      runScore: 940,
      runElapsedSeconds: 186,
      vehicle: {
        isDestroyed: () => false,
        survivingPartIds: () => ['core', 'seat'],
        partHpSnapshot: () => ({ core: 175, seat: 44 }),
      },
      callbacks: {
        onReward: (amount: number) => {
          bankedEarnings += amount;
          return amount;
        },
        onWaveCheckpoint: (...args: unknown[]) =>
          checkpointCalls.push([bankedEarnings, ...args]),
      },
      stopVehicleMotion: () => undefined,
      showVictory: () => undefined,
      queueGameOver: () => undefined,
    });

    mode.queueCompletedStepTransition();

    expect(checkpointCalls).toEqual([
      [
        40,
        { wave: 3, elapsedSeconds: 186 },
        ['core', 'seat'],
        { core: 175, seat: 44 },
        23,
        940,
      ],
    ]);
  });
});
