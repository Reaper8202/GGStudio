import { expect, test, type Page } from '@playwright/test';
import { boot, buildBasicRig, newBlueprint, place } from './seam.ts';

async function enterSurvivalPaused(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const entered = window.__scrapRig.enterSurvival();
    if (entered) window.__scrapRig.setSimPaused(true);
    return entered;
  });
}

test('wave completion enters build phase and resumes at the next wave', async ({
  page,
}) => {
  await boot(page);
  await buildBasicRig(page);
  expect((await place(page, 'turret', { x: 0, y: 2, z: 1 })).ok).toBe(true);
  expect(await page.evaluate(() => window.__scrapRig.grantMoney(250))).toBe(
    true,
  );
  const design = await page.evaluate(() =>
    window.__scrapRig.getBlueprintJson(),
  );

  expect(await enterSurvivalPaused(page)).toBe(true);
  expect(await page.evaluate(() => window.__scrapRig.runState())).toEqual({
    wave: 1,
    inBuildPhase: false,
  });
  await page.evaluate(() => window.__scrapRig.forceWaveComplete());

  await expect(page.getByText('VICTORY', { exact: true })).toBeVisible();
  await expect(page.getByText('Wave 1 Cleared', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Go to Garage' }).click();

  expect(await page.evaluate(() => window.__scrapRig.mode())).toBe('editor');
  expect(await page.evaluate(() => window.__scrapRig.runState())).toEqual({
    wave: 1,
    inBuildPhase: true,
  });
  expect(await page.evaluate(() => window.__scrapRig.getBlueprintJson())).toBe(
    design,
  );

  expect(await enterSurvivalPaused(page)).toBe(true);
  expect(await page.evaluate(() => window.__scrapRig.runState())).toEqual({
    wave: 2,
    inBuildPhase: false,
  });
  expect(
    await page.evaluate(() => window.__scrapRig.survivalTelemetry()?.wave),
  ).toBe(2);
  expect(await page.evaluate(() => window.__scrapRig.getBlueprintJson())).toBe(
    design,
  );
});

test('victory screen next wave continues the run without leaving survival', async ({
  page,
}) => {
  await boot(page);
  await buildBasicRig(page);
  expect(await page.evaluate(() => window.__scrapRig.grantMoney(250))).toBe(
    true,
  );
  expect((await place(page, 'turret', { x: 0, y: 2, z: 1 })).ok).toBe(true);

  expect(await enterSurvivalPaused(page)).toBe(true);
  await page.evaluate(() => window.__scrapRig.forceWaveComplete());
  await expect(page.getByText('VICTORY', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Next Wave' }).click();
  await expect(page.getByText('VICTORY', { exact: true })).toBeHidden();
  expect(await page.evaluate(() => window.__scrapRig.mode())).toBe('survival');
  expect(await page.evaluate(() => window.__scrapRig.runState())).toEqual({
    wave: 2,
    inBuildPhase: false,
  });
  expect(
    await page.evaluate(() => window.__scrapRig.survivalTelemetry()?.wave),
  ).toBe(2);
});

test('new-build profile hygiene and fresh-run wave state are independent', async ({
  page,
}) => {
  await boot(page);
  expect(await page.evaluate(() => window.__scrapRig.grantMoney(1_000))).toBe(
    true,
  );
  expect(
    await page.evaluate(() => window.__scrapRig.unlockPart('armour-plate')),
  ).toBe(true);
  await newBlueprint(page);
  expect((await place(page, 'chassis-core', { x: 0, y: 1, z: 0 })).ok).toBe(
    true,
  );
  const profileBeforeNew = await page.evaluate(() =>
    window.__scrapRig.profile(),
  );

  await page.getByRole('button', { name: 'New', exact: true }).click();
  expect(await page.evaluate(() => window.__scrapRig.profile())).toEqual(
    profileBeforeNew,
  );

  await buildBasicRig(page);
  const design = await page.evaluate(() =>
    window.__scrapRig.getBlueprintJson(),
  );
  expect(await enterSurvivalPaused(page)).toBe(true);
  expect(await page.evaluate(() => window.__scrapRig.runState()?.wave)).toBe(1);
  await page.evaluate(() => window.__scrapRig.backToEditor());
  expect(await page.evaluate(() => window.__scrapRig.runState())).toBeNull();

  expect(await enterSurvivalPaused(page)).toBe(true);
  expect(await page.evaluate(() => window.__scrapRig.runState())).toEqual({
    wave: 1,
    inBuildPhase: false,
  });
  expect(await page.evaluate(() => window.__scrapRig.getBlueprintJson())).toBe(
    design,
  );
});

test('repeated editor and survival transitions keep one HUD root and one design', async ({
  page,
}) => {
  await boot(page);
  await buildBasicRig(page);
  const design = await page.evaluate(() =>
    window.__scrapRig.getBlueprintJson(),
  );

  await expect(page.locator('.ui-layer')).toHaveCount(1);
  await expect(page.locator('.palette')).toHaveCount(1);
  for (let transition = 0; transition < 2; transition += 1) {
    expect(await enterSurvivalPaused(page)).toBe(true);
    await expect(page.locator('.ui-layer')).toHaveCount(1);
    await expect(
      page.getByText('ZOMBIE SURVIVAL', { exact: true }),
    ).toHaveCount(1);
    await expect(page.locator('.palette')).toHaveCount(0);

    await page.evaluate(() => window.__scrapRig.backToEditor());
    await expect(page.locator('.ui-layer')).toHaveCount(1);
    await expect(page.locator('.palette')).toHaveCount(1);
    await expect(
      page.getByText('ZOMBIE SURVIVAL', { exact: true }),
    ).toHaveCount(0);
  }

  expect(await page.evaluate(() => window.__scrapRig.mode())).toBe('editor');
  expect(await page.evaluate(() => window.__scrapRig.getBlueprintJson())).toBe(
    design,
  );
});
