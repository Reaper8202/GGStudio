import { expect, test, type Page } from '@playwright/test';

const PROFILE_STORAGE_KEY = 'scraprig.profile.v1';
const BLUEPRINT_STORAGE_KEY = 'scraprig.blueprints.v1';
const DEFAULT_PROFILE = {
  money: 200,
  unlocks: [
    'chassis-core',
    'frame-box',
    'wheel-standard',
    'driver-seat',
    'engine-small',
    'fuel-tank',
    'turret',
  ],
};

interface BlueprintSnapshot {
  name: string;
  parts: { id: string; defId: string }[];
}

interface RawSave {
  profile: string | null;
  blueprints: string | null;
}

async function openTitle(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await page.waitForFunction(
    () =>
      window.__scrapRig !== undefined && window.__scrapRig.mode() === 'title',
    null,
    { timeout: 20_000 },
  );
}

async function reloadToTitle(page: Page): Promise<void> {
  await page.reload();
  await page.waitForFunction(
    () =>
      window.__scrapRig !== undefined && window.__scrapRig.mode() === 'title',
    null,
    { timeout: 20_000 },
  );
}

async function rawSave(page: Page): Promise<RawSave> {
  return page.evaluate(
    ([profileKey, blueprintKey]) => ({
      profile: localStorage.getItem(profileKey),
      blueprints: localStorage.getItem(blueprintKey),
    }),
    [PROFILE_STORAGE_KEY, BLUEPRINT_STORAGE_KEY] as const,
  );
}

async function expectContinueUnavailable(page: Page): Promise<void> {
  const continueButton = page.getByRole('button', {
    name: 'Continue',
    exact: true,
    includeHidden: true,
  });
  await expect(continueButton).toBeHidden();
  await expect(continueButton).toBeDisabled();
}

async function startNewGame(page: Page): Promise<void> {
  expect(await page.evaluate(() => window.__scrapRig.newGame())).toBe(true);
  await page.waitForFunction(() => window.__scrapRig.mode() === 'editor');
}

async function createDistinctSave(page: Page): Promise<{
  profile: { money: number; unlocks: string[] };
  blueprint: BlueprintSnapshot;
}> {
  await startNewGame(page);
  expect(await page.evaluate(() => window.__scrapRig.grantMoney(431))).toBe(
    true,
  );
  await page.evaluate(() => {
    window.__scrapRig.loadBlueprintJson(
      JSON.stringify({
        schemaVersion: 2,
        id: 'title-save',
        name: 'title-save',
        parts: [
          {
            id: 'saved-root',
            defId: 'chassis-core',
            pos: { x: 0, y: 1, z: 0 },
            orient: 0,
            config: {},
          },
          {
            id: 'saved-frame',
            defId: 'frame-box',
            pos: { x: 0, y: 2, z: 0 },
            orient: 0,
            config: {},
          },
        ],
      }),
    );
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  return page.evaluate(() => ({
    profile: window.__scrapRig.profile(),
    blueprint: JSON.parse(
      window.__scrapRig.getBlueprintJson(),
    ) as BlueprintSnapshot,
  }));
}

test('fresh boot stays on the title until New Game starts a default garage', async ({
  page,
}) => {
  await openTitle(page);

  expect(await page.evaluate(() => window.__scrapRig.mode())).toBe('title');
  await expect(
    page.getByText('ZOMBIE MOTORWORKS', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Build the last ride out of the graveyard.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'New Game', exact: true }),
  ).toBeVisible();
  await expectContinueUnavailable(page);
  expect(await rawSave(page)).toEqual({ profile: null, blueprints: null });
  expect(await page.evaluate(() => window.__scrapRig.continueGame())).toBe(
    false,
  );
  expect(await page.evaluate(() => window.__scrapRig.mode())).toBe('title');

  await startNewGame(page);

  expect(await page.evaluate(() => window.__scrapRig.profile())).toEqual(
    DEFAULT_PROFILE,
  );
  const starter = await page.evaluate(
    () => JSON.parse(window.__scrapRig.getBlueprintJson()) as BlueprintSnapshot,
  );
  expect(starter.name).toBe('starter-rig');
  expect(starter.parts.some((part) => part.defId === 'chassis-core')).toBe(
    true,
  );
  expect(
    await page.evaluate(() => window.__scrapRig.validate().errors),
  ).toEqual([]);
  await expect(
    page.getByText('ZOMBIE MOTORWORKS', { exact: true }),
  ).toHaveCount(0);
});

test('Continue restores the saved money and active blueprint after reload', async ({
  page,
}) => {
  await openTitle(page);
  const expected = await createDistinctSave(page);
  const persisted = await rawSave(page);
  expect(persisted.profile).not.toBeNull();
  expect(persisted.blueprints).not.toBeNull();

  await reloadToTitle(page);

  const continueButton = page.getByRole('button', {
    name: 'Continue',
    exact: true,
  });
  await expect(continueButton).toBeVisible();
  await expect(continueButton).toBeEnabled();
  expect(await page.evaluate(() => window.__scrapRig.continueGame())).toBe(
    true,
  );
  await page.waitForFunction(() => window.__scrapRig.mode() === 'editor');
  expect(await page.evaluate(() => window.__scrapRig.profile())).toEqual(
    expected.profile,
  );
  expect(
    await page.evaluate(
      () =>
        JSON.parse(window.__scrapRig.getBlueprintJson()) as BlueprintSnapshot,
    ),
  ).toEqual(expected.blueprint);
});

test('New Game confirms before erasing an existing save', async ({ page }) => {
  await openTitle(page);
  await createDistinctSave(page);
  await reloadToTitle(page);
  const beforeConfirmation = await rawSave(page);

  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await expect(
    page.getByText('This erases your garage, money and unlocks. Start over?', {
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__scrapRig.mode())).toBe('title');
  expect(await rawSave(page)).toEqual(beforeConfirmation);

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByText('This erases your garage, money and unlocks. Start over?', {
      exact: true,
    }),
  ).toBeHidden();
  expect(await rawSave(page)).toEqual(beforeConfirmation);
  await expect(
    page.getByRole('button', { name: 'Continue', exact: true }),
  ).toBeEnabled();

  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForFunction(() => window.__scrapRig.mode() === 'editor');

  expect(await page.evaluate(() => window.__scrapRig.profile())).toEqual(
    DEFAULT_PROFILE,
  );
  const replacement = await page.evaluate(
    () => JSON.parse(window.__scrapRig.getBlueprintJson()) as BlueprintSnapshot,
  );
  expect(replacement.name).toBe('starter-rig');
  expect(replacement.parts.some((part) => part.id === 'saved-frame')).toBe(
    false,
  );
  expect(await rawSave(page)).toEqual({ profile: null, blueprints: null });
  await expect(
    page.getByText('ZOMBIE MOTORWORKS', { exact: true }),
  ).toHaveCount(0);
});

test('Menu disposes the editor and returns to the title', async ({ page }) => {
  await openTitle(page);
  await startNewGame(page);

  await page.getByRole('button', { name: 'Menu', exact: true }).click();

  await page.waitForFunction(() => window.__scrapRig.mode() === 'title');
  await expect(
    page.getByText('ZOMBIE MOTORWORKS', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.palette')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Menu', exact: true }),
  ).toHaveCount(0);
});

test('Menu is hidden during an active run Build Phase', async ({ page }) => {
  await openTitle(page);
  await startNewGame(page);
  expect(await page.evaluate(() => window.__scrapRig.enterSurvival())).toBe(
    true,
  );
  await page.evaluate(() => {
    window.__scrapRig.setSimPaused(true);
    window.__scrapRig.forceWaveComplete();
  });
  await page.waitForFunction(() => window.__scrapRig.mode() === 'editor');

  expect(await page.evaluate(() => window.__scrapRig.runState())).toEqual({
    wave: 1,
    inBuildPhase: true,
  });
  await expect(
    page.getByRole('button', {
      name: 'Menu',
      exact: true,
      includeHidden: true,
    }),
  ).toBeHidden();
});
