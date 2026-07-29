/**
 * Guns hunt on their own and the player's aim outranks that: while
 * `manualOverride` is set every weapon drops the target auto-aim found for it
 * and converges on the shared aim point.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPartDef } from '../src/core/parts.ts';
import type { PlacedPart, VehicleBlueprint } from '../src/core/types.ts';
import type { AssembledVehicle } from '../src/runtime/assembler.ts';
import { assembleVehicle } from '../src/runtime/assembler.ts';
import type { RuntimeWeapon, WeaponAimInput } from '../src/runtime/weapons.ts';
import { createWeapon, stepWeapons } from '../src/runtime/weapons.ts';

const BODY_ORIGIN = { x: 0, y: 1, z: 0 };

function part(id: string, x: number): PlacedPart {
  return { id, defId: 'turret', pos: { x, y: 0, z: 0 }, orient: 0, config: {} };
}

/** Two blasters mounted a metre either side of centre, both facing +Z. */
function twoBlasterRig(world: RAPIER.World): {
  assembled: AssembledVehicle;
  weapons: RuntimeWeapon[];
  attached: Set<string>;
} {
  const parts = [part('left', -2), part('right', 2)];
  const blueprint: VehicleBlueprint = {
    schemaVersion: 4,
    id: 'aim-override',
    name: 'Aim override',
    parts,
  };
  const assembled = assembleVehicle(world, blueprint, getPartDef, [], {
    translation: BODY_ORIGIN,
  });
  const weapons = parts.map((placed) => createWeapon(placed));
  return {
    assembled,
    weapons,
    attached: new Set(weapons.map((w) => w.partId)),
  };
}

/** World yaw of a fired ray, in the same frame as the aim inputs. */
function shotYaw(shot: {
  from: { x: number; z: number };
  to: { x: number; z: number };
}): number {
  return Math.atan2(shot.to.x - shot.from.x, shot.to.z - shot.from.z);
}

/** World yaw from a weapon's mount onto a point, mount offset included. */
function yawFromMount(
  weapon: RuntimeWeapon,
  target: { x: number; z: number },
): number {
  return Math.atan2(
    target.x - (BODY_ORIGIN.x + weapon.mountLocal.x),
    target.z - (BODY_ORIGIN.z + weapon.mountLocal.z),
  );
}

function aimEntry(aimYawWorld: number): WeaponAimInput {
  return { aimYawWorld, fire: true };
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('player aim override', () => {
  it('pulls every weapon off its own target and onto the cursor point', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const { assembled, weapons, attached } = twoBlasterRig(world);
    const [left, right] = weapons;

    // Auto-aim has each blaster tracking a different zombie, one dead astern.
    const weaponAim = new Map<string, WeaponAimInput>([
      [left.partId, aimEntry(Math.PI)],
      [right.partId, aimEntry(Math.PI / 2)],
    ]);
    // The player clicks a point off the port bow, well inside the 8 m range.
    const cursor = { x: -3, y: BODY_ORIGIN.y, z: 4 };

    // One generous step: the manual slew rate covers a half turn in it, so the
    // shots below are taken from the settled yaw rather than mid-sweep.
    const fired = stepWeapons(
      world,
      assembled,
      weapons,
      attached,
      {
        aimYawWorld: Math.atan2(cursor.x, cursor.z),
        aimPoint: cursor,
        fire: true,
        weaponAim,
        manualOverride: true,
      },
      0.5,
    );

    expect(fired.shots).toHaveLength(2);
    const [leftShot, rightShot] = fired.shots;
    // Each mount solves the cursor for itself, so the two rays cross on the
    // point instead of running parallel to it.
    expect(shotYaw(leftShot)).toBeCloseTo(yawFromMount(left, cursor), 2);
    expect(shotYaw(rightShot)).toBeCloseTo(yawFromMount(right, cursor), 2);
    expect(shotYaw(leftShot)).not.toBeCloseTo(shotYaw(rightShot), 2);

    world.removeRigidBody(assembled.body);
    world.free();
  });

  it('leaves each weapon on its acquired target while the override is off', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const { assembled, weapons, attached } = twoBlasterRig(world);
    const [left, right] = weapons;
    const weaponAim = new Map<string, WeaponAimInput>([
      [left.partId, aimEntry(Math.PI / 2)],
      [right.partId, aimEntry(-Math.PI / 2)],
    ]);
    const cursor = { x: 0, y: BODY_ORIGIN.y, z: 5 };

    // The cursor still sits dead ahead and the trigger is up: guns work their
    // own targets, which here are the opposite beams.
    let shots = stepWeapons(
      world,
      assembled,
      weapons,
      attached,
      { aimYawWorld: 0, aimPoint: cursor, fire: false, weaponAim },
      0.5,
    ).shots;
    // Auto turrets slew slowly; give them the time to come round.
    for (let i = 0; i < 4 && shots.length < 2; i++) {
      left.cooldown = 0;
      right.cooldown = 0;
      shots = stepWeapons(
        world,
        assembled,
        weapons,
        attached,
        { aimYawWorld: 0, aimPoint: cursor, fire: false, weaponAim },
        0.5,
      ).shots;
    }

    expect(shots).toHaveLength(2);
    // Acquisition alone pulls the trigger — no player input was given here.
    expect(shotYaw(shots[0])).toBeCloseTo(Math.PI / 2, 2);
    expect(shotYaw(shots[1])).toBeCloseTo(-Math.PI / 2, 2);

    world.removeRigidBody(assembled.body);
    world.free();
  });
});
