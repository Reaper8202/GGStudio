import type { PlayerAvatar } from './entities/PlayerAvatar';
import type { Obstacle3D, CoinPickup } from './entities/obstacles';

/** Ground-plane half-extents (world units). The player stands at z = 0. */
const PLAYER_HALF_W = 0.45;
const OBSTACLE_HALF_DEPTH: Record<string, number> = {
  low: 0.85, // vent base + player depth
  high: 0.5, // thin gate plane
  block: 0.75, // impostor body
};
const OBSTACLE_HALF_W = 0.95;
const COIN_HALF_W = 0.75;
const COIN_HALF_DEPTH = 0.7;

/**
 * Lane/z-interval overlap with pose gating — same rules as the 2D game:
 * jump clears 'low' (vents), slide clears 'high' (gates), 'block'
 * (impostors) always kills. Coins collect in any pose. No physics engine —
 * deterministic and allocation-free.
 */
export class CollisionSystem {
  checkObstacles(
    player: PlayerAvatar,
    obstacles: readonly Obstacle3D[],
    now: number,
  ): Obstacle3D | null {
    if (player.pose === 'dead' || player.invulnerable(now)) return null;
    const px = player.x;
    for (const o of obstacles) {
      const dz = Math.abs(o.group.position.z);
      if (dz > OBSTACLE_HALF_DEPTH[o.kind]) continue;
      if (Math.abs(o.group.position.x - px) > OBSTACLE_HALF_W + PLAYER_HALF_W - 0.35) continue;
      if (o.kind === 'low' && player.airborne) continue;
      if (o.kind === 'high' && player.sliding) continue;
      return o;
    }
    return null;
  }

  /** Collects overlapping coins via `collect`. */
  checkCoins(
    player: PlayerAvatar,
    coins: readonly CoinPickup[],
    collect: (c: CoinPickup) => void,
  ): void {
    if (player.pose === 'dead') return;
    const px = player.x;
    for (const c of coins) {
      if (!c.active) continue;
      // Arc coins float over a vent jump — only reachable while airborne.
      if (c.elevated && !player.airborne) continue;
      if (
        Math.abs(c.group.position.z) < COIN_HALF_DEPTH &&
        Math.abs(c.group.position.x - px) < COIN_HALF_W
      ) {
        collect(c);
      }
    }
  }
}
