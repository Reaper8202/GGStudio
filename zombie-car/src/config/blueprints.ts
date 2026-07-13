/**
 * Starter vehicle blueprint: 1 chassis, 4 wheels, a front bumper (structure),
 * a central engine block, and one roof turret mount (type "weapon").
 *
 * Coordinates use a small integer grid (`GRID_CELL_SIZE` meters per unit).
 * Forward is local -Z (most negative gridPosition.z = the front of the
 * vehicle), consistent with `VehicleFactory`/`Vehicle`.
 */
import type { VehicleBlueprint } from "../types";

/** Meters per integer grid unit used by `VehicleComponentBlueprint.gridPosition`. */
export const GRID_CELL_SIZE = 0.5;

export const STARTER_BLUEPRINT: VehicleBlueprint = {
  id: "starter-buggy",
  name: "Starter Buggy",
  components: [
    {
      id: "chassis",
      type: "chassis",
      gridPosition: { x: 0, y: 2, z: 0 },
      localRotation: { x: 0, y: 0, z: 0 },
      mass: 220,
      health: 80,
      configuration: { width: 1.7, height: 0.6, depth: 2.8, color: 0x2f6f4f },
    },
    {
      id: "wheel-front-left",
      type: "wheel",
      gridPosition: { x: -2, y: 1, z: -3 },
      localRotation: { x: 0, y: 0, z: 0 },
      mass: 20,
      health: 15,
      configuration: { radius: 0.34, thickness: 0.3, color: 0x1a1a1a },
    },
    {
      id: "wheel-front-right",
      type: "wheel",
      gridPosition: { x: 2, y: 1, z: -3 },
      localRotation: { x: 0, y: 0, z: 0 },
      mass: 20,
      health: 15,
      configuration: { radius: 0.34, thickness: 0.3, color: 0x1a1a1a },
    },
    {
      id: "wheel-rear-left",
      type: "wheel",
      gridPosition: { x: -2, y: 1, z: 2 },
      localRotation: { x: 0, y: 0, z: 0 },
      mass: 20,
      health: 15,
      configuration: { radius: 0.34, thickness: 0.3, color: 0x1a1a1a },
    },
    {
      id: "wheel-rear-right",
      type: "wheel",
      gridPosition: { x: 2, y: 1, z: 2 },
      localRotation: { x: 0, y: 0, z: 0 },
      mass: 20,
      health: 15,
      configuration: { radius: 0.34, thickness: 0.3, color: 0x1a1a1a },
    },
    {
      id: "front-bumper",
      type: "structure",
      gridPosition: { x: 0, y: 1, z: -4 },
      localRotation: { x: 0, y: 0, z: 0 },
      mass: 35,
      health: 25,
      configuration: { width: 1.75, height: 0.35, depth: 0.25, color: 0x8a8f94 },
    },
    {
      id: "engine-block",
      type: "engine",
      gridPosition: { x: 0, y: 2, z: -1 },
      localRotation: { x: 0, y: 0, z: 0 },
      mass: 140,
      health: 20,
      configuration: { width: 1.0, height: 0.45, depth: 0.7, color: 0x54606b },
    },
    {
      id: "roof-turret-mount",
      type: "weapon",
      gridPosition: { x: 0, y: 3, z: 0 },
      localRotation: { x: 0, y: 0, z: 0 },
      mass: 15,
      health: 15,
      configuration: { radius: 0.26, thickness: 0.1, color: 0x33383d },
    },
  ],
};
