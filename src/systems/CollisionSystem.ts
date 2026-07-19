import type { Player, Aabb } from '../entities/Player';
import type { Obstacle } from '../entities/Obstacle';
import type { Coin } from '../entities/Coin';

const OBSTACLE_HALF_W = 58;
const OBSTACLE_DEPTH = 42; // ground footprint along the track
const COIN_RADIUS = 26;

function overlaps(a: Aabb, x: number, y: number, halfW: number, depth: number): boolean {
  return (
    a.x < x + halfW &&
    a.x + a.w > x - halfW &&
    a.y < y &&
    a.y + a.h > y - depth
  );
}

/**
 * Manual AABB on the ground plane (no physics engine — deterministic and
 * allocation-free). Pose gates severity: jump clears `low`, slide clears
 * `high`, `block` always kills. Coins collect in any pose.
 */
export class CollisionSystem {
  /** Returns the obstacle hit this frame, or null. */
  checkObstacles(player: Player, obstacles: readonly Obstacle[]): Obstacle | null {
    if (player.invulnerable || player.pose === 'dead') return null;
    const a = player.aabb();
    for (const o of obstacles) {
      if (!o.active) continue;
      if (!overlaps(a, o.x, o.y, OBSTACLE_HALF_W, OBSTACLE_DEPTH)) continue;
      if (o.kind === 'low' && player.airborne) continue;
      if (o.kind === 'high' && player.sliding) continue;
      return o;
    }
    return null;
  }

  /** Collects overlapping coins via `collect`; returns how many were taken. */
  checkCoins(player: Player, coins: readonly Coin[], collect: (c: Coin) => void): number {
    if (player.pose === 'dead') return 0;
    const a = player.aabb();
    let taken = 0;
    for (const c of coins) {
      if (!c.active) continue;
      if (overlaps(a, c.x, c.y + COIN_RADIUS, COIN_RADIUS, COIN_RADIUS * 2)) {
        collect(c);
        taken++;
      }
    }
    return taken;
  }
}
