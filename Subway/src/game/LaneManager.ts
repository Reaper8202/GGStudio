import { GameConfig } from '../config/GameConfig';

/** Horizontal geometry of the 3 lanes, in world units. */
export class LaneManager {
  readonly laneCount = GameConfig.lanes;
  readonly laneSpacing = 2.3;
  /** Half-width of the walkable floor (for track/wall placement). */
  readonly floorHalfWidth = (this.laneSpacing * this.laneCount) / 2 + 0.6;

  laneX(lane: number): number {
    return (lane - (this.laneCount - 1) / 2) * this.laneSpacing;
  }

  clampLane(lane: number): number {
    return Math.max(0, Math.min(this.laneCount - 1, lane));
  }
}
