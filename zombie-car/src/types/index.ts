/**
 * Shared contracts for all game systems.
 *
 * This file is owned by the orchestrator and is FROZEN during parallel
 * implementation — worker agents import from it but must not edit it.
 * If a contract change is needed, request it from the orchestrator.
 */
import type * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

export enum GamePhase {
  Countdown = "Countdown",
  WaveActive = "WaveActive",
  Upgrade = "Upgrade",
  GameOver = "GameOver",
}

// ---------------------------------------------------------------------------
// Vehicle blueprint (future vehicle-builder compatibility)
// ---------------------------------------------------------------------------

export type VehicleComponentType =
  | "chassis"
  | "structure"
  | "wheel"
  | "weapon"
  | "engine"
  | "armor";

export interface VehicleComponentBlueprint {
  id: string;
  type: VehicleComponentType;
  gridPosition: { x: number; y: number; z: number };
  localRotation: { x: number; y: number; z: number };
  mass: number;
  health: number;
  configuration?: Record<string, number | string | boolean>;
}

export interface VehicleBlueprint {
  id: string;
  name: string;
  components: VehicleComponentBlueprint[];
}

// ---------------------------------------------------------------------------
// Vehicle tuning (all base handling values; never mutated at runtime —
// temporary effects apply multipliers on top)
// ---------------------------------------------------------------------------

export interface VehicleTuning {
  mass: number;
  acceleration: number;
  reverseAcceleration: number;
  maximumForwardSpeed: number;
  maximumReverseSpeed: number;
  brakingForce: number;
  rollingResistance: number;
  lateralGrip: number;
  steeringStrength: number;
  highSpeedSteeringMultiplier: number;
  collisionDamageMultiplier: number;
  zombieDragPerContact: number;
  maximumZombieDrag: number;
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export interface WeaponStats {
  damage: number;
  fireRate: number; // shots per second
  range: number;
  projectileSpeed: number;
  targetRotationSpeed: number; // radians per second
}

// ---------------------------------------------------------------------------
// Zombies
// ---------------------------------------------------------------------------

export enum ZombieState {
  Spawning = "Spawning",
  Chasing = "Chasing",
  Attacking = "Attacking",
  KnockedBack = "KnockedBack",
  Dead = "Dead",
}

export interface ZombieStats {
  health: number;
  speed: number;
  attackDamage: number;
  attackInterval: number; // seconds between attacks while in range
  reward: number; // money awarded on kill
}

/** Minimal view of a zombie exposed to the turret/projectile system. */
export interface ZombieTarget {
  readonly position: THREE.Vector3;
  readonly isAlive: boolean;
  /** Apply weapon damage. Optional direction for hit feedback/knockback. */
  takeDamage(amount: number, direction?: THREE.Vector3): void;
}

/** Implemented by the zombie system so other systems can query targets. */
export interface ZombieQuery {
  getActiveZombies(): readonly ZombieTarget[];
}

// ---------------------------------------------------------------------------
// Run state and modifiers
// ---------------------------------------------------------------------------

/**
 * Run-scoped multipliers produced by upgrades. Systems read these live every
 * frame/shot — upgrades mutate ONLY this object plus upgradeLevels/money.
 */
export interface RunModifiers {
  weaponDamageMultiplier: number;
  fireRateMultiplier: number;
  weaponRangeMultiplier: number;
  enginePowerMultiplier: number;
  /** 0..1 fraction of incoming damage removed (Reinforced Chassis). */
  damageResistance: number;
  /** Scales each zombie-contact drag penalty; <1 with Anti-Swarm. */
  contactPenaltyMultiplier: number;
  /** Flat HP added to base max health (Vehicle Armor). The vehicle restores
   *  the newly added capacity when this grows. */
  maxHealthBonus: number;
}

export interface GameState {
  phase: GamePhase;
  wave: number;
  money: number;
  totalMoneyEarned: number;
  totalKills: number;
  zombiesRemainingInWave: number;
  upgradeLevels: Record<string, number>;
  modifiers: RunModifiers;
  muted: boolean;
}

export function createDefaultModifiers(): RunModifiers {
  return {
    weaponDamageMultiplier: 1,
    fireRateMultiplier: 1,
    weaponRangeMultiplier: 1,
    enginePowerMultiplier: 1,
    damageResistance: 0,
    contactPenaltyMultiplier: 1,
    maxHealthBonus: 0,
  };
}

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

export interface UpgradeDefinition {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  /** price(level) = round(basePrice * priceGrowth^level), level = levels owned */
  priceGrowth: number;
  maximumLevel?: number;
  /** Mutate state.modifiers (and nothing else) for the newly reached level. */
  apply: (gameState: GameState, newLevel: number) => void;
  /** Human-readable effect at a given level (level 0 = base). */
  effectText: (level: number) => string;
}

// ---------------------------------------------------------------------------
// Cross-system APIs
// ---------------------------------------------------------------------------

export type DamageSource = "zombie" | "collision";

/** Implemented by the vehicle system; consumed by combat, camera, UI. */
export interface VehicleApi {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  /** Normalized world-space facing direction on the ground plane. */
  readonly forward: THREE.Vector3;
  readonly speed: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly isDestroyed: boolean;
  /** Visual root object (contains chassis meshes; turret attaches to mount). */
  readonly root: THREE.Object3D;
  /** Chassis rigid body for impact math / knockback direction. */
  readonly body: RAPIER.RigidBody;
  /** Attachment point for the roof turret (world-parented under root). */
  readonly turretMount: THREE.Object3D;
  applyDamage(amount: number, source: DamageSource): void;
  /** Combat system reports the current number of touching/attacking zombies. */
  setSwarmContacts(contacts: number): void;
  setDrivingEnabled(enabled: boolean): void;
  /** Restore to full health at spawn position for a fresh run. */
  reset(): void;
}

/** Implemented by the world so spawning/AI can use the map safely. */
export interface WorldApi {
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Clear positions around the map edge suitable for zombie spawning. */
  readonly spawnPoints: readonly THREE.Vector3[];
}

/** Standard lifecycle every system implements (register with the loop). */
export interface GameSystem {
  /** Called at the fixed physics rate, before physics.step(). */
  fixedUpdate?(dt: number): void;
  /** Called once per rendered frame. */
  update?(dt: number): void;
  /** Restore initial run state (clean restart without page reload). */
  reset?(): void;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface GameEvents {
  "phase:changed": { phase: GamePhase; previous: GamePhase };
  "countdown:tick": { secondsRemaining: number };
  "wave:started": { wave: number; totalZombies: number };
  "wave:completed": { wave: number; reward: number };
  "zombie:killed": { reward: number; x: number; y: number; z: number };
  "zombies:remaining": { remaining: number };
  "vehicle:damaged": {
    amount: number;
    health: number;
    maxHealth: number;
    source: DamageSource;
  };
  "vehicle:healthChanged": { health: number; maxHealth: number };
  "vehicle:destroyed": Record<string, never>;
  "swarm:changed": { contacts: number; slowdown: number; swarmed: boolean };
  "money:changed": { money: number; totalEarned: number };
  "kills:changed": { totalKills: number };
  "upgrade:purchased": { id: string; level: number; price: number };
  /** Big collision — camera shake with 0..1 intensity. */
  "impact:major": { intensity: number };
  /** Lightweight audio hook; sound ids are strings like "shot", "kill". */
  "audio:play": { sound: string };
  "ui:startNextWave": Record<string, never>;
  "ui:restartRun": Record<string, never>;
  "ui:resetVehicle": Record<string, never>;
  /** Emitted by the director after all systems have been reset. */
  "game:restarted": Record<string, never>;
}

export type EventKey = keyof GameEvents;

export interface EventBus {
  /** Subscribe; returns an unsubscribe function. */
  on<K extends EventKey>(
    event: K,
    handler: (payload: GameEvents[K]) => void
  ): () => void;
  off<K extends EventKey>(
    event: K,
    handler: (payload: GameEvents[K]) => void
  ): void;
  emit<K extends EventKey>(event: K, payload: GameEvents[K]): void;
}

// ---------------------------------------------------------------------------
// Game context (constructed in main.ts, passed to every system)
// ---------------------------------------------------------------------------

export interface GameContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  physics: RAPIER.World;
  rapier: typeof RAPIER;
  events: EventBus;
  state: GameState;
}
