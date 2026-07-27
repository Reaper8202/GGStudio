import { test } from '@playwright/test';
import { boot, buildBasicRig, place, settle } from './seam.ts';

/**
 * Deterministic cost harness. Headless Chromium renders through software GL,
 * so wall-clock frame rate there is meaningless — but CPU cost is comparable:
 *   simMs   = one fixed step (physics + zombie AI + weapons), render amortised
 *   frameMs = one fixed step plus syncView and the render submit
 */
test('sim + frame cost of a busy wave', async ({ page }) => {
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
  for (const pos of [
    { x: 0, y: 2, z: 0 },
    { x: 1, y: 2, z: 0 },
    { x: -1, y: 2, z: 0 },
    { x: 1, y: 2, z: 2 },
    { x: -1, y: 2, z: 2 },
    { x: 0, y: 2, z: 2 },
  ]) {
    await place(page, 'frame-box', pos);
  }
  await page.evaluate(() => window.__scrapRig.enterSurvival());
  await page.evaluate(() => window.__scrapRig.debugStartWave(18));
  await settle(page, 1200);
  await page.evaluate(() => window.__scrapRig.setControls({ throttle: 1 }));
  await page.evaluate(() => window.__scrapRig.stepSim(60));

  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const result = await page.evaluate(() => {
    const sim: number[] = [];
    const frame: number[] = [];
    for (let i = 0; i < 20; i++) {
      let t0 = performance.now();
      window.__scrapRig.stepSim(60);
      sim.push((performance.now() - t0) / 60);
      t0 = performance.now();
      for (let n = 0; n < 30; n++) window.__scrapRig.stepSim(1);
      frame.push((performance.now() - t0) / 30);
    }
    return {
      zombiesAlive: window.__scrapRig.survivalTelemetry()?.zombiesAlive,
      sim,
      frame,
    };
  });
  console.log(
    'RESULT:',
    JSON.stringify({
      zombiesAlive: result.zombiesAlive,
      simMs: +median(result.sim).toFixed(3),
      frameMs: +median(result.frame).toFixed(3),
      // Per-frame view/render cost, backed out of the two measurements.
      viewMs: +(median(result.frame) - median(result.sim)).toFixed(3),
    }),
  );
});
