import { describe, expect, it } from 'vitest';
import {
  BOSS_DEFINITIONS,
  bossForWave,
  type BossDefinition,
} from '../src/survival/zombies/bossConfig.ts';
import {
  BASE_ZOMBIE_STATS,
  PHONE_ADDICT_SPEED_MULTIPLIER,
  THROWER_SPEED_MULTIPLIER,
  WORKER_REWARD,
  WORKER_SPEED_MULTIPLIER,
  ZOMBIE_POOL_COUNTS,
} from '../src/survival/zombies/zombieConfig.ts';
import { healthMultiplierForWave } from '../src/survival/WaveManager.ts';
import { waveBalanceReport } from '../src/survival/waveBalance.ts';

const entries = Object.entries(BOSS_DEFINITIONS) as [string, BossDefinition][];

describe('boss registry invariants', () => {
  it('has at least one boss and enough pool slots to field it', () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(ZOMBIE_POOL_COUNTS.boss).toBeGreaterThanOrEqual(1);
  });

  it.each(entries)('%s is a well-formed definition', (id, def) => {
    expect(def.id).toBe(id);
    expect(def.name.length).toBeGreaterThan(0);
    expect(def.warning.length).toBeGreaterThan(0);
    expect(def.baseHealth).toBeGreaterThan(0);
    expect(def.reward).toBeGreaterThan(0);

    // Slow: a boss must never outrun the specialists, let alone a walker.
    expect(def.speedMultiplier).toBeLessThan(1);

    // Ram damage is capped and knockback resisted, so a fast rig cannot simply
    // flatten the boss the way it flattens the horde.
    expect(def.knockbackResistance).toBeGreaterThan(0);
    expect(def.knockbackResistance).toBeLessThanOrEqual(1);
    expect(Number.isFinite(def.impactDamageCap)).toBe(true);
    expect(def.impactDamageCap).toBeGreaterThan(0);

    // The slam circle must out-reach the distance the boss stops at. The boss
    // halts as soon as the nearest part is within rangeM, so a smaller circle
    // would always fall short of the very part that triggered the swing — the
    // boss would telegraph forever and never land a hit.
    expect(def.attack.radiusM).toBeGreaterThan(def.attack.rangeM);
    expect(def.attack.rangeM).toBeGreaterThan(0);
    expect(def.attack.windupSeconds).toBeGreaterThan(0);
    expect(def.attack.windupSeconds).toBeLessThan(def.attack.intervalSeconds);
    expect(def.attack.damage).toBeGreaterThan(0);

    expect(def.colliderRadiusM).toBeGreaterThan(0);
    expect(def.colliderHalfHeightM).toBeGreaterThan(0);
    expect(def.visualHeightM).toBeGreaterThan(0);
    expect(def.assetName.length).toBeGreaterThan(0);
  });
});

describe('The Sledge', () => {
  const sledge = BOSS_DEFINITIONS['hammer-brute'];

  it('lumbers slower than every zombie that closes to melee', () => {
    // The thrower is deliberately excluded: it is slower still, but it stops at
    // 13 m and lobs, so its speed says nothing about a melee chase.
    expect(sledge.speedMultiplier).toBeLessThan(WORKER_SPEED_MULTIPLIER);
    expect(sledge.speedMultiplier).toBeLessThan(PHONE_ADDICT_SPEED_MULTIPLIER);
    expect(sledge.speedMultiplier).toBeLessThan(0.75);
    // Still fast enough to actually reach the player from the spawn ring.
    expect(sledge.speedMultiplier).toBeGreaterThan(THROWER_SPEED_MULTIPLIER);
  });

  it('hits far harder than a walker and pays far better than a worker', () => {
    expect(sledge.attack.damage).toBeGreaterThan(
      BASE_ZOMBIE_STATS.attackDamage * 4,
    );
    expect(sledge.reward).toBeGreaterThan(WORKER_REWARD * 5);
  });

  it('carries roughly a full horde wave of health', () => {
    // The wave-5 boss replaces the wave-4 horde, so its scaled health should sit
    // in the same band rather than being a token or an unkillable wall.
    const bossHp = sledge.baseHealth * healthMultiplierForWave(5);
    const previousHordeHp = waveBalanceReport(4).effectiveTotalHp;
    expect(bossHp).toBeGreaterThan(previousHordeHp * 0.75);
    expect(bossHp).toBeLessThan(previousHordeHp * 1.5);
  });

  it('is the boss every fifth wave summons', () => {
    expect(bossForWave(5)).toBe(sledge);
  });
});
