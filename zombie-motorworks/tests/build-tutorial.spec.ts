/**
 * New Game hand-off: pick a rig, then get taught how to build that rig.
 *
 * The two halves are wired through App (`applyChosenBuild` re-opens the garage
 * with the tutorial armed), so this covers the seam between them rather than
 * either feature on its own.
 */

import { expect, test, type Page } from '@playwright/test';

interface BlueprintSnapshot {
  name: string;
  parts: { id: string; defId: string }[];
}

async function openTitle(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto('/?debug=1');
  await page.waitForFunction(
    () =>
      window.__scrapRig !== undefined && window.__scrapRig.mode() === 'title',
    null,
    { timeout: 20_000 },
  );
  return errors;
}

async function newGameInto(page: Page, rigName: string): Promise<void> {
  expect(await page.evaluate(() => window.__scrapRig.newGame())).toBe(true);
  await page.waitForFunction(() => window.__scrapRig.mode() === 'editor');
  const picker = page.getByRole('dialog', { name: 'Choose Your Rig' });
  await expect(picker).toBeVisible();
  await picker.getByText(rigName, { exact: false }).first().click();
}

test('picking the medium rig coaches that rig, and skipping hands it over', async ({
  page,
}) => {
  const errors = await openTitle(page);
  await newGameInto(page, 'Emberframe');

  // The garage reopens on an empty bay with the guided build running.
  await expect(page.locator('.tutorial-coach')).toBeVisible();
  await expect(page.locator('.tutorial-coach')).toContainText('Emberframe');
  const state = await page.evaluate(() => window.__scrapRig.tutorialState());
  expect(state?.active).toBe(true);
  // 18 blocks on the Emberframe: welcome + 17 placements + fight.
  expect(state?.total).toBe(19);
  const staged = await page.evaluate(
    () => JSON.parse(window.__scrapRig.getBlueprintJson()) as BlueprintSnapshot,
  );
  expect(staged.parts.map((part) => part.defId)).toEqual(['chassis-core']);

  // Skipping is not a punishment: it hands over the finished rig, weapon on.
  await page.getByRole('button', { name: 'Skip Tutorial' }).click();
  await expect(page.locator('.tutorial-coach')).toHaveCount(0);
  const skipped = await page.evaluate(
    () => JSON.parse(window.__scrapRig.getBlueprintJson()) as BlueprintSnapshot,
  );
  expect(skipped.parts).toHaveLength(18);
  expect(skipped.parts.some((part) => part.defId === 'pyre-core')).toBe(true);
  expect(
    await page.evaluate(() => window.__scrapRig.validate().errors),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test('the light rig gets its own, shorter script', async ({ page }) => {
  const errors = await openTitle(page);
  await newGameInto(page, 'Sparkrunner');

  await expect(page.locator('.tutorial-coach')).toBeVisible();
  await expect(page.locator('.tutorial-coach')).toContainText('Sparkrunner');
  const state = await page.evaluate(() => window.__scrapRig.tutorialState());
  // 11 blocks on the Sparkrunner: welcome + 10 placements + fight.
  expect(state?.total).toBe(12);
  expect(errors).toEqual([]);
});
