import { describe, expect, it } from 'vitest';
import {
  BOSS_DEFINITIONS,
  ELITE_BOSSES,
  bossForWave,
  type BossDefinition,
} from '../src/survival/zombies/bossConfig.ts';
import {
  BASE_ZOMBIE_STATS,
  BEHEMOTH_HEALTH_MULTIPLIER,
  BEHEMOTH_REWARD,
  BEHEMOTH_SPEED_MULTIPLIER,
  BEHEMOTH_VISUAL_HEIGHT,
  PROJECTILE_HORIZONTAL_SPEED,
  THROWER_ATTACK_RANGE,
  VIAL_MAX_FLIGHT_TIME,
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

describe('The Behemoth (elite boss)', () => {
  const elite = ELITE_BOSSES.behemoth;

  it('is a well-formed elite spec', () => {
    expect(elite.kind).toBe('behemoth');
    expect(elite.name.length).toBeGreaterThan(0);
    expect(elite.warning.length).toBeGreaterThan(0);
    // Stacks on top of the ordinary Behemoth's own multiplier, so it must be
    // strictly tougher than a horde one, not just as tough.
    expect(elite.healthMultiplier).toBeGreaterThan(1);
    expect(elite.reward).toBeGreaterThan(0);
  });

  it('pays far better than an ordinary Behemoth kill', () => {
    expect(elite.reward).toBeGreaterThan(BEHEMOTH_REWARD * 3);
  });

  it('carries roughly a full horde wave of health', () => {
    // No separate baseHealth of its own: an elite boss is just a tougher
    // instance of the real kind, so this mirrors the exact formula
    // Zombie.spawn uses — base health times the kind's own multiplier times
    // the elite's stacked multiplier. The wave-5 boss stands alongside the
    // wave-4 horde's scale, so the result should sit in the same band rather
    // than being a token or an unkillable wall.
    const eliteBaseHealth =
      BASE_ZOMBIE_STATS.health *
      BEHEMOTH_HEALTH_MULTIPLIER *
      elite.healthMultiplier;
    const bossHp = eliteBaseHealth * healthMultiplierForWave(5);
    const previousHordeHp = waveBalanceReport(4).effectiveTotalHp;
    expect(bossHp).toBeGreaterThan(previousHordeHp * 0.75);
    expect(bossHp).toBeLessThan(previousHordeHp * 1.5);
  });

  it('is the boss every fifth wave summons, alternating with The Alchemist', () => {
    expect(bossForWave(5)).toEqual({ style: 'elite', elite });
    expect(bossForWave(15)).toEqual({ style: 'elite', elite });
  });

  it('is a real Behemoth — same model, animation, and smash attack as an ordinary one', () => {
    // There is deliberately no boss-specific visual size, attack shape, or
    // asset here: an elite boss reuses `KIND_MODELS.behemoth` and the kind's
    // own attack AI wholesale (see `Zombie.spawn`), rather than the classic
    // system's per-definition `visualHeightM`/`attack` fields.
    expect(elite).not.toHaveProperty('visualHeightM');
    expect(elite).not.toHaveProperty('attack');
    expect(elite).not.toHaveProperty('assetName');
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

  it('moves faster than an ordinary Behemoth but can still be run down', () => {
    // It spends its time backing away, so it needs more speed than a
    // Behemoth — but staying under a walker guarantees a rig can always
    // close on it.
    expect(alchemist.speedMultiplier).toBeGreaterThan(BEHEMOTH_SPEED_MULTIPLIER);
    expect(alchemist.speedMultiplier).toBeLessThan(1);
  });

  it('towers over the horde', () => {
    expect(alchemist.visualHeightM).toBeGreaterThan(BEHEMOTH_VISUAL_HEIGHT);
  });

  it('wears its own rigged model at its own proportions', () => {
    expect(alchemist.bodyVisual).toBe('model');
    expect(alchemist.assetName).toBe('green-alchemist.rigged.glb');
    // `applyBossVisualSizing` applies the width squash to the model itself, not
    // just to the pre-load fallback capsule, so a value here would stretch the
    // art. It existed only while the boss was a bare capsule.
    expect(alchemist.visualWidthScale).toBeUndefined();
    // Its own paint is the point of having the model; a tint would wash it out.
    expect(alchemist.tint).toBe(0xffffff);
  });

  it('names a pose set, since a rigged model left in bind is a T-pose', () => {
    // Its rig is the only one authored from a T-pose, so unlike every other
    // model here it renders visibly wrong — arms straight out to the sides —
    // if nothing drives it. Naming the pose set is what wires the clips up.
    expect(alchemist.poseSet).toBe('alchemist');
  });

  it('throws exactly three vials once past half health', () => {
    if (alchemist.attack.kind !== 'vial') throw new Error('vial boss expected');
    expect(alchemist.attack.phaseTwoHealthFraction).toBe(0.5);
    expect(alchemist.attack.enragedVialCount).toBe(3);
  });

  it('carries roughly a full horde wave of health', () => {
    // Same rule as the elite Behemoth: the wave-10 boss replaces the wave-9
    // horde, so its scaled health should sit in that band rather than being a
    // token or a wall.
    const bossHp = alchemist.baseHealth * healthMultiplierForWave(10);
    const previousHordeHp = waveBalanceReport(9).effectiveTotalHp;
    expect(bossHp).toBeGreaterThan(previousHordeHp * 0.75);
    expect(bossHp).toBeLessThan(previousHordeHp * 1.5);
  });

  it('is the boss wave 10 summons, alternating with the elite Behemoth', () => {
    expect(bossForWave(10)).toEqual({ style: 'classic', definition: alchemist });
    expect(bossForWave(15)).toEqual({
      style: 'elite',
      elite: ELITE_BOSSES.behemoth,
    });
    expect(bossForWave(20)).toEqual({ style: 'classic', definition: alchemist });
  });
});
