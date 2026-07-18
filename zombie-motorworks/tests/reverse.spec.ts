import { expect, test } from '@playwright/test';
import { boot, buildBasicRig } from './seam.ts';

test('S reverses from a standstill, and forward drive still works after', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await boot(page);
  await buildBasicRig(page);
  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(true);

  const result = await page.evaluate(() => {
    window.__scrapRig.setSimPaused(true);
    window.__scrapRig.stepSim(120); // settle on suspension
    window.__scrapRig.setControls({ reverse: 1 });
    window.__scrapRig.stepSim(60);
    const reversingSpeed = window.__scrapRig.telemetry().speedKmh;
    window.__scrapRig.stepSim(180);
    const reversedZ = window.__scrapRig.telemetry().position.z;
    window.__scrapRig.setControls({ reverse: 0, throttle: 1 });
    window.__scrapRig.stepSim(300);
    const forwardZ = window.__scrapRig.telemetry().position.z;
    return { reversingSpeed, reversedZ, forwardZ };
  });

  // Vehicle spawns at the origin facing +Z: reverse must drive it to -Z.
  expect(result.reversedZ).toBeLessThan(-1.5);
  expect(result.reversingSpeed).toBeGreaterThan(0);
  // Releasing S and applying throttle drives forward again.
  expect(result.forwardZ - result.reversedZ).toBeGreaterThan(2);
});

test('S acts as a brake while rolling forward, then reverses once stopped', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await boot(page);
  await buildBasicRig(page);
  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(true);

  const result = await page.evaluate(() => {
    window.__scrapRig.setSimPaused(true);
    window.__scrapRig.stepSim(120);
    window.__scrapRig.setControls({ throttle: 1 });
    window.__scrapRig.stepSim(180); // build forward speed
    const cruisingKmh = window.__scrapRig.telemetry().speedKmh;
    // Hold S: should brake to a stop first…
    window.__scrapRig.setControls({ throttle: 0, reverse: 1 });
    window.__scrapRig.stepSim(120);
    const afterBrakeKmh = window.__scrapRig.telemetry().speedKmh;
    const zAtStop = window.__scrapRig.telemetry().position.z;
    // …then, still holding S, start reversing.
    window.__scrapRig.stepSim(240);
    const finalZ = window.__scrapRig.telemetry().position.z;
    return { cruisingKmh, afterBrakeKmh, zAtStop, finalZ };
  });

  expect(result.cruisingKmh).toBeGreaterThan(10);
  expect(result.afterBrakeKmh).toBeLessThan(result.cruisingKmh);
  expect(result.finalZ).toBeLessThan(result.zAtStop - 0.5);
});
