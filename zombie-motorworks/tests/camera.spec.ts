import { expect, test } from '@playwright/test';
import { boot, buildBasicRig } from './seam.ts';

const dist = (a: [number, number, number], b: [number, number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('W drives the vehicle away from the follow camera, not toward it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await boot(page);
  await buildBasicRig(page);

  expect(
    await page.evaluate(() => {
      const entered = window.__scrapRig.enterSurvival();
      if (entered) window.__scrapRig.setSimPaused(true);
      return entered;
    }),
  ).toBe(true);

  const result = await page.evaluate(() => {
    // Past the 3s countdown, plus settling on the suspension.
    window.__scrapRig.stepSim(220);
    const before = window.__scrapRig.survivalTelemetry();
    if (!before) throw new Error('no survival telemetry');
    window.__scrapRig.setControls({ throttle: 1 });
    window.__scrapRig.stepSim(180);
    const after = window.__scrapRig.survivalTelemetry();
    if (!after) throw new Error('no survival telemetry after driving');
    return {
      cameraPos: before.cameraPos,
      posBefore: before.vehiclePos,
      posAfter: after.vehiclePos,
    };
  });

  const distBefore = dist(result.posBefore, result.cameraPos);
  const distAfter = dist(result.posAfter, result.cameraPos);
  // Forward throttle must increase the distance to where the camera sat —
  // the ported zombie-car camera used to park IN FRONT of the vehicle.
  expect(distAfter - distBefore).toBeGreaterThan(2);
});
