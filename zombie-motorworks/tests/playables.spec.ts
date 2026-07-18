import { expect, test, type Page } from '@playwright/test';

const PROFILE_STORAGE_KEY = 'scraprig.profile.v1';
const BLUEPRINT_STORAGE_KEY = 'scraprig.blueprints.v1';

/**
 * Installs a fake YouTube Playables SDK before any page script runs. The real
 * SDK script tag may also execute, so the fake is pinned with a non-writable
 * property. Cloud state round-trips through window.__seedDoc (hydration) and
 * window.__fakeSaves (captured saveData payloads).
 */
async function installFakeYtGame(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__fakeSaves = [];
    const fake = {
      IN_PLAYABLES_ENV: true,
      game: {
        firstFrameReady: () => {
          w.__firstFrameReady = true;
        },
        gameReady: () => {
          w.__gameReady = true;
        },
        loadData: async () => (w.__seedDoc as string | undefined) ?? '',
        saveData: async (doc: string) => {
          (w.__fakeSaves as string[]).push(doc);
        },
      },
      system: {
        isAudioEnabled: () => true,
        onAudioEnabledChange: () => {},
        onPause: (cb: () => void) => {
          w.__pauseCb = cb;
        },
        onResume: (cb: () => void) => {
          w.__resumeCb = cb;
        },
      },
    };
    Object.defineProperty(window, 'ytgame', {
      value: fake,
      writable: false,
      configurable: false,
    });
  });
}

async function waitForTitle(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      window.__scrapRig !== undefined && window.__scrapRig.mode() === 'title',
    null,
    { timeout: 20_000 },
  );
}

test('Playables env: saves flow through ytgame and hydrate on reload', async ({
  page,
}) => {
  await installFakeYtGame(page);
  await page.goto('/?debug=1');
  await waitForTitle(page);

  // Lifecycle signals fired once the title rendered.
  expect(await page.evaluate(() => window.__firstFrameReady)).toBe(true);
  expect(await page.evaluate(() => window.__gameReady)).toBe(true);

  // Start a game and save; the write must reach ytgame.saveData…
  expect(await page.evaluate(() => window.__scrapRig.newGame())).toBe(true);
  await page.waitForFunction(() => window.__scrapRig.mode() === 'editor');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.__fakeSaves.length > 0, null, {
    timeout: 10_000,
  });

  // …and never touch localStorage.
  const local = await page.evaluate(
    ([profileKey, blueprintKey]) => ({
      profile: localStorage.getItem(profileKey),
      blueprints: localStorage.getItem(blueprintKey),
    }),
    [PROFILE_STORAGE_KEY, BLUEPRINT_STORAGE_KEY] as const,
  );
  expect(local).toEqual({ profile: null, blueprints: null });

  const doc = await page.evaluate(
    () => window.__fakeSaves[window.__fakeSaves.length - 1],
  );
  const parsed = JSON.parse(doc) as Record<string, string>;
  expect(Object.keys(parsed)).toEqual(
    expect.arrayContaining([PROFILE_STORAGE_KEY, BLUEPRINT_STORAGE_KEY]),
  );

  // A pause request flushes synchronously scheduled writes without crashing.
  await page.evaluate(() => {
    (window.__pauseCb as () => void)();
    (window.__resumeCb as () => void)();
  });

  // Reload with the captured doc as the cloud save: Continue must appear.
  await page.addInitScript((seed: string) => {
    (window as unknown as Record<string, unknown>).__seedDoc = seed;
  }, doc);
  await page.reload();
  await waitForTitle(page);
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
});

declare global {
  interface Window {
    __fakeSaves: string[];
    __firstFrameReady?: boolean;
    __gameReady?: boolean;
    __pauseCb?: unknown;
    __resumeCb?: unknown;
  }
}
