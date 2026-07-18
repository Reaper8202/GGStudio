import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:4173/?debug=1');
await page.waitForFunction(() => window.__scrapRig !== undefined);
await page.evaluate(() => window.__scrapRig.enterTest());
for (const scenario of ['ramp', 'drop', 'bumps']) {
  await page.evaluate((s) => window.__scrapRig.setScenario(s), scenario);
  await page.waitForTimeout(1000);
  const before = await page.evaluate(() => window.__scrapRig.telemetry());
  await page.evaluate(() => window.__scrapRig.setControls({ throttle: 1 }));
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.__scrapRig.setControls({ throttle: 0, brake: 1 }));
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__scrapRig.telemetry());
  console.log(`${scenario}: alive ${before.aliveParts}->${after.aliveParts}, detached ${after.detachedParts}, wheels ${after.totalWheels}`);
}
await browser.close();
process.exit(0);
