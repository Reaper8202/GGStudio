import { expect, test, type Page } from '@playwright/test';
import { boot, buildBasicRig, place, settle } from './seam.ts';

/**
 * Both cornering tests must judge the rigs at the SAME speed, and a heavy build
 * accelerates slowly, so run up to a speed target rather than for a fixed time.
 * 55 km/h is a comfortable cornering speed on the asphalt pad.
 */
const CORNERING_SPEED_KMH = 55;

async function accelerateToCorneringSpeed(page: Page): Promise<void> {
  await page.evaluate(() => window.__scrapRig.setControls({ throttle: 1 }));
  await page.waitForFunction(
    (target) => window.__scrapRig.telemetry().speedKmh >= (target as number),
    CORNERING_SPEED_KMH,
    { timeout: 30_000 },
  );
}

/** Tilt of the body Y axis off world Y: 1 is level, 0.5 is tipped ~60°. */
async function bodyUprightness(page: Page): Promise<number> {
  return page.evaluate(() => {
    const q = window.__scrapRig.telemetry().rotation;
    // Body up = R * (0,1,0): uy = 1 - 2(x^2 + z^2)
    return 1 - 2 * (q.x * q.x + q.z * q.z);
  });
}

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

test('tall narrow rigs warn about rollover and lean hard in a turn', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  await buildBasicRig(page);
  // Stack a heavy tower to the grid ceiling: SSF drops well below tire grip,
  // so the tower is the thing that loses the corner, not the tyres.
  for (let y = 2; y <= 8; y++) {
    const r = await place(page, 'frame-reinforced', { x: 0, y, z: 1 });
    expect(r.ok, `tower level ${y}: ${r.issues.join(',')}`).toBe(true);
  }
  const analysis = await page.evaluate(() => window.__scrapRig.analyze());
  const codes = analysis.warnings.map((w) => w.code);
  expect(codes.join(',')).toMatch(/HIGH_COM|NARROW_TRACK/);

  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(true);
  await settle(page);
  await accelerateToCorneringSpeed(page);
  await page.evaluate(() => window.__scrapRig.setControls({ steer: 1 }));
  await settle(page, 6000);
  const t = await page.evaluate(() => window.__scrapRig.telemetry());
  const tilt = await bodyUprightness(page);
  // The rig heels over past ~50° and hangs there. It no longer inverts: the
  // downforce, lateral-stability and roll damping guards in RuntimeVehicle
  // arrest the roll before it goes over. The penalty for a high CoM is the
  // lean itself, which is why the paired control test below is the real
  // assertion — a level rig in the identical corner stays flat (uy ~0.998).
  expect(tilt, `tilt uy=${tilt}, speed=${t.speedKmh}`).toBeLessThan(0.7);
});

test('flat-ground control rig does NOT roll in the same turn (baseline)', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  await buildBasicRig(page);
  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(true);
  await settle(page);
  await accelerateToCorneringSpeed(page);
  await page.evaluate(() => window.__scrapRig.setControls({ steer: 1 }));
  await settle(page, 6000);
  const tilt = await bodyUprightness(page);
  expect(tilt).toBeGreaterThan(0.9);
});
