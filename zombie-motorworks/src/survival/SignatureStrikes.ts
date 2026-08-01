/**
 * In-flight signature strikes: the window between the player's click and the
 * blast landing.
 *
 * Two of the three signatures do not detonate on the frame they are fired. The
 * Pyre Core's bolus arcs to the point at a finite speed; the Fallout Silo's
 * shell falls for seconds under a marked ring. Both need something to remember
 * where they are going, what they will do when they get there, and where to
 * draw themselves in the meantime — and the Storm Rod, which lands instantly,
 * still goes through the same path so all three resolve in one place.
 *
 * This module owns only the bookkeeping and the flight geometry. It never
 * touches zombies, particles or sound: the owning mode passes a callback that
 * does the damage, and asks each frame where to draw a trail or a marker. That
 * keeps the arc maths testable without a physics world behind it.
 */

import type { SignatureDefinition } from '../core/types.ts';
import type { SignatureStats } from '../core/signatures.ts';
import { ZOMBIE_HALF_HEIGHT, ZOMBIE_RADIUS } from './zombies/zombieConfig.ts';

/**
 * Height a strike's blast is centred at, metres.
 *
 * `ZombieSystem.explodeAt` measures falloff in three dimensions, and a zombie's
 * position is its capsule centre — about 0.87m off the ground. Centring a blast
 * at y=0 would therefore charge every target most of a metre of "distance" it
 * has not actually travelled, quietly shrinking every radius in this file: a
 * 2.2m lightning strike would land 40% of its damage on something standing
 * directly under it. Detonating at body height instead makes the falloff behave
 * like the flat circle the numbers describe.
 */
const BLAST_HEIGHT_M = ZOMBIE_HALF_HEIGHT + ZOMBIE_RADIUS;

/** What a strike does when it arrives. */
export interface StrikeImpact {
  kind: SignatureDefinition['kind'];
  /** Where the blast is centred, in world metres. */
  x: number;
  y: number;
  z: number;
  /** Damage at the centre, falling off linearly to nothing at the rim. */
  damage: number;
  radiusM: number;
  /** Seconds of char left on what the blast catches; 0 for none. */
  burnSeconds: number;
  /** Seconds of arc flare left on what the blast catches; 0 for none. */
  shockSeconds: number;
}

/** One strike between firing and landing. */
interface PendingStrike extends StrikeImpact {
  /** Seconds still to run before it detonates. */
  remaining: number;
  /** Total flight time, so progress can be derived for the telegraph. */
  total: number;
  /** Launch point, for drawing the payload along its path. */
  fromX: number;
  fromY: number;
  fromZ: number;
  /**
   * Peak extra height of the arc, metres. Zero for a shell, which is modelled
   * as falling straight down out of the sky rather than arcing.
   */
  arcHeightM: number;
  /** Seconds since the last telegraph mark was drawn. */
  sinceMark: number;
}

/** Where a strike's payload is right now, for the frame's VFX. */
export interface StrikeVisual {
  kind: SignatureDefinition['kind'];
  /** Payload position this frame. */
  x: number;
  y: number;
  z: number;
  /** Impact point, for the ground marker. */
  targetX: number;
  targetZ: number;
  radiusM: number;
  /** 0 at launch to 1 at impact. */
  progress: number;
  /** True on the frames a telegraph mark is due; see `MARK_INTERVAL_S`. */
  drawMark: boolean;
}

/**
 * How often the falling-shell ring is redrawn, seconds. The shell is in the
 * air for four seconds; a per-frame ring would spend the whole particle budget
 * telegraphing a shot that has not landed yet, and at this rate the marker
 * still reads as continuous.
 */
const MARK_INTERVAL_S = 0.1;

/** Height a shell is drawn falling from, metres. */
const SHELL_DROP_HEIGHT_M = 26;

/**
 * Clamp a requested impact point into the signature's reach.
 *
 * A click past the weapon's range is pulled back onto the edge of the circle
 * rather than refused. Eating the click would be the worse failure: the player
 * gets no shot, no feedback that explains why, and the cooldown they were
 * watching does not move.
 */
export function clampStrikePoint(
  from: { x: number; z: number },
  to: { x: number; z: number },
  rangeM: number,
): { x: number; z: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= rangeM || distance < 1e-6) return { x: to.x, z: to.z };
  const scale = rangeM / distance;
  return { x: from.x + dx * scale, z: from.z + dz * scale };
}

export class SignatureStrikes {
  private readonly pending: PendingStrike[] = [];

  /** Strikes still in the air. */
  get activeCount(): number {
    return this.pending.length;
  }

  /**
   * Fire a strike at a world point. Returns true when it detonated on this
   * call (the Storm Rod's instant bolt), false when it is now in flight.
   *
   * Travel time is derived from the payload's speed over the ground distance
   * and added to any fixed delay, so a fireball lobbed across the arena takes
   * visibly longer to arrive than one dropped at the rig's feet — while the
   * shell's four-second fall is the same wherever it is aimed.
   */
  fire(
    stats: SignatureStats,
    kind: SignatureDefinition['kind'],
    from: { x: number; y: number; z: number },
    target: { x: number; z: number },
    detonate: (impact: StrikeImpact) => void,
  ): boolean {
    const impact: StrikeImpact = {
      kind,
      x: target.x,
      y: BLAST_HEIGHT_M,
      z: target.z,
      damage: stats.damage,
      radiusM: stats.radiusM,
      burnSeconds: stats.burnSeconds,
      shockSeconds: stats.shockSeconds,
    };

    const groundDistance = Math.hypot(target.x - from.x, target.z - from.z);
    const travelSeconds =
      stats.travelSpeedMps > 0 ? groundDistance / stats.travelSpeedMps : 0;
    const total = travelSeconds + stats.delaySeconds;
    if (total <= 0) {
      detonate(impact);
      return true;
    }

    this.pending.push({
      ...impact,
      remaining: total,
      total,
      fromX: from.x,
      fromY: from.y,
      fromZ: from.z,
      // A shell is modelled as dropping out of the sky onto the point, so it
      // has no arc; a bolus is lobbed, and its arc scales with the throw.
      arcHeightM: kind === 'nuke' ? 0 : 1.2 + groundDistance * 0.14,
      sinceMark: MARK_INTERVAL_S,
    });
    return false;
  }

  /**
   * Advance every strike in flight, detonating the ones that arrive.
   *
   * Iterated back to front so a strike removed on arrival cannot make the loop
   * skip the one that shuffled into its place.
   */
  step(dt: number, detonate: (impact: StrikeImpact) => void): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const strike = this.pending[i];
      strike.remaining -= dt;
      strike.sinceMark += dt;
      if (strike.remaining > 0) continue;
      this.pending.splice(i, 1);
      detonate(strike);
    }
  }

  /**
   * Where each strike's payload and marker should be drawn this frame.
   *
   * `drawMark` is latched here rather than in the caller so the marker's
   * cadence survives however the mode chooses to render it, and the flag is
   * cleared as it is read — one mark per interval, not one per reader.
   */
  visuals(): StrikeVisual[] {
    const out: StrikeVisual[] = [];
    for (const strike of this.pending) {
      const progress =
        strike.total <= 0
          ? 1
          : Math.max(0, Math.min(1, 1 - strike.remaining / strike.total));
      const drawMark = strike.sinceMark >= MARK_INTERVAL_S;
      if (drawMark) strike.sinceMark = 0;
      out.push({
        kind: strike.kind,
        ...this.payloadPosition(strike, progress),
        targetX: strike.x,
        targetZ: strike.z,
        radiusM: strike.radiusM,
        progress,
        drawMark,
      });
    }
    return out;
  }

  /** Drop every strike in flight, without detonating any of them. */
  clear(): void {
    this.pending.length = 0;
  }

  /**
   * The payload's world position at `progress` along its flight.
   *
   * A shell ignores its launch point entirely and falls vertically onto the
   * target, which is what makes the marked ring honest — the warning is where
   * the shell is going, not a line the player has to extrapolate. A bolus
   * travels the straight line to the point with a parabolic lift over it.
   */
  private payloadPosition(
    strike: PendingStrike,
    progress: number,
  ): { x: number; y: number; z: number } {
    if (strike.kind === 'nuke') {
      return {
        x: strike.x,
        y: SHELL_DROP_HEIGHT_M * (1 - progress),
        z: strike.z,
      };
    }
    // 4·p·(1−p) peaks at 1 halfway along, so `arcHeightM` is the height of the
    // throw rather than a scale factor on it.
    const lift = 4 * progress * (1 - progress) * strike.arcHeightM;
    return {
      x: strike.fromX + (strike.x - strike.fromX) * progress,
      y: strike.fromY + (strike.y - strike.fromY) * progress + lift,
      z: strike.fromZ + (strike.z - strike.fromZ) * progress,
    };
  }
}
