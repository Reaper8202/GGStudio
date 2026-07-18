// Visual verification: boot the app, screenshot editor, then test chamber.
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:4173/?debug=1');
await page.waitForFunction(() => window.__scrapRig !== undefined, null, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'docs/screenshots/editor.png' });

// Enter test chamber via debug seam, drive forward 2.5s.
const entered = await page.evaluate(() => window.__scrapRig.enterTest());
console.log('entered chamber:', entered);
await page.waitForTimeout(800);
const before = await page.evaluate(() => window.__scrapRig.telemetry());
await page.evaluate(() => window.__scrapRig.setControls({ throttle: 1 }));
await page.waitForTimeout(2500);
const after = await page.evaluate(() => window.__scrapRig.telemetry());
await page.screenshot({ path: 'docs/screenshots/chamber.png' });
console.log('pos before:', JSON.stringify(before?.position));
console.log('pos after:', JSON.stringify(after?.position));
console.log('speed:', after?.speedKmh, 'rpm:', after?.rpm, 'grounded:', after?.groundedWheels);

await browser.close();
process.exit(0);
