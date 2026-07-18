import { expect, test, type Page } from '@playwright/test';
import { boot, buildBasicRig, orientOf, place } from './seam.ts';

interface BlueprintPart {
  id: string;
  defId: string;
  pos: { x: number; y: number; z: number };
}

async function parts(page: Page): Promise<BlueprintPart[]> {
  return page.evaluate(
    () =>
      (
        JSON.parse(window.__scrapRig.getBlueprintJson()) as {
          parts: BlueprintPart[];
        }
      ).parts,
  );
}

async function enterSurvivalPaused(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const entered = window.__scrapRig.enterSurvival();
    if (entered) window.__scrapRig.setSimPaused(true);
    return entered;
  });
}

test('moving a wheel changes its assembled survival world position', async ({
  page,
}) => {
  await boot(page);
  await buildBasicRig(page);
  const originalWheel = (await parts(page)).find(
    (part) =>
      part.defId === 'wheel-standard' && part.pos.x === 2 && part.pos.z === 2,
  );
  if (!originalWheel) throw new Error('missing right-front wheel');

  expect(await enterSurvivalPaused(page)).toBe(true);
  const originalX = await page.evaluate((partId) => {
    const telemetry = window.__scrapRig.survivalTelemetry();
    const wheel = telemetry?.wheels.find(
      (candidate) => candidate.partId === partId,
    );
    if (!wheel) throw new Error(`missing runtime wheel ${partId}`);
    return wheel.worldCentre[0];
  }, originalWheel.id);

  await page.evaluate(() => window.__scrapRig.backToEditor());
  expect(
    await page.evaluate(
      (partId) => window.__scrapRig.sellPart(partId),
      originalWheel.id,
    ),
  ).toBe(true);
  expect((await place(page, 'frame-box', { x: 2, y: 1, z: 2 })).ok).toBe(true);
  const yaw180 = await orientOf(page, 'yaw180');
  expect(
    (await place(page, 'wheel-standard', { x: 3, y: 1, z: 2 }, yaw180)).ok,
  ).toBe(true);
  const movedWheel = (await parts(page)).find(
    (part) =>
      part.defId === 'wheel-standard' && part.pos.x === 3 && part.pos.z === 2,
  );
  if (!movedWheel) throw new Error('missing moved right-front wheel');

  expect(await enterSurvivalPaused(page)).toBe(true);
  const movedX = await page.evaluate((partId) => {
    const telemetry = window.__scrapRig.survivalTelemetry();
    const wheel = telemetry?.wheels.find(
      (candidate) => candidate.partId === partId,
    );
    if (!wheel) throw new Error(`missing runtime wheel ${partId}`);
    return wheel.worldCentre[0];
  }, movedWheel.id);

  expect(movedX).toBeCloseTo(originalX + 0.5, 5);
});

test('adding and removing a second turret changes assembled weapon count', async ({
  page,
}) => {
  await boot(page);
  await buildBasicRig(page);
  expect((await place(page, 'turret', { x: 0, y: 2, z: 1 })).ok).toBe(true);
  const firstTurret = (await parts(page)).find(
    (part) => part.defId === 'turret',
  );
  if (!firstTurret) throw new Error('missing first turret');

  expect(await enterSurvivalPaused(page)).toBe(true);
  expect(
    await page.evaluate(
      () => window.__scrapRig.survivalTelemetry()?.weapons.length,
    ),
  ).toBe(1);

  await page.evaluate(() => window.__scrapRig.backToEditor());
  expect((await place(page, 'turret', { x: 1, y: 2, z: 2 })).ok).toBe(true);
  const secondTurret = (await parts(page)).find(
    (part) => part.defId === 'turret' && part.id !== firstTurret.id,
  );
  if (!secondTurret) throw new Error('missing second turret');

  expect(await enterSurvivalPaused(page)).toBe(true);
  expect(
    await page.evaluate(
      () => window.__scrapRig.survivalTelemetry()?.weapons.length,
    ),
  ).toBe(2);

  await page.evaluate(() => window.__scrapRig.backToEditor());
  expect(
    await page.evaluate(
      (partId) => window.__scrapRig.sellPart(partId),
      secondTurret.id,
    ),
  ).toBe(true);
  expect(await enterSurvivalPaused(page)).toBe(true);
  expect(
    await page.evaluate(() =>
      window.__scrapRig
        .survivalTelemetry()
        ?.weapons.map((weapon) => weapon.partId),
    ),
  ).toEqual([firstTurret.id]);
});

test('adding armour raises fresh-spawn total maximum HP', async ({ page }) => {
  await boot(page);
  await buildBasicRig(page);

  expect(await enterSurvivalPaused(page)).toBe(true);
  const hpWithoutArmour = await page.evaluate(() =>
    Object.values(window.__scrapRig.survivalTelemetry()?.partHp ?? {}).reduce(
      (total, hp) => total + hp,
      0,
    ),
  );

  await page.evaluate(() => window.__scrapRig.backToEditor());
  expect(
    await page.evaluate(() => window.__scrapRig.unlockPart('armour-plate')),
  ).toBe(true);
  expect((await place(page, 'armour-plate', { x: 0, y: 2, z: 2 })).ok).toBe(
    true,
  );

  expect(await enterSurvivalPaused(page)).toBe(true);
  const hpWithArmour = await page.evaluate(() =>
    Object.values(window.__scrapRig.survivalTelemetry()?.partHp ?? {}).reduce(
      (total, hp) => total + hp,
      0,
    ),
  );

  expect(hpWithArmour).toBe(hpWithoutArmour + 220);
});
