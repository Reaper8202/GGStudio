import { GameConfig } from '../config/GameConfig';
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

/** Platform footprint half-length, world units (spans ±this around center). */
const PLATFORM_HALF_LEN = GameConfig.platform.length / 2;
/** Visual height (PlayerAvatar.height) required to count as "on top". */
const PLATFORM_RIDE_HEIGHT = GameConfig.platform.height - 0.25;

/**
 * Lane/z-interval overlap with pose gating — same rules as the 2D game:
 * jump clears 'low' (vents), slide clears 'high' (gates), 'block'
 * (impostors) always kills. Coins collect in any pose. No physics engine —
 * deterministic and allocation-free.
 *
 * 'platform' obstacles are excluded from checkObstacles (they don't kill by
 * simple overlap) and handled separately by checkPlatforms, which also
 * drives the ride/fall state machine in PlayerAvatar.
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
      if (o.kind === 'platform') continue; // see checkPlatforms
      const dz = Math.abs(o.group.position.z);
      if (dz > OBSTACLE_HALF_DEPTH[o.kind]) continue;
      if (Math.abs(o.group.position.x - px) > OBSTACLE_HALF_W + PLAYER_HALF_W - 0.35) continue;
      if (o.kind === 'low' && player.airborne) continue;
      if (o.kind === 'high' && player.sliding) continue;
      return o;
    }
    return null;
  }

  /**
   * Rideable-platform logic. `riding` is the platform the player was riding
   * last frame (or null); pass the returned `riding` back in next frame to
   * keep the ride sticky across the whole footprint (including while
   * sliding on top), and to guarantee a platform never kills the player
   * currently riding it.
   *
   * - `riding`: the platform is under the player's lane, the player's z=0
   *   is inside its footprint, and either (a) the player was already riding
   *   it last frame (sticky), or (b) the player is high enough
   *   (player.height ≥ platform.height − 0.25) — landing ANYWHERE over the
   *   footprint counts, including lane-switching onto it mid-air.
   * - `hit`: a grounded, non-invulnerable player anywhere inside the
   *   footprint ran into the box (front face or side entry) — death. This
   *   can't false-positive: any legitimate way to be over the footprint
   *   (descending jump, riding) satisfies the height test first.
   */
  checkPlatforms(
    player: PlayerAvatar,
    obstacles: readonly Obstacle3D[],
    riding: Obstacle3D | null,
    now: number,
  ): { riding: Obstacle3D | null; hit: Obstacle3D | null } {
    if (player.pose === 'dead') return { riding: null, hit: null };

    const px = player.x;
    let nextRiding: Obstacle3D | null = null;
    let hit: Obstacle3D | null = null;

    for (const o of obstacles) {
      if (o.kind !== 'platform') continue;
      if (Math.abs(o.group.position.x - px) > OBSTACLE_HALF_W + PLAYER_HALF_W - 0.35) continue;

      const insideFootprint = Math.abs(o.group.position.z) < PLATFORM_HALF_LEN;
      if (!insideFootprint) continue;

      const highEnough = player.height >= PLATFORM_RIDE_HEIGHT;
      if (riding === o || highEnough) {
        nextRiding = o;
      } else if (!player.invulnerable(now)) {
        hit = o;
      }
    }

    return { riding: nextRiding, hit };
  }

  /** Collects overlapping coins via `collect`. */
  checkCoins(
    player: PlayerAvatar,
    coins: readonly CoinPickup[],
    riding: boolean,
    collect: (c: CoinPickup) => void,
  ): void {
    if (player.pose === 'dead') return;
    const px = player.x;
    for (const c of coins) {
      if (!c.active) continue;
      // Arc coins float over a vent jump / platform top — reachable while
      // airborne, or while riding a platform (they hover at the platform's
      // top-surface height).
      if (c.elevated && !(player.airborne || riding)) continue;
      if (
        Math.abs(c.group.position.z) < COIN_HALF_DEPTH &&
        Math.abs(c.group.position.x - px) < COIN_HALF_W
      ) {
        collect(c);
      }
    }
  }
}
