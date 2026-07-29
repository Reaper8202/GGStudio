import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  TRACER_STYLE_TUNING,
  TracerRenderer,
  tracerStyleForWeapon,
  type TracerStyle,
} from '../src/survival/Tracers.ts';

/**
 * The tracer ribbon is built entirely from BufferGeometry maths, so it can be
 * checked without a GL context. This matters: a shader/geometry regression here
 * is invisible to typecheck and lint, and a screenshot only catches it by luck
 * because a tracer lives about a tenth of a second.
 */
function renderer(): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  tracers: TracerRenderer;
  positions: () => Float32Array;
  colors: () => Float32Array;
  alphas: () => Float32Array;
} {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 12, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const tracers = new TracerRenderer(scene, { capacity: 4 });
  const mesh = scene.children.find(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh,
  );
  if (mesh === undefined) throw new Error('TracerRenderer added no mesh');
  const geometry = mesh.geometry;
  return {
    scene,
    camera,
    tracers,
    positions: () => geometry.getAttribute('position').array as Float32Array,
    colors: () => geometry.getAttribute('tracerColor').array as Float32Array,
    alphas: () => geometry.getAttribute('tracerAlpha').array as Float32Array,
  };
}

const spread = (values: Float32Array): number =>
  Math.max(...values) - Math.min(...values);

const xSpread = (positions: Float32Array): number =>
  spread(positions.filter((_, index) => index % 3 === 0));

describe('TracerRenderer', () => {
  it('adds exactly one pooled mesh to the scene', () => {
    const scene = new THREE.Scene();
    const tracers = new TracerRenderer(scene, { capacity: 8 });
    expect(scene.children.filter((c) => c instanceof THREE.Mesh)).toHaveLength(
      1,
    );
    tracers.dispose();
  });

  it('starts with every quad collapsed and invisible', () => {
    const { positions, alphas, tracers } = renderer();
    expect(spread(positions())).toBe(0);
    expect(Math.max(...alphas())).toBe(0);
    tracers.dispose();
  });

  it('builds a ribbon with real width once a tracer is spawned', () => {
    const { tracers, camera, positions, alphas } = renderer();
    tracers.spawn({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -10 }, 'turret');
    tracers.update(0.016, camera);

    // A visible streak: the geometry must span the shot and carry alpha.
    expect(spread(positions())).toBeGreaterThan(0);
    expect(Math.max(...alphas())).toBeGreaterThan(0);

    // The whole point of the rebuild — a camera-facing ribbon has thickness
    // across the shot axis, which a 1px THREE.Line never had.
    expect(xSpread(positions())).toBeGreaterThan(0.01);
    tracers.dispose();
  });

  it('fades the tracer out and collapses it once its life ends', () => {
    const { tracers, camera, positions, alphas } = renderer();
    tracers.spawn({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -10 }, 'turret');
    tracers.update(0.016, camera);
    const early = Math.max(...alphas());

    tracers.update(0.05, camera);
    const later = Math.max(...alphas());
    expect(later).toBeLessThan(early);

    // Well past any style's lifetime.
    tracers.update(1, camera);
    expect(Math.max(...alphas())).toBe(0);
    expect(spread(positions())).toBe(0);
    tracers.dispose();
  });

  it('keeps drawing when more tracers are spawned than the pool holds', () => {
    const { tracers, camera, alphas } = renderer();
    for (let i = 0; i < 12; i++) {
      tracers.spawn(
        { x: i, y: 1, z: 0 },
        { x: i, y: 1, z: -8 },
        'cannon-heavy',
      );
    }
    tracers.update(0.016, camera);
    expect(Math.max(...alphas())).toBeGreaterThan(0);
    tracers.dispose();
  });

  it('reset clears live tracers immediately', () => {
    const { tracers, camera, positions, alphas } = renderer();
    tracers.spawn({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -10 }, 'sniper-light');
    tracers.update(0.016, camera);
    tracers.reset();
    expect(Math.max(...alphas())).toBe(0);
    expect(spread(positions())).toBe(0);
    tracers.dispose();
  });

  it('removes its mesh on dispose', () => {
    const scene = new THREE.Scene();
    const tracers = new TracerRenderer(scene, { capacity: 4 });
    tracers.dispose();
    expect(scene.children.filter((c) => c instanceof THREE.Mesh)).toHaveLength(
      0,
    );
  });

  it('ignores spawns after dispose rather than throwing', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const tracers = new TracerRenderer(scene, { capacity: 4 });
    tracers.dispose();
    expect(() =>
      tracers.spawn({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 'turret'),
    ).not.toThrow();
    expect(() => tracers.update(0.016, camera)).not.toThrow();
  });

  it('maps every weapon id to a distinct tuning and safely falls back', () => {
    const weaponIds = [
      'turret',
      'cannon-heavy',
      'ice-cannon',
      'sniper-light',
      'flamethrower',
    ] as const;
    const styles = weaponIds.map(tracerStyleForWeapon);
    expect(styles).toEqual(weaponIds);

    const fingerprints = styles.map((style) => {
      const tuning = TRACER_STYLE_TUNING[style];
      return `${tuning.width}:${tuning.lifeSeconds}:${tuning.travelSeconds}`;
    });
    expect(new Set(fingerprints).size).toBe(weaponIds.length);
    expect(() => tracerStyleForWeapon('future-laser')).not.toThrow();
    expect(tracerStyleForWeapon('future-laser')).toBe('turret');
  });

  it('makes different weapons visibly different ribbon geometry', () => {
    const ribbonWidth = (style: TracerStyle): number => {
      const { tracers, camera, positions } = renderer();
      tracers.spawn({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -10 }, style);
      tracers.update(0.016, camera);
      const width = xSpread(positions());
      tracers.dispose();
      return width;
    };

    expect(ribbonWidth('cannon-heavy')).toBeGreaterThan(ribbonWidth('turret'));
    expect(TRACER_STYLE_TUNING['sniper-light'].lifeSeconds).toBeGreaterThan(
      TRACER_STYLE_TUNING['cannon-heavy'].lifeSeconds,
    );
  });

  it('makes a faded miss dimmer and shorter-lived than the same weapon hit', () => {
    const hit = renderer();
    const miss = renderer();
    const from = { x: 0, y: 1, z: 0 };
    const to = { x: 0, y: 1, z: -10 };
    hit.tracers.spawn(from, to, 'turret');
    miss.tracers.spawn(from, to, 'turret', { faded: true });
    hit.tracers.update(0.016, hit.camera);
    miss.tracers.update(0.016, miss.camera);
    expect(Math.max(...miss.alphas())).toBeLessThan(Math.max(...hit.alphas()));

    hit.tracers.update(0.08, hit.camera);
    miss.tracers.update(0.08, miss.camera);
    expect(Math.max(...miss.alphas())).toBe(0);
    expect(Math.max(...hit.alphas())).toBeGreaterThan(0);
    hit.tracers.dispose();
    miss.tracers.dispose();
  });

  it('layers EMP and pierce treatment over each weapon rather than replacing it', () => {
    const turret = renderer();
    const empTurret = renderer();
    const sniper = renderer();
    const piercedSniper = renderer();
    const from = { x: 0, y: 1, z: 0 };
    const to = { x: 0, y: 1, z: -10 };
    turret.tracers.spawn(from, to, 'turret');
    empTurret.tracers.spawn(from, to, 'turret', { emp: true });
    sniper.tracers.spawn(from, to, 'sniper-light');
    piercedSniper.tracers.spawn(from, to, 'sniper-light', { piercing: true });
    turret.tracers.update(0.016, turret.camera);
    empTurret.tracers.update(0.016, empTurret.camera);
    sniper.tracers.update(0.016, sniper.camera);
    piercedSniper.tracers.update(0.016, piercedSniper.camera);

    expect(Array.from(empTurret.colors())).not.toEqual(
      Array.from(turret.colors()),
    );
    expect(xSpread(piercedSniper.positions())).toBeGreaterThan(
      xSpread(sniper.positions()),
    );
    expect(Array.from(piercedSniper.colors())).not.toEqual(
      Array.from(empTurret.colors()),
    );
    turret.tracers.dispose();
    empTurret.tracers.dispose();
    sniper.tracers.dispose();
    piercedSniper.tracers.dispose();
  });
});
