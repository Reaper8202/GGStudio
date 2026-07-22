import { describe, expect, it } from 'vitest';
import {
  healthMultiplierForWave,
  zombieCompositionForWave,
} from '../src/survival/WaveManager.ts';
import {
  BASE_ZOMBIE_STATS,
  IMPACT_DAMAGE_PER_SPEED,
  LETHAL_IMPACT_SPEED,
  MAXIMUM_SWARM_DRAG,
  MIN_IMPACT_SPEED,
  SWARM_DRAG_PER_CONTACT,
} from '../src/survival/zombies/zombieConfig.ts';

describe('zombie ram and drag balance', () => {
  it('uses the gentler health ramp and introduces one thrower at wave 3', () => {
    expect(healthMultiplierForWave(5)).toBeCloseTo(1.24);
    expect(healthMultiplierForWave(21)).toBe(2.2);
    expect(zombieCompositionForWave(2).thrower).toBe(0);
    expect(zombieCompositionForWave(3).thrower).toBe(1);
  });

  it('uses 40 km/h damage and 80 km/h lethal ram thresholds', () => {
    expect(MIN_IMPACT_SPEED * 3.6).toBeCloseTo(40);
    expect(LETHAL_IMPACT_SPEED * 3.6).toBeCloseTo(80);
    expect(MIN_IMPACT_SPEED * IMPACT_DAMAGE_PER_SPEED).toBeLessThan(
      BASE_ZOMBIE_STATS.health,
    );
    expect((BASE_ZOMBIE_STATS.health / IMPACT_DAMAGE_PER_SPEED) * 3.6).toBe(
      80,
    );
  });

  it('applies only light, capped swarm drag', () => {
    expect(SWARM_DRAG_PER_CONTACT).toBe(0.03);
    expect(MAXIMUM_SWARM_DRAG).toBe(0.3);
  });
});
