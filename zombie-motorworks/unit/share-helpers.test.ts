import { describe, expect, it } from 'vitest';
import {
  buildShareLink,
  extractShareCode,
  sharedSlotName,
} from '../src/editor/shareHelpers.ts';

describe('share UI helpers', () => {
  it('builds a URL-safe share link', () => {
    expect(buildShareLink('abc-_', 'https://game.test', '/garage')).toBe(
      'https://game.test/garage?build=abc-_',
    );
  });

  it('extracts codes from links and leaves raw codes alone', () => {
    expect(extractShareCode(' ZMB1-code ')).toBe('ZMB1-code');
    expect(extractShareCode('https://game.test/?build=abc-_')).toBe('abc-_');
  });

  it('allocates a non-overwriting shared slot name', () => {
    expect(sharedSlotName('Scout', [])).toBe('Scout (shared)');
    expect(
      sharedSlotName('Scout', ['Scout (shared)', 'Scout (shared 2)']),
    ).toBe('Scout (shared 3)');
  });
});
