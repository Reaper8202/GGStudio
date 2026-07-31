import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { modelFileFor } from '../src/survival/zombies/Zombie.ts';
import {
  BOSS_DEFINITIONS,
  DEFAULT_BOSS_ASSET,
  type BossDefinition,
} from '../src/survival/zombies/bossConfig.ts';

const bosses = Object.values(BOSS_DEFINITIONS);

describe('boss model selection', () => {
  it('preloads the shared placeholder before a definition exists', () => {
    // A boss pool slot is constructed before the wave picks which boss fills
    // it, so with no definition yet there is nothing to show but the default.
    expect(modelFileFor('boss', 0, null)).toBe(DEFAULT_BOSS_ASSET);
  });

  it.each(bosses.map((def): [string, BossDefinition] => [def.id, def]))(
    'swaps %s onto its own asset once its definition is known',
    (_id, def) => {
      // The regression this guards: hard-coding DEFAULT_BOSS_ASSET here leaves
      // the slot showing the placeholder walker for the boss's whole life, and
      // because the placeholder is then fitted to `visualHeightM`, the boss
      // reads as a scaled-up normal zombie rather than as itself. Nothing else
      // in the suite notices.
      expect(modelFileFor('boss', 0, def)).toBe(def.assetName);
    },
  );

  it.each(bosses.filter((def) => def.bodyVisual === 'model').map((def): [string, BossDefinition] => [def.id, def]))(
    '%s brings art of its own rather than reusing the placeholder',
    (_id, def) => {
      // A model-bodied boss that named the placeholder would render correctly
      // but pointlessly — the whole reason the swap exists is that a boss has
      // its own asset.
      expect(def.assetName).not.toBe(DEFAULT_BOSS_ASSET);
      expect(def.assetName.length).toBeGreaterThan(0);
    },
  );

  it.each(bosses.filter((def) => def.bodyVisual === 'model').map((def): [string, BossDefinition] => [def.id, def]))(
    'ships the asset %s names',
    (_id, def) => {
      // A name that does not resolve 404s at spawn, and the boss then keeps
      // whatever the slot was already showing — the placeholder walker — which
      // looks exactly like the swap never happening at all. Cheap to catch here.
      const path = fileURLToPath(
        new URL(`../public/assets/zombies/${def.assetName}`, import.meta.url),
      );
      expect(existsSync(path), `${def.assetName} is missing`).toBe(true);
    },
  );

  it('ignores a boss definition for an ordinary kind', () => {
    // bossDef rides along on the pool slot; only the 'boss' kind may consult
    // it, or an elite boss (a real kind with boosted stats) would lose its own
    // model to whatever classic definition happened to be active.
    const alchemist = BOSS_DEFINITIONS['acid-alchemist'];
    expect(modelFileFor('behemoth', 0, alchemist)).toBe('behemoth.rigged.glb');
    expect(modelFileFor('walker', 0, alchemist)).toBe('Zed_1');
  });
});

describe('ordinary kind model selection', () => {
  it('spreads walkers across the six numbered Zed exports', () => {
    const files = Array.from({ length: 6 }, (_, i) => modelFileFor('walker', i, null));
    expect(new Set(files).size).toBe(6);
    expect(files[0]).toBe('Zed_1');
    // Wraps rather than running off the end of the export list.
    expect(modelFileFor('walker', 6, null)).toBe('Zed_1');
  });

  it.each([
    ['gunslinger', 'gunslinger.rigged.glb'],
    ['necromancer', 'necromancer.rigged.glb'],
    ['kamikaze', 'kamikaze.rigged.glb'],
    ['behemoth', 'behemoth.rigged.glb'],
    ['zamboni', 'zamboni.glb'],
  ] as const)('gives %s its own model', (kind, file) => {
    expect(modelFileFor(kind, 3, null)).toBe(file);
  });
});
