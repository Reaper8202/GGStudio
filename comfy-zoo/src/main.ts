/**
 * Composition root. Platform detect → adapter.init() → boot-phase assets →
 * world build → load save or tutorial new-game → mountUI → gameplayStart →
 * 'game:ready'. First frame never waits for the 'main'/'dinos' phases.
 */
import { EventBus, type GameQuery, type ZooPediaEntry, type BuildCatalogEntry, type ShelterInfo } from './core/EventBus';
import type { PlatformAdapter } from './platform/PlatformAdapter';
import { LocalAdapter } from './platform/LocalAdapter';
import { CrazyGamesAdapter, isCrazyGames } from './platform/CrazyGamesAdapter';
import { PlayablesAdapter, isPlayables } from './platform/PlayablesAdapter';
import { DevvitAdapter, isDevvit } from './platform/DevvitAdapter';
import { AssetManager } from './core/AssetManager';
import { createRenderContext, Game, type GameSystems } from './core/Game';
import { type GameContext, type RuntimeState, type ZoopediaRecord, makeUid } from './core/GameContext';
import { SaveSystem, type SaveBlob } from './core/SaveSystem';
import { SpatialHash } from './core/SpatialHash';
import { TileGrid } from './world/TileGrid';
import { WorldGen } from './world/WorldGen';
import { WORLD_SIZE } from './world/layout';
import { Fx } from './entities/Fx';
import { Player } from './entities/Player';
import { Animal } from './entities/Animal';
import { Shelter } from './entities/Shelter';
import { EconomySystem } from './systems/EconomySystem';
import { HerdingSystem } from './systems/HerdingSystem';
import { CaptureSystem } from './systems/CaptureSystem';
import { HungerSystem } from './systems/HungerSystem';
import { QuestSystem } from './systems/QuestSystem';
import { BuildSystem } from './systems/BuildSystem';
import { SpawnSystem } from './systems/SpawnSystem';
import { AdEventSystem } from './systems/AdEventSystem';
import { OfflineProgress } from './systems/OfflineProgress';
import { DailySystem } from './systems/DailySystem';
import { InteractionSystem } from './systems/InteractionSystem';
import { ProgressionSystem } from './systems/ProgressionSystem';
import { ANIMALS, BALANCE, QUESTS, SHELTERS, getAnimal, getShelter, skinsForSpecies } from './core/data';
import { mountUI } from './ui';
import type { ResourceKind } from './data/types';

function pickAdapter(): PlatformAdapter {
  if (isCrazyGames()) return new CrazyGamesAdapter();
  if (isPlayables()) return new PlayablesAdapter();
  if (isDevvit()) return new DevvitAdapter();
  return new LocalAdapter();
}

function freshState(): RuntimeState {
  return {
    coins: 0,
    resources: { berry: 0, hay: 0, forage: 0, water: 0 },
    followersMax: BALANCE.maxFollowersBase,
    streakCount: 0,
    lastDailyKey: null,
    lastVisitorKey: null,
    unlockedZones: ['meadow'],
    unlockedSpecies: [],
    doubleHarvestUntil: 0,
    lastSaveAt: Date.now(),
  };
}

function freshZoopedia(): Map<string, ZoopediaRecord> {
  const map = new Map<string, ZoopediaRecord>();
  for (const a of ANIMALS) {
    map.set(a.id, { caught: false, count: 0, ownedSkins: [], activeSkin: null });
  }
  return map;
}

async function boot(): Promise<void> {
  const adapter = pickAdapter();
  await adapter.init();

  const bus = new EventBus();
  const assets = new AssetManager(bus);
  await assets.loadManifest();
  await assets.loadPhase('boot');

  const { renderer, scene, camera } = createRenderContext();
  const grid = new TileGrid(WORLD_SIZE, 2);
  const hash = new SpatialHash(4);
  const penHash = new SpatialHash(4);
  const fx = new Fx(scene);
  const player = new Player(BALANCE.playerSpeed);
  player.setPosition(0, 2);
  scene.add(player.group);

  const ctx: GameContext = {
    bus,
    adapter,
    scene,
    camera,
    renderer,
    assets,
    grid,
    hash,
    penHash,
    fx,
    joystick: { x: 0, y: 0, active: false },
    player,
    animals: [],
    shelters: [],
    resourceNodes: [],
    state: freshState(),
    zoopedia: freshZoopedia(),
    activeQuests: [],
    now: 0,
    paused: false,
    actionHeld: false,
    nextUid: 1,
    requestSave: () => {},
  };

  // ---- load save (before world gen so gates/zones respect unlock state) ----
  const rawSave = await adapter.load();
  const save = rawSave ? SaveSystem.parse(rawSave) : null;
  if (save) restoreState(ctx, save);

  const worldGen = new WorldGen(ctx);
  worldGen.buildAll();
  worldGen.applyGateColliders();

  // ---- systems ----
  const saveSystem = new SaveSystem(ctx);
  ctx.requestSave = () => saveSystem.markDirty();
  const economy = new EconomySystem(ctx);
  const herding = new HerdingSystem(ctx, economy);
  const capture = new CaptureSystem(ctx, herding);
  const hunger = new HungerSystem(ctx);
  const quests = new QuestSystem(ctx, economy);
  const build = new BuildSystem(ctx, economy);
  const spawner = new SpawnSystem(ctx);
  const adEvents = new AdEventSystem(ctx, spawner);
  const interaction = new InteractionSystem(ctx, capture, herding, hunger, quests, build);
  const progression = new ProgressionSystem(ctx);
  const offline = new OfflineProgress(ctx, economy);
  const daily = new DailySystem(ctx, economy, spawner);

  if (save) {
    restoreEntities(ctx, save);
    restoreQuests(ctx, save);
    offline.apply();
    // saves from before the barn became the store hub don't have one — add it
    if (!ctx.shelters.some((s) => s.def.hub)) placeHub(ctx, build);
  } else {
    newGame(ctx, build, spawner);
  }
  // vegetation/resources go last so they never spawn in cells shelters occupy
  worldGen.populate();
  quests.init();

  // cosmetic skin selection from the ZooPedia
  bus.on('ui:requestSkin', ({ speciesId, skinId }) => {
    const rec = ctx.zoopedia.get(speciesId);
    if (!rec) return;
    if (skinId === 'default' || rec.ownedSkins.includes(skinId)) {
      rec.activeSkin = skinId === 'default' ? null : skinId;
      bus.emit('zoopedia:updated', { speciesId, caught: rec.caught });
      ctx.requestSave('skin');
    }
  });
  // capturing a tinted variant also unlocks it as a skin on the base species
  bus.on('animal:captured', ({ speciesId }) => {
    const def = getAnimal(speciesId);
    if (!def.variantOf) return;
    const base = ctx.zoopedia.get(def.variantOf);
    if (base && !base.ownedSkins.includes(speciesId)) {
      base.ownedSkins.push(speciesId);
      bus.emit('zoopedia:updated', { speciesId: def.variantOf, caught: base.caught });
    }
  });
  bus.once('animal:captured', () => {
    adapter.track('first_capture_time', { seconds: Math.round(ctx.now) });
  });

  const systems: GameSystems = {
    economy,
    herding,
    hunger,
    spawner,
    adEvents,
    build,
    interaction,
    progression,
    save: saveSystem,
  };

  const query = makeQuery(ctx, herding, interaction, progression);
  const handles = mountUI(bus, adapter, query);
  ctx.joystick = handles.joystick;

  const game = new Game(ctx, systems);
  game.start();
  daily.check();
  adapter.gameplayStart();
  bus.emit('game:ready', {});

  // stream the rest without blocking the first frame
  void assets
    .loadPhase('main')
    .then(() => assets.loadPhase('dinos'))
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// New game — tutorial-by-doing: docile Cow 5 m away, barn hub (the store) plus
// a free starter pen to house her in.
// ---------------------------------------------------------------------------

function newGame(ctx: GameContext, build: BuildSystem, spawner: SpawnSystem): void {
  placeHub(ctx, build);

  const penDef = getShelter('barn');
  const penAnchor = findFreeAnchor(ctx, -7, -3, penDef.footprint.w, penDef.footprint.h);
  build.place(penDef, penAnchor.cx, penAnchor.cz, 0);

  const cow = getAnimal('cow');
  const a = spawner.spawn(cow, ctx.player.x + 3, ctx.player.z + 4); // 5 m from spawn
  a.setHome(a.x, a.z);
  ctx.requestSave('new-game');
}

/** The barn hub: pre-placed store building, never bought. */
function placeHub(ctx: GameContext, build: BuildSystem): void {
  const hubDef = getShelter('hub');
  const anchor = findFreeAnchor(ctx, 7, -3, hubDef.footprint.w, hubDef.footprint.h);
  build.place(hubDef, anchor.cx, anchor.cz, 0);
}

/** Snap near (x,z); if occupied, scan outward for the nearest valid footprint. */
function findFreeAnchor(
  ctx: GameContext,
  x: number,
  z: number,
  w: number,
  h: number,
): { cx: number; cz: number } {
  const first = ctx.grid.snapFootprint(x, z, w, h);
  if (ctx.grid.footprintValid(first.cx, first.cz, w, h)) return first;
  for (let r = 1; r <= 8; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = first.cx + dx;
        const cz = first.cz + dz;
        if (ctx.grid.footprintValid(cx, cz, w, h)) return { cx, cz };
      }
    }
  }
  return first;
}

// ---------------------------------------------------------------------------
// Save restore
// ---------------------------------------------------------------------------

function restoreState(ctx: GameContext, save: SaveBlob): void {
  const s = ctx.state;
  s.coins = save.coins;
  s.resources = {
    berry: save.resources?.berry ?? 0,
    hay: save.resources?.hay ?? 0,
    forage: save.resources?.forage ?? 0,
    water: save.resources?.water ?? 0,
  };
  s.followersMax = save.followersMax ?? BALANCE.maxFollowersBase;
  s.streakCount = save.streakCount ?? 0;
  s.lastDailyKey = save.lastDailyKey ?? null;
  s.lastVisitorKey = save.lastVisitorKey ?? null;
  s.unlockedZones = save.unlockedZones?.length ? save.unlockedZones : ['meadow'];
  s.unlockedSpecies = save.unlockedSpecies ?? [];
  s.lastSaveAt = save.savedAt ?? Date.now();
  ctx.nextUid = Math.max(1, save.nextUid ?? 1);
  for (const z of save.zoopedia ?? []) {
    ctx.zoopedia.set(z.speciesId, {
      caught: z.caught,
      count: z.count,
      ownedSkins: z.ownedSkins ?? [],
      activeSkin: z.activeSkin ?? null,
    });
  }
}

function restoreEntities(ctx: GameContext, save: SaveBlob): void {
  for (const s of save.shelters ?? []) {
    let def;
    try {
      def = getShelter(s.shelterId);
    } catch {
      continue; // shelter type removed from data — skip gracefully
    }
    const level = Math.min(s.level, def.levels.length - 1);
    const shelter = new Shelter(s.uid, def, level, s.cx, s.cz, ctx);
    shelter.food = Math.min(s.food, shelter.foodMax);
    shelter.setFoodVisual();
    ctx.scene.add(shelter.group);
    ctx.shelters.push(shelter);

    for (const speciesId of s.occupantSpecies ?? []) {
      let animalDef;
      try {
        animalDef = getAnimal(speciesId);
      } catch {
        continue;
      }
      const animal = new Animal(makeUid(ctx, 'housed'), animalDef, ctx);
      const pen = shelter.penPoint();
      animal.setPosition(pen.x + (Math.random() - 0.5) * pen.r, pen.z + (Math.random() - 0.5) * pen.r);
      animal.setHome(pen.x, pen.z);
      animal.shelterUid = shelter.uid;
      animal.brain.house(pen.x, pen.z, pen.r);
      shelter.addOccupant(animal.uid);
      ctx.scene.add(animal.group);
      ctx.animals.push(animal);
    }
  }
}

function restoreQuests(ctx: GameContext, save: SaveBlob): void {
  for (const q of save.quests ?? []) {
    const def = QUESTS.find((d) => d.id === q.defId);
    if (!def) continue;
    ctx.activeQuests.push({
      uid: `quest_${def.id}_${ctx.nextUid++}`,
      def,
      current: Math.min(q.current, def.target),
    });
  }
}

// ---------------------------------------------------------------------------
// GameQuery — the read-only surface the UI polls.
// ---------------------------------------------------------------------------

function makeQuery(
  ctx: GameContext,
  herding: HerdingSystem,
  interaction: InteractionSystem,
  progression: ProgressionSystem,
): GameQuery {
  const baseSpecies = ANIMALS.filter((a) => !a.variantOf);

  return {
    coins: () => ctx.state.coins,
    resources: (): Record<ResourceKind, number> => ({ ...ctx.state.resources }),
    followerCount: () => ({ current: herding.count, max: ctx.state.followersMax }),
    activeQuests: () =>
      ctx.activeQuests.map((q) => ({
        questUid: q.uid,
        text: q.def.text.replace('{n}', String(q.def.target)),
        current: q.current,
        target: q.def.target,
      })),
    zoopedia: (): ZooPediaEntry[] =>
      baseSpecies.map((def) => {
        const rec = ctx.zoopedia.get(def.id);
        const skins = skinsForSpecies(def.id).map((s) => ({
          skinId: s.skinId,
          name: s.name,
          owned: s.skinId === 'default' || (rec?.ownedSkins.includes(s.skinId) ?? false),
          adLocked: s.adLocked,
        }));
        return {
          speciesId: def.id,
          name: def.name,
          tier: def.tier,
          caught: rec?.caught ?? false,
          count: rec?.count ?? 0,
          captureChancePct: Math.round(def.captureChance * 100),
          diet: def.diet,
          skins,
          activeSkinId: rec?.activeSkin ?? null,
        };
      }),
    zoopediaCompletionPct: () => {
      const caught = baseSpecies.filter((d) => ctx.zoopedia.get(d.id)?.caught).length;
      return baseSpecies.length === 0 ? 0 : Math.round((caught / baseSpecies.length) * 100);
    },
    buildCatalog: (): BuildCatalogEntry[] => {
      const housed = ctx.shelters.reduce((n, s) => n + s.occupants.length, 0);
      return SHELTERS.filter((def) => !def.hub).map((def) => {
        const unlocked = housed >= def.unlockAtHoused;
        return {
          shelterId: def.id,
          name: def.name,
          cost: def.levels[0].cost,
          capacity: def.levels[0].capacity,
          species: [...def.species],
          unlocked,
          lockHint: unlocked ? null : def.lockHint,
          // pens have no building model — show the fence in the store thumbnail
          modelPath: def.levels[0].model ?? 'models/buildings/Fence.glb',
        };
      });
    },
    shelters: (): ShelterInfo[] =>
      ctx.shelters.map((s) => {
        const next = s.def.levels[s.level + 1];
        const hasSad = s.occupants.some((uid) => {
          const a = ctx.animals.find((x) => x.uid === uid);
          return a?.brain.state === 'sad';
        });
        return {
          shelterUid: s.uid,
          shelterId: s.def.id,
          name: s.def.name,
          level: s.level + 1,
          occupants: s.occupants.length,
          capacity: s.capacity,
          food: s.food,
          foodMax: s.foodMax,
          upgradeCost: next ? next.cost : null,
          hasSadAnimal: hasSad,
        };
      }),
    totalHoused: () => ctx.shelters.reduce((n, s) => n + s.occupants.length, 0),
    currentZone: () => progression.currentZone(),
    actionContext: () => interaction.context,
  };
}

void boot();
