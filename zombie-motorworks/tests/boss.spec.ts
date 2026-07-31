import { expect, test } from '@playwright/test';
import { boot, buildBasicRig, place, settle } from './seam.ts';

test('a boss wave spawns one boss, shows its health bar, and gates the clear', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await boot(page);
  await buildBasicRig(page);
  expect((await place(page, 'turret', { x: 0, y: 2, z: 1 })).ok).toBe(true);
  expect(await page.evaluate(() => window.__scrapRig.enterSurvival())).toBe(
    true,
  );

  const bossHud = page.locator('.survival-boss-hud');
  await expect(bossHud).toBeHidden();

  // Wave 5 is the first boss wave. The boss heads the spawn queue, so it is on
  // the field almost immediately.
  await page.evaluate(() => window.__scrapRig.debugStartWave(5));
  await page.waitForFunction(
    () => window.__scrapRig.survivalTelemetry()?.boss != null,
    null,
    { timeout: 20_000 },
  );

  const spawned = await page.evaluate(
    () => window.__scrapRig.survivalTelemetry()!,
  );
  expect(spawned.wave).toBe(5);
  expect(spawned.boss).not.toBeNull();
  expect(spawned.boss!.name).toBe('The Sledge');
  expect(spawned.boss!.maxHealth).toBeGreaterThan(0);
  expect(spawned.boss!.health).toBe(spawned.boss!.maxHealth);
  // Boss waves are a duel: the boss is the only enemy on the field.
  expect(spawned.zombiesAlive).toBe(1);

  await expect(bossHud).toBeVisible();
  await expect(bossHud.getByText('The Sledge')).toBeVisible();
  await expect(page.locator('.survival-boss-hud__value')).toHaveText('100%');

  // The wave cannot clear while the boss lives.
  await settle(page, 1500);
  expect(
    await page.evaluate(() => window.__scrapRig.survivalTelemetry()?.phase),
  ).toBe('active');

  // Killing it clears the wave and retires the bar.
  await page.evaluate(() => window.__scrapRig.debugKillAllZombies());
  await expect(page.getByText('Wave 5 Cleared', { exact: true })).toBeVisible();
  await expect(bossHud).toBeHidden();
  expect(
    await page.evaluate(() => window.__scrapRig.survivalTelemetry()?.boss),
  ).toBeNull();
});

test('the boss closes on a parked rig and its hammer slam damages parts', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await boot(page);
  await buildBasicRig(page);
  expect(await page.evaluate(() => window.__scrapRig.enterSurvival())).toBe(
    true,
  );
  await page.evaluate(() => window.__scrapRig.debugStartWave(5));
  await page.waitForFunction(
    () => window.__scrapRig.survivalTelemetry()?.boss != null,
    null,
    { timeout: 20_000 },
  );

  const before = await page.evaluate(
    () => window.__scrapRig.survivalTelemetry()!,
  );
  expect(before.integrityPct).toBe(100);

  // Drive the simulation deterministically rather than in real time: the boss
  // can spawn ~50 m out and lumbers in at under 2 m/s, far longer than a
  // headless page simulates inside a sane timeout. Step one simulated second at
  // a time and stop the moment the first hammer connects.
  await page.evaluate(() => window.__scrapRig.setSimPaused(true));
  const landedAfterSeconds = await page.evaluate(() => {
    for (let second = 1; second <= 90; second += 1) {
      window.__scrapRig.stepSim(60);
      const integrity = window.__scrapRig.survivalTelemetry()?.integrityPct;
      if (integrity !== undefined && integrity < 100) return second;
    }
    return -1;
  });
  expect(landedAfterSeconds).toBeGreaterThan(0);

  const after = await page.evaluate(
    () => window.__scrapRig.survivalTelemetry()!,
  );
  expect(after.integrityPct).toBeLessThan(before.integrityPct);
  // A slam hits every part inside the circle at once, so more than one part of
  // a parked rig should be showing damage.
  const damaged = Object.entries(after.partHp).filter(
    ([partId, hp]) => hp < (before.partHp[partId] ?? 0),
  );
  expect(damaged.length).toBeGreaterThan(1);
  // The boss survives the encounter it just won.
  expect(after.boss).not.toBeNull();
});

test('wave 10 summons The Alchemist, which throws acid vials from range', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await boot(page);
  await buildBasicRig(page);
  expect(await page.evaluate(() => window.__scrapRig.enterSurvival())).toBe(
    true,
  );

  // Wave 10 is the second slot in the boss rotation, so it is the other boss.
  await page.evaluate(() => window.__scrapRig.debugStartWave(10));
  await page.waitForFunction(
    () => window.__scrapRig.survivalTelemetry()?.boss != null,
    null,
    { timeout: 20_000 },
  );

  const spawned = await page.evaluate(
    () => window.__scrapRig.survivalTelemetry()!,
  );
  expect(spawned.wave).toBe(10);
  expect(spawned.boss!.name).toBe('The Alchemist');
  expect(spawned.zombiesAlive).toBe(1);
  await expect(
    page.locator('.survival-boss-hud').getByText('The Alchemist'),
  ).toBeVisible();

  // It never closes to melee, so unlike the Sledge test the damage has to
  // arrive as a projectile or the acid puddle it leaves behind. Step
  // deterministically and wait for the first vial (or its puddle) to land on
  // the parked rig.
  const before = await page.evaluate(
    () => window.__scrapRig.survivalTelemetry()!,
  );
  expect(before.integrityPct).toBe(100);

  await page.evaluate(() => window.__scrapRig.setSimPaused(true));
  const landedAfterSeconds = await page.evaluate(() => {
    for (let second = 1; second <= 120; second += 1) {
      window.__scrapRig.stepSim(60);
      const integrity = window.__scrapRig.survivalTelemetry()?.integrityPct;
      if (integrity !== undefined && integrity < 100) return second;
    }
    return -1;
  });
  expect(landedAfterSeconds).toBeGreaterThan(0);

  const after = await page.evaluate(
    () => window.__scrapRig.survivalTelemetry()!,
  );
  expect(after.integrityPct).toBeLessThan(before.integrityPct);
  // A vial's direct splash (or the puddle it leaves) damages the part it
  // lands near, unlike the slam's whole circle.
  const damaged = Object.entries(after.partHp).filter(
    ([partId, hp]) => hp < (before.partHp[partId] ?? 0),
  );
  expect(damaged.length).toBeGreaterThanOrEqual(1);
  expect(after.boss).not.toBeNull();
});

test('an ordinary wave never shows the boss health bar', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  await buildBasicRig(page);
  expect(await page.evaluate(() => window.__scrapRig.enterSurvival())).toBe(
    true,
  );

  await page.evaluate(() => window.__scrapRig.debugStartWave(4));
  await settle(page, 2500);

  const telemetry = await page.evaluate(
    () => window.__scrapRig.survivalTelemetry()!,
  );
  expect(telemetry.wave).toBe(4);
  expect(telemetry.boss).toBeNull();
  expect(telemetry.zombiesAlive).toBeGreaterThan(1);
  await expect(page.locator('.survival-boss-hud')).toBeHidden();
});
