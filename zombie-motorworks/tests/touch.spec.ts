import { expect, test } from '@playwright/test';
import { boot, buildBasicRig } from './seam.ts';

test.use({ hasTouch: true });

test('touch devices get on-screen controls that drive and stop the vehicle', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await boot(page);

  // The editor never shows the driving overlay.
  await expect(page.locator('.touch-controls')).toHaveCount(0);

  await buildBasicRig(page);
  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(true);

  const throttle = page.locator('.touch-btn[data-key="ArrowUp"]');
  await expect(throttle).toBeVisible();
  await expect(page.locator('.touch-btn[data-key="ArrowLeft"]')).toBeVisible();
  await expect(page.locator('.touch-btn[data-key="f"]')).toBeVisible();

  // Deterministic sim stepping: wall-clock settling is flaky under parallel
  // test workers. The synthetic pointerdown lands its keydown synchronously,
  // so stepped frames see the held button exactly like a finger would.
  await page.evaluate(() => {
    window.__scrapRig.setSimPaused(true);
    window.__scrapRig.stepSim(120);
  });
  await throttle.dispatchEvent('pointerdown', { pointerId: 1 });
  const moving = await page.evaluate(() => {
    window.__scrapRig.stepSim(180);
    return window.__scrapRig.telemetry();
  });
  expect(moving.position.z).toBeGreaterThan(3);
  expect(moving.speedKmh).toBeGreaterThan(10);

  // Release throttle, hold the brake button until it stops. Chunked stepping:
  // a long ArrowDown hold would engage reverse after the stop.
  await throttle.dispatchEvent('pointerup', { pointerId: 1 });
  const brake = page.locator('.touch-btn[data-key="ArrowDown"]');
  await brake.dispatchEvent('pointerdown', { pointerId: 1 });
  const stopped = await page.evaluate(() => {
    for (let i = 0; i < 10; i++) {
      window.__scrapRig.stepSim(30);
      if (window.__scrapRig.telemetry().speedKmh < 4) break;
    }
    return window.__scrapRig.telemetry();
  });
  expect(stopped.speedKmh).toBeLessThan(4);
  await brake.dispatchEvent('pointerup', { pointerId: 1 });

  // Leaving the chamber removes the overlay with the mode.
  await page.evaluate(() => window.__scrapRig.backToEditor());
  await expect(page.locator('.touch-controls')).toHaveCount(0);
});
