import { expect, test } from '@playwright/test';
import { boot, buildBasicRig } from './seam.ts';

test('game over shows the final score and ranked leaderboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await boot(page);
  await buildBasicRig(page);
  expect(
    await page.evaluate(() => {
      const entered = window.__scrapRig.enterSurvival();
      if (entered) window.__scrapRig.setSimPaused(true);
      return entered;
    }),
  ).toBe(true);

  const finalScore = await page.evaluate(
    () => window.__scrapRig.survivalTelemetry()?.score ?? -1,
  );
  expect(finalScore).toBeGreaterThanOrEqual(0);
  await page.evaluate(() => window.__scrapRig.forceGameOver());

  const gameOver = page.locator('.survival-gameover');
  await expect(gameOver).toBeVisible();
  await expect(gameOver.locator('.survival-gameover__score')).toHaveText(
    finalScore.toLocaleString(),
  );
  await expect(gameOver.locator('.leaderboard')).toBeVisible();
  await expect(gameOver.locator('.leaderboard table')).toBeVisible();

  const overflow = await page.evaluate(() => {
    const leaderboard = document.querySelector<HTMLElement>(
      '.survival-gameover .leaderboard',
    );
    return {
      pageClientWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      leaderboardClientWidth: leaderboard?.clientWidth ?? 0,
      leaderboardScrollWidth: leaderboard?.scrollWidth ?? 0,
    };
  });
  expect(overflow.pageScrollWidth).toBeLessThanOrEqual(
    overflow.pageClientWidth,
  );
  expect(overflow.leaderboardScrollWidth).toBeGreaterThan(
    overflow.leaderboardClientWidth,
  );
});
