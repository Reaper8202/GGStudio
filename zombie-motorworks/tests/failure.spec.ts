import { expect, test } from '@playwright/test';
import { boot, buildBasicRig, place, settle } from './seam.ts';

test('fresh wheels are auto-configured; explicit wheel choices are preserved', async ({ page }) => {
  await boot(page);
  await buildBasicRig(page);
  // Fresh wheels get sensible defaults filled in (driven + braking + preset).
  const wheels = await page.evaluate(() => JSON.parse(window.__scrapRig.getBlueprintJson()).parts.filter((p: { defId: string }) => p.defId === 'wheel-standard'));
  expect(wheels.every((wheel: { config: { driven: boolean; braking: boolean; suspensionPreset: string } }) =>
    wheel.config.driven && wheel.config.braking && wheel.config.suspensionPreset === 'standard',
  )).toBe(true);
  // An explicit player choice must survive editor refreshes (not be stomped).
  expect(
    await page.evaluate(() => window.__scrapRig.configureAt({ x: 2, y: 1, z: 2 }, { driven: false })),
  ).toBe(true);
  const after = await page.evaluate(() => JSON.parse(window.__scrapRig.getBlueprintJson()).parts.find((p: { pos: { x: number; z: number } }) => p.pos.x === 2 && p.pos.z === 2));
  expect(after.config.driven).toBe(false);
});

test('tall narrow rigs warn about rollover and actually roll in a hard turn', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  await buildBasicRig(page);
  // Stack a heavy tower to the grid ceiling: SSF drops well below tire grip,
  // so rollover (not drift) is the physical outcome.
  for (let y = 2; y <= 8; y++) {
    const r = await place(page, 'frame-reinforced', { x: 0, y, z: 1 });
    expect(r.ok, `tower level ${y}: ${r.issues.join(',')}`).toBe(true);
  }
  const analysis = await page.evaluate(() => window.__scrapRig.analyze());
  const codes = analysis.warnings.map((w) => w.code);
  expect(codes.join(',')).toMatch(/HIGH_COM|NARROW_TRACK/);

  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(true);
  await settle(page);
  // Short run-up (stay on the high-grip asphalt pad), then a sustained turn.
  await page.evaluate(() => window.__scrapRig.setControls({ throttle: 1 }));
  await settle(page, 1700);
  await page.evaluate(() => window.__scrapRig.setControls({ steer: 1 }));
  await settle(page, 6000);
  const t = await page.evaluate(() => window.__scrapRig.telemetry());
  // Roll/pitch magnitude from quaternion: tilt of the body Y axis off world Y.
  const tilt = await page.evaluate(() => {
    const q = window.__scrapRig.telemetry().rotation;
    // Body up = R * (0,1,0): uy = 1 - 2(x^2 + z^2)
    return 1 - 2 * (q.x * q.x + q.z * q.z);
  });
  // uy < 0.5 means tipped more than 60° — rolled over.
  expect(tilt, `tilt uy=${tilt}, speed=${t.speedKmh}`).toBeLessThan(0.5);
});

test('flat-ground control rig does NOT roll in the same turn (baseline)', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  await buildBasicRig(page);
  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(true);
  await settle(page);
  await page.evaluate(() => window.__scrapRig.setControls({ throttle: 1 }));
  await settle(page, 1700);
  await page.evaluate(() => window.__scrapRig.setControls({ steer: 1 }));
  await settle(page, 6000);
  const tilt = await page.evaluate(() => {
    const q = window.__scrapRig.telemetry().rotation;
    return 1 - 2 * (q.x * q.x + q.z * q.z);
  });
  expect(tilt).toBeGreaterThan(0.8);
});
