/**
 * Single wiring entry point for Agent B's systems. The orchestrator
 * (src/main.ts, Agent A) calls this once after the world is built and
 * registers the returned systems with the core loop.
 */
import type { GameContext, WorldApi } from "../types";
import { STARTER_BLUEPRINT } from "../config/blueprints";
import { STARTER_TUNING } from "../config/vehicleTuning";
import { InputManager } from "../input/InputManager";
import { Vehicle } from "./Vehicle";
import { FollowCamera } from "../camera/FollowCamera";

export interface VehicleSystems {
  vehicle: Vehicle;
  input: InputManager;
  camera: FollowCamera;
}

export function createVehicleSystems(ctx: GameContext, world: WorldApi): VehicleSystems {
  const input = new InputManager();
  const vehicle = new Vehicle(ctx, world, STARTER_BLUEPRINT, STARTER_TUNING, input);
  const camera = new FollowCamera(ctx, vehicle, world);
  return { vehicle, input, camera };
}

export { Vehicle } from "./Vehicle";
export { FollowCamera } from "../camera/FollowCamera";
export { InputManager } from "../input/InputManager";
export { buildVehicle } from "./VehicleFactory";
export type { VehicleBuild, WheelVisual } from "./VehicleFactory";
