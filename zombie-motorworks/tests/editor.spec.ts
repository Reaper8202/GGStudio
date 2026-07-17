import { expect, test } from '@playwright/test';
import { boot, buildBasicRig, newBlueprint, place } from './seam.ts';

test('editor boots with palette, build card, and a non-black scene', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.palette')).toBeVisible();
  await expect(page.getByText(/^Weight:/)).toBeVisible();
  await expect(page.getByRole('button', { name: '▶ TEST DRIVE' })).toBeVisible();
  const shot = await page.locator('canvas.viewport').screenshot();
  expect(shot.byteLength).toBeGreaterThan(20_000);
});

test('New starts with a locked Truck Heart', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const parts = await page.evaluate(() => JSON.parse(window.__scrapRig.getBlueprintJson()).parts);
  expect(parts).toHaveLength(1);
  expect(parts[0]).toMatchObject({ id: 'p1', defId: 'chassis-core', pos: { x: 0, y: 1, z: 0 } });
});

test('placement validation rejects overlap and floating parts while direct frame sockets allow wheels', async ({ page }) => {
  await boot(page);
  await newBlueprint(page);
  expect((await place(page, 'chassis-core', { x: 0, y: 1, z: 0 })).ok).toBe(true);
  expect((await place(page, 'frame-box', { x: 0, y: 1, z: 0 })).issues.join()).toContain('OVERLAP');
  expect((await place(page, 'frame-box', { x: 4, y: 4, z: 4 })).issues.join()).toContain('NO_CONNECTION');
  expect((await place(page, 'wheel-standard', { x: -1, y: 1, z: 0 })).ok).toBe(true);
  expect((await place(page, 'chassis-core', { x: 0, y: 1, z: 1 })).ok).toBe(false);
});

test('blocks can stack through the placement seam and UI placement', async ({ page }) => {
  await boot(page);
  await newBlueprint(page);
  expect((await place(page, 'chassis-core', { x: 0, y: 1, z: 0 })).ok).toBe(true);
  expect((await place(page, 'frame-box', { x: 0, y: 2, z: 0 })).ok).toBe(true);

  // Use a root-only build so the canvas centre is the exposed top surface.
  await page.evaluate(() => window.__scrapRig.loadBlueprintJson(JSON.stringify({
    schemaVersion: 2, id: 'ui-stack', name: 'ui-stack',
    parts: [{ id: 'p1', defId: 'chassis-core', pos: { x: 0, y: 1, z: 0 }, orient: 0, config: {} }],
  })));
  const before = await page.evaluate(() => JSON.parse(window.__scrapRig.getBlueprintJson()).parts.length);
  await page.locator('.part-btn[data-part-id="frame-box"]').click();
  const box = await page.locator('canvas.viewport').boundingBox();
  if (!box) throw new Error('missing editor canvas');
  // Canvas centre is the ray to (0,1,0) — the CORNER of the root cube (a
  // knife-edge graze). Aim at the projected centre of its top face instead.
  const cx = box.x + box.width / 2 + 5;
  const cy = box.y + box.height / 2 + 10;
  await page.locator('canvas.viewport').dispatchEvent('pointermove', { clientX: cx, clientY: cy });
  await page.locator('canvas.viewport').dispatchEvent('pointerdown', { button: 0, clientX: cx, clientY: cy });
  await page.locator('canvas.viewport').dispatchEvent('pointerup', { button: 0, clientX: cx, clientY: cy });
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__scrapRig.getBlueprintJson()).parts.length)).toBe(before + 1);
  // The new block must sit ON TOP of the root (the original stacking bug).
  const parts = await page.evaluate(() => JSON.parse(window.__scrapRig.getBlueprintJson()).parts);
  expect(parts.some((p: { defId: string; pos: { y: number } }) => p.defId === 'frame-box' && p.pos.y === 2)).toBe(true);
});

test('stationary right-click deletes under the cursor without a selection', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__scrapRig.loadBlueprintJson(JSON.stringify({
    schemaVersion: 2, id: 'right-delete', name: 'right-delete', parts: [
      { id: 'p1', defId: 'chassis-core', pos: { x: 0, y: 1, z: 0 }, orient: 0, config: {} },
      { id: 'p2', defId: 'frame-box', pos: { x: 0, y: 2, z: 0 }, orient: 0, config: {} },
    ],
  })));
  const before = await page.evaluate(() => JSON.parse(window.__scrapRig.getBlueprintJson()).parts.length);
  const box = await page.locator('canvas.viewport').boundingBox();
  if (!box) throw new Error('missing editor canvas');
  const event = { button: 2, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  await page.locator('canvas.viewport').dispatchEvent('contextmenu', event);
  await page.locator('canvas.viewport').dispatchEvent('pointerdown', event);
  await page.locator('canvas.viewport').dispatchEvent('pointerup', event);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__scrapRig.getBlueprintJson()).parts.length)).toBe(before - 1);
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
  expect((await page.evaluate(() => window.__scrapRig.validate())).errors.map((e) => e.code)).toContain('NO_PROPULSION');
  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(false);
  await buildBasicRig(page);
  expect(await page.evaluate(() => window.__scrapRig.validate()).then((v) => v.errors.length)).toBe(0);
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
  expect(JSON.parse(await page.evaluate(() => window.__scrapRig.getBlueprintJson())).parts).toEqual(JSON.parse(json).parts);
});
