import Phaser from 'phaser';
import { GameConfig } from '../config/GameConfig';
import {
  GAME_HEIGHT,
  GAME_WIDTH,
  Intent,
  RegistryKeys,
  SceneKeys,
} from '../config/constants';
import type { LifecycleGuard } from '../platform/LifecycleGuard';
import type { Sfx } from '../audio/Sfx';
import { LaneManager } from '../systems/LaneManager';
import { InputController } from '../systems/InputController';
import { Spawner, type ObstacleKind } from '../systems/Spawner';
import { DifficultyDirector } from '../systems/DifficultyDirector';
import { CollisionSystem } from '../systems/CollisionSystem';
import type { ScoreManager } from '../systems/ScoreManager';
import { ObjectPool } from '../systems/ObjectPool';
import { Rng } from '../systems/Rng';
import { Player } from '../entities/Player';
import { Obstacle } from '../entities/Obstacle';
import { Coin } from '../entities/Coin';
import { Hud } from '../ui/Hud';
import { addDim, textStyle } from '../ui/Overlay';
import { TextureKeys, Depths } from '../config/constants';

const GROUND_Y = 600;
const KILL_Y = GAME_HEIGHT + 100;
/** Cap delta so a background-tab return can't teleport the world. */
const MAX_DELTA_MS = 50;

/**
 * The run itself. Owns all systems; everything per-frame is pooled and
 * allocation-free. Lifecycle contract (spec §5.2):
 *   gameplayStart → fired here on create (the run begins as the direct result
 *                   of the player's tap in Menu/GameOver) and on pause-resume
 *   gameplayStop  → fired on death and on pause/tab-hide
 */
export class PlayScene extends Phaser.Scene {
  private platform!: LifecycleGuard;
  private sfx!: Sfx;
  private score!: ScoreManager;
  private lanes!: LaneManager;
  private player!: Player;
  private inputCtl!: InputController;
  private spawner!: Spawner;
  private difficulty!: DifficultyDirector;
  private collisions!: CollisionSystem;
  private road!: Phaser.GameObjects.TileSprite;
  private hud!: Hud;
  private obstaclePool!: ObjectPool<Obstacle>;
  private coinPool!: ObjectPool<Coin>;
  private obstacles: Obstacle[] = [];
  private coins: Coin[] = [];

  private running = false;
  private paused = false;
  private resuming = false;
  private reviveUsed = false;
  private pauseUi: Phaser.GameObjects.GameObject[] = [];

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.pauseGame();
  };

  constructor() {
    super(SceneKeys.Play);
  }

  create(): void {
    this.platform = this.registry.get(RegistryKeys.Platform) as LifecycleGuard;
    this.sfx = this.registry.get(RegistryKeys.Sfx) as Sfx;
    this.score = this.registry.get(RegistryKeys.Score) as ScoreManager;

    this.running = false;
    this.paused = false;
    this.resuming = false;
    this.reviveUsed = false;
    this.obstacles = [];
    this.coins = [];
    this.pauseUi = [];
    this.score.resetRun();

    this.lanes = new LaneManager();
    this.difficulty = new DifficultyDirector();
    this.collisions = new CollisionSystem();

    this.road = this.add
      .tileSprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, 600, GAME_HEIGHT, TextureKeys.Road)
      .setDepth(Depths.Road);

    this.player = new Player(this, this.lanes, this.sfx, GROUND_Y);

    this.obstaclePool = new ObjectPool<Obstacle>(
      () => new Obstacle(this),
      (o) => o.deactivate(),
    );
    this.coinPool = new ObjectPool<Coin>(
      () => new Coin(this),
      (c) => c.deactivate(),
    );

    // Seed: config > ?seed= query > nondeterministic (outside the run loop).
    const urlSeed = new URLSearchParams(location.search).get('seed');
    const seed =
      GameConfig.seed ??
      (urlSeed !== null && urlSeed !== ''
        ? parseInt(urlSeed, 10) >>> 0
        : (Math.random() * 0xffffffff) >>> 0);
    const rng = new Rng(seed);

    // Deterministic spawn log for acceptance testing (dev/local only).
    let log: ((entry: string) => void) | undefined;
    if (!this.platform.isReal) {
      const spawnLog: string[] = [];
      const g = globalThis as unknown as Record<string, unknown>;
      g.__spawnLog = spawnLog;
      g.__score = this.score;
      log = (entry) => spawnLog.push(entry);
      console.info(`[Play] run seed ${seed}`);
    }

    this.spawner = new Spawner(rng, this.difficulty, {
      spawnObstacle: (lane: number, kind: ObstacleKind, y: number): void => {
        const o = this.obstaclePool.acquire();
        o.activate(lane, kind, this.lanes.laneX(lane), y);
        this.obstacles.push(o);
      },
      spawnCoin: (lane: number, y: number, elevated: boolean): void => {
        const c = this.coinPool.acquire();
        c.activate(this.lanes.laneX(lane), y, elevated);
        this.coins.push(c);
      },
    }, log);

    this.inputCtl = new InputController(this);
    this.inputCtl.on(Intent.Left, () => this.player.moveLane(-1));
    this.inputCtl.on(Intent.Right, () => this.player.moveLane(1));
    this.inputCtl.on(Intent.Jump, () => this.player.jump());
    this.inputCtl.on(Intent.Slide, () => this.player.slide());
    this.inputCtl.on(InputController.ANY, () => this.sfx.unlock());

    this.hud = new Hud(this, this.score.highScore);
    this.showControlsHintOnce();

    // Resume tap (pause overlay is up).
    this.input.on('pointerdown', () => this.resumeFromPause());
    this.input.keyboard?.on('keydown-SPACE', () => this.resumeFromPause());

    document.addEventListener('visibilitychange', this.onVisibility);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('visibilitychange', this.onVisibility);
    });

    // The run starts as the direct result of the player's start/restart tap.
    this.platform.gameplayStart();
    this.running = true;
  }

  override update(_time: number, delta: number): void {
    if (!this.running) return;
    const dt = Math.min(delta, MAX_DELTA_MS);

    const speed = this.difficulty.speedAt(this.score.meters);
    const dy = (speed * dt) / 1000;

    this.score.addDistance(dy * 1); // world px == distance px
    this.road.tilePositionY -= dy;
    this.spawner.update(dt, this.score.meters);

    // Move + cull obstacles (swap-remove, no allocation).
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      o.y += dy;
      if (o.y > KILL_Y) {
        this.obstaclePool.release(o);
        this.obstacles[i] = this.obstacles[this.obstacles.length - 1];
        this.obstacles.pop();
      }
    }
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.y += dy;
      if (!c.active || c.y > KILL_Y) {
        this.coinPool.release(c);
        this.coins[i] = this.coins[this.coins.length - 1];
        this.coins.pop();
      }
    }

    this.player.update();

    this.collisions.checkCoins(this.player, this.coins, (c) => {
      c.deactivate(); // culled from the array on the next sweep
      this.score.collectCoin();
      this.sfx.coin();
    });

    const hit = this.collisions.checkObstacles(this.player, this.obstacles);
    if (hit) {
      this.onDeath();
      return;
    }

    this.hud.update(this.score.score, this.score.coins, this.score.meters);
  }

  // -- death / revive / restart ---------------------------------------------

  private onDeath(): void {
    this.running = false;
    this.inputCtl.enabled = false;
    this.player.die();
    this.sfx.hit();
    this.cameras.main.shake(220, 0.012);
    this.platform.gameplayStop();

    const newBest = this.score.score > this.score.highScore;
    void this.score.commit();
    this.hud.setBest(this.score.highScore);

    this.time.delayedCall(650, () => {
      this.scene.launch(SceneKeys.GameOver, {
        canRevive: !this.reviveUsed,
        newBest,
      });
    });
  }

  /** Called by GameOverScene after a fully-watched rewarded ad. */
  revive(): void {
    this.reviveUsed = true;

    // Clear the board ahead so the revive is never an instant re-death.
    for (const o of this.obstacles) this.obstaclePool.release(o);
    this.obstacles.length = 0;
    this.spawner.reviveGrace();

    this.player.revive();
    this.sfx.revive();
    this.platform.gameplayStart();
    this.inputCtl.enabled = true;
    this.running = true;
  }

  // -- pause / resume --------------------------------------------------------

  private pauseGame(): void {
    if (!this.running || this.paused) return;
    this.running = false;
    this.paused = true;
    this.inputCtl.enabled = false;
    this.platform.gameplayStop();

    const dim = addDim(this, 0.6);
    const label = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'PAUSED\nTAP TO RESUME', textStyle(44))
      .setOrigin(0.5)
      .setAlign('center')
      .setDepth(dim.depth + 1);
    this.pauseUi = [dim, label];
  }

  private resumeFromPause(): void {
    if (!this.paused || this.resuming) return;
    this.resuming = true;
    // Returning from a pause is a commercial-break opportunity (spec §5.2).
    void this.platform.commercialBreak().then(() => {
      for (const o of this.pauseUi) o.destroy();
      this.pauseUi = [];
      this.platform.gameplayStart();
      this.paused = false;
      this.resuming = false;
      this.inputCtl.enabled = true;
      this.running = true;
    });
  }

  // -- onboarding ------------------------------------------------------------

  /** Teach through play: a fading hint on the very first run only. */
  private showControlsHintOnce(): void {
    if (this.registry.get(RegistryKeys.HintShown)) return;
    this.registry.set(RegistryKeys.HintShown, true);
    const hint = this.add
      .text(
        GAME_WIDTH / 2,
        GAME_HEIGHT * 0.32,
        '← → move    ↑ jump    ↓ slide\n(or swipe)',
        textStyle(30),
      )
      .setOrigin(0.5)
      .setAlign('center')
      .setDepth(Depths.Hud);
    this.tweens.add({
      targets: hint,
      alpha: 0,
      delay: 3200,
      duration: 800,
      onComplete: () => hint.destroy(),
    });
  }
}
