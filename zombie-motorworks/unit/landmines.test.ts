import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mineSweeperRadius } from '../src/core/turretModules.ts';
import { Landmines } from '../src/survival/zombies/Landmines.ts';
import {
  LANDMINE_ARM_SECONDS,
  LANDMINE_GLINT_RADIUS,
} from '../src/survival/zombies/zombieConfig.ts';

const HIDDEN_REVEAL = { vehicleX: 0, vehicleZ: 0, wave: 8, radiusM: 0 };

describe('Landmines', () => {
  it('arms for exactly the configured window and cannot detonate during it', () => {
    const mines = new Landmines(new THREE.Scene());
    let detonations = 0;

    mines.plant(0, 0);
    mines.update(
      LANDMINE_ARM_SECONDS - 0.01,
      () => {
        detonations++;
        return true;
      },
      HIDDEN_REVEAL,
    );

    expect(mines.activeMines()).toHaveLength(1);
    expect(mines.activeMines()[0]?.state).toBe('arming');
    expect(detonations).toBe(0);

    mines.update(0.01, () => false, HIDDEN_REVEAL);
    expect(mines.activeMines()[0]?.state).toBe('armed');

    mines.dispose();
  });

  it('detonates on contact after arming', () => {
    const mines = new Landmines(new THREE.Scene());

    mines.plant(0, 0);
    mines.update(LANDMINE_ARM_SECONDS, () => false, HIDDEN_REVEAL);
    mines.update(1 / 60, () => true, HIDDEN_REVEAL);

    expect(mines.activeMines()).toHaveLength(0);
    mines.dispose();
  });

  it('reveals every armed mine on wave 7 and below', () => {
    const mines = new Landmines(new THREE.Scene());

    mines.plant(50, 0);
    mines.update(LANDMINE_ARM_SECONDS, () => false, {
      vehicleX: 0,
      vehicleZ: 0,
      wave: 7,
      radiusM: 0,
    });

    expect(mines.activeMines()[0]).toMatchObject({
      state: 'armed',
      revealed: true,
    });
    mines.dispose();
  });

  it('keeps wave 8 mines hidden without reveal radius but still detonates', () => {
    const mines = new Landmines(new THREE.Scene());

    mines.plant(12, 0);
    mines.update(LANDMINE_ARM_SECONDS, () => false, {
      vehicleX: 0,
      vehicleZ: 0,
      wave: 8,
      radiusM: 0,
    });
    expect(mines.activeMines()[0]?.revealed).toBe(false);

    mines.update(1 / 60, () => true, {
      vehicleX: 0,
      vehicleZ: 0,
      wave: 8,
      radiusM: 0,
    });

    expect(mines.activeMines()).toHaveLength(0);
    mines.dispose();
  });

  it.each([1, 2, 3])(
    'reveals mines at the level %i radius boundary only',
    (level) => {
      const radius = mineSweeperRadius(level);
      const mines = new Landmines(new THREE.Scene());

      mines.plant(radius, 0);
      mines.plant(radius + 0.01, 0);
      mines.update(LANDMINE_ARM_SECONDS, () => false, {
        vehicleX: 0,
        vehicleZ: 0,
        wave: 8,
        radiusM: radius,
      });

      const snapshots = mines.activeMines();
      expect(snapshots[0]?.revealed).toBe(true);
      expect(snapshots[1]?.revealed).toBe(false);
      mines.dispose();
    },
  );

  it('draws glint-range mines without reporting them as revealed', () => {
    const scene = new THREE.Scene();
    const mines = new Landmines(scene);

    mines.plant(LANDMINE_GLINT_RADIUS, 0);
    mines.update(LANDMINE_ARM_SECONDS, () => false, HIDDEN_REVEAL);

    expect(mines.activeMines()[0]?.revealed).toBe(false);
    expect(scene.children[0]?.visible).toBe(true);
    mines.dispose();
  });

  it('un-reveals mines when the reveal radius drops to zero mid-run', () => {
    const mines = new Landmines(new THREE.Scene());

    mines.plant(10, 0);
    mines.update(LANDMINE_ARM_SECONDS, () => false, {
      vehicleX: 0,
      vehicleZ: 0,
      wave: 8,
      radiusM: mineSweeperRadius(1),
    });
    expect(mines.activeMines()[0]?.revealed).toBe(true);

    mines.update(1 / 60, () => false, HIDDEN_REVEAL);
    expect(mines.activeMines()[0]?.revealed).toBe(false);
    mines.dispose();
  });
});
