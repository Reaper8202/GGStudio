import { expect, test, type Page } from '@playwright/test';
import { advanceToEditor, boot, newBlueprint, place } from './seam.ts';

interface BlueprintPart {
  id: string;
  defId: string;
  pos: { x: number; y: number; z: number };
  config: { level?: number };
}

interface BlueprintSnapshot {
  parts: BlueprintPart[];
}

async function blueprint(page: Page): Promise<BlueprintSnapshot> {
  return page.evaluate(
    () => JSON.parse(window.__scrapRig.getBlueprintJson()) as BlueprintSnapshot,
  );
}

async function reloadDebugApp(page: Page): Promise<void> {
  await page.reload();
  await page.waitForFunction(() => window.__scrapRig !== undefined, null, {
    timeout: 20_000,
  });
  await advanceToEditor(page);
}

test('placement, upgrade, and sale apply exact wallet deltas', async ({
  page,
}) => {
  await boot(page);
  await newBlueprint(page);
  const startingMoney = await page.evaluate(
    () => window.__scrapRig.profile().money,
  );

  expect((await place(page, 'chassis-core', { x: 0, y: 1, z: 0 })).ok).toBe(
    true,
  );
  expect((await place(page, 'wheel-standard', { x: -1, y: 1, z: 0 })).ok).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__scrapRig.profile().money)).toBe(
    startingMoney - 18,
  );

  const wheel = (await blueprint(page)).parts.find(
    (part) => part.defId === 'wheel-standard',
  );
  if (!wheel) throw new Error('wheel placement did not create a part');

  expect(
    await page.evaluate(
      (partId) => window.__scrapRig.buyUpgrade(partId),
      wheel.id,
    ),
  ).toBe(true);
  expect(
    (await blueprint(page)).parts.find((part) => part.id === wheel.id)?.config
      .level,
  ).toBe(2);
  expect(await page.evaluate(() => window.__scrapRig.profile().money)).toBe(
    startingMoney - 29,
  );

  expect(
    await page.evaluate(
      (partId) => window.__scrapRig.sellPart(partId),
      wheel.id,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => window.__scrapRig.profile().money)).toBe(
    startingMoney - 15,
  );
  expect(
    (await blueprint(page)).parts.some((part) => part.id === wheel.id),
  ).toBe(false);
});

test('locked, unlocked, and insufficient-funds placement paths are enforced', async ({
  page,
}) => {
  await boot(page);
  await newBlueprint(page);
  expect((await place(page, 'chassis-core', { x: 0, y: 1, z: 0 })).ok).toBe(
    true,
  );
  const startingProfile = await page.evaluate(() =>
    window.__scrapRig.profile(),
  );

  const locked = await place(page, 'frame-reinforced', {
    x: 0,
    y: 1,
    z: 1,
  });
  expect(locked.ok).toBe(false);
  expect(locked.issues).toContain('LOCKED_PART: frame-reinforced');
  expect(await page.evaluate(() => window.__scrapRig.profile())).toEqual(
    startingProfile,
  );
  expect((await blueprint(page)).parts).toHaveLength(1);

  expect(
    await page.evaluate(() => window.__scrapRig.unlockPart('frame-reinforced')),
  ).toBe(true);
  expect(await page.evaluate(() => window.__scrapRig.profile().money)).toBe(
    startingProfile.money - 150,
  );
  expect(
    await page.evaluate(() => window.__scrapRig.unlockPart('frame-reinforced')),
  ).toBe(true);
  expect(await page.evaluate(() => window.__scrapRig.profile().money)).toBe(
    startingProfile.money - 150,
  );

  expect((await place(page, 'frame-reinforced', { x: 0, y: 1, z: 1 })).ok).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__scrapRig.profile().money)).toBe(
    startingProfile.money - 175,
  );

  const beforeDeniedPlacement = await blueprint(page);
  const denied = await place(page, 'turret', { x: 0, y: 2, z: 0 });
  expect(denied.ok).toBe(false);
  expect(denied.issues).toContain('INSUFFICIENT_FUNDS: need $150');
  expect(await blueprint(page)).toEqual(beforeDeniedPlacement);
  expect(await page.evaluate(() => window.__scrapRig.profile().money)).toBe(
    startingProfile.money - 175,
  );
});

test('money, unlocks, part levels, and the active blueprint persist across reload', async ({
  page,
}) => {
  await boot(page);
  expect(await page.evaluate(() => window.__scrapRig.grantMoney(1_000))).toBe(
    true,
  );
  await newBlueprint(page);
  expect((await place(page, 'chassis-core', { x: 0, y: 1, z: 0 })).ok).toBe(
    true,
  );
  expect((await place(page, 'frame-box', { x: 0, y: 2, z: 0 })).ok).toBe(true);
  const frame = (await blueprint(page)).parts.find(
    (part) => part.defId === 'frame-box',
  );
  if (!frame) throw new Error('frame placement did not create a part');
  expect(
    await page.evaluate(
      (partId) => window.__scrapRig.buyUpgrade(partId),
      frame.id,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => window.__scrapRig.unlockPart('frame-reinforced')),
  ).toBe(true);

  const expectedProfile = await page.evaluate(() =>
    window.__scrapRig.profile(),
  );
  const expectedBlueprint = await blueprint(page);
  await reloadDebugApp(page);

  expect(await page.evaluate(() => window.__scrapRig.profile())).toEqual(
    expectedProfile,
  );
  expect(await blueprint(page)).toEqual(expectedBlueprint);
  expect(
    (await blueprint(page)).parts.find((part) => part.id === frame.id)?.config
      .level,
  ).toBe(2);
});

test('a corrupted profile falls back to defaults and boots a clean editor', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await boot(page);
  await page.evaluate(() =>
    localStorage.setItem('scraprig.profile.v1', '{not valid json'),
  );

  await reloadDebugApp(page);

  expect(await page.evaluate(() => window.__scrapRig.mode())).toBe('editor');
  await expect(page.locator('.garage-dock')).toBeVisible();
  expect(await page.evaluate(() => window.__scrapRig.profile())).toEqual({
    money: 200,
    unlocks: [
      'chassis-core',
      'frame-box',
      'wheel-standard',
      'engine-small',
      'fuel-tank',
      'turret',
    ],
    highestWaveCleared: 0,
    phoneAddictsKilled: 0,
  });
  expect(
    await page.evaluate(() => window.__scrapRig.validate().errors),
  ).toEqual([]);
  expect(pageErrors).toEqual([]);
});
