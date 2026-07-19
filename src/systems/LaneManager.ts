import { GAME_WIDTH } from '../config/constants';
import { GameConfig } from '../config/GameConfig';

/** Horizontal geometry of the 3 lanes. */
export class LaneManager {
  readonly laneCount = GameConfig.lanes;
  readonly laneSpacing = 200;
  readonly centerX = GAME_WIDTH / 2;
  /** Total road width incl. shoulders (used to draw the road strip). */
  readonly roadWidth = this.laneSpacing * this.laneCount;

  laneX(lane: number): number {
    return this.centerX + (lane - (this.laneCount - 1) / 2) * this.laneSpacing;
  }

  clampLane(lane: number): number {
    return Math.max(0, Math.min(this.laneCount - 1, lane));
  }
}
