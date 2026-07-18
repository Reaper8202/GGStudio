import { expect, test } from '@playwright/test';
import { boot, buildBasicRig } from './seam.ts';

test('full-speed wall impact does not send the vehicle into an uncontrolled spin', async ({
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
    window.__scrapRig.stepSim(220); // past countdown + settle
    window.__scrapRig.setControls({ throttle: 1 });
    // Drive straight +Z from the centre spawn toward the perimeter wall
    // (half-size 35). Detect the impact as forward progress stalling.
    let prevZ = window.__scrapRig.survivalTelemetry()!.vehiclePos[2];
    let travelled = 0;
    let impact = false;
    for (let i = 0; i < 50; i++) {
      window.__scrapRig.stepSim(60);
      const z = window.__scrapRig.survivalTelemetry()!.vehiclePos[2];
      const delta = z - prevZ;
      travelled += Math.abs(delta);
      prevZ = z;
      if (travelled > 5 && delta < 0.3) {
        impact = true;
        break;
      }
    }
    // Let the impact response play out, then sample the body state.
    window.__scrapRig.setControls({ throttle: 0 });
    window.__scrapRig.stepSim(120);
    const t = window.__scrapRig.survivalTelemetry()!;
    return { impact, travelled, rotation: t.rotation, angvel: t.angvel };
  });

  expect(result.impact, `never hit the wall (travelled ${result.travelled}m)`).toBe(
    true,
  );
  // Yaw rate must have been arrested by the soft limiter + angular damping.
  expect(Math.abs(result.angvel[1])).toBeLessThan(1.0);
  // And the vehicle must still be upright: body up-vector y component.
  const [qx, , qz] = result.rotation;
  const upY = 1 - 2 * (qx * qx + qz * qz);
  expect(upY).toBeGreaterThan(0.7);
});
