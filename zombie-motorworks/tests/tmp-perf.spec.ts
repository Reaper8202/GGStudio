import { test } from '@playwright/test';
import { boot, buildBasicRig, place, settle } from './seam.ts';

/**
 * Deterministic simulation-cost harness. Headless Chromium renders through
 * software GL, so frame times there are meaningless — but fixed-step CPU cost
 * (physics, zombie AI, HUD sync) is exactly what we can compare. Each sample
 * runs 60 fixed steps behind a single render, so the render is amortised.
 */
test('sim cost of a busy wave', async ({ page }) => {
  test.setTimeout(600_000);
  await boot(page);
  await buildBasicRig(page);
  await page.evaluate(() => {
    window.__scrapRig.grantMoney(50_000);
    for (const id of ['turret', 'ice-cannon', 'nitro-injector']) {
      window.__scrapRig.unlockPart(id);
    }
  });
  await place(page, 'turret', { x: 0, y: 2, z: 1 });
  await place(page, 'ice-cannon', { x: 1, y: 2, z: 1 });
  await place(page, 'nitro-injector', { x: -1, y: 2, z: 1 });
  await page.evaluate(() => window.__scrapRig.enterSurvival());
  await page.evaluate(() => window.__scrapRig.debugStartWave(12));
  await settle(page, 1200);
  await page.evaluate(() => window.__scrapRig.setControls({ throttle: 1 }));
  await page.evaluate(() => window.__scrapRig.stepSim(60));

  const result = await page.evaluate(() => {
    const samples: number[] = [];
    for (let i = 0; i < 8; i++) {
      const t0 = performance.now();
      window.__scrapRig.stepSim(60);
      samples.push((performance.now() - t0) / 60);
    }
    samples.sort((a, b) => a - b);
    return {
      zombiesAlive: window.__scrapRig.survivalTelemetry()?.zombiesAlive,
      msPerStepMedian: +samples[4].toFixed(3),
      msPerStepBest: +samples[0].toFixed(3),
      msPerStepWorst: +samples[samples.length - 1].toFixed(3),
    };
  });
  console.log('SIM:', JSON.stringify(result));
});
