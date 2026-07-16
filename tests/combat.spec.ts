import { expect, test } from '@playwright/test';
import { boot, buildBasicRig, place, settle } from './seam.ts';

test('weapons fire with ammo consumption and recoil; drop test damages and detaches parts', async ({ page }) => {
  test.setTimeout(150_000);
  await boot(page);
  await buildBasicRig(page);
  // Hardpoint + fixed gun + ammo on the deck.
  expect((await place(page, 'hardpoint', { x: 0, y: 2, z: 1 })).ok).toBe(true);
  expect((await place(page, 'gun-fixed', { x: 0, y: 3, z: 1 })).ok).toBe(true);
  expect((await place(page, 'ammo-box', { x: 0, y: 2, z: 2 })).ok).toBe(true);
  // Armour panel on the nose.
  expect((await place(page, 'armour-panel', { x: 0, y: 1, z: 2 })).ok).toBe(true);

  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(true);
  await settle(page);
  const before = await page.evaluate(() => window.__scrapRig.telemetry());
  expect(before.ammo).toBe(200);

  await page.evaluate(() => window.__scrapRig.setControls({ fire: true }));
  await settle(page, 1500);
  await page.evaluate(() => window.__scrapRig.setControls({ fire: false }));
  const fired = await page.evaluate(() => window.__scrapRig.telemetry());
  expect(fired.ammo).toBeLessThan(200);

  // Drop test: fall from height, expect damage — destroyed or detached parts.
  await page.evaluate(() => window.__scrapRig.setScenario('drop'));
  await settle(page, 500);
  // Drive off the elevated platform edge.
  await page.evaluate(() => window.__scrapRig.setControls({ throttle: 1 }));
  await settle(page, 4500);
  const after = await page.evaluate(() => window.__scrapRig.telemetry());
  const lost = before.aliveParts - after.aliveParts + after.detachedParts;
  expect(lost, `alive ${after.aliveParts}/${before.aliveParts}, detached ${after.detachedParts}`).toBeGreaterThan(0);

  // Reset restores a pristine vehicle.
  await page.evaluate(() => window.__scrapRig.resetVehicle());
  await settle(page, 800);
  const reset = await page.evaluate(() => window.__scrapRig.telemetry());
  expect(reset.detachedParts).toBe(0);
});
