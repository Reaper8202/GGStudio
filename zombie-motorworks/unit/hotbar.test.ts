import { describe, expect, it } from 'vitest';
import {
  HOTBAR_CAPACITY,
  resolveHotbar,
  seedHotbar,
  toggleHotbarSlot,
  withHotbarSlot,
} from '../src/core/hotbar.ts';
import { decodeProfile, defaultProfile, encodeProfile } from '../src/core/profile.ts';

const STARTER_STOCK = defaultProfile().inventory ?? {};

describe('build bar seeding', () => {
  it('seeds from owned block types in catalog order, capped at capacity', () => {
    const seeded = seedHotbar(STARTER_STOCK);

    expect(seeded).toHaveLength(HOTBAR_CAPACITY);
    expect(seeded).toEqual([
      'frame-box',
      'wheel-standard',
      'engine-small',
      'fuel-tank',
      'turret',
    ]);
  });

  it('leaves out block types the player owns none of', () => {
    expect(seedHotbar({ turret: 2, 'frame-box': 0 })).toEqual(['turret']);
  });

  it('seeds only when no bar was ever curated', () => {
    expect(resolveHotbar(undefined, STARTER_STOCK)).toEqual(
      seedHotbar(STARTER_STOCK),
    );
    // An emptied bar is a deliberate choice and must not refill itself.
    expect(resolveHotbar([], STARTER_STOCK)).toEqual([]);
  });
});

describe('build bar normalization', () => {
  it('drops unknown ids and duplicates and truncates to capacity', () => {
    expect(
      resolveHotbar(
        [
          'turret',
          'turret',
          'not-a-part',
          'frame-box',
          'wheel-standard',
          'engine-small',
          'fuel-tank',
          'spike-ram',
        ],
        STARTER_STOCK,
      ),
    ).toEqual([
      'turret',
      'frame-box',
      'wheel-standard',
      'engine-small',
      'fuel-tank',
    ]);
  });

  it('keeps a slotted block type the player has run out of', () => {
    expect(resolveHotbar(['turret'], {})).toEqual(['turret']);
  });
});

describe('build bar editing', () => {
  it('appends a purchase to the first free slot and ignores repeats', () => {
    expect(withHotbarSlot(['turret'], 'frame-box')).toEqual([
      'turret',
      'frame-box',
    ]);
    expect(withHotbarSlot(['turret'], 'turret')).toEqual(['turret']);
    expect(withHotbarSlot([], 'not-a-part')).toEqual([]);
  });

  it('leaves a full bar untouched rather than evicting a chosen block', () => {
    const full = ['frame-box', 'wheel-standard', 'engine-small', 'fuel-tank', 'turret'];

    expect(withHotbarSlot(full, 'spike-ram')).toEqual(full);
  });

  it('toggles a block type on and off the bar', () => {
    expect(toggleHotbarSlot(['turret'], 'frame-box')).toEqual([
      'turret',
      'frame-box',
    ]);
    expect(toggleHotbarSlot(['turret', 'frame-box'], 'turret')).toEqual([
      'frame-box',
    ]);
  });

  it('drops the most recent pick when the bar is already full', () => {
    const full = ['frame-box', 'wheel-standard', 'engine-small', 'fuel-tank', 'turret'];

    expect(toggleHotbarSlot(full, 'spike-ram')).toEqual([
      'frame-box',
      'wheel-standard',
      'engine-small',
      'fuel-tank',
      'spike-ram',
    ]);
    // Removing from a full bar still works.
    expect(toggleHotbarSlot(full, 'turret')).toHaveLength(HOTBAR_CAPACITY - 1);
  });
});

describe('build bar persistence', () => {
  it('round-trips a curated bar through the profile codec', () => {
    const profile = {
      ...defaultProfile(),
      hotbarDefIds: ['turret', 'spike-ram'],
    };

    expect(decodeProfile(encodeProfile(profile)).hotbarDefIds).toEqual([
      'turret',
      'spike-ram',
    ]);
  });

  it('keeps an emptied bar empty instead of reseeding it', () => {
    const profile = { ...defaultProfile(), hotbarDefIds: [] };

    expect(decodeProfile(encodeProfile(profile)).hotbarDefIds).toEqual([]);
  });

  it('leaves the bar unset for profiles saved before it existed', () => {
    expect(defaultProfile().hotbarDefIds).toBeUndefined();
    expect(
      decodeProfile(
        JSON.stringify({ schemaVersion: 1, money: 40, unlockedDefIds: [] }),
      ).hotbarDefIds,
    ).toBeUndefined();
  });

  it('discards saved ids that are no longer in the catalog', () => {
    expect(
      decodeProfile(
        JSON.stringify({
          schemaVersion: 1,
          money: 40,
          unlockedDefIds: [],
          hotbarDefIds: ['turret', 'retired-part', 7],
        }),
      ).hotbarDefIds,
    ).toEqual(['turret']);
  });
});
