import { describe, expect, it } from 'vitest';
import { isCompleteDistinctIconSet } from '../src/editor/PartIconRenderer.ts';

describe('part icon renderer result validation', () => {
  const partIds = ['frame', 'wheel', 'engine'] as const;

  it('accepts one distinct rendered asset for every part', () => {
    expect(
      isCompleteDistinctIconSet(
        partIds,
        new Map([
          ['frame', 'data:image/png;base64,frame'],
          ['wheel', 'data:image/png;base64,wheel'],
          ['engine', 'data:image/png;base64,engine'],
        ]),
      ),
    ).toBe(true);
  });

  it('rejects missing icons', () => {
    expect(
      isCompleteDistinctIconSet(
        partIds,
        new Map([
          ['frame', 'data:image/png;base64,frame'],
          ['wheel', 'data:image/png;base64,wheel'],
        ]),
      ),
    ).toBe(false);
  });

  it('rejects a repeated placeholder image', () => {
    expect(
      isCompleteDistinctIconSet(
        partIds,
        new Map([
          ['frame', 'data:image/png;base64,default-block'],
          ['wheel', 'data:image/png;base64,default-block'],
          ['engine', 'data:image/png;base64,default-block'],
        ]),
      ),
    ).toBe(false);
  });
});
