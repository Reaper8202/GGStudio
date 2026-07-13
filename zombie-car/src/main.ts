/**
 * Bootstrap entry point: creates the renderer/scene/physics world, the
 * TypedEventBus + GameState, wires up GameDirector/GameLoop, and builds the
 * construction-site map. Owned by Agent A (Foundation & World).
 */
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { GamePhase, createDefaultModifiers } from "./types";
import type { GameContext, GameState } from "./types";
import { GameConfig } from "./config/gameConfig";
import { TypedEventBus } from "./core/EventBus";
import { GameLoop } from "./core/GameLoop";
import { GameDirector } from "./core/GameDirector";
import { ConstructionSite } from "./world/ConstructionSite";
import { createVehicleSystems } from "./vehicle";
import { createCombatSystems } from "./zombies";
import { createUiSystems } from "./ui";

async function bootstrap(): Promise<void> {
  await RAPIER.init();

  const container = document.getElementById("game-canvas-container");
  if (!container) {
    throw new Error("main: #game-canvas-container not found in index.html");
  }

  // --- Renderer -----------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, GameConfig.devicePixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  // --- Scene ----------------------------------------------------------------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);

  // --- Camera ---------------------------------------------------------------
  // Temporary static angled top-down view of the map center. The camera
  // system (Agent B, `src/camera/**`) replaces this with the vehicle-follow
  // rig once the vehicle exists; until then this gives a sane view of the
  // built world for sanity-checking.
  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );
  camera.position.set(0, 42, 30);
  camera.lookAt(0, 0, 0);

  // --- Physics --------------------------------------------------------------
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  // --- Events / state ---------------------------------------------------------
  const events = new TypedEventBus();

  const state: GameState = {
    phase: GamePhase.Countdown,
    wave: 0,
    money: GameConfig.startingMoney,
    totalMoneyEarned: 0,
    totalKills: 0,
    zombiesRemainingInWave: 0,
    upgradeLevels: {},
    modifiers: createDefaultModifiers(),
    muted: false,
  };

  const ctx: GameContext = {
    scene,
    camera,
    renderer,
    physics,
    rapier: RAPIER,
    events,
    state,
  };

  // --- Core systems -----------------------------------------------------------
  const loop = new GameLoop(ctx, () => renderer.render(scene, camera));
  const director = new GameDirector(ctx, loop);
  const world = new ConstructionSite(ctx);
  director.registerSystem(world);

  // === SYSTEM WIRING (integration) ===
  // Remaining gameplay systems are instantiated + registered here, in the
  // order defined by docs/STATUS.md's "Integration contract":
  //   input -> vehicle -> zombies -> waves -> weapons -> effects -> camera
  //   -> economy -> ui
  // Each one implements `GameSystem`; register it with
  // `director.registerSystem(sys)` so it receives fixedUpdate/update calls
  // and participates in `ui:restartRun` resets. Example shape:
  //
  //   const input = new InputController(ctx);
  //   const vehicle = buildVehicle(ctx, starterBlueprint);
  //   const zombies = new ZombieManager(ctx, world);
  //   const waves = new WaveDirector(ctx, zombies);
  //   const weapons = new TurretSystem(ctx, vehicle, zombies);
  //   const effects = new EffectsSystem(ctx);
  //   const camera3p = new FollowCamera(ctx, vehicle);
  //   const economy = new EconomySystem(ctx);
  //   const ui = new HudSystem(ctx, vehicle, world);
  //   for (const sys of [input, vehicle, zombies, waves, weapons, effects, camera3p, economy, ui]) {
  //     director.registerSystem(sys);
  //   }

  const { vehicle, input, camera: followCamera } = createVehicleSystems(ctx, world);
  director.registerSystem(input);
  director.registerSystem(vehicle);
  const { zombies, waves, weapons, effects } = createCombatSystems(ctx, world, vehicle);
  director.registerSystem(zombies);
  director.registerSystem(waves);
  director.registerSystem(weapons);
  director.registerSystem(effects);
  director.registerSystem(followCamera);
  // UI overlays are purely event-driven (they react to game:restarted
  // themselves); only the economy participates in the system lifecycle.
  const { economy } = createUiSystems(ctx);
  director.registerSystem(economy);

  // Driving only makes sense while the run is live: lock the controls while
  // the upgrade panel or game-over overlay is up (the vehicle also disables
  // itself on destruction; reset() re-enables).
  events.on("phase:changed", ({ phase }) => {
    vehicle.setDrivingEnabled(
      phase === GamePhase.Countdown || phase === GamePhase.WaveActive
    );
  });
  // === END SYSTEM WIRING ===

  // --- Resize -----------------------------------------------------------------
  function handleResize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, GameConfig.devicePixelRatioCap));
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", handleResize);

  // --- Start --------------------------------------------------------------------
  director.boot();
  loop.start();

  // Exposed for automated/manual testing (see docs/STATUS.md).
  (window as unknown as { __game: unknown }).__game = { ctx, director, vehicle, zombies, waves };
}

bootstrap().catch((err) => {
  console.error("Failed to bootstrap game:", err);
});
