import { describe, expect, it } from 'vitest';
import { PART_CATALOG } from '../src/core/parts.ts';
import type { RuntimeVehicle } from '../src/runtime/vehicle.ts';
import type { RuntimeWeapon } from '../src/runtime/weapons.ts';
import { AutoAim } from '../src/survival/AutoAim.ts';
import type { ZombieSystem } from '../src/survival/zombies/ZombieSystem.ts';

// The Ice Cannon stands in for a generic 360-degree auto turret throughout:
// the Zombie Blaster and Heavy Cannon are player-aimed and never appear here.
describe('AutoAim', () => {
  it('targets the nearest body translation and reuses override storage', () => {
    const autoPart = { alive: true, detached: false, health: 100 };
    const manualPart = { alive: true, detached: false, health: 100 };
    const autoWeapon: RuntimeWeapon = {
      partId: 'auto',
      weaponDefId: 'turret',
      def: { ...PART_CATALOG['ice-cannon'].weapon!, rangeM: 5 },
      mountLocal: { x: 1, y: 0, z: 0 },
      forwardLocal: { x: 0, y: 0, z: 1 },
      yaw: 0,
      cooldown: 0,
      cycleTime: 0,
      shotsFired: 0,
      label: 'Test Weapon',
      empLevel: 0,
      piercingLevel: 0,
    };
    const manualWeapon: RuntimeWeapon = {
      partId: 'manual',
      weaponDefId: 'turret',
      // A genuinely manual-aim weapon (flamethrower) is excluded from the map.
      def: PART_CATALOG.flamethrower.weapon!,
      mountLocal: { x: 0, y: 0, z: 0 },
      forwardLocal: { x: 0, y: 0, z: 1 },
      yaw: 0,
      cooldown: 0,
      cycleTime: 0,
      shotsFired: 0,
      label: 'Test Weapon',
      empLevel: 0,
      piercingLevel: 0,
    };
    const vehicle = {
      body: {
        translation: () => ({ x: 10, y: 0, z: 20 }),
        rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      },
      assembled: {
        parts: new Map([
          ['auto', autoPart],
          ['manual', manualPart],
        ]),
      },
      weaponStates: () => [autoWeapon, manualWeapon],
    } as unknown as RuntimeVehicle;

    const bodyPosition = { x: 13, y: 1, z: 24 };
    const target = {
      // A deliberately stale visual position catches accidental render-space aim.
      position: { x: -100, y: 0, z: -100 },
      body: { translation: () => bodyPosition },
      collider: { handle: 1 },
    };
    const zombies = {
      getAliveTargets: () => [target],
    } as unknown as ZombieSystem;

    const autoAim = new AutoAim(vehicle, zombies, {
      castRay: () => ({ collider: { handle: 1 } }),
    } as never);
    const firstMap = autoAim.step();
    const firstEntry = firstMap.get('auto');
    expect(firstEntry).toBeDefined();
    expect(firstEntry?.fire).toBe(true);
    expect(firstEntry?.aimYawWorld).toBeCloseTo(Math.atan2(2, 4));
    expect(firstEntry?.aimPoint).toEqual(bodyPosition);
    expect(firstMap.has('manual')).toBe(false);

    bodyPosition.x = 100;
    const secondMap = autoAim.step();
    expect(secondMap).toBe(firstMap);
    expect(secondMap.get('auto')).toBe(firstEntry);
    expect(secondMap.get('auto')?.fire).toBe(false);
    expect(secondMap.get('auto')?.aimYawWorld).toBe(firstEntry?.aimYawWorld);

    autoPart.detached = true;
    expect(autoAim.step().has('auto')).toBe(false);
  });

  it('skips an occluded nearest target for the next visible candidate', () => {
    const autoWeapon: RuntimeWeapon = {
      partId: 'auto',
      weaponDefId: 'turret',
      def: PART_CATALOG['ice-cannon'].weapon!,
      mountLocal: { x: 0, y: 0, z: 0 },
      forwardLocal: { x: 0, y: 0, z: 1 },
      yaw: 0,
      cooldown: 0,
      cycleTime: 0,
      shotsFired: 0,
      label: 'Test Weapon',
      empLevel: 0,
      piercingLevel: 0,
    };
    const vehicle = {
      body: {
        translation: () => ({ x: 0, y: 0, z: 0 }),
        rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      },
      assembled: { parts: new Map([['auto', { alive: true, detached: false, health: 100 }]]) },
      weaponStates: () => [autoWeapon],
    } as unknown as RuntimeVehicle;
    const occluded = {
      body: { translation: () => ({ x: 0, y: 0.9, z: 3 }) },
      collider: { handle: 1 },
    };
    const visible = {
      body: { translation: () => ({ x: 2, y: 0.9, z: 4 }) },
      collider: { handle: 2 },
    };
    const zombies = { getAliveTargets: () => [occluded, visible] } as unknown as ZombieSystem;
    const autoAim = new AutoAim(vehicle, zombies, {
      castRay: () => ({ collider: { handle: 2 } }),
    } as never);

    const entry = autoAim.step().get('auto');
    expect(entry?.fire).toBe(true);
    expect(entry?.aimPoint).toEqual({ x: 2, y: 0.9, z: 4 });
  });

  it('holds fire when all bounded candidates are occluded', () => {
    const weapon: RuntimeWeapon = {
      partId: 'auto', weaponDefId: 'ice-cannon', def: PART_CATALOG['ice-cannon'].weapon!, mountLocal: { x: 0, y: 0, z: 0 },
      forwardLocal: { x: 0, y: 0, z: 1 }, yaw: 0, cooldown: 0, cycleTime: 0, shotsFired: 0, label: 'Test Weapon', empLevel: 0, piercingLevel: 0,
    };
    const vehicle = {
      body: { translation: () => ({ x: 0, y: 0, z: 0 }), rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }) },
      assembled: { parts: new Map([['auto', { alive: true, detached: false, health: 100 }]]) }, weaponStates: () => [weapon],
    } as unknown as RuntimeVehicle;
    const zombie = { body: { translation: () => ({ x: 0, y: 0.9, z: 3 }) }, collider: { handle: 1 } };
    const autoAim = new AutoAim(vehicle, { getAliveTargets: () => [zombie] } as unknown as ZombieSystem, {
      castRay: () => ({ collider: { handle: 99 } }),
    } as never);

    expect(autoAim.step().get('auto')?.fire).toBe(false);
  });

  it('prefers an in-range thrower over a nearer walker for ranged-priority weapons', () => {
    const weapon: RuntimeWeapon = {
      partId: 'sniper', weaponDefId: 'sniper-light', def: PART_CATALOG['sniper-light'].weapon!, mountLocal: { x: 0, y: 0, z: 0 },
      forwardLocal: { x: 0, y: 0, z: 1 }, yaw: 0, cooldown: 0, cycleTime: 0, shotsFired: 0, label: 'Test Weapon', empLevel: 0, piercingLevel: 0,
    };
    const vehicle = {
      body: { translation: () => ({ x: 0, y: 0, z: 0 }), rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }) },
      assembled: { parts: new Map([['sniper', { alive: true, detached: false, health: 100 }]]) }, weaponStates: () => [weapon],
    } as unknown as RuntimeVehicle;
    const walker = {
      kind: 'walker', body: { translation: () => ({ x: 0, y: 0.9, z: 12 }) }, collider: { handle: 1 },
    };
    const thrower = {
      kind: 'thrower', body: { translation: () => ({ x: 0, y: 0.9, z: 20 }) }, collider: { handle: 2 },
    };
    const autoAim = new AutoAim(vehicle, { getAliveTargets: () => [walker, thrower] } as unknown as ZombieSystem, {
      // Line of sight resolves to whichever zombie the ray was aimed at.
      castRay: (_ray: unknown, maxToi: number) => ({
        collider: { handle: maxToi > 15 ? 2 : 1 },
      }),
    } as never);

    const entry = autoAim.step().get('sniper');
    expect(entry?.fire).toBe(true);
    expect(entry?.aimPoint).toEqual({ x: 0, y: 0.9, z: 20 });
  });

  // No shipped part uses 'strongest' today — the Heavy Cannon is player-aimed —
  // but the ranking is part of AutoAim's contract, so it is covered directly.
  it('locks a strongest-priority weapon onto the toughest zombie, not the nearest', () => {
    const cannon: RuntimeWeapon = {
      partId: 'cannon',
      weaponDefId: 'turret',
      def: {
        ...PART_CATALOG['ice-cannon'].weapon!,
        rangeM: 30,
        targetPriority: 'strongest',
      },
      mountLocal: { x: 0, y: 0, z: 0 },
      forwardLocal: { x: 0, y: 0, z: 1 }, yaw: 0, cooldown: 0, cycleTime: 0, shotsFired: 0, label: 'Test Weapon', empLevel: 0, piercingLevel: 0,
    };
    const vehicle = {
      body: { translation: () => ({ x: 0, y: 0, z: 0 }), rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }) },
      assembled: { parts: new Map([['cannon', { alive: true, detached: false, health: 100 }]]) }, weaponStates: () => [cannon],
    } as unknown as RuntimeVehicle;
    // Nearer but weak vs. farther but tougher: 'strongest' must pick the tough one.
    const weak = {
      kind: 'walker', currentHealth: 40, body: { translation: () => ({ x: 0, y: 0.9, z: 5 }) }, collider: { handle: 1 },
    };
    const tough = {
      kind: 'thrower', currentHealth: 120, body: { translation: () => ({ x: 0, y: 0.9, z: 15 }) }, collider: { handle: 2 },
    };
    const autoAim = new AutoAim(vehicle, { getAliveTargets: () => [weak, tough] } as unknown as ZombieSystem, {
      castRay: () => ({ collider: { handle: 2 } }),
    } as never);

    const entry = autoAim.step().get('cannon');
    expect(entry).toBeDefined();
    expect(entry?.aimPoint).toEqual({ x: 0, y: 0.9, z: 15 });
    expect(entry?.fire).toBe(true);
  });

  it('holds fire when the only target sits inside the minimum range', () => {
    const weapon: RuntimeWeapon = {
      partId: 'sniper', weaponDefId: 'sniper-light', def: PART_CATALOG['sniper-light'].weapon!, mountLocal: { x: 0, y: 0, z: 0 },
      forwardLocal: { x: 0, y: 0, z: 1 }, yaw: 0, cooldown: 0, cycleTime: 0, shotsFired: 0, label: 'Test Weapon', empLevel: 0, piercingLevel: 0,
    };
    const vehicle = {
      body: { translation: () => ({ x: 0, y: 0, z: 0 }), rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }) },
      assembled: { parts: new Map([['sniper', { alive: true, detached: false, health: 100 }]]) }, weaponStates: () => [weapon],
    } as unknown as RuntimeVehicle;
    const close = {
      kind: 'walker', body: { translation: () => ({ x: 0, y: 0.9, z: 4 }) }, collider: { handle: 1 },
    };
    const autoAim = new AutoAim(vehicle, { getAliveTargets: () => [close] } as unknown as ZombieSystem, {
      castRay: () => ({ collider: { handle: 1 } }),
    } as never);

    expect(autoAim.step().get('sniper')?.fire).toBe(false);
  });

  it('pushes a closer Phone Addict behind a walker for an EMP-0 turret', () => {
    const phoneAddict = autoAimTarget('phone-addict', 1, 0, 2);
    const walker = autoAimTarget('walker', 2, 2, 4);
    const autoAim = aimAtTargets(autoTurret(0), [phoneAddict, walker]);

    const entry = autoAim.step().get('auto');

    expect(entry?.fire).toBe(true);
    expect(entry?.aimPoint).toEqual({ x: 2, y: 0.9, z: 4 });
  });

  it('still fires at a Phone Addict when it is the only in-range target', () => {
    const phoneAddict = autoAimTarget('phone-addict', 1, 0, 2);
    const autoAim = aimAtTargets(autoTurret(0), [phoneAddict]);

    const entry = autoAim.step().get('auto');

    expect(entry?.fire).toBe(true);
    expect(entry?.aimPoint).toEqual({ x: 0, y: 0.9, z: 2 });
  });

  it('uses nearest-first ordering once the turret has EMP', () => {
    const phoneAddict = autoAimTarget('phone-addict', 1, 0, 2);
    const walker = autoAimTarget('walker', 2, 2, 4);
    const autoAim = aimAtTargets(autoTurret(1), [walker, phoneAddict]);

    const entry = autoAim.step().get('auto');

    expect(entry?.fire).toBe(true);
    expect(entry?.aimPoint).toEqual({ x: 0, y: 0.9, z: 2 });
  });
});

function autoTurret(empLevel: number): RuntimeWeapon {
  return {
    partId: 'auto',
    weaponDefId: 'turret',
    def: PART_CATALOG['ice-cannon'].weapon!,
    mountLocal: { x: 0, y: 0, z: 0 },
    forwardLocal: { x: 0, y: 0, z: 1 },
    yaw: 0,
    cooldown: 0,
    cycleTime: 0,
    shotsFired: 0,
    label: 'Test Weapon',
    empLevel,
    piercingLevel: 0,
  };
}

type AutoAimTarget = ReturnType<ZombieSystem['getAliveTargets']>[number];

function autoAimTarget(
  kind: AutoAimTarget['kind'],
  handle: number,
  x: number,
  z: number,
): AutoAimTarget {
  return {
    kind,
    body: { translation: () => ({ x, y: 0.9, z }) },
    collider: { handle },
  } as AutoAimTarget;
}

function aimAtTargets(
  weapon: RuntimeWeapon,
  targets: AutoAimTarget[],
): AutoAim {
  const vehicle = {
    body: {
      translation: () => ({ x: 0, y: 0, z: 0 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    },
    assembled: {
      parts: new Map([
        ['auto', { alive: true, detached: false, health: 100 }],
      ]),
    },
    weaponStates: () => [weapon],
  } as unknown as RuntimeVehicle;
  const zombies = { getAliveTargets: () => targets } as unknown as ZombieSystem;
  return new AutoAim(vehicle, zombies, {
    castRay: (ray: { dir: { x: number } }) => ({
      collider: { handle: ray.dir.x > 0.1 ? 2 : 1 },
    }),
  } as never);
}
