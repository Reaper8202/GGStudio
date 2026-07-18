import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { analyzeVehicle } from '../src/core/analysis.ts';
import { getPartDef } from '../src/core/parts.ts';
import { validateBlueprint } from '../src/core/placement.ts';
import { deserializeBlueprint } from '../src/core/serialize.ts';

const fixtures = [
  ['balanced', []],
  ['tall-unstable', ['NARROW_TRACK']],
  ['bad-wheels', ['NO_DRIVEN_WHEELS']],
  ['heavy-armour', []],
  ['multi-gun', []],
  ['minimal', []],
] as const;

function fixtureJson(name: string): string {
  return readFileSync(
    new URL(`../tests/fixtures/${name}.json`, import.meta.url),
    'utf8',
  );
}

describe('blueprint fixtures', () => {
  it.each(fixtures)(
    '%s deserializes, validates, and analyzes',
    (name, expectedWarnings) => {
      const blueprint = deserializeBlueprint(fixtureJson(name));
      const validation = validateBlueprint(blueprint, getPartDef);
      const analysis = analyzeVehicle(blueprint, getPartDef);

      expect(validation.errors).toEqual([]);
      expect(validation.warnings).toEqual([]);
      expect(validation.infos).toEqual([]);
      expect(analysis.totalMassKg).toBeGreaterThan(0);
      expect(analysis.warnings.map((warning) => warning.code)).toEqual(
        expect.arrayContaining([...expectedWarnings]),
      );
    },
  );
});
