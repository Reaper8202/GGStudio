import { expect, test } from '@playwright/test';
import { boot, orientOf, place } from './seam.ts';

test('guided tutorial advances through a first truck', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__scrapRig.startTutorial());
  await expect
    .poll(() => page.evaluate(() => window.__scrapRig.tutorialState()))
    .toEqual({ active: true, stepIndex: 0, total: 7 });

  for (const pos of [
    { x: 0, y: 1, z: 1 },
    { x: 0, y: 1, z: -1 },
    { x: 1, y: 1, z: 0 },
    { x: -1, y: 1, z: 0 },
  ]) {
    expect((await place(page, 'frame-box', pos)).ok).toBe(true);
  }
  expect((await page.evaluate(() => window.__scrapRig.tutorialState()))?.stepIndex).toBe(1);

  for (const pos of [
    { x: 1, y: 1, z: 1 },
    { x: -1, y: 1, z: 1 },
    { x: 1, y: 1, z: -1 },
    { x: -1, y: 1, z: -1 },
  ]) {
    expect((await place(page, 'wheel-mount', pos)).ok).toBe(true);
  }
  expect((await page.evaluate(() => window.__scrapRig.tutorialState()))?.stepIndex).toBe(2);

  const yaw180 = await orientOf(page, 'yaw180');
  const wheelConfig = { driven: true, braking: true };
  for (const [pos, orient] of [
    [{ x: -2, y: 1, z: 1 }, 0],
    [{ x: -2, y: 1, z: -1 }, 0],
    [{ x: 2, y: 1, z: 1 }, yaw180],
    [{ x: 2, y: 1, z: -1 }, yaw180],
  ] as const) {
    expect((await place(page, 'wheel-standard', pos, orient, wheelConfig)).ok).toBe(true);
  }
  expect((await page.evaluate(() => window.__scrapRig.tutorialState()))?.stepIndex).toBe(3);

  expect((await place(page, 'driver-seat', { x: 0, y: 2, z: 0 })).ok).toBe(true);
  expect((await page.evaluate(() => window.__scrapRig.tutorialState()))?.stepIndex).toBe(4);

  expect((await place(page, 'engine-mount', { x: 0, y: 1, z: 2 })).ok).toBe(true);
  expect((await place(page, 'engine-small', { x: 0, y: 2, z: 2 })).ok).toBe(true);
  expect((await page.evaluate(() => window.__scrapRig.tutorialState()))?.stepIndex).toBe(5);

  expect((await place(page, 'fuel-tank', { x: 0, y: 2, z: 1 })).ok).toBe(true);
  expect((await page.evaluate(() => window.__scrapRig.tutorialState()))?.stepIndex ?? 0).toBeGreaterThanOrEqual(6);
  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(true);
});

test('simple palette uses kid labels and can show all parts', async ({ page }) => {
  await boot(page);
  await expect(page.getByText('Wheel Holder', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '🔧 More parts' }).click();
  await expect(page.getByText('structural', { exact: true })).toBeVisible();
});
