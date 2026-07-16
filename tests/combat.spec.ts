import { expect, test } from '@playwright/test';
import { boot, buildBasicRig, place, settle } from './seam.ts';

test('self-contained turret fires, and a correct rig survives drop and ramp', async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page);
  await buildBasicRig(page);
  expect((await place(page, 'turret', { x: 0, y: 2, z: 1 })).ok).toBe(true);
  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(true);
  await settle(page);
  const before = await page.evaluate(() => window.__scrapRig.telemetry());
  expect(before.ammo).toBe(200);
  await page.evaluate(() => window.__scrapRig.setControls({ fire: true }));
  await settle(page, 1500);
  await page.evaluate(() => window.__scrapRig.setControls({ fire: false }));
  expect((await page.evaluate(() => window.__scrapRig.telemetry())).ammo).toBeLessThan(200);

  await page.evaluate(() => window.__scrapRig.setScenario('drop'));
  await settle(page, 500);
  await page.evaluate(() => window.__scrapRig.setControls({ throttle: 1 }));
  await settle(page, 4500);
  const dropped = await page.evaluate(() => window.__scrapRig.telemetry());
  expect(dropped.aliveParts).toBe(before.aliveParts);
  expect(dropped.detachedParts).toBe(0);

  await page.evaluate(() => window.__scrapRig.resetVehicle());
  await page.evaluate(() => window.__scrapRig.setScenario('ramp'));
  await settle(page);
  await page.evaluate(() => window.__scrapRig.setControls({ throttle: 1 }));
  await settle(page, 6000);
  const ramp = await page.evaluate(() => window.__scrapRig.telemetry());
  expect(ramp.aliveParts).toBe(before.aliveParts);
  expect(ramp.detachedParts).toBe(0);
});
