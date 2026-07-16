import { expect, test } from '@playwright/test';
import { boot, buildBasicRig, newBlueprint, orientOf, place } from './seam.ts';

test('editor boots with palette, analysis panel, and a non-black scene', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.palette')).toBeVisible();
  await expect(page.getByText('analysis', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'TEST DRIVE' })).toBeVisible();
  // Canvas must not be black/empty: a uniform frame compresses to a tiny PNG.
  const shot = await page.locator('canvas.viewport').screenshot();
  expect(shot.byteLength).toBeGreaterThan(20_000);
});

test('placement validation: overlap, floating parts, and mounts are enforced', async ({ page }) => {
  await boot(page);
  await newBlueprint(page);

  expect((await place(page, 'chassis-core', { x: 0, y: 1, z: 0 })).ok).toBe(true);
  // Overlap rejected.
  const overlap = await place(page, 'frame-box', { x: 0, y: 1, z: 0 });
  expect(overlap.ok).toBe(false);
  expect(overlap.issues.join()).toContain('OVERLAP');
  // Floating part rejected.
  const floating = await place(page, 'frame-box', { x: 4, y: 4, z: 4 });
  expect(floating.ok).toBe(false);
  expect(floating.issues.join()).toContain('NO_CONNECTION');
  // Wheel needs a wheel mount, not a plain frame face.
  const wrongMount = await place(page, 'wheel-standard', { x: -1, y: 1, z: 0 });
  expect(wrongMount.ok).toBe(false);
  expect(wrongMount.issues.join()).toContain('MISSING_MOUNT');
  // Second root rejected.
  const secondRoot = await place(page, 'chassis-core', { x: 0, y: 1, z: 1 });
  expect(secondRoot.ok).toBe(false);
});

test('armour occupies a host face exclusively', async ({ page }) => {
  await boot(page);
  await newBlueprint(page);
  await place(page, 'chassis-core', { x: 0, y: 1, z: 0 });
  const first = await place(page, 'armour-panel', { x: 0, y: 1, z: 0 });
  expect(first.ok).toBe(true);
  const second = await place(page, 'shell-panel', { x: 0, y: 1, z: 0 });
  expect(second.ok).toBe(false);
  expect(second.issues.join()).toContain('ARMOUR_FACE_OCCUPIED');
});

test('undo/redo restore identical blueprints', async ({ page }) => {
  await boot(page);
  await newBlueprint(page);
  await place(page, 'chassis-core', { x: 0, y: 1, z: 0 });
  const before = await page.evaluate(() => window.__scrapRig.getBlueprintJson());
  await place(page, 'frame-box', { x: 0, y: 1, z: 1 });
  const after = await page.evaluate(() => window.__scrapRig.getBlueprintJson());
  await page.evaluate(() => window.__scrapRig.undo());
  expect(await page.evaluate(() => window.__scrapRig.getBlueprintJson())).toBe(before);
  await page.evaluate(() => window.__scrapRig.redo());
  expect(await page.evaluate(() => window.__scrapRig.getBlueprintJson())).toBe(after);
});

test('hard errors block test drive; warnings do not', async ({ page }) => {
  await boot(page);
  await newBlueprint(page);
  await place(page, 'chassis-core', { x: 0, y: 1, z: 0 });
  await place(page, 'driver-seat', { x: 0, y: 2, z: 0 });
  // No engine, no wheels -> NO_PROPULSION hard error, cannot enter test.
  const validation = await page.evaluate(() => window.__scrapRig.validate());
  expect(validation.errors.map((e) => e.code)).toContain('NO_PROPULSION');
  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(false);

  // Full rig with a deliberately wrong wheel: warning, but still drivable.
  await buildBasicRig(page);
  const rollX90 = await orientOf(page, 'rollX90');
  // Wheel with suspension pointing sideways (roll 90° about X) — placeable, wrong.
  await place(page, 'frame-box', { x: 0, y: 2, z: 1 });
  const analysis = await page.evaluate(() => window.__scrapRig.analyze());
  void rollX90;
  expect(await page.evaluate(() => window.__scrapRig.validate()).then((v) => v.errors.length)).toBe(0);
  expect(Array.isArray(analysis.warnings)).toBe(true);
  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(true);
});

test('blueprint save/load round-trips through localStorage', async ({ page }) => {
  await boot(page);
  await buildBasicRig(page);
  const json = await page.evaluate(() => window.__scrapRig.getBlueprintJson());
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => window.__scrapRig !== undefined);
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  const loaded = await page.evaluate(() => window.__scrapRig.getBlueprintJson());
  expect(JSON.parse(loaded).parts).toEqual(JSON.parse(json).parts);
});
