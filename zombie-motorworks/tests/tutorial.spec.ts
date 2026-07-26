import { expect, test } from '@playwright/test';
import { boot, orientOf, place } from './seam.ts';

test('guided tutorial advances through a first truck', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__scrapRig.startTutorial());
  await expect.poll(() => page.evaluate(() => window.__scrapRig.tutorialState())).toEqual({ active: true, stepIndex: 0, total: 5 });

  for (const pos of [
    { x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: -1 },
    { x: 1, y: 1, z: 1 }, { x: -1, y: 1, z: 1 },
    { x: 1, y: 1, z: -1 }, { x: -1, y: 1, z: -1 },
  ]) {
    expect((await place(page, 'frame-box', pos)).ok).toBe(true);
  }
  expect((await page.evaluate(() => window.__scrapRig.tutorialState()))?.stepIndex).toBe(1);

  const yaw180 = await orientOf(page, 'yaw180');
  for (const [pos, orient] of [
    [{ x: -2, y: 1, z: 1 }, 0], [{ x: -2, y: 1, z: -1 }, 0],
    [{ x: 2, y: 1, z: 1 }, yaw180], [{ x: 2, y: 1, z: -1 }, yaw180],
  ] as const) {
    const r = await place(page, 'wheel-standard', pos, orient);
    expect(r.ok, `wheel at ${JSON.stringify(pos)}: ${r.issues.join(',')}`).toBe(true);
  }
  expect((await page.evaluate(() => window.__scrapRig.tutorialState()))?.stepIndex).toBe(2);

  expect((await place(page, 'engine-small', { x: 0, y: 2, z: 1 })).ok).toBe(true);
  expect((await page.evaluate(() => window.__scrapRig.tutorialState()))?.stepIndex).toBe(3);
  expect((await place(page, 'fuel-tank', { x: 0, y: 2, z: -1 })).ok).toBe(true);
  expect((await page.evaluate(() => window.__scrapRig.tutorialState()))?.stepIndex ?? 0).toBeGreaterThanOrEqual(4);
  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(true);
});

test('the garage dock shows store tiles, inventory stock, and the erase tool', async ({
  page,
}) => {
  await boot(page);

  // Store and inventory both carry a Frame Box tile, so scope by list rather
  // than by label — an unscoped getByText('Block') matches both.
  const store = page.locator('.store-list');
  const inventory = page.locator('.inventory-list');

  await expect(store.locator('.part-btn[data-part-id="frame-box"]')).toBeVisible();
  await expect(
    store.locator('.part-btn[data-part-id="wheel-standard"]'),
  ).toBeVisible();
  // Weapons live behind their own filter and start hidden.
  await expect(store.locator('.part-btn[data-part-id="turret"]')).toBeHidden();
  await page.getByRole('button', { name: 'Weapons', exact: true }).click();
  await expect(store.locator('.part-btn[data-part-id="turret"]')).toBeVisible();
  await expect(
    store.locator('.part-btn[data-part-id="frame-box"]'),
  ).toBeHidden();

  // The starter garage hands over loose stock to place.
  await expect(
    inventory.locator('.part-btn[data-part-id="wheel-standard"]'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Erase Part' })).toBeVisible();
});
