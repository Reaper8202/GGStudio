/**
 * Application shell: owns the WebGL renderer and switches between the title,
 * editor, test chamber, and survival modes. RAPIER.init() runs once at boot.
 * Runtime modes deep-clone the blueprint; returning restores the editor with
 * the original untouched.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type {
  PartConfig,
  PlacedPart,
  Vec3i,
  VehicleBlueprint,
} from '../core/types.ts';
import {
  createEmptyBlueprint,
  pruneBlueprintToSurvivors,
} from '../core/blueprint.ts';
import { serializeBlueprint, deserializeBlueprint } from '../core/serialize.ts';
import { validateBlueprint } from '../core/placement.ts';
import { analyzeVehicle } from '../core/analysis.ts';
import { getPartDef } from '../core/parts.ts';
import { getEffectiveDef } from '../core/upgrades.ts';
import { composeOrientations, orientationFromSteps } from '../core/grid.ts';
import {
  BLUEPRINT_STORAGE_KEY,
  EditorMode,
  type EditorViewState,
} from '../editor/EditorMode.ts';
import { CommandHistory } from '../core/commands.ts';
import { ChamberMode, type ScenarioName } from '../chamber/ChamberMode.ts';
import type { VehicleControls } from '../runtime/vehicle.ts';
import { SurvivalMode } from '../survival/SurvivalMode.ts';
import type { RunState } from '../core/economy.ts';
import {
  defaultProfile,
  MINE_SWEEPER_UNLOCK_WAVE,
  type PlayerProfile,
} from '../core/profile.ts';
import type { SavedRun } from '../core/runSave.ts';
import { PROFILE_STORAGE_KEY, profileStore } from './profileStore.ts';
import { runSaveStore } from './runSaveStore.ts';
import { TitleScreen } from './TitleScreen.ts';

export interface RunCheckpoint {
  /** Wave the player will play next. */
  wave: number;
  /** Vehicle state committed at the start of `wave`. */
  blueprint: VehicleBlueprint;
  /** Per-part HP committed at the start of `wave`. */
  partHp: Record<string, number>;
  /** Cumulative kills committed before `wave`. */
  kills: number;
  /** Run earnings already credited before `wave`. */
  bankedEarnings: number;
}

export interface CheckpointRunState extends RunState {
  partHp: Record<string, number>;
  kills: number;
}

/** Effective maximum HP for every placed part in a blueprint. */
export function fullPartHp(bp: VehicleBlueprint): Record<string, number> {
  return Object.fromEntries(
    bp.parts.map((part) => [part.id, getEffectiveDef(part).health]),
  );
}

/** The immutable wave-start state for a brand-new run. */
export function createInitialRunCheckpoint(
  bp: VehicleBlueprint,
): RunCheckpoint {
  return {
    wave: 1,
    blueprint: pruneBlueprintToSurvivors(
      bp,
      bp.parts.map((part) => part.id),
    ),
    partHp: fullPartHp(bp),
    kills: 0,
    bankedEarnings: 0,
  };
}

function partHpForBlueprint(
  bp: VehicleBlueprint,
  partHp: Readonly<Record<string, number>>,
): Record<string, number> {
  return Object.fromEntries(
    bp.parts.map((part) => [
      part.id,
      partHp[part.id] ?? getEffectiveDef(part).health,
    ]),
  );
}

/** Commit permanent wave damage and prepare the vehicle's next-wave state. */
export function createClearedWaveCheckpoint(input: {
  blueprint: VehicleBlueprint;
  nextWave: number;
  survivingPartIds: readonly string[];
  partHp: Readonly<Record<string, number>>;
  kills: number;
  bankedEarnings: number;
}): RunCheckpoint {
  const blueprint = pruneBlueprintToSurvivors(
    input.blueprint,
    input.survivingPartIds,
  );
  return {
    wave: input.nextWave,
    blueprint,
    partHp: partHpForBlueprint(blueprint, input.partHp),
    kills: input.kills,
    bankedEarnings: input.bankedEarnings,
  };
}

/** Include garage edits in the checkpoint while preserving carried damage. */
export function prepareCheckpointForGarageFight(
  checkpoint: RunCheckpoint,
  bp: VehicleBlueprint,
): RunCheckpoint {
  const blueprint = pruneBlueprintToSurvivors(
    bp,
    bp.parts.map((part) => part.id),
  );
  return {
    ...checkpoint,
    blueprint,
    partHp: partHpForBlueprint(blueprint, checkpoint.partHp),
  };
}

/** Survival input derived only from the committed wave-start checkpoint. */
export function runStateFromCheckpoint(
  checkpoint: RunCheckpoint,
): CheckpointRunState {
  return {
    wave: checkpoint.wave,
    partHp: { ...checkpoint.partHp },
    kills: checkpoint.kills,
  };
}

/** Failed-wave recovery keeps committed parts but restores all of their HP. */
export function recoverRunFromCheckpoint(checkpoint: RunCheckpoint): {
  blueprint: VehicleBlueprint;
  partHp: Record<string, number>;
} {
  const blueprint = pruneBlueprintToSurvivors(
    checkpoint.blueprint,
    checkpoint.blueprint.parts.map((part) => part.id),
  );
  return { blueprint, partHp: fullPartHp(blueprint) };
}

/** Persistable schema derived only from a committed wave-start checkpoint. */
export function savedRunFromCheckpoint(
  checkpoint: RunCheckpoint,
  savedAt: number,
): SavedRun {
  return {
    schemaVersion: 2,
    wave: checkpoint.wave,
    kills: checkpoint.kills,
    bankedEarnings: checkpoint.bankedEarnings,
    blueprint: checkpoint.blueprint,
    partHp: { ...checkpoint.partHp },
    savedAt,
  };
}

/** Apply permanent wave progress and its catalog unlock to a profile. */
export function recordWaveCleared(
  profile: PlayerProfile,
  wave: number,
): void {
  profile.highestWaveCleared = Math.max(
    profile.highestWaveCleared ?? 0,
    wave,
  );
  if (
    wave >= MINE_SWEEPER_UNLOCK_WAVE &&
    !profile.unlockedDefIds.includes('mine-sweeper')
  ) {
    profile.unlockedDefIds.push('mine-sweeper');
  }
}

/** Apply the lifetime kill progress used by the EMP unlock gate. */
export function recordPhoneAddictKilled(profile: PlayerProfile): void {
  profile.phoneAddictsKilled = (profile.phoneAddictsKilled ?? 0) + 1;
}

/** Restore every persistent profile field owned by a fresh game. */
export function resetProfileForNewGame(profile: PlayerProfile): void {
  const fresh = defaultProfile();
  profile.schemaVersion = fresh.schemaVersion;
  profile.money = fresh.money;
  profile.unlockedDefIds = [...fresh.unlockedDefIds];
  profile.inventory = { ...fresh.inventory };
  delete profile.currentBlueprintName;
  delete profile.highestWaveCleared;
  delete profile.phoneAddictsKilled;
}

export class App {
  private renderer!: THREE.WebGLRenderer;
  private editor: EditorMode | null = null;
  private chamber: ChamberMode | null = null;
  private survival: SurvivalMode | null = null;
  private title: TitleScreen | null = null;
  private bp: VehicleBlueprint = createEmptyBlueprint('starter-rig');
  private readonly profile: PlayerProfile;
  private readonly saveExistedAtBoot: boolean;
  /** Survive editor <-> runtime-mode round trips: undo history and camera/layer. */
  private readonly history: CommandHistory;
  private savedView: EditorViewState | undefined;
  private activeRun: RunState | null = null;
  private checkpoint: RunCheckpoint | null = null;
  private inBuildPhase = false;
  private runMoneyEarned = 0;
  private runSummary:
    { wavesSurvived: number; moneyEarned: number } | undefined;
  private profileDirty = false;
  private profileFlushTimer: number | undefined;
  private saveFailureNotified = false;
  private pendingEditorNotice: string | undefined;

  constructor(private readonly root: HTMLElement) {
    // Raw-key detection must happen before profile loading can synthesize an
    // in-memory default. Loading currently does not persist it, but this order
    // keeps title-screen availability independent of that implementation detail.
    this.saveExistedAtBoot = this.hasStoredSave();
    this.profile = profileStore.load();
    this.history = new CommandHistory((moneyDelta) =>
      this.changeMoney(moneyDelta, true),
    );
    window.addEventListener('pagehide', this.flushDirtyProfile);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  async start(): Promise<void> {
    await RAPIER.init();
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.root.clientWidth, this.root.clientHeight);
    this.renderer.domElement.className = 'viewport';
    this.root.appendChild(this.renderer.domElement);
    window.addEventListener('resize', () => {
      this.renderer.setSize(this.root.clientWidth, this.root.clientHeight);
      this.editor?.resize(this.root.clientWidth, this.root.clientHeight);
      this.chamber?.resize(this.root.clientWidth, this.root.clientHeight);
      this.survival?.resize(this.root.clientWidth, this.root.clientHeight);
      this.title?.resize(this.root.clientWidth, this.root.clientHeight);
    });

    this.showTitle(this.saveExistedAtBoot);

    const loop = (): void => {
      requestAnimationFrame(loop);
      this.title?.update();
      this.editor?.update();
      this.chamber?.update();
      this.survival?.update();
    };
    loop();
  }

  /** True when a resumable run save exists. */
  hasStoredRun(): boolean {
    return runSaveStore.has();
  }

  /**
   * Persist the in-progress run and return to the title screen.
   * Called from the survival pause overlay; live mid-wave state is discarded.
   */
  saveAndQuitRun(): void {
    if (this.checkpoint === null) return;
    const savedRun = savedRunFromCheckpoint(this.checkpoint, Date.now());
    try {
      runSaveStore.save(savedRun);
    } catch {
      this.notifySaveFailure();
      return;
    }

    this.flushProfile();
    this.survival?.dispose();
    this.survival = null;
    this.clearSessionState();
    this.showTitle();
  }

  /** Load the saved run and drop straight into survival at its wave. */
  resumeSavedRun(): boolean {
    const savedRun = runSaveStore.load();
    if (savedRun === null) return false;

    this.disposeTitle();
    this.clearSessionState();
    this.bp = savedRun.blueprint;
    this.runMoneyEarned = savedRun.bankedEarnings;
    this.runSummary = undefined;
    this.checkpoint = {
      wave: savedRun.wave,
      blueprint: savedRun.blueprint,
      partHp: { ...savedRun.partHp },
      kills: savedRun.kills,
      bankedEarnings: savedRun.bankedEarnings,
    };
    this.activeRun = { wave: savedRun.wave };
    this.inBuildPhase = false;
    this.enterSurvival(this.bp, runStateFromCheckpoint(this.checkpoint));
    return true;
  }

  private openEditor(): void {
    this.disposeTitle();
    this.chamber?.dispose();
    this.chamber = null;
    this.survival?.dispose();
    this.survival = null;
    this.editor = new EditorMode(
      this.root,
      this.renderer,
      this.bp,
      (bp) => this.enterChamber(bp),
      (bp) => this.startOrResumeRun(bp),
      {
        history: this.history,
        view: this.savedView,
        profile: this.profile,
        persistProfile: () => this.saveProfileOrThrow(),
        onMenu: () => this.returnToTitle(),
        runContext:
          this.activeRun && this.inBuildPhase ? this.activeRun : undefined,
        runSummary: this.runSummary,
        notice: this.pendingEditorNotice,
      },
    );
    this.pendingEditorNotice = undefined;
    this.editor.resize(this.root.clientWidth, this.root.clientHeight);
  }

  private showTitle(hasSave = this.hasStoredSave()): void {
    if (this.activeRun && this.inBuildPhase) return;
    this.disposeTitle();
    this.title = new TitleScreen(
      this.root,
      this.renderer,
      hasSave,
      {
        onNewGame: () => this.beginNewGame(),
        onContinue: () => this.beginContinueGame(),
        onResumeRun: () => this.resumeSavedRun(),
      },
      runSaveStore.load(),
    );
  }

  private returnToTitle(): void {
    if (!this.editor || (this.activeRun && this.inBuildPhase)) return;
    this.bp = this.editor.blueprint();
    this.editor.persistGarage();
    this.editor.dispose();
    this.editor = null;
    this.showTitle();
  }

  private beginNewGame(): void {
    this.disposeTitle();
    this.clearStoredSave();
    resetProfileForNewGame(this.profile);
    this.resetSessionState();
    this.bp = buildStarterBlueprint();
    this.openEditor();
  }

  private beginContinueGame(): void {
    this.disposeTitle();
    this.resetSessionState();
    const loaded = this.loadCurrentBlueprint();
    if (loaded.kind === 'loaded') {
      this.bp = loaded.blueprint;
    } else {
      this.bp = buildStarterBlueprint();
      if (loaded.kind === 'failed') {
        this.pendingEditorNotice = `Saved vehicle could not be loaded — it has been preserved as ${loaded.name}`;
      }
    }
    this.openEditor();
  }

  private resetSessionState(): void {
    runSaveStore.clear();
    this.clearSessionState();
  }

  private clearSessionState(): void {
    this.history.clear();
    this.savedView = undefined;
    this.activeRun = null;
    this.checkpoint = null;
    this.inBuildPhase = false;
    this.runMoneyEarned = 0;
    this.runSummary = undefined;
  }

  private disposeTitle(): void {
    this.title?.dispose();
    this.title = null;
  }

  private hasStoredSave(): boolean {
    try {
      return (
        localStorage.getItem(PROFILE_STORAGE_KEY) !== null ||
        localStorage.getItem(BLUEPRINT_STORAGE_KEY) !== null
      );
    } catch {
      return false;
    }
  }

  private clearStoredSave(): void {
    for (const key of [PROFILE_STORAGE_KEY, BLUEPRINT_STORAGE_KEY]) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Keep the fresh in-memory game usable if persistence is unavailable.
      }
    }
  }

  private enterChamber(bp: VehicleBlueprint): void {
    this.bp = bp;
    this.savedView = this.editor?.viewState();
    this.editor?.dispose();
    this.editor = null;
    this.chamber = new ChamberMode(this.root, this.renderer, bp, () =>
      this.openEditor(),
    );
    this.chamber.resize(this.root.clientWidth, this.root.clientHeight);
  }

  private startOrResumeRun(bp: VehicleBlueprint): void {
    if (this.checkpoint !== null) {
      this.resumeRun(bp);
    } else {
      this.startRun(bp);
    }
  }

  private startRun(bp: VehicleBlueprint): void {
    runSaveStore.clear();
    this.runMoneyEarned = 0;
    this.runSummary = undefined;
    this.checkpoint = createInitialRunCheckpoint(bp);
    this.activeRun = { wave: this.checkpoint.wave };
    this.inBuildPhase = false;
    this.enterSurvival(
      this.checkpoint.blueprint,
      runStateFromCheckpoint(this.checkpoint),
    );
  }

  private resumeRun(bp: VehicleBlueprint): void {
    if (this.checkpoint === null) {
      this.startRun(bp);
      return;
    }
    this.checkpoint = prepareCheckpointForGarageFight(this.checkpoint, bp);
    this.activeRun = { wave: this.checkpoint.wave };
    this.inBuildPhase = false;
    this.enterSurvival(
      this.checkpoint.blueprint,
      runStateFromCheckpoint(this.checkpoint),
    );
  }

  private enterSurvival(bp: VehicleBlueprint, run: RunState): void {
    this.editor?.persistGarage();
    this.bp = bp;
    this.savedView = this.editor?.viewState();
    this.editor?.dispose();
    this.editor = null;
    this.chamber?.dispose();
    this.chamber = null;
    this.survival?.dispose();
    this.survival = new SurvivalMode(this.root, this.renderer, bp, run, {
      profileMoney: () => this.profile.money,
      runEarnings: () => this.runMoneyEarned,
      onReward: (amount) => this.creditRunReward(amount),
      onExit: (state) => this.finishRun(state),
      onWaveAdvance: (state, survivingPartIds, partHp, kills) => {
        this.commitClearedWaveCheckpoint(
          state.wave,
          survivingPartIds,
          partHp,
          kills,
        );
        this.activeRun = { wave: state.wave };
      },
      onBuildPhase: (state, survivingPartIds, partHp, kills) =>
        this.enterBuildPhase(state, survivingPartIds, partHp, kills),
      onWaveCheckpoint: (state, survivingPartIds, partHp, kills) => {
        this.commitClearedWaveCheckpoint(
          state.wave,
          survivingPartIds,
          partHp,
          kills,
        );
      },
      onGameOver: (state) => this.finishRun(state),
      onResetWave: (state) => this.resetSurvivalWave(state),
      onCheatInfiniteMoney: () => this.grantInfiniteMoney(),
      onPhoneAddictKilled: () => {
        recordPhoneAddictKilled(this.profile);
        this.markProfileDirty();
      },
      onWaveCleared: (wave) => {
        recordWaveCleared(this.profile, wave);
        this.markProfileDirty();
      },
      onSaveAndQuit: () => this.saveAndQuitRun(),
    });
    this.survival.resize(this.root.clientWidth, this.root.clientHeight);
  }

  private commitClearedWaveCheckpoint(
    nextWave: number,
    survivingPartIds: readonly string[],
    partHp: Record<string, number>,
    kills: number,
  ): void {
    this.checkpoint = createClearedWaveCheckpoint({
      blueprint: this.bp,
      nextWave,
      survivingPartIds,
      partHp,
      kills,
      bankedEarnings: this.runMoneyEarned,
    });
    this.bp = this.checkpoint.blueprint;
    this.history.clear();
  }

  private enterBuildPhase(
    run: RunState,
    survivingPartIds: readonly string[],
    partHp: Record<string, number>,
    kills: number,
  ): void {
    this.flushProfile();
    this.commitClearedWaveCheckpoint(
      run.wave + 1,
      survivingPartIds,
      partHp,
      kills,
    );
    this.activeRun = { wave: run.wave };
    this.inBuildPhase = true;
    this.runSummary = undefined;
    this.openEditor();
    // Persist permanent wave damage immediately; the history was intentionally
    // cleared because its pre-wave commands can reference parts that are gone.
    this.editor?.persistGarage();
  }

  private finishRun(run: RunState): void {
    runSaveStore.clear();
    this.flushProfile();
    if (this.checkpoint !== null) {
      this.bp = recoverRunFromCheckpoint(this.checkpoint).blueprint;
    }
    this.history.clear();
    this.runSummary = {
      wavesSurvived: Math.max(0, run.wave - 1),
      moneyEarned: this.runMoneyEarned,
    };
    this.activeRun = null;
    this.checkpoint = null;
    this.inBuildPhase = false;
    this.openEditor();
  }

  private resetSurvivalWave(run: RunState): void {
    if (this.checkpoint !== null) {
      this.bp = this.checkpoint.blueprint;
      this.activeRun = { wave: this.checkpoint.wave };
      this.inBuildPhase = false;
      this.enterSurvival(this.bp, runStateFromCheckpoint(this.checkpoint));
      return;
    }
    this.activeRun = { wave: run.wave };
    this.inBuildPhase = false;
    this.enterSurvival(this.bp, this.activeRun);
  }

  private grantInfiniteMoney(): void {
    const amount = Number.MAX_SAFE_INTEGER - this.profile.money;
    if (amount <= 0) return;
    this.changeMoney(amount, true);
    this.editor?.refreshProfile();
  }

  private creditRunReward(amount: number): number {
    const credited = Math.min(
      amount,
      Number.MAX_SAFE_INTEGER - this.profile.money,
    );
    if (credited <= 0) return 0;
    this.changeMoney(credited, false);
    this.runMoneyEarned += credited;
    return credited;
  }

  private changeMoney(moneyDelta: number, persist: boolean): void {
    if (!Number.isSafeInteger(moneyDelta)) {
      throw new Error('Money change must be a safe integer');
    }
    const next = this.profile.money + moneyDelta;
    if (!Number.isSafeInteger(next) || next < 0) {
      throw new Error('Insufficient funds');
    }
    this.profile.money = next;
    if (persist) {
      try {
        this.saveProfileOrThrow();
      } catch (error) {
        this.profile.money -= moneyDelta;
        throw error;
      }
    } else {
      this.markProfileDirty();
    }
  }

  private loadCurrentBlueprint():
    | { kind: 'missing' }
    | { kind: 'loaded'; blueprint: VehicleBlueprint }
    | { kind: 'failed'; name: string } {
    const name = this.profile.currentBlueprintName;
    if (!name) return { kind: 'missing' };
    try {
      const slots = JSON.parse(
        localStorage.getItem(BLUEPRINT_STORAGE_KEY) ?? '{}',
      ) as Record<string, unknown>;
      const json = slots[name];
      if (typeof json !== 'string') return { kind: 'missing' };
      return { kind: 'loaded', blueprint: deserializeBlueprint(json) };
    } catch {
      return { kind: 'failed', name };
    }
  }

  private markProfileDirty(): void {
    this.profileDirty = true;
    if (this.profileFlushTimer !== undefined) return;
    this.profileFlushTimer = window.setTimeout(() => {
      this.profileFlushTimer = undefined;
      this.flushProfile();
    }, 2_000);
  }

  private readonly flushDirtyProfile = (): void => {
    if (this.profileFlushTimer !== undefined) {
      window.clearTimeout(this.profileFlushTimer);
      this.profileFlushTimer = undefined;
    }
    this.flushProfile();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') this.flushDirtyProfile();
  };

  private flushProfile(): void {
    if (!this.profileDirty) return;
    try {
      profileStore.save(this.profile);
      this.profileDirty = false;
    } catch {
      this.notifySaveFailure();
    }
  }

  private saveProfileOrThrow(): void {
    try {
      profileStore.save(this.profile);
      this.profileDirty = false;
    } catch (error) {
      this.notifySaveFailure();
      throw error;
    }
  }

  private notifySaveFailure(): void {
    if (this.saveFailureNotified) return;
    this.saveFailureNotified = true;
    const notice = 'Progress could not be saved';
    if (this.editor) this.editor.showNotice(notice);
    else this.pendingEditorNotice = notice;
  }

  debugSeam(): Record<string, unknown> {
    return {
      orient: {
        yaw90: orientationFromSteps(0, 1, 0),
        yaw180: orientationFromSteps(0, 2, 0),
        rollX90: orientationFromSteps(1, 0, 0),
      },
      composeOrient: (a: number, b: number) => composeOrientations(a, b),
      mode: () =>
        this.title
          ? 'title'
          : this.survival
            ? 'survival'
            : this.chamber
              ? 'chamber'
              : 'editor',
      newGame: () => this.title?.requestNewGame() ?? false,
      continueGame: () => this.title?.continueGame() ?? false,
      hasStoredRun: () => this.hasStoredRun(),
      saveAndQuitRun: () => this.saveAndQuitRun(),
      resumeSavedRun: () => this.resumeSavedRun(),
      clearRunSave: () => runSaveStore.clear(),
      getBlueprintJson: () =>
        serializeBlueprint(this.editor?.blueprint() ?? this.bp),
      loadBlueprintJson: (json: string) =>
        this.editor?.replaceBlueprint(deserializeBlueprint(json)),
      place: (defId: string, pos: Vec3i, orient = 0, config: PartConfig = {}) =>
        this.editor?.debugPlace(defId, pos, orient, config),
      startTutorial: () => this.editor?.startTutorial(),
      tutorialState: () => this.editor?.debugTutorialState(),
      configureAt: (pos: Vec3i, config: PartConfig) =>
        this.editor?.debugConfigure(pos, config),
      undo: () => this.editor?.debugUndo(),
      redo: () => this.editor?.debugRedo(),
      validate: () =>
        validateBlueprint(this.editor?.blueprint() ?? this.bp, getPartDef),
      analyze: () =>
        analyzeVehicle(this.editor?.blueprint() ?? this.bp, getPartDef),
      enterTest: () => {
        const bp = this.editor?.blueprint();
        if (!bp) return false;
        const v = validateBlueprint(bp, getPartDef);
        if (v.errors.length > 0) return false;
        this.enterChamber(bp);
        return true;
      },
      enterSurvival: () => {
        const bp = this.editor?.blueprint();
        if (!bp) return false;
        const v = validateBlueprint(bp, getPartDef);
        if (v.errors.length > 0) return false;
        this.startOrResumeRun(bp);
        return true;
      },
      backToEditor: () => {
        if (this.survival && this.activeRun) this.finishRun(this.activeRun);
        else if (!this.editor && !this.title) this.openEditor();
      },
      setControls: (c: Partial<VehicleControls>) => {
        this.chamber?.debugSetControls(c);
        this.survival?.debugSetControls(c);
      },
      stepSim: (steps: number) => {
        this.chamber?.debugStepSim(steps);
        this.survival?.debugStepSim(steps);
      },
      setSimPaused: (paused: boolean) => {
        this.chamber?.debugSetSimPaused(paused);
        this.survival?.debugSetSimPaused(paused);
      },
      telemetry: () => this.chamber?.debugTelemetry(),
      survivalTelemetry: () => this.survival?.debugTelemetry() ?? null,
      profile: () => ({
        money: this.profile.money,
        unlocks: [...this.profile.unlockedDefIds],
        highestWaveCleared: this.profile.highestWaveCleared ?? 0,
        phoneAddictsKilled: this.profile.phoneAddictsKilled ?? 0,
      }),
      setProgress: (
        highestWaveCleared: number,
        phoneAddictsKilled: number,
      ): void => {
        if (
          !Number.isSafeInteger(highestWaveCleared) ||
          highestWaveCleared < 0 ||
          !Number.isSafeInteger(phoneAddictsKilled) ||
          phoneAddictsKilled < 0
        ) {
          return;
        }
        // Go through recordWaveCleared so the seam grants exactly the unlocks a
        // real clear would. Setting the counter alone would leave the profile in
        // a state the game can never actually produce.
        this.profile.highestWaveCleared = 0;
        this.profile.phoneAddictsKilled = phoneAddictsKilled;
        recordWaveCleared(this.profile, highestWaveCleared);
        this.markProfileDirty();
        this.editor?.refreshProfile();
      },
      grantMoney: (amount: number) => {
        if (!Number.isSafeInteger(amount) || amount < 0) return false;
        try {
          this.changeMoney(amount, true);
          this.editor?.refreshProfile();
          return true;
        } catch {
          return false;
        }
      },
      buyUpgrade: (partId: string) =>
        this.editor?.debugBuyUpgrade(partId) ?? false,
      sellPart: (partId: string) => this.editor?.debugSellPart(partId) ?? false,
      unlockPart: (defId: string) =>
        this.editor?.debugUnlockPart(defId) ?? false,
      selectPart: (partId: string) =>
        this.editor?.debugSelectPart(partId) ?? false,
      runState: () =>
        this.activeRun
          ? { wave: this.activeRun.wave, inBuildPhase: this.inBuildPhase }
          : null,
      zombiePositions: () => this.survival?.debugZombiePositions() ?? [],
      debugStartWave: (wave: number) => {
        if (!this.survival) return;
        const sanitizedWave = Math.max(
          1,
          Math.floor(Number.isFinite(wave) ? wave : 1),
        );
        this.activeRun = { wave: sanitizedWave };
        this.survival.debugStartWave(sanitizedWave);
      },
      debugKillAllZombies: () => this.survival?.debugKillAllZombies(),
      forceWaveComplete: () => this.survival?.debugForceWaveComplete(),
      setScenario: (s: ScenarioName) => this.chamber?.debugSetScenario(s),
      resetVehicle: () => this.chamber?.reset(),
    };
  }
}

/** A small, valid, drivable starter rig so first boot isn't a blank grid. */
export function buildStarterBlueprint(): VehicleBlueprint {
  const yaw180 = orientationFromSteps(0, 2, 0);
  let n = 0;
  const part = (
    defId: string,
    pos: Vec3i,
    orient = 0,
    config: PartConfig = {},
  ): PlacedPart => ({
    id: `p${++n}`,
    defId,
    pos,
    orient,
    config,
  });
  const parts: PlacedPart[] = [
    part('chassis-core', { x: 0, y: 1, z: 0 }),
    part('driver-seat', { x: 0, y: 2, z: 0 }),
    // 3-wide deck, z -1..2 spine plus flanks (long wheelbase resists wheelies).
    part('frame-box', { x: 0, y: 1, z: 1 }),
    part('frame-box', { x: 0, y: 1, z: 2 }),
    part('frame-box', { x: 0, y: 1, z: -1 }),
    part('frame-box', { x: 1, y: 1, z: 0 }),
    part('frame-box', { x: -1, y: 1, z: 0 }),
    part('frame-box', { x: 1, y: 1, z: 1 }),
    part('frame-box', { x: -1, y: 1, z: 1 }),
    part('frame-box', { x: 1, y: 1, z: -1 }),
    part('frame-box', { x: -1, y: 1, z: -1 }),
    part('frame-box', { x: 1, y: 1, z: 2 }),
    part('frame-box', { x: -1, y: 1, z: 2 }),
    part('frame-box', { x: 1, y: 1, z: -2 }),
    part('frame-box', { x: -1, y: 1, z: -2 }),
    part(
      'wheel-standard',
      { x: 2, y: 1, z: 2 },
      yaw180,
      defaultWheelConfig(true),
    ),
    part('wheel-standard', { x: -2, y: 1, z: 2 }, 0, defaultWheelConfig(true)),
    part(
      'wheel-standard',
      { x: 2, y: 1, z: -2 },
      yaw180,
      defaultWheelConfig(false),
    ),
    part(
      'wheel-standard',
      { x: -2, y: 1, z: -2 },
      0,
      defaultWheelConfig(false),
    ),
    part('frame-box', { x: 0, y: 1, z: -2 }),
    part('engine-small', { x: 0, y: 2, z: -2 }),
    part('fuel-tank', { x: 0, y: 2, z: -1 }),
    part('turret', { x: 0, y: 2, z: 1 }),
  ];
  return { ...createEmptyBlueprint('starter-rig'), parts };
}

function defaultWheelConfig(steering: boolean): PartConfig {
  return {
    driven: !steering,
    braking: true,
    steering,
    steerInverted: false,
  };
}
