import { expect, test } from '@playwright/test';
import { boot, buildBasicRig, orientOf, place, settle } from './seam.ts';

test('vehicle drives forward, steers, and the blueprint survives the round trip', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  await buildBasicRig(page);
  const bpBefore = await page.evaluate(() => window.__scrapRig.getBlueprintJson());

  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(true);
  await settle(page);
  const rest = await page.evaluate(() => window.__scrapRig.telemetry());
  expect(rest.groundedWheels).toBe(4);

  // Straight-line acceleration.
  await page.evaluate(() => window.__scrapRig.setControls({ throttle: 1 }));
  await settle(page, 2000);
  const t1 = await page.evaluate(() => window.__scrapRig.telemetry());
  expect(t1.position.z).toBeGreaterThan(3);
  expect(t1.speedKmh).toBeGreaterThan(10);
  expect(t1.fuel).toBeLessThan(40);

  // Steering yaws the vehicle and bends the path.
  await page.evaluate(() => window.__scrapRig.setControls({ steer: 1 }));
  await settle(page, 1600);
  const t2 = await page.evaluate(() => window.__scrapRig.telemetry());
  expect(Math.abs(t2.position.x - t1.position.x)).toBeGreaterThan(1);

  // Braking stops it.
  await page.evaluate(() => window.__scrapRig.setControls({ throttle: 0, steer: 0, brake: 1 }));
  await settle(page, 2500);
  const t3 = await page.evaluate(() => window.__scrapRig.telemetry());
  expect(t3.speedKmh).toBeLessThan(4);

  // Back to editor: blueprint untouched by runtime damage/state.
  await page.evaluate(() => window.__scrapRig.backToEditor());
  const bpAfter = await page.evaluate(() => window.__scrapRig.getBlueprintJson());
  expect(bpAfter).toBe(bpBefore);
});

test('underpowered heavy rig struggles on the ramp scenario', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  await buildBasicRig(page);
  // Weigh it down hard: a slab of reinforced frames on the deck.
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 2; z++) {
      await place(page, 'frame-reinforced', { x, y: 2, z });
      await place(page, 'frame-reinforced', { x, y: 3, z });
    }
  }
  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(true);
  await page.evaluate(() => window.__scrapRig.setScenario('ramp'));
  await settle(page);
  await page.evaluate(() => window.__scrapRig.setControls({ throttle: 1 }));
  await settle(page, 6000);
  const heavy = await page.evaluate(() => window.__scrapRig.telemetry());
  // The 30° dirt ramp starts at z≈16 (analyzer says ~10° max slope for this mass):
  // the rig must NOT have crested it (crest sits ~4m up).
  expect(heavy.position.y).toBeLessThan(2.5);
});

test('wheels mounted sideways produce no propulsion (natural failure)', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  await buildBasicRig(page);
  // Replace nothing — build a second rig variant instead: flip every wheel
  // 90° about X so suspension points horizontally.
  const rollX90 = await orientOf(page, 'rollX90');
  const { yaw180 } = await page.evaluate(() => window.__scrapRig.orient);
  await page.evaluate(() => {
    window.__scrapRig.loadBlueprintJson(
      JSON.stringify({ schemaVersion: 2, id: 't', name: 't', parts: [] }),
    );
  });
  await buildRigWithWheelOrients(page, rollX90, yaw180);
  const analysis = await page.evaluate(() => window.__scrapRig.analyze());
  const codes = analysis.warnings.map((w) => w.code);
  expect(codes).toContain('WHEEL_AXLE_ORIENTATION');

  expect(await page.evaluate(() => window.__scrapRig.enterTest())).toBe(true);
  await settle(page);
  await page.evaluate(() => window.__scrapRig.setControls({ throttle: 1 }));
  await settle(page, 2500);
  const t = await page.evaluate(() => window.__scrapRig.telemetry());
  // No wheel touches down properly: the rig sits on its belly and goes nowhere.
  expect(Math.abs(t.position.z)).toBeLessThan(1.5);
  expect(t.speedKmh).toBeLessThan(3);
});

async function buildRigWithWheelOrients(
  page: import('@playwright/test').Page,
  leftOrient: number,
  yaw180: number,
): Promise<void> {
  const steps: [string, { x: number; y: number; z: number }][] = [
    ['chassis-core', { x: 0, y: 1, z: 0 }],
    ['driver-seat', { x: 0, y: 2, z: 0 }],
    ['frame-box', { x: 0, y: 1, z: 1 }],
    ['frame-box', { x: 0, y: 1, z: 2 }],
    ['frame-box', { x: 0, y: 1, z: -1 }],
    ['frame-box', { x: 1, y: 1, z: 0 }],
    ['frame-box', { x: -1, y: 1, z: 0 }],
    ['frame-box', { x: 1, y: 1, z: 1 }],
    ['frame-box', { x: -1, y: 1, z: 1 }],
    ['frame-box', { x: 1, y: 1, z: -1 }],
    ['frame-box', { x: -1, y: 1, z: -1 }],
    ['frame-box', { x: 1, y: 1, z: 2 }],
    ['frame-box', { x: -1, y: 1, z: 2 }],
    ['frame-box', { x: 1, y: 1, z: -2 }],
    ['frame-box', { x: -1, y: 1, z: -2 }],
    ['frame-box', { x: 0, y: 1, z: -2 }],
    ['engine-small', { x: 0, y: 2, z: -2 }],
    ['fuel-tank', { x: 0, y: 2, z: -1 }],
  ];
  for (const [d, p] of steps) {
    const r = await place(page, d, p);
    if (!r.ok) throw new Error(`${d}: ${r.issues.join(',')}`);
  }
  // Left wheels: rolled 90° about X (suspension sideways). Right side needs the
  // yaw-180 composed in so its inner socket faces the frame side.
  const rightOrient = await page.evaluate(
    ([a, b]) => window.__scrapRig.composeOrient(a, b),
    [leftOrient, yaw180] as const,
  );
  const wheels: [{ x: number; y: number; z: number }, number][] = [
    [{ x: 2, y: 1, z: 2 }, rightOrient],
    [{ x: -2, y: 1, z: 2 }, leftOrient],
    [{ x: 2, y: 1, z: -2 }, rightOrient],
    [{ x: -2, y: 1, z: -2 }, leftOrient],
  ];
  for (const [p, o] of wheels) {
    const r = await place(page, 'wheel-standard', p, o);
    if (!r.ok) throw new Error(`sideways wheel at ${JSON.stringify(p)}: ${r.issues.join(',')}`);
  }
}
