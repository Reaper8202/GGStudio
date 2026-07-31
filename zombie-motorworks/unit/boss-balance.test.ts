import { describe, expect, it } from 'vitest';
import {
  BOSS_DEFINITIONS,
  bossForWave,
  type BossDefinition,
} from '../src/survival/zombies/bossConfig.ts';
import {
  BASE_ZOMBIE_STATS,
  PHONE_ADDICT_SPEED_MULTIPLIER,
  PROJECTILE_HORIZONTAL_SPEED,
  THROWER_ATTACK_RANGE,
  THROWER_SPEED_MULTIPLIER,
  VIAL_MAX_FLIGHT_TIME,
  WORKER_REWARD,
  WORKER_SPEED_MULTIPLIER,
  ZOMBIE_ATTACK_RANGE,
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

    // Shared across attack kinds: every boss stops somewhere, telegraphs for less
    // than its own interval (or the tell would never finish), and hurts.
    expect(def.attack.rangeM).toBeGreaterThan(0);
    expect(def.attack.windupSeconds).toBeGreaterThan(0);
    expect(def.attack.windupSeconds).toBeLessThan(def.attack.intervalSeconds);
    expect(def.attack.damage).toBeGreaterThan(0);

    expect(def.colliderRadiusM).toBeGreaterThan(0);
    expect(def.colliderHalfHeightM).toBeGreaterThan(0);
    expect(def.visualHeightM).toBeGreaterThan(0);
    expect(def.assetName.length).toBeGreaterThan(0);
    if (def.visualWidthScale !== undefined) {
      expect(def.visualWidthScale).toBeGreaterThan(0);
      expect(def.visualWidthScale).toBeLessThanOrEqual(1);
    }
  });

  it.each(entries.filter(([, def]) => def.attack.kind === 'slam'))(
    '%s is a well-formed slam',
    (_id, def) => {
      if (def.attack.kind !== 'slam') throw new Error('filtered above');

      // The slam circle must out-reach the distance the boss stops at. The boss
      // halts as soon as the nearest part is within rangeM, so a smaller circle
      // would always fall short of the very part that triggered the swing — the
      // boss would telegraph forever and never land a hit.
      expect(def.attack.radiusM).toBeGreaterThan(def.attack.rangeM);
    },
  );

  it.each(entries.filter(([, def]) => def.attack.kind === 'vial'))(
    '%s is a well-formed vial attack',
    (_id, def) => {
      if (def.attack.kind !== 'vial') throw new Error('filtered above');
      const attack = def.attack;

      // The three rings have to nest: it breaks off inside disengage, backs up
      // past retreat, and throws at range. Any other ordering either traps it in
      // a retreat it can never satisfy or lets it throw from inside melee.
      expect(attack.disengageRangeM).toBeGreaterThan(0);
      expect(attack.disengageRangeM).toBeLessThan(attack.retreatRangeM);
      expect(attack.retreatRangeM).toBeLessThanOrEqual(attack.rangeM);

      // The whole point of the vial: slower in flight than a thrower's lob.
      expect(attack.projectileSpeedMps).toBeGreaterThan(0);
      expect(attack.projectileSpeedMps).toBeLessThan(
        PROJECTILE_HORIZONTAL_SPEED,
      );

      // A phase threshold outside (0, 1) would mean the boss is either always
      // enraged from spawn or can never reach the second phase at all.
      expect(attack.phaseTwoHealthFraction).toBeGreaterThan(0);
      expect(attack.phaseTwoHealthFraction).toBeLessThan(1);
      expect(attack.enragedVialCount).toBeGreaterThan(1);
      expect(attack.enragedSpreadDeg).toBeGreaterThan(0);
      expect(attack.enragedSpreadDeg).toBeLessThan(180);

      // Its working band must stay inside the flight-time clamps, or a vial
      // would be forced to fly faster than its nominal speed to arrive on time.
      expect(attack.rangeM / attack.projectileSpeedMps).toBeLessThanOrEqual(
        VIAL_MAX_FLIGHT_TIME,
      );

      // The puddle is the point: a zero radius, zero duration, or zero DPS
      // puddle would make the vial nothing more than a worse needle.
      expect(attack.puddleRadiusM).toBeGreaterThan(0);
      expect(attack.puddleDurationSeconds).toBeGreaterThan(0);
      expect(attack.poisonDamagePerSecond).toBeGreaterThan(0);
    },
  );
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

  it('shows a capsule body, not a primitive body like the alchemist', () => {
    expect(sledge.bodyVisual).toBe('model');
  });
});

describe('The Alchemist', () => {
  const alchemist = BOSS_DEFINITIONS['acid-alchemist'];

  it('throws acid vials rather than swinging', () => {
    expect(alchemist.attack.kind).toBe('vial');
  });

  it('kites: it throws from beyond the thrower and never brawls', () => {
    if (alchemist.attack.kind !== 'vial') throw new Error('vial boss expected');
    // Throwing from past the thrower's range keeps "things shoot at me here"
    // consistent with what the player already learned on wave 3.
    expect(alchemist.attack.rangeM).toBeGreaterThan(THROWER_ATTACK_RANGE);
    // It gives ground well before melee, so it is never a stand-and-trade fight.
    expect(alchemist.attack.disengageRangeM).toBeGreaterThan(ZOMBIE_ATTACK_RANGE);
  });

  it('moves faster than The Sledge but can still be run down', () => {
    // It spends its time backing away, so it needs more speed than the brute —
    // but staying under a walker guarantees a rig can always close on it.
    expect(alchemist.speedMultiplier).toBeGreaterThan(
      BOSS_DEFINITIONS['hammer-brute'].speedMultiplier,
    );
    expect(alchemist.speedMultiplier).toBeLessThan(1);
  });

  it('is tall and narrow rather than a second brute', () => {
    const sledge = BOSS_DEFINITIONS['hammer-brute'];
    expect(alchemist.visualHeightM).toBeGreaterThan(sledge.visualHeightM);
    expect(alchemist.colliderRadiusM).toBeLessThan(sledge.colliderRadiusM);
    // Without the width squash the capsule body would just look like a fat pill.
    expect(alchemist.visualWidthScale).toBeLessThan(1);
  });

  it('renders as a primitive capsule, not the shared voxel placeholder', () => {
    expect(alchemist.bodyVisual).toBe('capsule');
  });

  it('throws exactly three vials once past half health', () => {
    if (alchemist.attack.kind !== 'vial') throw new Error('vial boss expected');
    expect(alchemist.attack.phaseTwoHealthFraction).toBe(0.5);
    expect(alchemist.attack.enragedVialCount).toBe(3);
  });

  it('carries roughly a full horde wave of health', () => {
    // Same rule as The Sledge: the wave-10 boss replaces the wave-9 horde, so its
    // scaled health should sit in that band rather than being a token or a wall.
    const bossHp = alchemist.baseHealth * healthMultiplierForWave(10);
    const previousHordeHp = waveBalanceReport(9).effectiveTotalHp;
    expect(bossHp).toBeGreaterThan(previousHordeHp * 0.75);
    expect(bossHp).toBeLessThan(previousHordeHp * 1.5);
  });

  it('is the boss wave 10 summons, alternating with The Sledge', () => {
    expect(bossForWave(10)).toBe(alchemist);
    expect(bossForWave(15)).toBe(BOSS_DEFINITIONS['hammer-brute']);
    expect(bossForWave(20)).toBe(alchemist);
  });
});
