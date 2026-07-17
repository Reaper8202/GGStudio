import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { boot } from './seam.ts';

const fixtureNames = [
  'balanced',
  'tall-unstable',
  'bad-wheels',
  'heavy-armour',
  'multi-gun',
  'minimal',
] as const;

for (const fixtureName of fixtureNames) {
  test(`${fixtureName} fixture validates and spawns in survival`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const json = readFileSync(
      new URL(`./fixtures/${fixtureName}.json`, import.meta.url),
      'utf8',
    );

    await boot(page);
    await page.evaluate(
      (fixtureJson) => window.__scrapRig.loadBlueprintJson(fixtureJson),
      json,
    );
    expect(
      await page.evaluate(() => window.__scrapRig.validate().errors),
    ).toEqual([]);
    expect(
      await page.evaluate(() => {
        const entered = window.__scrapRig.enterSurvival();
        if (entered) {
          window.__scrapRig.setSimPaused(true);
          window.__scrapRig.stepSim(1);
        }
        return entered;
      }),
    ).toBe(true);

    const telemetry = await page.evaluate(() =>
      window.__scrapRig.survivalTelemetry(),
    );
    expect(telemetry?.mode).toBe('survival');
    expect(await page.evaluate(() => window.__scrapRig.runState())).toEqual({
      wave: 1,
      inBuildPhase: false,
    });
    if (fixtureName === 'multi-gun') expect(telemetry?.weapons).toHaveLength(3);
    if (fixtureName === 'heavy-armour') {
      expect(telemetry?.integrityPct).toBeCloseTo(100, 5);
    }
    expect(pageErrors).toEqual([]);
  });
}
