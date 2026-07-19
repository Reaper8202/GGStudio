import * as THREE from 'three';
import { GameConfig } from '../config/GameConfig';
import {
  CREW_COLORS,
  Intent,
  Palette,
  SaveKeys,
  THEME_CYCLE,
  THEME_SEGMENT_METERS,
} from '../config/constants';
import type { LifecycleGuard } from '../platform/LifecycleGuard';
import type { Sfx } from '../audio/Sfx';
import type { ScoreManager } from '../systems/ScoreManager';
import { DifficultyDirector } from '../systems/DifficultyDirector';
import { Spawner, type ObstacleKind } from '../systems/Spawner';
import { ObjectPool } from '../systems/ObjectPool';
import { Rng } from '../systems/Rng';
import { LaneManager } from './LaneManager';
import { InputController } from './InputController';
import { CollisionSystem } from './CollisionSystem';
import { Track } from './Track';
import { PlayerAvatar } from './entities/PlayerAvatar';
import { ChasingImposter } from './entities/ChasingImposter';
import {
  VentObstacle,
  GateObstacle,
  ImposterObstacle,
  CoinPickup,
  type Obstacle3D,
} from './entities/obstacles';
import { UI } from '../ui/UI';

type State = 'menu' | 'playing' | 'paused' | 'gameover';

/** Cap delta so a background-tab return can't teleport the world. */
const MAX_DELTA_MS = 50;
/** Obstacles/coins are recycled once they pass behind the camera. */
const KILL_Z = 9;

/**
 * The game shell: renderer, camera, state machine, run loop. Lifecycle
 * contract (spec §5.2) is identical to the 2D build — gameplayStart fires
 * when a run starts as the direct result of the player's tap, gameplayStop
 * on death/pause, commercial breaks between runs and on pause-resume, one
 * rewarded revive per run. During ads main.ts pauses the whole loop via
 * setAdPaused().
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly track: Track;
  private readonly lanes = new LaneManager();
  private readonly player: PlayerAvatar;
  /** The impostor at your heels (public for acceptance tests). */
  readonly chaser: ChasingImposter;
  private readonly input: InputController;
  private readonly collisions = new CollisionSystem();
  private readonly difficulty = new DifficultyDirector();
  private readonly ui = new UI();

  private readonly pools: Record<ObstacleKind, ObjectPool<Obstacle3D>>;
  private readonly coinPool: ObjectPool<CoinPickup>;
  private obstacles: Obstacle3D[] = [];
  private coins: CoinPickup[] = [];
  private spawner: Spawner | null = null;

  private state: State = 'menu';
  private reviveUsed = false;
  private busy = false; // guards double-taps around async ad breaks
  private shakeUntil = 0;
  private lastTime = -1;
  private adPaused = false;

  /** Smoothed fps, exposed for acceptance tests via the __game dev hook. */
  fps = 60;

  constructor(
    private readonly platform: LifecycleGuard,
    private readonly score: ScoreManager,
    private readonly sfx: Sfx,
  ) {
    // AA is nearly free on real GPUs but costly at high DPR / in software
    // rendering. `?aa=0` forces it off (useful for low-end devices/tests).
    const aa =
      new URLSearchParams(location.search).get('aa') !== '0' &&
      window.devicePixelRatio <= 1.5;
    this.renderer = new THREE.WebGLRenderer({ antialias: aa });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('game')!.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(Palette.bg);
    this.scene.fog = new THREE.Fog(Palette.fog, 28, 85);

    this.camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      0.1,
      220,
    );
    this.camera.position.set(0, 4.4, 6.8);
    this.camera.lookAt(0, 0.9, -12);

    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x0b0e1a, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(4, 9, 5);
    this.scene.add(sun);

    this.track = new Track(this.scene, this.lanes);
    this.player = new PlayerAvatar(this.scene, this.lanes, this.sfx);
    this.chaser = new ChasingImposter(this.scene);

    // Crew color: apply the persisted choice (default teal), save on pick.
    this.ui.setSelectedColor(CREW_COLORS[0]);
    void this.platform.load(SaveKeys.CrewColor).then((raw) => {
      const hex = raw === null ? NaN : parseInt(raw, 10);
      if ((CREW_COLORS as readonly number[]).includes(hex)) {
        this.player.setColor(hex);
        this.ui.setSelectedColor(hex);
      }
    });
    this.ui.onColorPick = (hex) => {
      this.sfx.unlock();
      this.sfx.click();
      this.player.setColor(hex);
      void this.platform.save(SaveKeys.CrewColor, String(hex));
    };

    this.pools = {
      low: new ObjectPool<Obstacle3D>(
        () => new VentObstacle(this.scene),
        (o) => o.deactivate(),
      ),
      high: new ObjectPool<Obstacle3D>(
        () => new GateObstacle(this.scene),
        (o) => o.deactivate(),
      ),
      block: new ObjectPool<Obstacle3D>(
        () => new ImposterObstacle(this.scene),
        (o) => o.deactivate(),
      ),
    };
    this.coinPool = new ObjectPool<CoinPickup>(
      () => new CoinPickup(this.scene),
      (c) => c.deactivate(),
    );

    // -- input → player intents (active only while playing) ------------------
    this.input = new InputController();
    this.input.on(Intent.Left, () => this.player.moveLane(-1, performance.now()));
    this.input.on(Intent.Right, () => this.player.moveLane(1, performance.now()));
    this.input.on(Intent.Jump, () => this.player.jump(performance.now()));
    this.input.on(Intent.Slide, () => this.player.slide(performance.now()));
    this.input.on(InputController.ANY, () => this.sfx.unlock());

    // -- UI callbacks --------------------------------------------------------
    this.ui.onStart = () => this.startRun();
    this.ui.onRestart = () => this.restartRun();
    this.ui.onRevive = () => this.reviveRun();
    this.ui.onResumeTap = () => this.resumeFromPause();

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.pauseGame();
    });

    this.ui.showMenu(this.score.highScore);
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  /** main.ts wires this to LifecycleGuard's ad hooks: freeze the whole loop. */
  setAdPaused(paused: boolean): void {
    this.adPaused = paused;
    this.input.enabled = !paused && this.state === 'playing';
    if (paused) {
      this.renderer.setAnimationLoop(null);
    } else {
      this.lastTime = -1; // don't count ad time as a giant delta
      this.renderer.setAnimationLoop((t) => this.frame(t));
    }
  }

  // -- run lifecycle ---------------------------------------------------------

  private newRun(): void {
    this.score.resetRun();
    this.reviveUsed = false;
    for (const o of this.obstacles) this.pools[o.kind].release(o);
    this.obstacles = [];
    for (const c of this.coins) this.coinPool.release(c);
    this.coins = [];
    this.player.resetRun();
    this.chaser.reset();

    // Seed: config > ?seed= query > nondeterministic (outside the run loop).
    const urlSeed = new URLSearchParams(location.search).get('seed');
    const seed =
      GameConfig.seed ??
      (urlSeed !== null && urlSeed !== ''
        ? parseInt(urlSeed, 10) >>> 0
        : (Math.random() * 0xffffffff) >>> 0);
    const rng = new Rng(seed);

    let log: ((entry: string) => void) | undefined;
    if (!this.platform.isReal) {
      const spawnLog: string[] = [];
      const g = globalThis as unknown as Record<string, unknown>;
      g.__spawnLog = spawnLog;
      g.__score = this.score;
      g.__game = this;
      log = (entry) => spawnLog.push(entry);
      console.info(`[Game] run seed ${seed}`);
    }

    this.spawner = new Spawner(
      rng,
      this.difficulty,
      {
        spawnObstacle: (lane: number, kind: ObstacleKind, z: number): void => {
          const o = this.pools[kind].acquire();
          o.activate(lane, this.lanes.laneX(lane), z);
          this.obstacles.push(o);
        },
        spawnCoin: (lane: number, z: number, elevated: boolean): void => {
          const c = this.coinPool.acquire();
          c.activate(this.lanes.laneX(lane), z, elevated);
          this.coins.push(c);
        },
      },
      log,
    );
  }

  /** Menu tap → first run. Poki canonical flow: commercial break, then play. */
  private startRun(): void {
    if (this.state !== 'menu' || this.busy) return;
    this.busy = true;
    this.sfx.unlock();
    this.sfx.click();
    void this.platform.commercialBreak().then(() => {
      this.newRun();
      this.platform.gameplayStart();
      this.state = 'playing';
      this.input.enabled = true;
      this.busy = false;
      this.ui.showHud(this.score.highScore);
      this.ui.toast('← → move ↑ jump ↓ slide\n(or swipe)');
    });
  }

  private restartRun(): void {
    if (this.state !== 'gameover' || this.busy) return;
    this.busy = true;
    this.sfx.click();
    this.ui.setButtonsBusy(true);
    void this.platform.commercialBreak().then(() => {
      this.ui.hideGameOver();
      this.newRun();
      this.platform.gameplayStart();
      this.state = 'playing';
      this.input.enabled = true;
      this.busy = false;
      this.ui.showHud(this.score.highScore);
    });
  }

  private reviveRun(): void {
    if (this.state !== 'gameover' || this.busy || this.reviveUsed) return;
    this.busy = true;
    this.sfx.click();
    this.ui.setButtonsBusy(true);
    void this.platform.rewardedBreak().then((rewarded) => {
      this.busy = false;
      if (!rewarded) {
        this.ui.reviveUnavailable();
        return;
      }
      this.reviveUsed = true;
      // Clear the board ahead so the revive is never an instant re-death.
      for (const o of this.obstacles) this.pools[o.kind].release(o);
      this.obstacles = [];
      this.spawner?.reviveGrace();
      this.chaser.reset(); // back off — you escaped this time
      this.player.revive(performance.now());
      this.sfx.revive();
      this.ui.hideGameOver();
      this.platform.gameplayStart();
      this.state = 'playing';
      this.input.enabled = true;
      this.ui.showHud(this.score.highScore);
    });
  }

  private onDeath(): void {
    this.state = 'gameover';
    this.input.enabled = false;
    this.player.die();
    this.chaser.lunge(performance.now()); // the pounce that caught you
    this.sfx.hit();
    this.shakeUntil = performance.now() + 260;
    this.platform.gameplayStop();

    const newBest = this.score.score > this.score.highScore;
    void this.score.commit();
    this.ui.updateHud(this.score.score, this.score.coins, this.score.meters);
    this.ui.setBest(this.score.highScore);

    setTimeout(() => {
      if (this.state !== 'gameover') return;
      this.ui.showGameOver(
        this.score.score,
        this.score.coins,
        this.score.highScore,
        newBest,
        !this.reviveUsed,
      );
    }, 650);
  }

  private pauseGame(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.platform.gameplayStop();
    this.ui.showPaused(true);
  }

  private resumeFromPause(): void {
    if (this.state !== 'paused' || this.busy) return;
    this.busy = true;
    // Returning from a pause is a commercial-break opportunity (spec §5.2).
    void this.platform.commercialBreak().then(() => {
      this.ui.showPaused(false);
      this.platform.gameplayStart();
      this.state = 'playing';
      this.input.enabled = true;
      this.busy = false;
    });
  }

  // -- frame loop ------------------------------------------------------------

  private frame(time: number): void {
    if (this.adPaused) return;
    if (this.lastTime < 0) this.lastTime = time;
    const dt = Math.min(time - this.lastTime, MAX_DELTA_MS);
    this.lastTime = time;
    if (dt > 0) this.fps = this.fps * 0.95 + (1000 / dt) * 0.05;

    if (this.state === 'playing') this.updateRun(dt, time);

    // Player and chaser animate in every state (menu idle, death lunge);
    // theme color transitions keep easing even outside the run.
    this.player.update(time);
    this.chaser.update(dt, time, this.player.x, this.state === 'playing');
    this.track.update(dt);

    // Camera: follow the player's lane with a soft lean; shake on death.
    const targetX = this.player.x * 0.42;
    this.camera.position.x += (targetX - this.camera.position.x) * Math.min(1, dt / 120);
    let shakeX = 0;
    let shakeY = 0;
    if (time < this.shakeUntil) {
      const s = ((this.shakeUntil - time) / 260) * 0.14;
      shakeX = Math.sin(time * 0.09) * s;
      shakeY = Math.cos(time * 0.13) * s;
    }
    this.camera.lookAt(this.player.x * 0.25 + shakeX, 0.9 + shakeY, -12);

    this.renderer.render(this.scene, this.camera);
  }

  private updateRun(dt: number, now: number): void {
    const speed = this.difficulty.speedAt(this.score.meters);
    const dy = (speed * dt) / 1000;

    this.score.addDistance(dy);
    this.track.scroll(dy);
    // Environment cycles with distance (pure function of meters — seeded
    // runs stay deterministic). setTheme no-ops until the segment changes.
    this.track.setTheme(
      THEME_CYCLE[Math.floor(this.score.meters / THEME_SEGMENT_METERS) % THEME_CYCLE.length],
    );
    this.spawner?.update(dt, this.score.meters);

    // Move + cull obstacles (swap-remove, no allocation).
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      o.group.position.z += dy;
      o.update(dt, now);
      if (o.group.position.z > KILL_Z) {
        this.pools[o.kind].release(o);
        this.obstacles[i] = this.obstacles[this.obstacles.length - 1];
        this.obstacles.pop();
      }
    }
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.group.position.z += dy;
      c.update(dt);
      if (!c.active || c.group.position.z > KILL_Z) {
        this.coinPool.release(c);
        this.coins[i] = this.coins[this.coins.length - 1];
        this.coins.pop();
      }
    }

    this.collisions.checkCoins(this.player, this.coins, (c) => {
      c.deactivate(); // culled from the array on the next sweep
      this.score.collectCoin();
      this.sfx.coin();
    });

    const hit = this.collisions.checkObstacles(this.player, this.obstacles, now);
    if (hit) {
      this.onDeath();
      return;
    }

    this.ui.updateHud(this.score.score, this.score.coins, this.score.meters);
  }
}
